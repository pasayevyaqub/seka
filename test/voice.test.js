// Səsli danışıq siqnalı (server) — v2.8 inteqrasiya köməkçiləri ilə (real HTTP + WebSocket): balans məxfiliyi, xal məxfiliyi, çat tarixçəsi,
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-voice-'));
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


test('səs: status yalnız otaq üzvlərinə, sonra girənə mövcud iştirakçılar göndərilir, siqnal yalnız səsdəki üzvlər arasında', async () => {
  const { ids, cs, code } = await table('vs', [100, 100]);
  const [A, B] = cs;
  await makeUser('vs_out', 0); const O = await client('vs_out');
  A.clear(); B.clear();
  A.send({ t: 'voiceState', enabled: true, muted: false, restart: true });
  const st = await B.waitFor((m) => m.t === 'voiceState' && m.userId === ids[0]);
  assert.equal(st.enabled, true);
  // səsdə olmayan B-yə siqnal göndərmək olmaz (B hələ qoşulmayıb)
  A.send({ t: 'voiceSignal', to: ids[1], signal: { description: { type: 'offer', sdp: 'x' } } });
  await sleep(150);
  assert.ok(!B.msgs.some((m) => m.t === 'voiceSignal'));
  B.send({ t: 'voiceState', enabled: true });
  await A.waitFor((m) => m.t === 'voiceState' && m.userId === ids[1] && m.enabled);
  A.send({ t: 'voiceSignal', to: ids[1], signal: { description: { type: 'offer', sdp: 'x' } } });
  const sig = await B.waitFor((m) => m.t === 'voiceSignal');
  assert.equal(sig.fromId, ids[0]);
  // kənar istifadəçi heç nə almır və siqnal göndərə bilmir
  O.send({ t: 'voiceSignal', to: ids[1], signal: { candidate: {} } });
  await sleep(150);
  assert.ok(!O.msgs.some((m) => m.t === 'voiceState' || m.t === 'voiceSignal'));
  assert.equal(B.msgs.filter((m) => m.t === 'voiceSignal').length, 1);
  // böyük siqnal rədd olunur
  A.send({ t: 'voiceSignal', to: ids[1], signal: { description: { type: 'offer', sdp: 'y'.repeat(13000) } } });
  await sleep(150);
  assert.equal(B.msgs.filter((m) => m.t === 'voiceSignal').length, 1);
  // sonradan girən: otaqdakı səs iştirakçılarını dərhal öyrənir
  await makeUser('vs_late', 100); const L = await client('vs_late');
  L.send({ t: 'joinRoom', code });
  await L.waitFor((m) => m.t === 'voiceState' && m.userId === ids[0] && m.enabled);
  await L.waitFor((m) => m.t === 'voiceState' && m.userId === ids[1] && m.enabled);
  // səssiz statusu yayılır
  B.send({ t: 'voiceState', enabled: true, muted: true });
  const mu = await A.waitFor((m) => m.t === 'voiceState' && m.userId === ids[1] && m.muted === true);
  assert.equal(mu.restart, false);
  // bağlantı kəsilir → digərlərinə "səsdən çıxdı"
  B.close();
  await A.waitFor((m) => m.t === 'voiceState' && m.userId === ids[1] && m.enabled === false);
  O.close();
  await leaveAll([A, L]);
});

test('səs: /api/voice/ice — otaqdan kənarda 403; TURN qurulmayıbsa yalnız STUN; shared-secret ilə müddətli parol, gizli açar cavabda yoxdur', async () => {
  await makeUser('ice_a', 0);
  const r0 = await http('/api/voice/ice', { cookie: await login('ice_a') });
  assert.equal(r0.status, 403);
  const { cs } = await table('ice', [100, 100]);
  const r1 = await http('/api/voice/ice', { cookie: await login('ice0') });
  assert.equal(r1.status, 200); assert.equal(r1.data.turn, false);
  assert.ok(r1.data.iceServers.every((s) => !s.credential));
  process.env.TURN_URLS = 'turn:turn.example.com:3478'; process.env.TURN_SHARED_SECRET = 'cox-gizli-acar-123';
  try {
    const r2 = await http('/api/voice/ice', { cookie: await login('ice0') });
    assert.equal(r2.data.turn, true);
    const t = r2.data.iceServers.find((s) => s.credential);
    assert.ok(t && /^\d+:\d+:[A-Z0-9]+$/.test(t.username));
    assert.ok(Number(t.username.split(':')[0]) > Date.now() / 1000);
    assert.ok(!JSON.stringify(r2.data).includes('cox-gizli-acar-123'));
  } finally { delete process.env.TURN_URLS; delete process.env.TURN_SHARED_SECRET; }
  await leaveAll(cs);
});
