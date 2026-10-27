// v2.8 server inteqrasiyası (real HTTP + WebSocket): balans məxfiliyi, xal məxfiliyi, çat tarixçəsi,
// onlayn status və bağlantının bərpası, masadan borc təklifi/istəyi (atomik, idempotent, raund növbəsi ilə),
// "Şir" hədiyyəsinin bir dəfə tutulması, sağlamlıq yoxlaması.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../server/app.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let app, base, dir, dbFile;
const key = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-v28-'));
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
    this.ws.on('message', (d) => this.msgs.push(JSON.parse(d.toString())));
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

test('balans məxfiliyi: WebSocket-də başqasının dəqiq balansı yoxdur (otaq üzvləri və raund), özününkü var', async () => {
  const { ids, cs } = await table('pv', [345, 678]);
  const [A, B] = cs;
  A.clear();
  A.send({ t: 'startRound' });
  const r = await A.waitRoom((x) => x.round?.phase === 'betting');
  assert.equal(r.members.find((m) => m.id === ids[0]).balance, 335);
  assert.equal(r.members.find((m) => m.id === ids[1]).balance, null);
  assert.equal(r.round.players.find((p) => p.id === ids[1]).balance, null);
  const raw = JSON.stringify(A.msgs);
  assert.ok(!raw.includes('668') && !raw.includes('678'), 'B-nin balansı A-ya heç bir mesajda getməyib');
  await leaveAll(cs);
});

test('kart xalı: baxmamışdan əvvəl serverdən gəlmir; "look" yalnız baxana göndərilir, rəqibə heç nə getmir', async () => {
  const { ids, cs } = await table('lk');
  const [A, B] = cs;
  A.send({ t: 'startRound' });
  const r = await A.waitRoom((x) => x.round?.phase === 'betting');
  assert.equal(r.round.me.score, null);
  assert.ok(r.round.me.cards.length === 3);
  await B.waitRoom((x) => x.round?.phase === 'betting');
  A.clear(); B.clear();
  A.send({ t: 'look' });
  const after = await A.waitRoom((x) => x.round?.me?.looked === true);
  assert.equal(typeof after.round.me.score, 'number');
  await sleep(150);
  assert.equal(B.msgs.filter((m) => m.t === 'room').length, 1, 'B yeni vəziyyət almadı');
  assert.equal(B.room.round.players.find((p) => p.id === ids[0]).score, null);
  await leaveAll(cs);
});

test('çat tarixçəsi: otaqda qalır, yalnız üzvlərə və yalnız qoşulandan sonrakı mesajlar; oyun vəziyyəti dəyişmir', async () => {
  const { ids, cs, code } = await table('ch', [100, 100]);
  const [A, B] = cs;
  const outsider = await makeUser('ch_out', 0); const O = await client('ch_out');
  A.send({ t: 'chat', text: 'birinci mesaj' });
  await B.waitFor((m) => m.t === 'bubble' && m.value === 'birinci mesaj');
  await sleep(1600);
  B.send({ t: 'chat', text: 'ikinci mesaj' });
  await A.waitFor((m) => m.t === 'bubble' && m.value === 'ikinci mesaj');
  // bağlanıb yenidən açılan (təzə görünüş alan) üzv tarixçəni görür
  A.clear();
  A.send({ t: 'joinRoom', code }); // eyni otaq — yalnız görünüş yenilənir
  const v = await A.waitRoom((x) => (x.chatMsgs || []).length >= 2);
  assert.deepEqual(v.chatMsgs.map((m) => m.text), ['birinci mesaj', 'ikinci mesaj']);
  assert.ok(v.chatMsgs.every((m) => typeof m.t === 'number'));
  // otaqdan kənar istifadəçi heç nə almır
  assert.ok(!O.msgs.some((m) => m.t === 'bubble' || m.t === 'room'));
  // sonradan qoşulan köhnə söhbəti görmür
  await makeUser('ch_late', 100); const L = await client('ch_late');
  L.send({ t: 'joinRoom', code });
  const lv = await L.waitRoom((x) => x.code === code);
  assert.deepEqual(lv.chatMsgs, []);
  await sleep(1600);
  A.send({ t: 'chat', text: 'üçüncü' });
  await L.waitFor((m) => m.t === 'bubble' && m.value === 'üçüncü');
  O.close();
  await leaveAll([...cs, L]);
});

test('onlayn status: bağlantı kəsiləndə false, bərpa olunanda true; bot üçün status göndərilmir', async () => {
  const { ids, cs, code } = await table('on', [100, 100]);
  const [A, B] = cs;
  assert.equal(A.room.members.find((m) => m.id === ids[1]).connected, true);
  A.clear();
  B.close();
  await A.waitRoom((x) => x.members.find((m) => m.id === ids[1])?.connected === false);
  const B2 = await client('on1');
  const back = await A.waitRoom((x) => x.members.find((m) => m.id === ids[1])?.connected === true);
  assert.ok(back);
  assert.equal(B2.msgs.find((m) => m.t === 'hello').roomCode, code, 'yenidən qoşulanda otağa qayıdır');
  // botlu otaq
  await makeUser('on_bot', 0); const D = await client('on_bot');
  D.send({ t: 'createRoom', demo: true, bots: 2 });
  const dr = await D.waitRoom((x) => x.demo && x.members.length === 3);
  assert.ok(dr.members.filter((m) => m.isBot).every((m) => m.connected === null));
  await leaveAll([A, B2, D]);
});

test('masadan borc təklifi: qəbula qədər heç nə dəyişmir; təkrar/paralel qəbul bir borc; aktiv raundun balansı yenilənir', async () => {
  const { ids, cs, code } = await table('ln', [500, 20]);
  const [A, B] = cs;
  const [a, b] = ids;
  A.send({ t: 'startRound' });
  await A.waitRoom((x) => x.round?.phase === 'betting');
  await sleep(30);
  assert.equal(await bal(b), 10);
  const due = Date.now() + 3 * 86_400_000;
  const k1 = key();
  const off1 = await http('/api/loans/offer', { body: { borrowerId: b, amount: 50, dueAt: due, key: k1 }, cookie: await login('ln0') });
  const off2 = await http('/api/loans/offer', { body: { borrowerId: b, amount: 50, dueAt: due, key: k1 }, cookie: await login('ln0') });
  assert.equal(off1.status, 200); assert.equal(off2.data.duplicate, true);
  assert.equal(off1.data.loanId, off2.data.loanId, 'təkrar klik ikinci təklif yaratmadı');
  assert.equal(await bal(a), 490); assert.equal(await bal(b), 10);
  const pend = await http('/api/loans/pending', { cookie: await login('ln1') });
  const mine = pend.data.loans.filter((l) => l.mine);
  assert.equal(mine.length, 1); assert.equal(mine[0].amount, 50);
  // qarşı tərəf eyni anda iki dəfə qəbul edir (eyni açar) + bir dəfə başqa açarla
  const ka = key();
  const [x1, x2, x3] = await Promise.all([
    http(`/api/loans/${off1.data.loanId}/accept`, { body: { key: ka }, cookie: await login('ln1') }),
    http(`/api/loans/${off1.data.loanId}/accept`, { body: { key: ka }, cookie: await login('ln1') }),
    http(`/api/loans/${off1.data.loanId}/accept`, { body: { key: key() }, cookie: await login('ln1') }),
  ]);
  const oks = [x1, x2, x3].filter((x) => x.status === 200 && !x.data.duplicate);
  assert.equal(oks.length, 1, JSON.stringify([x1.data, x2.data, x3.data]));
  assert.equal(await bal(a), 440); assert.equal(await bal(b), 60);
  assert.equal(Number((await app.db.get(`SELECT COUNT(*) AS n FROM loans WHERE lender_id = $1 AND borrower_id = $2 AND status = 'active'`, [a, b])).n), 1);
  // aktiv raundun yaddaşı da yeniləndi — B köhnə balansla oynamır, masadan çıxmayıb
  const room = app.rooms.rooms.get(code);
  assert.equal(room.round.players.get(b).balance, 60);
  assert.equal(room.round.players.get(a).balance, 440);
  assert.ok(room.members.has(b) && !room.round.left.has(b));
  const bv = await B.waitRoom((x) => x.round?.players.find((p) => p.id === b)?.balance === 60);
  assert.ok(bv);
  // borc istəyi: B istəyir, A təsdiqləyir (pul A-dan B-yə, bir tranzaksiyada)
  const rq = await http('/api/loans/request', { body: { lenderId: a, amount: 30, dueAt: due, key: key() }, cookie: await login('ln1') });
  assert.equal(rq.status, 200);
  assert.equal(await bal(a), 440);
  const ap = await http(`/api/loans/${rq.data.loanId}/approve`, { body: { key: key() }, cookie: await login('ln0') });
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  assert.equal(await bal(a), 410); assert.equal(await bal(b), 90);
  assert.equal(room.round.players.get(a).balance, 410);
  // balans çatmayan borc verən: heç nə dəyişmir
  const big = await http('/api/loans/request', { body: { lenderId: a, amount: 5000, dueAt: due, key: key() }, cookie: await login('ln1') });
  const bad = await http(`/api/loans/${big.data.loanId}/approve`, { body: { key: key() }, cookie: await login('ln0') });
  assert.equal(bad.status, 400);
  assert.equal(await bal(a), 410); assert.equal(await bal(b), 90);
  assert.equal((await app.db.get('SELECT status FROM loans WHERE id = $1', [big.data.loanId])).status, 'requested');
  await leaveAll(cs);
});

test('"Şir" hədiyyəsi: qiymət serverdə, eyni açar ikinci dəfə tutulmur, animasiya hadisəsi bir dəfə; ayrıca faiz admin ayarından', async () => {
  const { ids, cs } = await table('lion', [2000, 0]);
  const [A, B] = cs;
  const [a, b] = ids;
  const set = await http('/api/admin/table-gifts/settings', { body: { gifts: [{ id: 'lion', price: 600, active: true, sharePct: 50 }] }, cookie: await adm() });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  const lion = set.data.gifts.find((g) => g.id === 'lion');
  assert.deepEqual([lion.price, lion.sharePct, lion.ownPct], [600, 50, 50]);
  // digər hədiyyələr ümumi faizdə qalır
  assert.ok(set.data.gifts.filter((g) => g.id !== 'lion').every((g) => g.ownPct === null && g.sharePct === 30));
  A.clear(); B.clear();
  const k = key();
  const [r1, r2] = await Promise.all([
    http('/api/table-gift', { body: { toId: b, giftId: 'lion', key: k }, cookie: await login('lion0') }),
    http('/api/table-gift', { body: { toId: b, giftId: 'lion', key: k }, cookie: await login('lion0') }),
  ]);
  assert.equal(r1.status, 200); assert.equal(r2.status, 200);
  assert.equal([r1, r2].filter((r) => r.data.duplicate).length, 1);
  assert.equal(await bal(a), 1400);
  assert.equal(await bal(b), 300);
  await sleep(150);
  const evs = B.msgs.filter((m) => m.t === 'tgift' && m.giftId === 'lion');
  assert.equal(evs.length, 1);
  assert.equal(evs[0].giftName, 'Şir');
  const hist = await http('/api/admin/table-gifts', { cookie: await adm() });
  assert.equal(hist.data.items.filter((g) => g.giftId === 'lion').length, 1);
  assert.equal(hist.data.items.find((g) => g.giftId === 'lion').sharePct, 50);
  // faizi boşaltmaq → ümumi faizə qayıdır
  const reset = await http('/api/admin/table-gifts/settings', { body: { gifts: [{ id: 'lion', price: 500, active: true, sharePct: '' }] }, cookie: await adm() });
  assert.equal(reset.data.gifts.find((g) => g.id === 'lion').ownPct, null);
  await leaveAll(cs);
});

test('sağlamlıq yoxlaması: baza və otaq göstəriciləri; məxfi məlumat yoxdur', async () => {
  const res = await fetch(base + '/health');
  assert.equal(res.status, 200);
  const h = await res.json();
  assert.equal(h.ok, true); assert.equal(h.db, 'ok');
  for (const k of ['uptimeSec', 'rssMb', 'rooms', 'activeRounds', 'roomsWaitingDb', 'sockets']) assert.equal(typeof h[k], 'number', k);
  const txt = JSON.stringify(h);
  assert.ok(!/postgres|password|token|DATABASE/i.test(txt));
});
