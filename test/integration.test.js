// Server səviyyəsində testlər: HTTP API + WebSocket + SQLite (müvəqqəti fayl)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../server/app.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let app, base, dir, dbFile;

async function boot() {
  app = await createApp({ dbFile, dbUrl: process.env.TEST_DATABASE_URL || null, botDelay: [5, 15], retryFast: [40, 40, 40], retrySlow: 80, adminUser: 'admin', adminPass: 'admin123', limits: { register: 1e6, login: 1e6 } });
  const port = await app.listen(0);
  base = `http://127.0.0.1:${port}`;
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-it-'));
  dbFile = path.join(dir, 'test.db');
  process.env.NODE_ENV = 'test';
  await boot();
});
after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function http(pathname, { body, cookie, method } = {}) {
  const res = await fetch(base + pathname, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

async function login(username, password = '123456') {
  const r = await http('/api/login', { body: { username, password } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.cookie;
}

let adminCookie;
async function admin() { if (!adminCookie) adminCookie = await login('admin', 'admin123'); return adminCookie; }

async function makeUser(username, { balance = 0 } = {}) {
  const adm = await admin();
  const r = await http('/api/admin/users', { body: { username, displayName: username[0].toUpperCase() + username.slice(1), password: '123456' }, cookie: adm });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const u = await app.db.get('SELECT id FROM users WHERE username = $1', [username]);
  // test hazırlığı: balansı birbaşa təyin edirik (qeydiyyat bonusu ayrıca testdə yoxlanılır)
  await app.db.run('UPDATE users SET balance = $1 WHERE id = $2', [balance, u.id]);
  return Number(u.id);
}
const key = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

class Client {
  constructor(cookie) {
    this.msgs = [];
    this.ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { cookie } });
    this.ws.on('message', (d) => this.msgs.push(JSON.parse(d.toString())));
    this.ready = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  get room() { for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === 'room') return this.msgs[i].room; return null; }
  async waitFor(pred, ms = 3000) {
    const t = Date.now();
    while (Date.now() - t < ms) {
      for (const m of this.msgs) if (pred(m)) return m;
      await sleep(10);
    }
    throw new Error('waitFor timeout; last: ' + JSON.stringify(this.msgs.slice(-3)).slice(0, 600));
  }
  async waitRoom(pred, ms) { return (await this.waitFor((m) => m.t === 'room' && pred(m.room), ms)).room; }
  async error(ms) { return (await this.waitFor((m) => m.t === 'error', ms)); }
  clear() { const r = this.msgs.filter((m) => m.t === 'room').pop(); this.msgs = r ? [r] : []; }
  close() { this.ws.close(); }
}

async function client(username) { const c = new Client(await login(username)); await c.ready; await c.waitFor((m) => m.t === 'hello'); return c; }
const dbGet = (sql, p) => app.db.get(sql, p);
const dbAll = (sql, p) => app.db.all(sql, p);

// ---------------------------------------------------------------
test('demo: 1 insan + 5 bot, hər girişdə 10 000 demo xal, əsas balans/statistika dəyişmir', async () => {
  const id = await makeUser('demo1', { balance: 0 });
  const c = await client('demo1');
  c.send({ t: 'createRoom', demo: true, bots: 5, name: 'Demo' });
  const room = await c.waitRoom((r) => r.demo && r.members.length === 6);
  assert.equal(room.members.filter((m) => m.isBot).length, 5);
  assert.equal(room.visibility, 'private');
  assert.ok(room.members.every((m) => m.balance === 10000));
  c.send({ t: 'startRound' });
  await c.waitRoom((r) => r.round && r.practiceRound);
  for (let i = 0; i < 300; i++) {
    const r = c.room.round;
    if (r.phase === 'finished') break;
    if (r.phase === 'betting' && r.me?.isTurn) c.send({ t: 'act', action: { type: r.me.canPas ? 'pas' : 'jackpotOpen', v: r.version } });
    if (r.phase === 'discard' && r.me?.mustDiscard) c.send({ t: 'act', action: { type: 'discard', index: 0, v: r.version } });
    if (r.phase === 'offer' && r.pending.to === id) c.send({ t: 'act', action: { type: 'offerDecline', v: r.version } });
    if (r.phase === 'tieDecision' && !r.pending.voted.includes(id)) c.send({ t: 'act', action: { type: 'tieVote', choice: 'bol', v: r.version } });
    await sleep(30);
  }
  assert.equal(c.room.round.phase, 'finished');
  assert.ok(c.room.members.find((m) => m.id === id).balance < 10000);
  assert.equal(Number((await dbGet('SELECT balance FROM users WHERE id = $1', [id])).balance), 0);
  assert.equal(Number((await dbGet('SELECT COUNT(*) AS n FROM transactions WHERE user_id = $1 AND kind <> \'bonus\'', [id])).n), 0);
  // çıxıb yenidən girəndə demo balans yenə 10 000
  c.send({ t: 'leaveRoom' });
  await c.waitFor((m) => m.t === 'left');
  c.clear();
  c.send({ t: 'createRoom', demo: true, bots: 7 });
  const again = await c.waitRoom((r) => r.demo && r.members.length === 8);
  assert.equal(again.members.find((m) => m.id === id).balance, 10000);
  // demo otağına başqası qoşula bilməz, 8-dən çox yer yoxdur
  c.clear(); c.send({ t: 'addBot' });
  assert.match((await c.error()).msg, /Boş yer yoxdur/);
  c.send({ t: 'leaveRoom' }); c.close();
  await sleep(50);
});

test('otaqlar: açıq/gizli, şifrə heç vaxt göndərilmir, səhv şifrə limiti', async () => {
  await makeUser('host1'); await makeUser('gost1'); await makeUser('gost2');
  const h = await client('host1');
  h.send({ t: 'createRoom', name: 'Açıq şifrəli', visibility: 'public', password: 'sirr123' });
  const room = await h.waitRoom((r) => r.name === 'Açıq şifrəli');
  assert.equal(room.hasPassword, true);
  assert.ok(!JSON.stringify(room).includes('sirr123'));
  const g = await client('gost1');
  const list = (await http('/api/rooms', { cookie: await login('gost1') })).data.rooms;
  const item = list.find((x) => x.code === room.code);
  assert.ok(item && item.locked && item.name === 'Açıq şifrəli');
  assert.ok(!JSON.stringify(list).match(/sirr123|passHash|[0-9a-f]{32}:/));
  g.send({ t: 'joinRoom', code: room.code });
  const e1 = await g.error();
  assert.equal(e1.code, 'PASSWORD');
  for (let i = 0; i < 5; i++) { g.clear(); g.send({ t: 'joinRoom', code: room.code, password: 'yanlis' }); assert.match((await g.error()).msg, /yanlışdır/); }
  g.clear(); g.send({ t: 'joinRoom', code: room.code, password: 'sirr123' });
  assert.match((await g.error()).msg, /Çox səhv/);
  // başqa istifadəçi düzgün şifrə ilə girir (həm kodla)
  const g2 = await client('gost2');
  g2.send({ t: 'joinRoom', code: room.code.toLowerCase(), password: 'sirr123' });
  await g2.waitRoom((r) => r.code === room.code && r.members.length === 2);
  // sahib gizli edir və şifrəni silir — siyahıdan çıxır, kodla şifrəsiz girilir
  h.send({ t: 'roomMeta', meta: { name: 'Gizli otaq', visibility: 'private', removePassword: true } });
  await h.waitRoom((r) => r.name === 'Gizli otaq' && !r.hasPassword && r.visibility === 'private');
  const list2 = (await http('/api/rooms', { cookie: await login('gost2') })).data.rooms;
  assert.ok(!list2.some((x) => x.code === room.code));
  // qeyri-sahib dəyişə bilməz
  g2.clear(); g2.send({ t: 'roomMeta', meta: { name: 'hack' } });
  assert.match((await g2.error()).msg, /otaq sahibi/);
  for (const c of [h, g, g2]) { c.send({ t: 'leaveRoom' }); c.close(); }
  await sleep(50);
});

test('real oyun: köhnə klik rədd, "yox" rədd, atomik yazılış, qarşılıqlı nəticə bir dəfə', async () => {
  const a = await makeUser('real_a', { balance: 1000 });
  const b = await makeUser('real_b', { balance: 1000 });
  const A = await client('real_a'); const B = await client('real_b');
  A.send({ t: 'createRoom', name: 'Real', visibility: 'private', settings: { ante: 10, minBet: 10 } });
  const room = await A.waitRoom((r) => r.name === 'Real');
  B.send({ t: 'joinRoom', code: room.code });
  await A.waitRoom((r) => r.members.length === 2);
  A.send({ t: 'startRound' });
  const r1 = await A.waitRoom((r) => r.round && r.round.phase === 'betting');
  assert.equal(r1.practice, false);
  const first = r1.round.turn;
  const P = first === a ? A : B, Q = first === a ? B : A;
  const v = r1.round.version;
  P.clear();
  P.send({ t: 'act', action: { type: 'yox', v } });
  assert.match((await P.error()).msg, /Naməlum/);
  // eyni versiya ilə iki klik: ikincisi rədd edilir
  P.clear();
  P.send({ t: 'act', action: { type: 'xod', amount: 20, v } });
  P.send({ t: 'act', action: { type: 'xod', amount: 20, v } });
  assert.match((await P.error()).msg, /dəyişib/);
  const r2 = await Q.waitRoom((r) => r.round && r.round.turn !== first);
  // Q bölməyi təklif edir, P qəbul edir → yarı bölünür
  Q.send({ t: 'act', action: { type: 'offerSplit', v: r2.round.version } });
  const r3 = await P.waitRoom((r) => r.round?.phase === 'offer');
  P.send({ t: 'act', action: { type: 'offerAccept', v: r3.round.version } });
  const fin = await A.waitRoom((r) => r.round?.phase === 'finished');
  assert.equal(fin.round.result.how, 'split');
  await sleep(50);
  const balA = Number((await dbGet('SELECT balance FROM users WHERE id = $1', [a])).balance);
  const balB = Number((await dbGet('SELECT balance FROM users WHERE id = $1', [b])).balance);
  assert.equal(balA + balB, 2000);
  const rounds = await dbAll(`SELECT * FROM rounds WHERE room = $1`, [room.code]);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].status, 'finished');
  const flows = await dbAll('SELECT * FROM round_flows WHERE round_uid = $1', [rounds[0].uid]);
  assert.ok(flows.length >= 1);
  const firstBal = first === a ? balA : balB;
  assert.equal(firstBal, 1000 - 30 + 20); // 10+20 qoydu, 40-ın yarısını aldı
  const stats = (await http('/api/my-stats', { cookie: await login(first === a ? 'real_a' : 'real_b') })).data.items;
  assert.equal(stats.length, 1);
  assert.equal(stats[0].netCents, -1000);
  const tx = await dbAll(`SELECT kind FROM transactions WHERE round_uid = $1`, [rounds[0].uid]);
  assert.ok(tx.length >= 4 && tx.every((t) => t.kind === 'game'));
  // ikinci raund: pas ilə bitir — kartlar açılmır
  A.clear(); B.clear();
  A.send({ t: 'startRound' });
  const s2 = await A.waitRoom((r) => r.round?.phase === 'betting');
  const T = s2.round.turn === a ? A : B;
  T.send({ t: 'act', action: { type: 'pas', v: s2.round.version } });
  const f2 = await B.waitRoom((r) => r.round?.phase === 'finished' && r.round.result.how === 'last');
  assert.deepEqual(f2.round.result.shown, []);
  assert.ok(f2.round.players.filter((p) => p.id !== b).every((p) => p.cards === null));
  for (const c of [A, B]) { c.send({ t: 'leaveRoom' }); c.close(); }
  await sleep(50);
});

test('mənfi balansı sıfırla: yalnız admin, təsdiq, paralel sorğu, tarixçə qalır', async () => {
  const id = await makeUser('borclu');
  // köhnə versiyadan qalmış mənfi balans (yeni əməliyyatlar mənfi yarada bilmir)
  await app.db.run('UPDATE users SET balance = -250 WHERE id = $1', [id]);
  // moderator icra edə bilməz
  const mod = await makeUser('modx');
  await http(`/api/admin/users/${mod}/role`, { body: { role: 'moderator' }, cookie: await admin() });
  const modCookie = await login('modx');
  const m = await http(`/api/admin/users/${id}/reset-negative`, { body: { confirm: true }, cookie: modCookie });
  assert.equal(m.status, 400);
  assert.match(m.data.error, /yalnız admin/);
  const noConfirm = await http(`/api/admin/users/${id}/reset-negative`, { body: {}, cookie: await admin() });
  assert.match(noConfirm.data.error, /Təsdiq/);
  const [r1, r2] = await Promise.all([
    http(`/api/admin/users/${id}/reset-negative`, { body: { confirm: true }, cookie: await admin() }),
    http(`/api/admin/users/${id}/reset-negative`, { body: { confirm: true }, cookie: await admin() }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 400]);
  const u = await dbGet('SELECT balance FROM users WHERE id = $1', [id]);
  assert.equal(Number(u.balance), 0);
  const tx = await dbAll(`SELECT * FROM transactions WHERE user_id = $1 ORDER BY id`, [id]);
  assert.equal(tx.length, 2);
  assert.equal(tx[1].kind, 'reset');
  assert.equal(Number(tx[1].prev_balance), -250);
  assert.equal(Number(tx[1].delta), 250);
  assert.ok(tx[1].by_user);
});

test('mənfi (köhnə) balanslı və balansı çatmayan oyunçu real raunda daxil edilmir', async () => {
  const a = await makeUser('neg_a'); await makeUser('neg_b', { balance: 100 }); await makeUser('neg_c', { balance: 100 });
  await app.db.run('UPDATE users SET balance = -50 WHERE id = $1', [a]);
  const A = await client('neg_a'); const B = await client('neg_b'); const C = await client('neg_c');
  B.send({ t: 'createRoom', name: 'Neg', visibility: 'private' });
  const room = await B.waitRoom((r) => r.name === 'Neg');
  A.send({ t: 'joinRoom', code: room.code }); C.send({ t: 'joinRoom', code: room.code });
  await B.waitRoom((r) => r.members.length === 3);
  B.send({ t: 'startRound' });
  const st = await B.waitRoom((r) => r.round?.phase === 'betting');
  assert.ok(!st.round.players.some((p) => p.id === a && p.inHand));
  assert.ok(st.round.log.some((l) => /balans oyun haqqına/.test(l.msg)));
  assert.equal(Number((await dbGet('SELECT balance FROM users WHERE id = $1', [a])).balance), -50);
  // raundda olmadığı üçün admin sıfırlaya bilər
  const res = await http(`/api/admin/users/${a}/reset-negative`, { body: { confirm: true }, cookie: await admin() });
  assert.equal(res.status, 200);
  for (const c of [A, B, C]) { c.send({ t: 'leaveRoom' }); c.close(); }
  await sleep(100);
});

test('botlar: yalnız raundlar arasında əlavə/çıxarılır, məşq rejimi, raund bitir', async () => {
  await makeUser('botsahib', { balance: 500 });
  const h = await client('botsahib');
  h.send({ t: 'createRoom', name: 'Botlu', visibility: 'public' });
  const room = await h.waitRoom((r) => r.name === 'Botlu');
  h.send({ t: 'addBot' }); h.send({ t: 'addBot' });
  const r2 = await h.waitRoom((r) => r.members.filter((m) => m.isBot).length === 2);
  assert.equal(r2.practice, true);
  const list = (await http('/api/rooms', { cookie: await login('botsahib') })).data.rooms;
  assert.equal(list.find((x) => x.code === room.code).bots, 2);
  h.send({ t: 'startRound' });
  await h.waitRoom((r) => r.round);
  h.clear();
  h.send({ t: 'addBot' });
  assert.match((await h.error()).msg, /Raund gedərkən/);
  const me = r2.members.find((m) => !m.isBot).id;
  for (let i = 0; i < 300 && h.room?.round?.phase !== 'finished'; i++) {
    const r = h.room.round;
    if (r.phase === 'betting' && r.me?.isTurn) h.send({ t: 'act', action: { type: 'pas', v: r.version } });
    if (r.phase === 'discard' && r.me?.mustDiscard) h.send({ t: 'act', action: { type: 'discard', index: 1, v: r.version } });
    if (r.phase === 'offer' && r.pending.to === me) h.send({ t: 'act', action: { type: 'offerAccept', v: r.version } });
    if (r.phase === 'tieDecision' && !r.pending.voted.includes(me)) h.send({ t: 'act', action: { type: 'tieVote', choice: 'seka', v: r.version } });
    if (r.phase === 'sekaJoin' && r.sekaJoin.eligible.includes(me) && !r.sekaJoin.joined.includes(me)) h.send({ t: 'act', action: { type: 'sekaJoin', v: r.version } });
    await sleep(30);
  }
  assert.equal(h.room.round.phase, 'finished');
  // real balans dəyişmədi, nəticə yazılmadı
  const u = await dbGet(`SELECT balance FROM users WHERE username = 'botsahib'`);
  assert.equal(Number(u.balance), 500);
  assert.equal((await dbAll(`SELECT * FROM rounds WHERE room = $1`, [room.code])).length, 0);
  // bot çıxarmaq
  const bot = h.room.members.find((m) => m.isBot);
  h.send({ t: 'removeBot', botId: bot.id });
  await h.waitRoom((r) => r.members.filter((m) => m.isBot).length === 1);
  h.send({ t: 'leaveRoom' }); h.close();
  await sleep(50);
});

test('server yenidən başlayanda yarımçıq real raundun pulu qaytarılır', async () => {
  const a = await makeUser('rst_a', { balance: 100 });
  await makeUser('rst_b', { balance: 100 });
  const A = await client('rst_a'); const B = await client('rst_b');
  A.send({ t: 'createRoom', name: 'Restart', visibility: 'private', settings: { ante: 10, minBet: 10 } });
  const room = await A.waitRoom((r) => r.name === 'Restart');
  B.send({ t: 'joinRoom', code: room.code });
  await A.waitRoom((r) => r.members.length === 2);
  A.send({ t: 'startRound' });
  await A.waitRoom((r) => r.round?.phase === 'betting');
  await sleep(50);
  assert.equal(Number((await dbGet('SELECT balance FROM users WHERE id = $1', [a])).balance), 90);
  // "çökmə": otaqları bağlamadan serveri dayandırırıq
  A.close(); B.close();
  app.rooms.stop();
  app.rooms.rooms.clear();
  await app.close();
  await boot();
  adminCookie = null;
  assert.equal(Number((await dbGet('SELECT balance FROM users WHERE id = $1', [a])).balance), 100);
  const r = await dbGet(`SELECT status FROM rounds WHERE room = $1`, [room.code]);
  assert.equal(r.status, 'aborted');
  const tx = await dbAll(`SELECT kind FROM transactions WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, [a]);
  assert.equal(tx[0].kind, 'refund');
});

test('raund gedərkən insan qoşulur — raund pozulmur, növbəti raundda oynayır', async () => {
  await makeUser('mid_a'); await makeUser('mid_b');
  const A = await client('mid_a');
  A.send({ t: 'createRoom', name: 'Ortada', visibility: 'public', withBot: true });
  const room = await A.waitRoom((r) => r.name === 'Ortada' && r.members.length === 2);
  A.send({ t: 'startRound' });
  const st = await A.waitRoom((r) => r.round && r.round.phase !== 'finished');
  const B = await client('mid_b');
  B.send({ t: 'joinRoom', code: room.code });
  const vb = await B.waitRoom((r) => r.code === room.code && r.members.length === 3);
  assert.equal(vb.round.me, null); // yeni gələn kartları görmür
  assert.ok(vb.round.players.every((p) => p.cards === null));
  assert.equal(vb.round.players.length, st.round.players.length);
  for (const c of [A, B]) { c.send({ t: 'leaveRoom' }); c.close(); }
  await sleep(50);
});


// ---------------- baza xətası: outbox, bloklama, təkrar cəhd ----------------
function faultyStore() {
  const real = app.store.applyRoundBatch.bind(app.store);
  const ctl = { down: false, loseOnce: false, calls: 0, restore() { app.store.applyRoundBatch = real; } };
  app.store.applyRoundBatch = async (b) => {
    ctl.calls++;
    if (ctl.down) throw new Error('DB down (test)');
    const res = await real(b);
    if (ctl.loseOnce) { ctl.loseOnce = false; throw new Error('COMMIT oldu, cavab itdi (test)'); }
    return res;
  };
  return ctl;
}

async function realRoom(prefix, balance = 100) {
  const a = await makeUser(`${prefix}_a`, { balance });
  const b = await makeUser(`${prefix}_b`, { balance });
  const A = await client(`${prefix}_a`); const B = await client(`${prefix}_b`);
  A.send({ t: 'createRoom', name: prefix, visibility: 'private', settings: { ante: 10, minBet: 10 } });
  const room = await A.waitRoom((r) => r.name === prefix);
  B.send({ t: 'joinRoom', code: room.code });
  await A.waitRoom((r) => r.members.length === 2);
  A.clear(); B.clear();
  A.send({ t: 'startRound' });
  const st = await A.waitRoom((r) => r.round?.phase === 'betting');
  const first = st.round.turn;
  return { a, b, A, B, code: room.code, first, P: first === a ? A : B, Q: first === a ? B : A, pid: first, qid: first === a ? b : a, st };
}

test('baza dayananda: hərəkət itmir, otaq dondurulur, digər hərəkətlər bloklanır, bərpadan sonra bir dəfə yazılır', async () => {
  const g = await realRoom('dbdown');
  await sleep(30);
  assert.equal(Number((await dbGet('SELECT balance FROM users WHERE id = $1', [g.pid])).balance), 90);
  const ctl = faultyStore();
  ctl.down = true;
  const room = app.rooms.rooms.get(g.code);
  const deadline0 = room.round.turnDeadline;
  g.P.clear(); g.Q.clear();
  g.P.send({ t: 'act', action: { type: 'xod', amount: 20, v: g.st.round.version } });
  const w = await g.Q.waitRoom((r) => r.dbWaiting);
  // klientə təsdiqlənməmiş nəticə göstərilmir: Q üçün hələ də köhnə (P-nin növbəsi olan) vəziyyət
  assert.equal(w.round.turn, g.pid);
  assert.equal(w.round.pot, 20);
  assert.equal(w.round.me.isTurn, false);
  assert.equal(Number((await dbGet('SELECT balance FROM users WHERE id = $1', [g.pid])).balance), 90);
  // yaddaşda paket saxlanılıb (silinməyib)
  assert.equal(room.outbox.length, 1);
  assert.match(room.outbox[0].batchId, /:2$/);
  // digər oyunçu hərəkət edə bilmir, sahib raund başlada bilmir
  g.Q.clear();
  g.Q.send({ t: 'act', action: { type: 'xod', amount: 20 } });
  assert.match((await g.Q.error()).msg, /Baza bağlantısı gözlənilir/);
  g.A.clear();
  g.A.send({ t: 'addBot' });
  assert.match((await g.A.error()).msg, /Baza bağlantısı gözlənilir/);
  // taymer də keçə bilmir: vaxtı keçmiş kimi göstərsək belə tick heç nə etmir
  const v0 = room.round.version;
  app.rooms.tick();
  await sleep(150);
  assert.equal(room.round.version, v0);
  assert.ok(ctl.calls >= 2, 'təkrar cəhdlər olmalıdır');
  // bərpa
  ctl.down = false;
  await g.Q.waitRoom((r) => !r.dbWaiting && r.round?.turn === g.qid, 3000);
  assert.equal(room.outbox.length, 0);
  assert.equal(Number((await dbGet('SELECT balance FROM users WHERE id = $1', [g.pid])).balance), 70);
  const tx = await dbAll('SELECT batch_id FROM transactions WHERE user_id = $1 AND round_uid IS NOT NULL ORDER BY id', [g.pid]);
  assert.equal(tx.length, 2);
  assert.equal(new Set(tx.map((t) => t.batch_id)).size, 2);
  // gözləmə vaxtı növbə vaxtından çıxılmır
  assert.ok(room.round.turnDeadline >= deadline0);
  ctl.restore();
  for (const c of [g.A, g.B]) { c.send({ t: 'leaveRoom' }); c.close(); }
  await sleep(100);
});

test('COMMIT-dən sonra cavab itir → otaq təkrar cəhd edir, balans bir dəfə dəyişir', async () => {
  const g = await realRoom('lost');
  await sleep(30);
  const ctl = faultyStore();
  ctl.loseOnce = true;
  g.P.clear(); g.Q.clear();
  g.P.send({ t: 'act', action: { type: 'xod', amount: 30, v: g.st.round.version } });
  await g.Q.waitRoom((r) => r.dbWaiting);
  await g.Q.waitRoom((r) => !r.dbWaiting && r.round?.turn === g.qid, 3000);
  assert.equal(Number((await dbGet('SELECT balance FROM users WHERE id = $1', [g.pid])).balance), 60);
  assert.equal((await dbAll('SELECT id FROM transactions WHERE user_id = $1 AND round_uid IS NOT NULL', [g.pid])).length, 2);
  ctl.restore();
  for (const c of [g.A, g.B]) { c.send({ t: 'leaveRoom' }); c.close(); }
  await sleep(100);
});

test('baza dayananda otaqdan çıxma və otağın bağlanması qorumanı keçmir', async () => {
  const g = await realRoom('leaveblk');
  await sleep(30);
  const room = app.rooms.rooms.get(g.code);
  const ctl = faultyStore();
  ctl.down = true;
  g.P.send({ t: 'act', action: { type: 'xod', amount: 10, v: g.st.round.version } });
  await g.Q.waitRoom((r) => r.dbWaiting);
  // hər iki insan çıxır — otaq silinmir, paket gözləyir
  g.A.send({ t: 'leaveRoom' }); g.B.send({ t: 'leaveRoom' });
  await sleep(150);
  assert.ok(app.rooms.rooms.has(g.code), 'təsdiqlənməmiş paketi olan otaq silinməməlidir');
  assert.equal(room.closing, true);
  assert.ok(!(await http('/api/rooms', { cookie: await login(`leaveblk_a`) })).data.rooms.some((x) => x.code === g.code));
  ctl.down = false;
  for (let i = 0; i < 100 && app.rooms.rooms.has(g.code); i++) await sleep(30);
  assert.ok(!app.rooms.rooms.has(g.code), 'bərpadan sonra otaq bağlanmalıdır');
  // xod yazıldı; ilk çıxan pas sayıldı, bank qalana getdi — heç nə itmədi və ikiləşmədi
  const ba = Number((await dbGet('SELECT balance FROM users WHERE id = $1', [g.a])).balance);
  const bb = Number((await dbGet('SELECT balance FROM users WHERE id = $1', [g.b])).balance);
  assert.equal(ba + bb, 200);
  assert.ok(ba !== 100);
  const rnd = await dbGet('SELECT uid, status FROM rounds WHERE room = $1', [g.code]);
  assert.equal(rnd.status, 'finished');
  const flows = await dbAll('SELECT cents FROM round_flows WHERE round_uid = $1', [rnd.uid]);
  assert.equal(flows.reduce((x, f) => x + Number(f.cents), 0), Math.abs(ba - 100) * 100);
  ctl.restore();
  g.A.close(); g.B.close();
});

test('bot qoruması: otaq dondurulubsa bot hərəkət etmir, açılanda davam edir', async () => {
  // Qeyd: botlu otaqlar məşq rejimindədir və bazaya yazmır; bu test bot qoruyucusunun özünü yoxlayır
  await makeUser('botblk', { balance: 0 });
  const h = await client('botblk');
  h.send({ t: 'createRoom', name: 'BotBlk', visibility: 'private', withBot: true });
  const rv = await h.waitRoom((r) => r.name === 'BotBlk' && r.members.length === 2);
  const room = app.rooms.rooms.get(rv.code);
  room.dealerIdx = 1; // bot birinci getsin
  const delay = app.rooms.botDelay;
  app.rooms.botDelay = [400, 400]; // bot dondurmadan əvvəl hərəkət etməsin
  h.send({ t: 'startRound' });
  await h.waitRoom((r) => r.round);
  room.outbox.push({ batchId: 'fake:1' }); // süni dondurma
  app.rooms.botDelay = delay;
  assert.ok(room.round.turn < 0, 'növbə botda olmalıdır');
  const v0 = room.round.version;
  app.rooms.scheduleBots(room);
  await app.rooms.runBots(room, room.round);
  await sleep(200);
  assert.equal(room.round.version, v0, 'dondurulmuş otaqda bot hərəkət etməməlidir');
  room.outbox.length = 0;
  app.rooms.scheduleBots(room);
  for (let i = 0; i < 50 && room.round.version === v0; i++) await sleep(20);
  assert.ok(room.round.version > v0, 'bot davam etməlidir');
  h.send({ t: 'leaveRoom' }); h.close();
  await sleep(50);
});

test('server baza dayanan vaxt çökür → yazılmamış paket itir, yazılanlar bir dəfə qaytarılır', async () => {
  const g = await realRoom('crash');
  await sleep(30);
  const ctl = faultyStore();
  ctl.down = true;
  g.P.send({ t: 'act', action: { type: 'xod', amount: 40, v: g.st.round.version } });
  await g.Q.waitRoom((r) => r.dbWaiting);
  g.A.close(); g.B.close();
  ctl.restore();
  app.rooms.stop(); app.rooms.rooms.clear();
  await app.close();
  await boot();
  adminCookie = null;
  // yalnız yazılmış oyun haqqı (10) qaytarıldı; yazılmamış xod (40) heç vaxt çıxılmamışdı
  assert.equal(Number((await dbGet('SELECT balance FROM users WHERE id = $1', [g.pid])).balance), 100);
  assert.equal(Number((await dbGet('SELECT balance FROM users WHERE id = $1', [g.qid])).balance), 100);
  const refunds = await dbAll(`SELECT delta FROM transactions WHERE user_id = $1 AND kind = 'refund'`, [g.pid]);
  assert.deepEqual(refunds.map((r) => Number(r.delta)), [10]);
});
