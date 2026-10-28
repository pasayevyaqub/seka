// v3.2 inteqrasiya (real HTTP + WebSocket + baza): "Nəyəsə gəlir?" çatda hamıya; seka bölgüsü bazada bir dəfə;
// baxış xalları raund gedərkən üçüncü oyunçuya getmir, raund bitəndə nəticədə gəlir.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-v32-'));
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

async function tableN(prefix, n, balance = 1000) {
  const ids = []; const cs = [];
  for (let i = 0; i < n; i++) ids.push(await makeUser(`${prefix}${i}`, balance));
  for (let i = 0; i < n; i++) cs.push(await client(`${prefix}${i}`));
  cs[0].send({ t: 'createRoom', name: prefix, visibility: 'private', settings: { ante: 10, minBet: 10 } });
  const room = await cs[0].waitRoom((r) => r.name === prefix);
  for (const c of cs.slice(1)) c.send({ t: 'joinRoom', code: room.code });
  await cs[0].waitRoom((r) => r.members.length === n);
  cs[0].send({ t: 'startRound' });
  await cs[0].waitRoom((r) => r.round && r.round.phase === 'betting');
  return { ids, cs, code: room.code, room: app.rooms.rooms.get(room.code) };
}
const byId = (ids, cs) => (id) => cs[ids.indexOf(id)];
const total = async (ids) => { let s = 0; for (const id of ids) s += await bal(id); return s; };

test('"Nəyəsə gəlir?": təklif və cavab çatda hamıya görünür; "davam" → növbə qalır; ikinci cavab qəbul edilmir', async () => {
  const { ids, cs, room } = await tableN('nq_a', 2);
  const C = byId(ids, cs);
  const r = room.round;
  const turn = r.turn; const other = ids.find((x) => x !== turn);
  for (const c of cs) c.msgs = [];
  C(turn).send({ t: 'act', action: { type: 'offerAny' } });
  for (const c of cs) {
    const b = await c.waitFor((m) => m.t === 'bubble' && m.kind === 'text' && /nəyəsə gəlir/i.test(m.value));
    assert.equal(b.userId, turn);
  }
  const v = await C(other).waitRoom((x) => x.round?.phase === 'offer');
  assert.equal(v.round.pending.kind, 'any'); assert.equal(v.round.pending.to, other);
  assert.ok(room.chatMsgs.some((m) => /nəyəsə gəlir/i.test(m.text)));
  C(other).send({ t: 'act', action: { type: 'offerReply', choice: 'no' } });
  C(other).send({ t: 'act', action: { type: 'offerReply', choice: 'split' } }); // təkrar — rədd
  await C(other).waitFor((m) => m.t === 'error' && /gözlənilmir/.test(m.msg));
  const v2 = await C(turn).waitRoom((x) => x.round?.phase === 'betting');
  assert.equal(v2.round.turn, turn);
  assert.ok(room.chatMsgs.some((m) => m.userId === other && m.text === 'Heç nəyə gəlmirəm, davam elə'));
  await leaveAll(cs);
});

test('"Nəyəsə gəlir?" → Seka → "Pulu böl və 2× Seka": bazadakı balanslar mühərriklə eyni, xal itmir/yaranmır, bir dəfə yazılır', async () => {
  const { ids, cs, room } = await tableN('nq_b', 2);
  const C = byId(ids, cs);
  const t0 = 2000; // 2 × 1000
  const r = room.round;
  const turn = r.turn; const other = ids.find((x) => x !== turn);
  C(turn).send({ t: 'act', action: { type: 'offerAny' } });
  await C(other).waitRoom((x) => x.round?.phase === 'offer');
  C(other).send({ t: 'act', action: { type: 'offerReply', choice: 'seka' } });
  await C(turn).waitRoom((x) => x.round?.phase === 'sekaChoice');
  const pot = room.round.pot;
  for (const id of ids) C(id).send({ t: 'act', action: { type: 'sekaChoice', choice: 'split' } });
  C(turn).send({ t: 'act', action: { type: 'sekaChoice', choice: 'keep' } }); // təkrar seçim — rədd, nəticəni dəyişmir
  const v = await C(turn).waitRoom((x) => x.round?.phase === 'sekaJoin');
  assert.equal(v.round.sekaJoin.mode, 'split');
  assert.equal(v.round.pot, 40); // bank bölündü, hər əsas 2×10 qoydu
  await sleep(150); // paket bazaya yazılsın
  assert.equal(await total(ids) + room.round.pot, t0);
  for (const id of ids) assert.equal(await bal(id), room.round.players.get(id).balance, 'baza = mühərrik');
  const tx = await app.db.all(`SELECT user_id, delta, reason FROM transactions WHERE reason = 'Seka: bank bölündü' AND user_id IN (${ids.join(',')})`);
  assert.equal(tx.length, 2);
  assert.equal(tx.reduce((a, x) => a + Number(x.delta), 0), pot);
  await leaveAll(cs);
});

test('baxış xalları: raund gedərkən üçüncü oyunçuya WebSocket-də getmir; raund bitəndə nəticədə və jurnalda', async () => {
  const { ids, cs, room } = await tableN('nq_c', 3);
  const C = byId(ids, cs);
  // dövrə tamamlansın: hamı bir xod
  const until = async (f) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > 3000) throw new Error('timeout'); await sleep(10); } };
  for (let i = 0; i < 3; i++) { const t = room.round.turn; C(t).send({ t: 'act', action: { type: 'xod', amount: 10 } }); await until(() => room.round.turn !== t); }
  const caller = room.round.turn;
  const target = room.round.prevActive(caller);
  const third = ids.find((x) => x !== caller && x !== target);
  C(third).msgs = [];
  C(caller).send({ t: 'act', action: { type: 'baxis' } });
  await until(() => room.round.compares.length === 1);
  await sleep(100);
  const sc = room.round.compares[0];
  assert.ok(sc && Number.isInteger(sc.aScore) && Number.isInteger(sc.bScore), 'server yadda saxladı');
  for (const m of C(third).msgs) {
    const j = JSON.stringify(m);
    assert.ok(!/compares|aScore|bScore/.test(j), 'raund gedərkən gizli');
    if (m.t === 'room') for (const p of m.room.round?.players || []) if (p.id !== third) assert.equal(p.score, null);
  }
  // raundu bitir: qalanlar pas
  while (room.round.phase !== 'finished') {
    const t = room.round.turn;
    if (room.round.phase !== 'betting') { await sleep(50); continue; }
    C(t).send({ t: 'act', action: { type: 'pas' } });
    await until(() => room.round.phase === 'finished' || room.round.turn !== t);
  }
  const fin = await C(third).waitRoom((x) => x.round?.phase === 'finished');
  assert.equal(fin.round.result.compares.length, 1);
  assert.ok(fin.round.log.some((l) => /baxış vaxtı xalı \d+ idi/.test(l.msg)));
  await leaveAll(cs);
});
