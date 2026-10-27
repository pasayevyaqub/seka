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
async function makeUser(username, balance = 0) {
  const r = await http('/api/register', { body: { username, displayName: username[0].toUpperCase() + username.slice(1), password: '123456' } });
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
    throw new Error('waitFor timeout; last: ' + JSON.stringify(this.msgs.slice(-3)).slice(0, 500));
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
