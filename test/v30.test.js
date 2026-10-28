// v3.0: hesab ayarları, admin toplu balans, dərəcələr, yeni raundun minimumu, hədiyyə idempotentliyi (real HTTP + WebSocket): balans məxfiliyi, xal məxfiliyi, çat tarixçəsi,
// onlayn status və bağlantının bərpası, masadan borc təklifi/istəyi (atomik, idempotent, raund növbəsi ilə),
// "Şir" hədiyyəsinin bir dəfə tutulması, sağlamlıq yoxlaması.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../server/app.js';
import { rankFor, RANKS } from '../server/ranks.js';
import { score3 as clientScore } from '../public/score.js';
import { handScore, newDeck, shuffle } from '../server/game/cards.js';
import { checkPassword } from '../server/store.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let app, base, dir, dbFile;
const key = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-v30-'));
  dbFile = path.join(dir, 't.db');
  app = await createApp({ dbFile, dbUrl: process.env.TEST_DATABASE_URL || null, botDelay: [5, 15], limits: { register: 1e6, login: 1e6 }, debtIntervalMs: 3_600_000 });
  base = `http://127.0.0.1:${await app.listen(0)}`;
});
after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function http(pathname, { body, cookie } = {}) {
  const res = await fetch(base + pathname, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: res.headers.get('set-cookie')?.split(';')[0], text: '' };
}
const cookies = new Map();
async function login(u, p = '123456') {
  if (cookies.has(u)) return cookies.get(u);
  const r = await http('/api/login', { body: { username: u, password: p } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  cookies.set(u, r.cookie);
  return r.cookie;
}
const adm = () => login('admin', 'admin123');
async function makeUser(username, balance = 0) {
  const r = await http('/api/admin/users', { body: { username, displayName: username[0].toUpperCase() + username.slice(1), password: '123456' }, cookie: await adm() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = Number(r.data.id);
  await app.db.run('UPDATE users SET balance = $1 WHERE id = $2', [balance, id]);
  return id;
}
const bal = async (id) => Number((await app.db.get('SELECT balance FROM users WHERE id = $1', [id])).balance);

class Client {
  constructor(cookie) {
    this.msgs = [];
    this.ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { cookie } });
    this.autoConsent = true; // v3.1: yeni raunda razılıq — test oyunçusu avtomatik "Razıyam" deyir (əl ilə yoxlanış: autoConsent=false)
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.msgs.push(m);
      if (m.t === 'room' && m.room.consent?.mine === 'wait' && this.autoConsent && this.ws.readyState === 1 && this.consentSent !== `${m.room.code}:${m.room.consent.id}`) { this.consentSent = `${m.room.code}:${m.room.consent.id}`; this.ws.send(JSON.stringify({ t: 'consent', yes: true })); }
    });
    this.ready = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  get room() { for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === 'room') return this.msgs[i].room; return null; }
  async waitFor(pred, ms = 3000) {
    const t = Date.now();
    while (Date.now() - t < ms) { for (const m of this.msgs) if (pred(m)) return m; await sleep(10); }
    throw new Error('waitFor timeout: ' + JSON.stringify(this.msgs.slice(-2)).slice(0, 800));
  }
  async waitRoom(pred, ms) { return (await this.waitFor((m) => m.t === 'room' && pred(m.room), ms)).room; }
  clear() { const r = this.msgs.filter((m) => m.t === 'room').pop(); this.msgs = r ? [r] : []; }
  close() { this.ws.close(); }
}
async function client(u) { const c = new Client(await login(u)); await c.ready; await c.waitFor((m) => m.t === 'hello'); return c; }

async function table(prefix, balances = [100, 100]) {
  const ids = []; const cs = [];
  for (let i = 0; i < balances.length; i++) ids.push(await makeUser(`${prefix}${i}`, balances[i]));
  for (let i = 0; i < balances.length; i++) cs.push(await client(`${prefix}${i}`));
  cs[0].send({ t: 'createRoom', name: prefix, visibility: 'private', settings: { ante: 10, minBet: 10 } });
  const room = await cs[0].waitRoom((r) => r.name === prefix);
  for (const c of cs.slice(1)) c.send({ t: 'joinRoom', code: room.code });
  await cs[0].waitRoom((r) => r.members.length === balances.length);
  return { ids, cs, code: room.code };
}
const leaveAll = async (cs) => { for (const c of cs) { try { c.send({ t: 'leaveRoom' }); c.close(); } catch { /* */ } } await sleep(60); };


const loginRaw = (u, p) => http('/api/login', { body: { username: u, password: p } });

test('hesab ayarları: mövcud şifrə olmadan heç nə dəyişmir; ad/telefon/şifrə; yeni şifrə iki dəfə; digər sessiyalar bağlanır', async () => {
  const id = await makeUser('acc_a', 0);
  const c1 = await login('acc_a');
  const other = (await loginRaw('acc_a', '123456')).cookie; // ikinci cihaz
  const bad = await http('/api/me/account', { body: { currentPassword: 'yanlis', displayName: 'Yeni Ad' }, cookie: c1 });
  assert.equal(bad.status, 400); assert.match(bad.data.error, /Mövcud şifrə/);
  assert.equal((await app.db.get('SELECT display_name FROM users WHERE id = $1', [id])).display_name, 'Acc_a');
  const ok = await http('/api/me/account', { body: { currentPassword: '123456', displayName: 'Yeni Ad', phone: '+994 50 123-45-67' }, cookie: c1 });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual(ok.data.changed, ['ad', 'telefon']);
  assert.equal(ok.data.user.phone, '+994501234567'); assert.equal(ok.data.user.phoneVerified, false); assert.equal(ok.data.smsVerification, false);
  const badPhone = await http('/api/me/account', { body: { currentPassword: '123456', phone: 'abc' }, cookie: c1 });
  assert.equal(badPhone.status, 400);
  const mism = await http('/api/me/account', { body: { currentPassword: '123456', newPassword: 'yeni-sifre-1', newPassword2: 'yeni-sifre-2' }, cookie: c1 });
  assert.match(mism.data.error, /eyni deyil/);
  const pw = await http('/api/me/account', { body: { currentPassword: '123456', newPassword: 'yeni-sifre-1', newPassword2: 'yeni-sifre-1' }, cookie: c1 });
  assert.equal(pw.status, 200); assert.deepEqual(pw.data.changed, ['şifrə']);
  const row = await app.db.get('SELECT pass_hash FROM users WHERE id = $1', [id]);
  assert.ok(!row.pass_hash.includes('yeni-sifre-1') && checkPassword('yeni-sifre-1', row.pass_hash));
  assert.ok(!JSON.stringify(pw.data).includes('yeni-sifre-1'));
  assert.equal((await http('/api/me', { cookie: c1 })).data.user.displayName, 'Yeni Ad'); // cari sessiya qalır
  assert.equal((await http('/api/me', { cookie: other })).data.user, null); // digər cihaz çıxarıldı
  assert.equal((await loginRaw('acc_a', '123456')).status, 400);
  assert.equal((await loginRaw('acc_a', 'yeni-sifre-1')).status, 200);
});

test('admin toplu balans: yalnız admin; ön baxış sayı; ikinci təsdiq; atomik; tarixçə/dərəcə qalır; təkrar açar ikiqat vermir; raund gedərkən olmur', async () => {
  const ids = [await makeUser('bk_a', 300), await makeUser('bk_b', 0), await makeUser('bk_c', 75)];
  await app.db.run(`INSERT INTO round_results(round_uid, user_id, outcome, net, group_key, counted, created_at) VALUES('bk-r1', $1, 'win', 50, 'x', 1, 1)`, [ids[0]]);
  const adminRow = await app.db.get(`SELECT id, balance FROM users WHERE username = 'admin'`);
  const mod = await makeUser('bk_mod', 0); await app.db.run(`UPDATE users SET role = 'moderator' WHERE id = $1`, [mod]);
  // adi oyunçu və moderator çağıra bilmir
  for (const u of ['bk_a', 'bk_mod']) {
    const r = await http('/api/admin/bulk', { body: { op: 'reset', expectCount: 1, confirm: true, key: key() }, cookie: await login(u) });
    assert.ok(r.status === 403 || r.status === 400, `${u}: ${r.status}`);
  }
  const pv = await http('/api/admin/bulk/preview?op=reset', { cookie: await adm() });
  assert.equal(pv.status, 200);
  const players = await app.db.all(`SELECT id, balance FROM users WHERE role = 'player' AND status = 'approved'`);
  assert.equal(pv.data.affected, players.filter((p) => Number(p.balance) !== 0).length);
  // ikinci təsdiq yoxdur → rədd; say uyğun deyil → rədd
  assert.equal((await http('/api/admin/bulk', { body: { op: 'reset', expectCount: pv.data.affected, key: key() }, cookie: await adm() })).status, 400);
  const wrong = await http('/api/admin/bulk', { body: { op: 'reset', expectCount: pv.data.affected + 1, confirm: true, key: key() }, cookie: await adm() });
  assert.match(wrong.data.error, /Siyahı dəyişib/);
  assert.equal(await bal(ids[0]), 300); // heç nə dəyişməyib
  const r = await http('/api/admin/bulk', { body: { op: 'reset', expectCount: pv.data.affected, confirm: true, key: key() }, cookie: await adm() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  for (const id of ids) assert.equal(await bal(id), 0);
  assert.equal(Number((await app.db.get('SELECT balance FROM users WHERE id = $1', [adminRow.id])).balance), Number(adminRow.balance)); // admin toxunulmaz
  assert.equal(Number((await app.db.get(`SELECT COUNT(*) AS n FROM round_results WHERE user_id = $1`, [ids[0]])).n), 1); // dərəcə qalır
  assert.ok((await app.db.get(`SELECT id FROM transactions WHERE user_id = $1 AND kind = 'admin_bulk'`, [ids[0]])));
  // hamısına ver: eyni açarla iki sorğu → bir dəfə
  const pg = await http('/api/admin/bulk/preview?op=grant&amount=250', { cookie: await adm() });
  const k = key();
  const g1 = await http('/api/admin/bulk', { body: { op: 'grant', amount: 250, expectCount: pg.data.affected, confirm: true, key: k }, cookie: await adm() });
  const g2 = await http('/api/admin/bulk', { body: { op: 'grant', amount: 250, expectCount: pg.data.affected, confirm: true, key: k }, cookie: await adm() });
  assert.equal(g1.status, 200); assert.equal(g2.data.duplicate, true);
  for (const id of ids) assert.equal(await bal(id), 250);
  const log = await http('/api/admin/log', { cookie: await adm() });
  assert.deepEqual(log.data.items.slice(0, 2).map((l) => l.action), ['bulk_grant', 'bulk_reset']);
  assert.equal(log.data.items[0].amount, 250); assert.ok(log.data.items[0].adminName);
  assert.equal((await http('/api/admin/log', { cookie: await login('bk_mod') })).status, 400);
  // raund gedərkən olmur
  const t = await table('bkr', [100, 100]);
  t.cs[0].send({ t: 'startRound' });
  await t.cs[0].waitRoom((x) => x.round?.phase === 'betting');
  const pv2 = await http('/api/admin/bulk/preview?op=reset', { cookie: await adm() });
  assert.equal(pv2.data.activeRounds, true);
  const blocked = await http('/api/admin/bulk', { body: { op: 'reset', expectCount: pv2.data.affected, confirm: true, key: key() }, cookie: await adm() });
  assert.match(blocked.data.error, /raund gedir/);
  await leaveAll(t.cs);
});

test('dərəcə: həddlər; tamamlanmış real raund qələbə/məğlubiyyət yazır; dərhal pas sayılmır; 24 saatda eyni tərkib limiti', async () => {
  assert.deepEqual(RANKS.map((r) => r.name), ['Yeni oyunçu', 'Həvəskar', 'Təcrübəli', 'Peşəkar', 'Ekspert', 'Usta', 'Çempion', 'Əfsanə']);
  assert.equal(rankFor(0).name, 'Yeni oyunçu'); assert.equal(rankFor(5).name, 'Həvəskar'); assert.equal(rankFor(699).name, 'Çempion'); assert.equal(rankFor(700).name, 'Əfsanə');
  assert.deepEqual(rankFor(3).next, { name: 'Həvəskar', wins: 5, left: 2 });
  const t = await table('rk', [500, 500]);
  const [A, B] = t.cs;
  const play = async (withBet) => {
    A.clear(); B.clear();
    A.send({ t: 'startRound' });
    const st = await A.waitRoom((x) => x.round?.phase === 'betting');
    const first = st.round.turn; const P = first === t.ids[0] ? A : B; const Q = first === t.ids[0] ? B : A;
    if (withBet) {
      P.send({ t: 'act', action: { type: 'xod', amount: 20, v: st.round.version } });
      const s2 = await Q.waitRoom((x) => x.round?.me?.isTurn);
      Q.send({ t: 'act', action: { type: 'pas', v: s2.round.version } });
    } else P.send({ t: 'act', action: { type: 'pas', v: st.round.version } });
    await A.waitRoom((x) => x.round?.phase === 'finished');
    await sleep(80);
    return first;
  };
  const first = await play(true);
  const winner = first;
  const loser = t.ids.find((x) => x !== first);
  const rw = await app.db.get('SELECT outcome, counted, net FROM round_results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [winner]);
  const rl = await app.db.get('SELECT outcome, counted, net FROM round_results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [loser]);
  assert.deepEqual([rw.outcome, Number(rw.counted), Number(rw.net)], ['win', 1, 10]);
  assert.deepEqual([rl.outcome, Number(rl.counted), Number(rl.net)], ['loss', 1, -10]);
  await play(false); // dərhal pas — statistikaya düşür, dərəcəyə sayılmır
  const last = await app.db.all('SELECT counted FROM round_results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [t.ids[0]]);
  assert.equal(Number(last[0].counted), 0);
  // profil: dərəcə və statistika
  const prof = await http('/api/profile', { cookie: await login(winner === t.ids[0] ? 'rk0' : 'rk1') });
  assert.ok(prof.data.rank.wins >= 1); assert.equal(prof.data.rank.rank.name, 'Yeni oyunçu');
  // 24 saatda eyni tərkib: 10-dan sonrakılar sayılmır
  const group = [...t.ids].sort((a, b) => a - b).join('-');
  for (let i = 0; i < 12; i++) await app.db.run(`INSERT INTO round_results(round_uid, user_id, outcome, net, group_key, counted, created_at) VALUES($1, $2, 'win', 5, $3, 1, $4)`, [`fake-${i}`, t.ids[0], group, Date.now()]);
  await play(true);
  const capped = await app.db.get('SELECT counted FROM round_results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [t.ids[0]]);
  assert.equal(Number(capped.counted), 0);
  await leaveAll(t.cs);
});

test('yeni raund: roundSeq artır (klient xod məbləğini otağın minimumundan başladır), minXod = otaq ayarı', async () => {
  const t = await table('ms', [10000, 10000]);
  const [A] = t.cs;
  A.send({ t: 'startRound' });
  const r1 = await A.waitRoom((x) => x.round?.phase === 'betting');
  assert.equal(r1.round.minXod, 10);
  const P = r1.round.turn === t.ids[0] ? t.cs[0] : t.cs[1];
  P.send({ t: 'act', action: { type: 'xod', amount: 5000, v: r1.round.version } });
  await A.waitRoom((x) => x.round?.currentBet === 5000);
  const Q = P === t.cs[0] ? t.cs[1] : t.cs[0];
  const s2 = await Q.waitRoom((x) => x.round?.me?.isTurn);
  Q.send({ t: 'act', action: { type: 'pas', v: s2.round.version } });
  await A.waitRoom((x) => x.round?.phase === 'finished');
  A.clear();
  A.send({ t: 'startRound' });
  const r2 = await A.waitRoom((x) => x.round?.phase === 'betting' && x.roundSeq === r1.roundSeq + 1);
  assert.equal(r2.round.minXod, 10); assert.equal(r2.round.currentBet, 0);
  await leaveAll(t.cs);
});

test('kart xalı: klientin hesabı serverlə eynidir (kart açılan kimi göstərilən xal düzgündür)', () => {
  for (let i = 0; i < 3000; i++) { const h = shuffle(newDeck()).slice(0, 3); assert.equal(clientScore(h), handScore(h), JSON.stringify(h)); }
});

test('"Masa kralı": eyni açarla iki sorğu bir dəfə tutulur, animasiya hadisəsi bir dəfə', async () => {
  const t = await table('kg', [1000, 0]);
  const [A, B] = t.cs;
  B.clear();
  const k = key();
  const [r1, r2] = await Promise.all([1, 2].map(() => http('/api/table-gift', { body: { toId: t.ids[1], giftId: 'table_king', key: k }, cookie: (cookies.get('kg0')) })));
  const okc = [r1, r2].filter((r) => r.status === 200);
  assert.equal(okc.length, 2); assert.equal(okc.filter((r) => r.data.duplicate).length, 1);
  assert.equal(await bal(t.ids[0]), 700);
  await sleep(150);
  assert.equal(B.msgs.filter((m) => m.t === 'tgift' && m.giftId === 'table_king').length, 1);
  await leaveAll(t.cs);
});
