// v3.2: masada borc istəyi — borc verənə kiçik bildiriş (10 san), qəbul/rədd dərhal, cavabsız avtomatik ləğv, nəticə istəyənə dərhal.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-v32l-'));
  dbFile = path.join(dir, 't.db');
  app = await createApp({ dbFile, dbUrl: process.env.TEST_DATABASE_URL || null, botDelay: [5, 15], limits: { register: 1e6, login: 1e6 }, debtIntervalMs: 3_600_000, loanAskMs: 400 });
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

async function table2(prefix, balA = 0, balB = 1000) {
  const a = await makeUser(`${prefix}a`, balA); const b = await makeUser(`${prefix}b`, balB);
  const A = await client(`${prefix}a`); const B = await client(`${prefix}b`);
  A.send({ t: 'createRoom', name: prefix, visibility: 'private' });
  const room = await A.waitRoom((r) => r.name === prefix);
  B.send({ t: 'joinRoom', code: room.code });
  await A.waitRoom((r) => r.members.length === 2);
  return { a, b, A, B, ca: await login(`${prefix}a`), cb: await login(`${prefix}b`) };
}
const ask = (t, amount, k = key()) => http('/api/loans/request', { body: { lenderId: t.b, amount, dueAt: Date.now() + 86_400_000, key: k }, cookie: t.ca });

test('masada borc istəyi: borc verənə kiçik bildiriş (kim, kimdən, nə qədər, 10 san); qəbul → xal bir dəfə köçür, hər iki tərəfə dərhal', async () => {
  const t = await table2('la_a');
  t.B.msgs = []; t.A.msgs = [];
  const r = await ask(t, 300);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.respondBy > Date.now() && r.data.respondBy <= Date.now() + 400);
  const m = await t.B.waitFor((x) => x.t === 'loanAsk');
  assert.deepEqual([m.id, m.borrowerId, m.borrowerName, m.lenderName, m.amount], [r.data.loanId, t.a, 'La_aa', 'La_ab', 300]);
  assert.ok(!t.B.msgs.some((x) => x.t === 'notify' && x.kind !== 'loan_ask'), 'toast yoxdur — yalnız kart (loan_ask yalnız tarixçə üçündür)');
  assert.ok(!t.A.msgs.some((x) => x.t === 'loanAsk'), 'istəyənə kart getmir');
  const k = key();
  const res = await Promise.all([1, 2, 3].map(() => http(`/api/loans/${m.id}/approve`, { body: { key: k }, cookie: t.cb })));
  assert.ok(res.every((x) => x.status === 200));
  assert.equal(await bal(t.a), 300); assert.equal(await bal(t.b), 700);
  assert.equal((await app.db.all(`SELECT * FROM transactions WHERE kind = 'loan_out' AND user_id = $1`, [t.b])).length, 1);
  const done = await t.A.waitFor((x) => x.t === 'loanAskDone');
  assert.equal(done.status, 'accepted');
  assert.match((await t.A.waitFor((x) => x.t === 'notify' && x.kind === 'loan')).text, /qəbul etdi/);
  await t.B.waitFor((x) => x.t === 'loanAskDone' && x.id === m.id);
  await leaveAll([t.A, t.B]);
});

test('masada borc istəyi: rədd → balans dəyişmir, istəyənə dərhal "rədd etdi"; sonra qəbul etmək olmur', async () => {
  const t = await table2('la_b');
  const r = await ask(t, 200);
  const rj = await http(`/api/loans/${r.data.loanId}/reject`, { body: { key: key() }, cookie: t.cb });
  assert.equal(rj.status, 200);
  assert.match((await t.A.waitFor((x) => x.t === 'notify' && x.kind === 'loan')).text, /rədd etdi/);
  assert.equal((await t.A.waitFor((x) => x.t === 'loanAskDone')).status, 'rejected');
  const ap = await http(`/api/loans/${r.data.loanId}/approve`, { body: { key: key() }, cookie: t.cb });
  assert.equal(ap.status, 400);
  assert.equal(await bal(t.a), 0); assert.equal(await bal(t.b), 1000);
  await leaveAll([t.A, t.B]);
});

test('masada borc istəyi: 10 saniyədə (testdə 0,4 san) cavab yoxdursa avtomatik ləğv; hər iki tərəfə bildiriş; gec qəbul alınmır', async () => {
  const t = await table2('la_c');
  const r = await ask(t, 150);
  const exp = await t.A.waitFor((x) => x.t === 'loanAskDone', 3000);
  assert.equal(exp.status, 'expired');
  await t.B.waitFor((x) => x.t === 'loanAskDone' && x.status === 'expired');
  assert.match((await t.A.waitFor((x) => x.t === 'notify' && x.kind === 'loan')).text, /vaxtında cavab vermədi/);
  assert.equal((await app.db.get('SELECT status FROM loans WHERE id = $1', [r.data.loanId])).status, 'cancelled');
  const late = await http(`/api/loans/${r.data.loanId}/approve`, { body: { key: key() }, cookie: t.cb });
  assert.equal(late.status, 400);
  assert.equal(await bal(t.a), 0); assert.equal(await bal(t.b), 1000);
  await leaveAll([t.A, t.B]);
});

test('borc istəyi: məbləğ və balans serverdə yoxlanılır; masadan kənarda adi istək (vaxt limiti yoxdur)', async () => {
  const t = await table2('la_d', 0, 100);
  for (const bad of [0, -5, 1.5, 'abc']) assert.equal((await ask(t, bad)).status, 400, String(bad));
  const big = await ask(t, 500); // borc verənin balansı çatmır — yalnız təsdiqdə yoxlanılır
  const ap = await http(`/api/loans/${big.data.loanId}/approve`, { body: { key: key() }, cookie: t.cb });
  assert.equal(ap.status, 400); assert.match(ap.data.error, /çatmır/);
  assert.equal(await bal(t.a), 0); assert.equal(await bal(t.b), 100);
  await leaveAll([t.A, t.B]);
  const c = await makeUser('la_e', 0); await makeUser('la_f', 1000);
  const far = await http('/api/loans/request', { body: { lenderId: c + 1, amount: 50, dueAt: Date.now() + 86_400_000, key: key() }, cookie: await login('la_e') });
  assert.equal(far.status, 200); assert.equal(far.data.respondBy, null);
});
