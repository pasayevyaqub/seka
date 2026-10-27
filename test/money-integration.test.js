// Server səviyyəsində maliyyə + oyun inteqrasiyası: aktiv raund zamanı hədiyyə/borc tutulması, HTTP idempotency,
// borc zənciri, açılışda vaxtı keçmiş borclar, profil şəkli, emoji və çat.
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

async function boot() {
  app = await createApp({ dbFile, dbUrl: process.env.TEST_DATABASE_URL || null, botDelay: [5, 15], retryFast: [40, 40], retrySlow: 80, limits: { register: 1e6, login: 1e6 }, debtIntervalMs: 3_600_000 });
  base = `http://127.0.0.1:${await app.listen(0)}`;
}
before(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-mi-')); dbFile = path.join(dir, 't.db'); await boot(); });
after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function http(pathname, { body, cookie, method, raw, type } = {}) {
  const res = await fetch(base + pathname, {
    method: method || (body || raw ? 'POST' : 'GET'),
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(raw ? { 'Content-Type': type || 'application/octet-stream' } : {}), ...(cookie ? { cookie } : {}) },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, cookie: res.headers.get('set-cookie')?.split(';')[0], type: ct };
}
const cookies = new Map();
async function login(u) {
  if (cookies.has(u)) return cookies.get(u);
  const r = await http('/api/login', { body: { username: u, password: '123456' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  cookies.set(u, r.cookie);
  return r.cookie;
}
let admCookie = null;
async function adminCookie() {
  if (admCookie) return admCookie;
  const r = await http('/api/login', { body: { username: 'admin', password: 'admin123' } });
  admCookie = r.cookie;
  return admCookie;
}
async function makeUser(username, balance = 0) {
  const adm = await adminCookie();
  const r = await http('/api/admin/users', { body: { username, displayName: username[0].toUpperCase() + username.slice(1), password: '123456' }, cookie: adm });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const u = await app.db.get('SELECT id FROM users WHERE username = $1', [username]);
  await app.db.run('UPDATE users SET balance = $1 WHERE id = $2', [balance, u.id]);
  return Number(u.id);
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
    throw new Error("waitFor timeout; last: " + JSON.stringify(this.msgs.slice(-2).map((m) => m.room?.round ? { ph: m.room.round.phase, turn: m.room.round.turn, cp: m.room.round.creditPot, pot: m.room.round.pot, deal: m.room.round.creditDeal, log: m.room.round.log?.slice(-4) } : m)).slice(0, 1500));
  }
  async waitRoom(pred, ms) { return (await this.waitFor((m) => m.t === 'room' && pred(m.room), ms)).room; }
  async error() { return this.waitFor((m) => m.t === 'error'); }
  clear() { const r = this.msgs.filter((m) => m.t === 'room').pop(); this.msgs = r ? [r] : []; }
  close() { this.ws.close(); }
}
async function client(u) { const c = new Client(await login(u)); await c.ready; await c.waitFor((m) => m.t === 'hello'); return c; }

async function realRound(prefix, balance = 100) {
  const a = await makeUser(`${prefix}_a`, balance); const b = await makeUser(`${prefix}_b`, balance);
  const A = await client(`${prefix}_a`); const B = await client(`${prefix}_b`);
  A.send({ t: 'createRoom', name: prefix, visibility: 'private', settings: { ante: 10, minBet: 10 } });
  const room = await A.waitRoom((r) => r.name === prefix);
  B.send({ t: 'joinRoom', code: room.code });
  await A.waitRoom((r) => r.members.length === 2);
  A.clear(); B.clear();
  A.send({ t: 'startRound' });
  const st = await A.waitRoom((r) => r.round?.phase === 'betting');
  const first = st.round.turn;
  return { a, b, A, B, code: room.code, pid: first, P: first === a ? A : B, Q: first === a ? B : A, st, puser: first === a ? `${prefix}_a` : `${prefix}_b` };
}

test('aktiv raundda hədiyyə: yaddaşdakı oyun balansı da azalır, köhnə balansla xod etmək olmur', async () => {
  const g = await realRound('gr', 100);
  const X = await makeUser('gr_x', 0);
  await sleep(30);
  assert.equal(await bal(g.pid), 90);
  const r = await http('/api/gift', { body: { toId: X, amount: 85, note: 'test', key: key() }, cookie: await login(g.puser) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await bal(g.pid), 5);
  const room = app.rooms.rooms.get(g.code);
  assert.equal(room.round.players.get(g.pid).balance, 5);
  g.P.clear();
  g.P.send({ t: 'act', action: { type: 'xod', amount: 10, v: room.round.version } });
  assert.match((await g.P.error()).msg, /Balans/);
  assert.equal(await bal(g.pid), 5);
  // eyni açarla təkrar (itmiş cavab) — ikinci dəfə çıxılmır
  const k = key();
  const r1 = await http('/api/gift', { body: { toId: X, amount: 5, key: k }, cookie: await login(g.puser) });
  const r2 = await http('/api/gift', { body: { toId: X, amount: 5, key: k }, cookie: await login(g.puser) });
  assert.equal(r1.status, 200); assert.equal(r2.status, 200); assert.equal(r2.data.duplicate, true);
  assert.equal(await bal(g.pid), 0);
  assert.equal(await bal(X), 90);
  for (const c of [g.A, g.B]) { c.send({ t: 'leaveRoom' }); c.close(); }
  await sleep(80);
});

test('otaq baza gözləyərkən həmin oyunçunun pul əməliyyatı qəbul edilmir', async () => {
  const g = await realRound('gblk', 100);
  const X = await makeUser('gblk_x', 0);
  await sleep(30);
  const real = app.store.applyRoundBatch.bind(app.store);
  app.store.applyRoundBatch = async () => { throw new Error('DB down'); };
  g.P.send({ t: 'act', action: { type: 'xod', amount: 10, v: g.st.round.version } });
  await g.Q.waitRoom((r) => r.dbWaiting);
  g.Q.clear();
  const r = await http('/api/gift', { body: { toId: X, amount: 10, key: key() }, cookie: await login(g.puser) });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Baza bağlantısı/);
  app.store.applyRoundBatch = real;
  await g.Q.waitRoom((x) => !x.dbWaiting, 3000);
  assert.equal(await bal(g.pid), 80);
  assert.equal(await bal(X), 0);
  for (const c of [g.A, g.B]) { c.send({ t: 'leaveRoom' }); c.close(); }
  await sleep(80);
});

test('aktiv raund zamanı vaxtı keçmiş borcun avtomatik tutulması oyunun yaddaş balansını da yeniləyir', async () => {
  const g = await realRound('dcol', 100);
  const L = await makeUser('dcol_l', 0);
  await sleep(30);
  const now = Date.now();
  await app.db.run(`INSERT INTO loans(lender_id, borrower_id, amount, remaining, due_at, status, created_at, accepted_at) VALUES($1, $2, 80, 80, $3, 'active', $3, $3)`, [L, g.pid, now - 1000]);
  await app.debts.scan();
  await sleep(100);
  assert.equal(await bal(g.pid), 10);
  assert.equal(await bal(L), 80);
  const room = app.rooms.rooms.get(g.code);
  assert.equal(room.round.players.get(g.pid).balance, 10);
  // bildiriş borcluya gəlir
  const n = await g.P.waitFor((m) => m.t === 'notify' && /Avtomatik borc/.test(m.text));
  assert.ok(n);
  g.P.clear();
  g.P.send({ t: 'act', action: { type: 'xod', amount: 20, v: room.round.version } });
  assert.match((await g.P.error()).msg, /Balans/);
  for (const c of [g.A, g.B]) { c.send({ t: 'leaveRoom' }); c.close(); }
  await sleep(80);
});

test('borc zənciri və qarşılıqlı borclar: limitli növbə, sonsuz dövr yoxdur, ikiqat tutulma yoxdur', async () => {
  const A = await makeUser('ch_a', 0); const B = await makeUser('ch_b', 0); const C = await makeUser('ch_c', 0);
  const past = Date.now() - 5000;
  const ins = (l, b, amt) => app.db.run(`INSERT INTO loans(lender_id, borrower_id, amount, remaining, due_at, status, created_at, accepted_at) VALUES($1, $2, $3, $3, $4, 'active', $4, $4)`, [l, b, amt, past]);
  await ins(B, A, 50); // A → B borcludur
  await ins(C, B, 40); // B → C
  await ins(A, C, 30); // C → A (dövr)
  await app.debts.scan();
  await sleep(50);
  // heç kimdə pul yoxdur → hamısı "Gecikib"
  const st = await app.db.all(`SELECT status FROM loans WHERE borrower_id IN ($1, $2, $3)`, [A, B, C]);
  assert.ok(st.every((x) => x.status === 'overdue'));
  // A-ya 100 hədiyyə gəlir → A B-yə 50 ödəyir → B C-yə 40 → C A-ya 30 → A-nın borcu yoxdur
  const G = await makeUser('ch_g', 500);
  const r = await http('/api/gift', { body: { toId: A, amount: 100, key: key() }, cookie: await login('ch_g') });
  assert.equal(r.status, 200);
  for (let i = 0; i < 50 && (await app.db.get(`SELECT COUNT(*) AS n FROM loans WHERE status = 'overdue' AND borrower_id IN ($1, $2, $3)`, [A, B, C])).n > 0; i++) await sleep(40);
  assert.equal(await bal(A), 100 - 50 + 30);
  assert.equal(await bal(B), 50 - 40);
  assert.equal(await bal(C), 40 - 30);
  assert.equal((await bal(A)) + (await bal(B)) + (await bal(C)), 100);
  const paid = await app.db.all(`SELECT status FROM loans WHERE borrower_id IN ($1, $2, $3)`, [A, B, C]);
  assert.ok(paid.every((x) => x.status === 'paid'));
  await app.debts.scan(); // təkrar yoxlama heç nə dəyişmir
  assert.equal((await bal(A)) + (await bal(B)) + (await bal(C)), 100);
  assert.ok(G);
});

test('server yatıbsa: açılışda vaxtı keçmiş borc tutulur (icra vaxtı — faktiki an)', async () => {
  const L = await makeUser('rs_l', 0); const B = await makeUser('rs_b', 60);
  const due = Date.now() - 3 * 3_600_000;
  await app.db.run(`INSERT INTO loans(lender_id, borrower_id, amount, remaining, due_at, status, created_at, accepted_at) VALUES($1, $2, 100, 100, $3, 'active', $3, $3)`, [L, B, due]);
  app.rooms.stop(); app.rooms.rooms.clear();
  await app.close();
  const t0 = Date.now();
  await boot();
  cookies.clear();
  for (let i = 0; i < 50 && (await bal(B)) > 0; i++) await sleep(40);
  assert.equal(await bal(B), 0);
  assert.equal(await bal(L), 60);
  const p = await app.db.get('SELECT executed_at FROM loan_payments WHERE amount = 60 ORDER BY id DESC LIMIT 1');
  assert.ok(Number(p.executed_at) >= t0, 'icra vaxtı son tarix yox, faktiki an olmalıdır');
});

test('HTTP: kredit müraciəti → admin təsdiqi (limit ilə), təkrar təsdiq və moderator icazələri', async () => {
  const u = await makeUser('cr_u', 0);
  const r = await http('/api/credit/request', { body: { amount: 200, note: 'masada', key: key() }, cookie: await login('cr_u') });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const r2 = await http('/api/credit/request', { body: { amount: 50, key: key() }, cookie: await login('cr_u') });
  assert.match(r2.data.error, /gözləyən/);
  const adm = (await http('/api/login', { body: { username: 'admin', password: 'admin123' } })).cookie;
  const ov = await http('/api/admin/credit', { cookie: adm });
  const req = ov.data.requests.find((x) => x.userId === u && x.status === 'pending');
  const k = key();
  const a1 = await http(`/api/admin/credit/${req.id}/approve`, { body: { amount: 150, newLimit: 300, key: k }, cookie: adm });
  const a2 = await http(`/api/admin/credit/${req.id}/approve`, { body: { amount: 150, newLimit: 300, key: k }, cookie: adm });
  const a3 = await http(`/api/admin/credit/${req.id}/approve`, { body: { amount: 150, newLimit: 300, key: key() }, cookie: adm });
  assert.equal(a1.status, 200); assert.equal(a2.data.duplicate, true); assert.equal(a3.status, 400);
  assert.equal(await bal(u), 150);
  const prof = await http('/api/profile', { cookie: await login('cr_u') });
  assert.equal(prof.data.creditDebt, 150);
  assert.equal(prof.data.creditLimit, 300);
  assert.equal(prof.data.creditLeft, 150);
  // moderator ayarları və mənfi sıfırlamanı edə bilməz
  const m = await makeUser('cr_mod', 0);
  await http(`/api/admin/users/${m}/role`, { body: { role: 'moderator' }, cookie: adm });
  const ms = await http('/api/admin/settings', { body: { signupBonus: 5 }, cookie: await login('cr_mod') });
  assert.equal(ms.status, 400);
  // adi oyunçu admin API-ni görmür
  assert.equal((await http('/api/admin/credit', { cookie: await login('cr_u') })).status, 403);
});

test('profil şəkli: həqiqi şəkil kiçildilir (WebP, metadata yox), saxta fayl və 2 MB-dan böyük rədd edilir, silinir', async () => {
  const sharp = (await import('sharp')).default;
  const u = await makeUser('av_u', 0);
  const c = await login('av_u');
  const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#c33' } }).png().withMetadata({ exif: { IFD0: { Copyright: 'GIZLI-METADATA' } } }).toBuffer();
  const up = await http('/api/me/avatar', { raw: png, type: 'image/png', cookie: c });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const img = await http(`/api/avatar/${u}`, { cookie: c });
  assert.equal(img.status, 200);
  assert.match(img.type, /webp/);
  const meta = await sharp(img.data).metadata();
  assert.equal(meta.width, 256); assert.equal(meta.height, 256);
  assert.ok(!meta.exif);
  assert.ok(!img.data.includes(Buffer.from('GIZLI-METADATA')));
  const fake = await http('/api/me/avatar', { raw: Buffer.from('<?php echo 1; ?>'), type: 'image/png', cookie: c });
  assert.equal(fake.status, 400);
  const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).gif().toBuffer();
  assert.equal((await http('/api/me/avatar', { raw: gif, type: 'image/gif', cookie: c })).status, 400);
  const big = Buffer.alloc(2 * 1024 * 1024 + 10, 1);
  const bigRes = await http('/api/me/avatar', { raw: big, cookie: c }).catch(() => ({ status: 400 }));
  assert.equal(bigRes.status, 400);
  const del = await http('/api/me/avatar', { method: 'DELETE', cookie: c });
  assert.equal(del.status, 200);
  assert.equal((await http(`/api/avatar/${u}`, { cookie: c })).status, 404);
});

test('emoji və çat: yalnız icazəli emoji, 3 saniyə fasilə, hamıya balon, forma vəziyyəti göndərilmir', async () => {
  await makeUser('em_a', 0); await makeUser('em_b', 0);
  const A = await client('em_a'); const B = await client('em_b');
  A.send({ t: 'createRoom', name: 'Emo', visibility: 'private' });
  const room = await A.waitRoom((r) => r.name === 'Emo');
  B.send({ t: 'joinRoom', code: room.code });
  await A.waitRoom((r) => r.members.length === 2);
  A.clear(); B.clear();
  A.send({ t: 'emoji', e: '🔥' });
  const b1 = await B.waitFor((m) => m.t === 'bubble');
  assert.equal(b1.value, '🔥');
  A.send({ t: 'emoji', e: '😂' });
  assert.match((await A.error()).msg, /3 saniyə/);
  A.clear();
  A.send({ t: 'emoji', e: '💩' });
  assert.match((await A.error()).msg, /icazəli deyil/);
  B.send({ t: 'chat', text: '<b>salam</b>   necəsən?' });
  const ch = await A.waitFor((m) => m.t === 'bubble' && m.kind === 'text');
  assert.equal(ch.value, '<b>salam</b> necəsən?'); // klient mətn kimi göstərir (HTML kimi yox)
  assert.ok(!B.msgs.some((m) => m.t === 'room' && m.round)); // emoji/çat masa vəziyyətini yenidən göndərmir
  B.clear(); B.send({ t: 'chat', text: '   ' });
  assert.match((await B.error()).msg, /Boş/);
  for (const c of [A, B]) { c.send({ t: 'leaveRoom' }); c.close(); }
  await sleep(50);
});

test('balansı çatmayan oyunçu real raund başlada bilmir — kredit/demo mesajı', async () => {
  await makeUser('poor_a', 5); await makeUser('poor_b', 100);
  const A = await client('poor_a'); const B = await client('poor_b');
  A.send({ t: 'createRoom', name: 'Poor', visibility: 'private' });
  const room = await A.waitRoom((r) => r.name === 'Poor');
  B.send({ t: 'joinRoom', code: room.code });
  await A.waitRoom((r) => r.members.length === 2);
  A.clear();
  A.send({ t: 'startRound' });
  assert.match((await A.error()).msg, /Kredit istə/);
  for (const c of [A, B]) { c.send({ t: 'leaveRoom' }); c.close(); }
  await sleep(50);
});

// ---------------- masa hədiyyələri ----------------
test('masa hədiyyəsi aktiv raundda: oyun balansları uyğunlaşır, animasiya hadisəsi bir dəfə, təkrar açar oynatmır', async () => {
  const g = await realRound('tg', 2000);
  await sleep(30);
  const qid = g.pid === g.a ? g.b : g.a;
  const room = app.rooms.rooms.get(g.code);
  const pBefore = room.round.players.get(g.pid).balance;
  const qBefore = room.round.players.get(qid).balance;
  g.A.msgs = []; g.B.msgs = [];
  const k = key();
  const r = await http('/api/table-gift', { body: { toId: qid, giftId: 'fire_ace', key: k }, cookie: await login(g.puser) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.credited, 300); assert.equal(r.data.price, 1000);
  assert.equal(room.round.players.get(g.pid).balance, pBefore - 1000);
  assert.equal(room.round.players.get(qid).balance, qBefore + 300);
  assert.equal(await bal(g.pid), pBefore - 1000);
  assert.equal(await bal(qid), qBefore + 300);
  for (const c of [g.A, g.B]) {
    const ev = await c.waitFor((m) => m.t === 'tgift');
    assert.equal(ev.giftId, 'fire_ace'); assert.equal(ev.toId, qid); assert.equal(ev.fromId, g.pid); assert.equal(ev.id, r.data.giftLogId);
  }
  // eyni açarla təkrar (bağlantı təkrarı): pul yenidən çıxılmır, animasiya yenidən göndərilmir
  const again = await http('/api/table-gift', { body: { toId: qid, giftId: 'fire_ace', key: k }, cookie: await login(g.puser) });
  assert.equal(again.data.duplicate, true);
  await sleep(80);
  assert.equal(g.A.msgs.filter((m) => m.t === 'tgift').length, 1);
  assert.equal(g.B.msgs.filter((m) => m.t === 'tgift').length, 1);
  assert.equal(await bal(g.pid), pBefore - 1000);
  // qalan balansla xod: yaddaş və baza uyğundur
  g.P.clear();
  g.P.send({ t: 'act', action: { type: 'xod', amount: 10, v: room.round.version } });
  await g.P.waitRoom((rr) => rr.round.turn !== g.pid);
  await sleep(50);
  assert.equal(await bal(g.pid), pBefore - 1010);
  assert.equal(room.round.players.get(g.pid).balance, pBefore - 1010);
  // özünə, bota, masada olmayana — qadağan
  const self = await http('/api/table-gift', { body: { toId: g.pid, giftId: 'card_rain', key: key() }, cookie: await login(g.puser) });
  assert.match(self.data.error, /Özünüzə/);
  const out = await makeUser('tg_out', 0);
  const away = await http('/api/table-gift', { body: { toId: out, giftId: 'card_rain', key: key() }, cookie: await login(g.puser) });
  assert.match(away.data.error, /masada deyil/);
  // balans çatmır
  await app.db.run('UPDATE users SET balance = 50 WHERE id = $1', [qid]);
  room.round.players.get(qid).balance = 50; room.members.get(qid).balance = 50;
  const quser = qid === g.a ? 'tg_a' : 'tg_b';
  const poor = await http('/api/table-gift', { body: { toId: g.pid, giftId: 'card_rain', key: key() }, cookie: await login(quser) });
  assert.equal(poor.status, 400); assert.match(poor.data.error, /Balansınız çatmır/);
  assert.equal(await bal(qid), 50);
  for (const c of [g.A, g.B]) { c.send({ t: 'leaveRoom' }); c.close(); }
  await sleep(80);
});

test('masa hədiyyəsi: demo/botlu otaqda və otaqdan kənarda işləmir; admin siyahı və ayarlar', async () => {
  const a = await makeUser('tgd_a', 5000);
  const A = await client('tgd_a');
  A.send({ t: 'createRoom', demo: true, bots: 2, name: 'Demo' });
  const room = await A.waitRoom((r) => r.demo);
  const bot = room.members.find((m) => m.isBot).id;
  const r1 = await http('/api/table-gift', { body: { toId: bot, giftId: 'card_rain', key: key() }, cookie: await login('tgd_a') });
  assert.match(r1.data.error, /Demo və botlu/);
  A.send({ t: 'leaveRoom' }); await sleep(80);
  const b = await makeUser('tgd_b', 0);
  const r2 = await http('/api/table-gift', { body: { toId: b, giftId: 'card_rain', key: key() }, cookie: await login('tgd_a') });
  assert.match(r2.data.error, /yalnız masada/);
  assert.equal(await bal(a), 5000);
  A.close();
  // kataloq: hamıya; ayarlar: yalnız admin
  const cat = await http('/api/table-gifts', { cookie: await login('tgd_a') });
  assert.equal(cat.data.sharePct, 30); assert.equal(cat.data.gifts.length, 4); assert.ok(cat.data.gifts.some((g) => g.id === 'lion' && g.sharePct === 30));
  const plain = await http('/api/admin/table-gifts', { cookie: await login('tgd_a') });
  assert.equal(plain.status, 403);
  const adm = (await http('/api/login', { body: { username: 'admin', password: 'admin123' } })).cookie;
  const list = await http('/api/admin/table-gifts', { cookie: adm });
  assert.ok(list.data.items.some((x) => x.giftId === 'fire_ace' && x.credited === 300));
  const set = await http('/api/admin/table-gifts/settings', { body: { sharePct: 40, gifts: [{ id: 'card_rain', price: 120, active: false }] }, cookie: adm });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  assert.equal(set.data.sharePct, 40);
  const cat2 = await http('/api/table-gifts', { cookie: await login('tgd_a') });
  assert.deepEqual(cat2.data.gifts.map((x) => x.id), ['table_king', 'fire_ace', 'lion']); // deaktiv hədiyyə kataloqda görünmür
  const bad = await http('/api/admin/table-gifts/settings', { body: { sharePct: 150 }, cookie: adm });
  assert.equal(bad.status, 400);
  await http('/api/admin/table-gifts/settings', { body: { sharePct: 30, gifts: [{ id: 'card_rain', price: 100, active: true }] }, cookie: adm });
});

// ---------------- v2.7: giriş, qeydiyyat, borc istəyi, borca oyun ----------------
test('qeydiyyat bağlıdır; admin oyunçu yaradır (bonus bir dəfə); giriş açarı; son admin qorunur', async () => {
  const reg = await http('/api/register', { body: { username: 'yeni_x', displayName: 'Yeni', password: '123456' } });
  assert.equal(reg.status, 403);
  assert.equal(await app.db.get('SELECT id FROM users WHERE username = $1', ['yeni_x']), null);
  const adm = await adminCookie();
  const c1 = await http('/api/admin/users', { body: { username: 'ali_k', displayName: 'Əli', password: 'ilkin123' }, cookie: adm });
  assert.equal(c1.status, 200, JSON.stringify(c1.data));
  assert.equal(c1.data.bonus, 100);
  const dup = await http('/api/admin/users', { body: { username: 'ali_k', displayName: 'Əli 2', password: 'ilkin123' }, cookie: adm });
  assert.equal(dup.status, 400);
  assert.equal(Number((await app.db.get(`SELECT COUNT(*) AS n FROM transactions t JOIN users u ON u.id = t.user_id WHERE u.username = 'ali_k' AND t.kind = 'bonus'`)).n), 1);
  // adi oyunçu oyunçu yarada bilməz
  const pl = await http('/api/login', { body: { username: 'ali_k', password: 'ilkin123' } });
  assert.equal(pl.status, 200);
  const no = await http('/api/admin/users', { body: { username: 'zz_zz', displayName: 'Zz', password: '123456' }, cookie: pl.cookie });
  assert.equal(no.status, 403);
  // öz şifrəsini dəyişir
  const pw = await http('/api/password', { body: { oldPassword: 'ilkin123', newPassword: 'yeni4567' }, cookie: pl.cookie });
  assert.equal(pw.status, 200);
  // giriş bağlanır: yeni oyunçu girişi dayanır, admin daxil olur, köhnə sessiya işləyir
  const off = await http('/api/admin/login-switch', { body: { open: false }, cookie: adm });
  assert.equal(off.data.playerLoginOpen, false);
  const denied = await http('/api/login', { body: { username: 'ali_k', password: 'yeni4567' } });
  assert.equal(denied.status, 400);
  assert.match(denied.data.error, /bağlıdır/);
  assert.equal((await http('/api/login', { body: { username: 'admin', password: 'admin123' } })).status, 200);
  assert.equal((await http('/api/me', { cookie: pl.cookie })).data.user.username, 'ali_k');
  assert.equal((await http('/api/register', { body: { username: 'yeni_y', displayName: 'Y', password: '123456' } })).status, 403);
  // ayar bazada saxlanılır — restartdan sonra da bağlıdır
  app.rooms.stop(); app.rooms.rooms.clear();
  await app.close();
  await boot();
  cookies.clear();
  assert.equal((await http('/api/login', { body: { username: 'ali_k', password: 'yeni4567' } })).status, 400);
  const adm2 = (await http('/api/login', { body: { username: 'admin', password: 'admin123' } })).cookie;
  await http('/api/admin/login-switch', { body: { open: true }, cookie: adm2 });
  const ok = await http('/api/login', { body: { username: 'ali_k', password: 'yeni4567' } });
  assert.equal(ok.status, 200);
  // bloklananda sessiya etibarsız olur
  const aliId = c1.data.id;
  await http(`/api/admin/users/${aliId}/status`, { body: { status: 'blocked' }, cookie: adm2 });
  assert.equal((await http('/api/me', { cookie: ok.cookie })).data.user, null);
  await http(`/api/admin/users/${aliId}/status`, { body: { status: 'approved' }, cookie: adm2 });
  // son aktiv admin: başqa admin yoxdursa onun rolu/statusu dəyişdirilə bilməz (özünü dəyişmək də qadağandır)
  const adminId = Number((await app.db.get(`SELECT id FROM users WHERE username = 'admin'`)).id);
  const self = await http(`/api/admin/users/${adminId}/status`, { body: { status: 'blocked' }, cookie: adm2 });
  assert.equal(self.status, 400);
  await http(`/api/admin/users/${aliId}/role`, { body: { role: 'admin' }, cookie: adm2 });
  const aliAdm = (await http('/api/login', { body: { username: 'ali_k', password: 'yeni4567' } })).cookie;
  // indi iki admin var: Əli admini bloklaya bilər; sonra Əli tək admin qalanda heç kim onu sala bilməz
  assert.equal((await http(`/api/admin/users/${aliId}/role`, { body: { role: 'player' }, cookie: aliAdm })).status, 400); // özünü yox
  await app.db.run(`UPDATE users SET status = 'blocked' WHERE username = 'admin'`); // simulyasiya: digər admin bloklanıb
  assert.equal(await app.store.activeAdminCount(), 1);
  await app.db.run(`UPDATE users SET status = 'approved' WHERE username = 'admin'`);
  await http(`/api/admin/users/${aliId}/role`, { body: { role: 'player' }, cookie: adm2 });
  admCookie = null;
});

test('borc istə: təsdiqə qədər heç nə dəyişmir; təsdiqdə bir tranzaksiya; təkrar/paralel təsdiq bir dəfə; rədd/geri götürmə', async () => {
  const L = await makeUser('lr_l', 500); const B = await makeUser('lr_b', 0);
  const lc = await login('lr_l'); const bc = await login('lr_b');
  const self = await http('/api/loans/request', { body: { lenderId: B, amount: 10, dueAt: Date.now() + 86_400_000, key: key() }, cookie: bc });
  assert.match(self.data.error, /Özünüzdən/);
  const bot = await http('/api/loans/request', { body: { lenderId: -5, amount: 10, dueAt: Date.now() + 86_400_000, key: key() }, cookie: bc });
  assert.match(bot.data.error, /Botlardan/);
  const rq = await http('/api/loans/request', { body: { lenderId: L, amount: 200, dueAt: Date.now() + 2 * 86_400_000, key: key() }, cookie: bc });
  assert.equal(rq.status, 200, JSON.stringify(rq.data));
  assert.equal(await bal(L), 500); assert.equal(await bal(B), 0);
  // borc alan özü təsdiqləyə bilməz
  assert.equal((await http(`/api/loans/${rq.data.loanId}/approve`, { body: { key: key() }, cookie: bc })).status, 400);
  const res = await Promise.all([1, 2, 3].map(() => http(`/api/loans/${rq.data.loanId}/approve`, { body: { key: key() }, cookie: lc })));
  assert.equal(res.filter((x) => x.status === 200).length, 1);
  assert.equal(await bal(L), 300); assert.equal(await bal(B), 200);
  const loan = await app.db.get('SELECT status, remaining FROM loans WHERE id = $1', [rq.data.loanId]);
  assert.deepEqual([loan.status, Number(loan.remaining)], ['active', 200]);
  // qismən qaytarma
  const rp = await http(`/api/loans/${rq.data.loanId}/repay`, { body: { amount: 50, key: key() }, cookie: bc });
  assert.equal(rp.data.remaining, 150);
  // balans çatmayanda təsdiq alınmır
  const rq2 = await http('/api/loans/request', { body: { lenderId: L, amount: 1000, dueAt: Date.now() + 86_400_000, key: key() }, cookie: bc });
  const ap2 = await http(`/api/loans/${rq2.data.loanId}/approve`, { body: { key: key() }, cookie: lc });
  assert.match(ap2.data.error, /çatmır/);
  assert.equal((await app.db.get('SELECT status FROM loans WHERE id = $1', [rq2.data.loanId])).status, 'requested');
  assert.equal((await http(`/api/loans/${rq2.data.loanId}/reject`, { body: { key: key() }, cookie: lc })).status, 200);
  const rq3 = await http('/api/loans/request', { body: { lenderId: L, amount: 5, dueAt: Date.now() + 86_400_000, key: key() }, cookie: bc });
  assert.equal((await http(`/api/loans/${rq3.data.loanId}/withdraw`, { body: { key: key() }, cookie: bc })).status, 200);
  assert.equal((await http(`/api/loans/${rq3.data.loanId}/approve`, { body: { key: key() }, cookie: lc })).status, 400);
  assert.equal(await bal(L), 350); assert.equal(await bal(B), 150);
});

// iki real oyunçu; kasıb oyunçunun növbəsinə qədər oyun
async function creditRound(prefix, poorBal = 10, richBal = 1000) {
  const poor = await makeUser(`${prefix}_p`, poorBal); const rich = await makeUser(`${prefix}_r`, richBal);
  const P = await client(`${prefix}_p`); const R = await client(`${prefix}_r`);
  P.send({ t: 'createRoom', name: prefix, visibility: 'private', settings: { ante: 10, minBet: 10 } });
  const room = await P.waitRoom((r) => r.name === prefix);
  R.send({ t: 'joinRoom', code: room.code });
  await P.waitRoom((r) => r.members.length === 2);
  P.clear(); R.clear();
  P.send({ t: 'startRound' });
  let st = await P.waitRoom((r) => r.round?.phase === 'betting');
  if (st.round.turn === rich) {
    R.send({ t: 'act', action: { type: 'xod', amount: 10, v: st.round.version } });
    st = await P.waitRoom((r) => r.round?.turn === poor);
  }
  return { poor, rich, P, R, code: room.code, st, room: () => app.rooms.rooms.get(room.code) };
}

test('borca oyna: qəbul → borclu uduzur → DB-də adi borc (Borca oyun — otaq/raund); real xal yaranmır', async () => {
  const g = await creditRound('cp1');
  await sleep(30);
  assert.equal(await bal(g.poor), 0);
  const total0 = (await bal(g.poor)) + (await bal(g.rich)) + g.room().round.pot;
  assert.equal(g.st.round.me.canCreditOffer, true);
  g.P.clear(); g.R.clear();
  g.P.send({ t: 'act', action: { type: 'creditOffer', limit: 100, dueDays: 7, v: g.st.round.version } });
  const st1 = await g.R.waitRoom((r) => r.round?.phase === 'creditOffer');
  assert.equal(st1.round.pending.limit, 100);
  // təkrar qəbul (bağlantı bərpası) ikinci dəfə işləmir
  g.P.clear(); g.R.clear();
  g.R.send({ t: 'act', action: { type: 'creditAccept', limit: 100, v: st1.round.version } });
  g.P.clear(); g.R.clear();
  g.R.send({ t: 'act', action: { type: 'creditAccept', limit: 100, v: st1.round.version } });
  const st2 = await g.P.waitRoom((r) => r.round?.creditDeal?.limit === 100 && r.round.phase === 'betting');
  // hədiyyə üçün şərti limit istifadə olunmur
  const gift = await http('/api/table-gift', { body: { toId: g.rich, giftId: 'card_rain', key: key() }, cookie: await login('cp1_p') });
  assert.match(gift.data.error, /Balansınız çatmır/);
  g.P.clear(); g.R.clear();
  g.P.send({ t: 'act', action: { type: 'xod', amount: 60, v: st2.round.version } });
  const st3 = await g.R.waitRoom((r) => r.round?.turn === g.rich && r.round.creditPot === 60);
  assert.equal(st3.round.players.find((p) => p.id === g.poor).creditPut, 60);
  assert.equal(await bal(g.poor), 0);   // şərti qoyuluş balansa yazılmır
  g.P.clear(); g.R.clear();
  g.R.send({ t: 'act', action: { type: 'xod', amount: 60, v: st3.round.version } });
  const st4 = await g.P.waitRoom((r) => r.round?.turn === g.poor);
  g.P.clear(); g.R.clear();
  g.P.send({ t: 'act', action: { type: 'pas', v: st4.round.version } });
  await g.P.waitRoom((r) => r.round?.phase === 'finished');
  await sleep(80);
  const loans = await app.db.all('SELECT * FROM loans WHERE borrower_id = $1 AND lender_id = $2', [g.poor, g.rich]);
  assert.equal(loans.length, 1);
  assert.equal(Number(loans[0].amount), 60);
  assert.equal(loans[0].status, 'active');
  assert.match(loans[0].note, /^Borca oyun — otaq cp1|^Borca oyun — otaq [A-Z0-9]+ \/ raund/);
  assert.equal((await bal(g.poor)) + (await bal(g.rich)), total0); // real xal: nə yarandı, nə itdi
  // profil: borclu/alacaqlı
  const pp = await http('/api/profile', { cookie: await login('cp1_p') });
  assert.ok(pp.data.loans.some((l) => l.lenderId === g.rich && l.remaining === 60 && /Borca oyun/.test(l.note)));
  for (const c of [g.P, g.R]) { c.send({ t: 'leaveRoom' }); c.close(); }
  await sleep(80);
});

test('borca oyna: rədd → balansı çatmayan avtomatik pas, borc yoxdur; borclu udur → borc yoxdur', async () => {
  const g = await creditRound('cp2');
  g.P.clear(); g.R.clear();
  g.P.send({ t: 'act', action: { type: 'creditOffer', limit: 50, dueDays: 3, v: g.st.round.version } });
  const s1 = await g.R.waitRoom((r) => r.round?.phase === 'creditOffer');
  g.P.clear(); g.R.clear();
  g.R.send({ t: 'act', action: { type: 'creditDecline', v: s1.round.version } });
  const f = await g.P.waitRoom((r) => r.round?.phase === 'finished');
  assert.deepEqual(f.round.result.winners, [g.rich]);
  await sleep(60);
  assert.equal(Number((await app.db.get('SELECT COUNT(*) AS n FROM loans WHERE borrower_id = $1', [g.poor])).n), 0);
  for (const c of [g.P, g.R]) { c.send({ t: 'leaveRoom' }); c.close(); }
  await sleep(60);
  const h = await creditRound('cp3');
  h.P.clear(); h.R.clear();
  h.P.send({ t: 'act', action: { type: 'creditOffer', limit: 50, dueDays: 3, v: h.st.round.version } });
  const a1 = await h.R.waitRoom((r) => r.round?.phase === 'creditOffer');
  h.P.clear(); h.R.clear();
  h.R.send({ t: 'act', action: { type: 'creditAccept', limit: 50, v: a1.round.version } });
  const a2 = await h.P.waitRoom((r) => r.round?.creditDeal && r.round.phase === 'betting');
  h.P.clear(); h.R.clear();
  h.P.send({ t: 'act', action: { type: 'xod', amount: 50, v: a2.round.version } });
  const a3 = await h.R.waitRoom((r) => r.round?.turn === h.rich);
  h.P.clear(); h.R.clear();
  h.R.send({ t: 'act', action: { type: 'pas', v: a3.round.version } });
  const fin = await h.P.waitRoom((r) => r.round?.phase === 'finished');
  assert.deepEqual(fin.round.result.winners, [h.poor]);
  await sleep(80);
  assert.equal(Number((await app.db.get('SELECT COUNT(*) AS n FROM loans WHERE borrower_id = $1', [h.poor])).n), 0);
  // borclu yalnız real bankı alır: iki oyun haqqı (+ əvvəl varlının xodu varsa) — öz 50 şərti qoyuluşu yox
  const potReal = fin.round.result.payouts[h.poor];
  assert.equal(await bal(h.poor), potReal);
  assert.ok(potReal <= 30);
  for (const c of [h.P, h.R]) { c.send({ t: 'leaveRoom' }); c.close(); }
  await sleep(60);
});

test('borca oyna + server restartı: bitməmiş raundda borc yaranmır, real qoyuluşlar qaytarılır', async () => {
  const g = await creditRound('cp4');
  g.P.clear(); g.R.clear();
  g.P.send({ t: 'act', action: { type: 'creditOffer', limit: 80, dueDays: 3, v: g.st.round.version } });
  const s1 = await g.R.waitRoom((r) => r.round?.phase === 'creditOffer');
  g.P.clear(); g.R.clear();
  g.R.send({ t: 'act', action: { type: 'creditAccept', limit: 80, v: s1.round.version } });
  const s2 = await g.P.waitRoom((r) => r.round?.creditDeal && r.round.phase === 'betting');
  g.P.clear(); g.R.clear();
  g.P.send({ t: 'act', action: { type: 'xod', amount: 80, v: s2.round.version } });
  await g.R.waitRoom((r) => r.round?.creditPot === 80);
  await sleep(60);
  const before = { p: await bal(g.poor), r: await bal(g.rich) };
  g.P.close(); g.R.close();
  app.rooms.stop(); app.rooms.rooms.clear();
  await app.close();
  await boot();
  cookies.clear(); admCookie = null;
  await sleep(100);
  assert.equal(Number((await app.db.get('SELECT COUNT(*) AS n FROM loans WHERE borrower_id = $1', [g.poor])).n), 0);
  // real qoyuluşlar (oyun haqları və varlının xodu) qaytarılıb, şərti qoyuluş silinib
  assert.equal(await bal(g.poor), before.p + 10);
  assert.ok((await bal(g.rich)) >= before.r + 10);
});
