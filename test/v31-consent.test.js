// v3.1: yeni raunda razılıq — hər oyunçudan; imtina edən/cavab verməyən bu raundu buraxır, xal tutulmur.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-v31c-'));
  dbFile = path.join(dir, 't.db');
  app = await createApp({ dbFile, dbUrl: process.env.TEST_DATABASE_URL || null, botDelay: [5, 15], limits: { register: 1e6, login: 1e6 }, debtIntervalMs: 3_600_000, consentMs: 700 });
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
    this.autoConsent = false; // v3.1: yeni raunda razılıq — test oyunçusu avtomatik "Razıyam" deyir (əl ilə yoxlanış: autoConsent=false)
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

async function table3(prefix, balances = [500, 500, 500]) {
  const ids = []; const cs = [];
  for (let i = 0; i < balances.length; i++) ids.push(await makeUser(`${prefix}${i}`, balances[i]));
  for (let i = 0; i < balances.length; i++) cs.push(await client(`${prefix}${i}`));
  cs[0].send({ t: 'createRoom', name: prefix, visibility: 'private', settings: { ante: 10, minBet: 10 } });
  const room = await cs[0].waitRoom((r) => r.name === prefix);
  for (const c of cs.slice(1)) c.send({ t: 'joinRoom', code: room.code });
  await cs[0].waitRoom((r) => r.members.length === balances.length);
  return { ids, cs, code: room.code };
}

test('razılıq: "Başla" raundu dərhal başlatmır; razı olanlar oynayır, imtina edəndən xal tutulmur', async () => {
  const { ids, cs, code } = await table3('cn_a');
  const [A, B, C] = cs;
  A.send({ t: 'startRound' });
  const vb = await B.waitRoom((r) => r.consent);
  assert.equal(vb.consent.mine, 'wait'); assert.equal(vb.round, null);
  assert.deepEqual(vb.consent.ask.sort(), [ids[1], ids[2]].sort());
  assert.equal((await A.waitRoom((r) => r.consent)).consent.mine, 'yes'); // sahibin "Başla"sı onun razılığıdır
  assert.equal(app.rooms.rooms.get(code).round, null);
  // sahib təkrar başlada bilməz, ayar dəyişmək olmaz
  A.msgs = []; A.send({ t: 'startRound' });
  assert.match((await A.waitFor((m) => m.t === 'error')).msg, /razılığı/);
  const balC = await bal(ids[2]);
  B.send({ t: 'consent', yes: true });
  await A.waitRoom((r) => r.consent?.yes.includes(ids[1]));
  B.send({ t: 'consent', yes: false }); // ikinci cavab nəzərə alınmır
  C.send({ t: 'consent', yes: false });
  const ra = await A.waitRoom((r) => r.round && !r.consent);
  assert.deepEqual(ra.round.players.map((p) => p.id).sort(), [ids[0], ids[1]].sort());
  const rc = await C.waitRoom((r) => r.round);
  assert.ok(!rc.round.players.some((p) => p.id === ids[2]));
  await sleep(100);
  assert.equal(await bal(ids[2]), balC); // C-dən oyun haqqı tutulmadı
  assert.ok((await bal(ids[0])) < 500 && (await bal(ids[1])) < 500);
  // sonrakı raundda C-dən yenidən soruşulur
  const room = app.rooms.rooms.get(code);
  for (const id of room.round.active()) { try { await app.rooms.act(id, { type: 'pas' }); } catch { /* */ } if (room.round.phase === 'finished') break; }
  await A.waitRoom((r) => r.round?.phase === 'finished');
  C.msgs = [];
  A.send({ t: 'startRound' });
  assert.equal((await C.waitRoom((r) => r.consent)).consent.mine, 'wait');
  await leaveAll(cs);
});

test('razılıq: vaxtında cavab verməyən iştirak etmir; heç kim razı deyilsə raund başlamır', async () => {
  const { ids, cs } = await table3('cn_b');
  const [A, B, C] = cs;
  A.send({ t: 'startRound' });
  await B.waitRoom((r) => r.consent);
  B.send({ t: 'consent', yes: true }); // C cavab vermir
  const ra = await A.waitRoom((r) => r.round && !r.consent, 3000);
  assert.deepEqual(ra.round.players.map((p) => p.id).sort(), [ids[0], ids[1]].sort());
  assert.ok(ra.chat.some((l) => /vaxtında cavab vermədi/.test(typeof l === 'string' ? l : l.text || JSON.stringify(l))));
  await leaveAll(cs);
  const t2 = await table3('cn_c');
  t2.cs[0].send({ t: 'startRound' });
  await t2.cs[1].waitRoom((r) => r.consent);
  t2.cs[1].send({ t: 'consent', yes: false }); t2.cs[2].send({ t: 'consent', yes: false });
  const err = await t2.cs[0].waitFor((m) => m.t === 'error');
  assert.match(err.msg, /Raund başlamadı/);
  const v = await t2.cs[0].waitRoom((r) => !r.consent);
  assert.equal(v.round, null);
  for (const id of t2.ids) assert.equal(await bal(id), 500);
  await leaveAll(t2.cs);
});

test('razılıq: soruşulmayan cavab verə bilməz; soruşulan çıxanda gözləmə bitir; sahib çıxanda ləğv olunur', async () => {
  const { ids, cs } = await table3('cn_d');
  const [A, B, C] = cs;
  A.msgs = [];
  A.send({ t: 'consent', yes: true });
  assert.match((await A.waitFor((m) => m.t === 'error')).msg, /gözlənilmir/);
  A.send({ t: 'startRound' });
  await B.waitRoom((r) => r.consent);
  B.send({ t: 'consent', yes: true });
  await A.waitRoom((r) => r.consent?.yes.includes(ids[1]));
  C.send({ t: 'leaveRoom' });
  const ra = await A.waitRoom((r) => r.round && !r.consent, 400); // vaxt bitməmiş başlayır
  assert.equal(ra.round.players.length, 2);
  await leaveAll(cs);

  const t = await table3('cn_e');
  t.cs[0].send({ t: 'startRound' });
  await t.cs[1].waitRoom((r) => r.consent);
  t.cs[0].send({ t: 'leaveRoom' });
  const v = await t.cs[1].waitRoom((r) => !r.consent && r.hostId !== t.ids[0]);
  assert.equal(v.round, null);
  await sleep(900);
  assert.equal(app.rooms.rooms.get(t.code).round, null);
  await leaveAll(t.cs);
});

test('razılıq: yalnız sahib + botlar (məşq) — soruşulacaq başqa insan yoxdur, raund dərhal başlayır', async () => {
  await makeUser('cn_solo', 0);
  const A = await client('cn_solo');
  A.send({ t: 'createRoom', name: 'cn_solo', visibility: 'private', demo: true, bots: 2 });
  await A.waitRoom((r) => r.name === 'cn_solo' || r.demo);
  A.send({ t: 'startRound' });
  const v = await A.waitRoom((r) => r.round);
  assert.equal(v.consent, null);
  await leaveAll([A]);
});
