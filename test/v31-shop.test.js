// v3.1: oyundaxili market — yalnız virtual xal; server qiyməti və balansı yoxlayır; idempotent alış; kolleksiya hesaba bağlıdır;
// istifadə yalnız otağa yayımlanır və oyuna təsir etmir; admin idarəsi.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-v31-'));
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
const raw = async (pathname, { method = 'GET', body, cookie, type } = {}) => {
  const res = await fetch(base + pathname, { method, headers: { ...(type ? { 'Content-Type': type } : {}), ...(cookie ? { cookie } : {}) }, body });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

test('market: ilkin 5 əşya, yalnız virtual xal; real ödəniş/çıxarış endpointi yoxdur', async () => {
  await makeUser('sh_list', 0);
  const c = await login('sh_list');
  const r = await http('/api/shop', { cookie: c });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.items.map((i) => i.id), ['cigarette', 'whisky', 'energy', 'food', 'doner']);
  assert.deepEqual(r.data.items.map((i) => i.name), ['Siqaret', 'Viski', 'Enerji içkisi', 'Yemək', 'Dönər']);
  assert.ok(r.data.items.every((i) => Number.isInteger(i.price) && i.price > 0));
  assert.deepEqual(r.data.collection, []);
  for (const p of ['/api/shop/checkout', '/api/shop/withdraw', '/api/shop/order', '/api/payments']) {
    const x = await http(p, { body: {}, cookie: c });
    assert.ok(x.status === 404 || x.status === 405, `${p} → ${x.status}`);
  }
  assert.equal((await http('/api/shop')).status, 401); // girişsiz yoxdur
});

test('alış: server qiyməti tətbiq olunur (klientin qiymətinə baxılmır), balans serverdə çıxılır, jurnal yazılır', async () => {
  const id = await makeUser('sh_buy', 500);
  const c = await login('sh_buy');
  const price = (await http('/api/shop', { cookie: c })).data.items.find((i) => i.id === 'whisky').price;
  const r = await http('/api/shop/buy', { body: { itemId: 'whisky', price: 1, amount: 1, key: key() }, cookie: c });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.price, price);
  assert.equal(r.data.balance, 500 - price);
  assert.equal(await bal(id), 500 - price);
  assert.deepEqual(r.data.collection.map((x) => x.id), ['whisky']);
  const tx = await app.db.get(`SELECT delta, kind FROM transactions WHERE user_id = $1 AND kind = 'shop'`, [id]);
  assert.equal(Number(tx.delta), -price);
  const pr = await app.db.all('SELECT * FROM shop_purchases WHERE user_id = $1', [id]);
  assert.equal(pr.length, 1); assert.equal(Number(pr[0].price), price);
  // artıq kolleksiyadadır — yenidən alınmır, xal tutulmur
  const again = await http('/api/shop/buy', { body: { itemId: 'whisky', key: key() }, cookie: c });
  assert.equal(again.status, 400); assert.match(again.data.error, /artıq kolleksiyanızdadır/);
  assert.equal(await bal(id), 500 - price);
  // naməlum əşya
  assert.equal((await http('/api/shop/buy', { body: { itemId: 'xyz', key: key() }, cookie: c })).status, 400);
});

test('alış: balans çatmırsa heç nə dəyişmir; balans mənfiyə düşmür', async () => {
  const id = await makeUser('sh_poor', 10);
  const c = await login('sh_poor');
  const r = await http('/api/shop/buy', { body: { itemId: 'whisky', key: key() }, cookie: c });
  assert.equal(r.status, 400); assert.match(r.data.error, /Balansınız çatmır/);
  assert.equal(await bal(id), 10);
  assert.equal((await app.db.all('SELECT * FROM user_items WHERE user_id = $1', [id])).length, 0);
  assert.equal((await app.db.all('SELECT * FROM shop_purchases WHERE user_id = $1', [id])).length, 0);
});

test('alış: eyni açarla təkrar (paralel də) — xal yalnız BİR dəfə tutulur', async () => {
  const id = await makeUser('sh_idem', 1000);
  const c = await login('sh_idem');
  const k = key();
  const res = await Promise.all([1, 2, 3, 4, 5].map(() => http('/api/shop/buy', { body: { itemId: 'doner', key: k }, cookie: c })));
  assert.ok(res.every((r) => r.status === 200), JSON.stringify(res.map((r) => r.data)));
  assert.equal(res.filter((r) => !r.data.duplicate).length, 1);
  const price = res[0].data.price;
  assert.equal(await bal(id), 1000 - price);
  assert.equal((await app.db.all('SELECT * FROM shop_purchases WHERE user_id = $1', [id])).length, 1);
  assert.equal((await app.db.all(`SELECT * FROM transactions WHERE user_id = $1 AND kind = 'shop'`, [id])).length, 1);
  // gecikmiş təkrar da eyni nəticə
  const late = await http('/api/shop/buy', { body: { itemId: 'doner', key: k }, cookie: c });
  assert.equal(late.data.duplicate, true); assert.equal(await bal(id), 1000 - price);
  // fərqli açarlarla paralel: əşya bir dəfə alınır (kolleksiyada bir dəfə)
  const ks = await Promise.all([1, 2, 3].map(() => http('/api/shop/buy', { body: { itemId: 'food', key: key() }, cookie: c })));
  assert.equal(ks.filter((r) => r.status === 200).length, 1);
  const foodPrice = ks.find((r) => r.status === 200).data.price;
  assert.equal(await bal(id), 1000 - price - foodPrice);
});

test('kolleksiya hesaba bağlıdır: çıxış və yenidən girişdən sonra qalır', async () => {
  await makeUser('sh_keep', 1000);
  const c = await login('sh_keep');
  await http('/api/shop/buy', { body: { itemId: 'energy', key: key() }, cookie: c });
  await http('/api/logout', { body: {}, cookie: c });
  const c2 = (await http('/api/login', { body: { username: 'sh_keep', password: '123456' } })).cookie;
  const r = await http('/api/shop', { cookie: c2 });
  assert.deepEqual(r.data.collection.map((x) => x.id), ['energy']);
  const prof = await http('/api/profile', { cookie: c2 });
  assert.deepEqual(prof.data.collection.map((x) => x.id), ['energy']);
});

test('istifadə: yalnız sahibi; hadisə yalnız öz otağına gedir; oyun vəziyyəti və balans dəyişmir', async () => {
  const { ids, cs } = await table('sh_use', [1000, 1000]);
  await makeUser('sh_out', 1000);
  const oc = await client('sh_out');
  const c0 = await login('sh_use0'); const c1 = await login('sh_use1');
  const no = await http('/api/shop/use', { body: { itemId: 'whisky' }, cookie: c0 });
  assert.equal(no.status, 400); assert.match(no.data.error, /kolleksiyanızda yoxdur/);
  await http('/api/shop/buy', { body: { itemId: 'whisky', key: key() }, cookie: c0 });
  // raund gedir: istifadə raundu dəyişmir
  cs[0].send({ t: 'startRound' });
  const before = await cs[0].waitRoom((r) => r.round && r.round.phase !== 'finished');
  const balBefore = await bal(ids[0]);
  for (const c of [...cs, oc]) c.msgs = [];
  const u = await http('/api/shop/use', { body: { itemId: 'whisky' }, cookie: c0 });
  assert.equal(u.status, 200, JSON.stringify(u.data));
  const ev0 = await cs[0].waitFor((m) => m.t === 'itemUse');
  const ev1 = await cs[1].waitFor((m) => m.t === 'itemUse');
  assert.equal(ev0.userId, ids[0]); assert.equal(ev1.itemId, 'whisky');
  assert.deepEqual(Object.keys(ev1).sort(), ['at', 'imageVer', 'itemId', 'name', 't', 'userId']); // heç bir şəxsi məlumat yoxdur
  await sleep(150);
  assert.ok(!oc.msgs.some((m) => m.t === 'itemUse'), 'başqa otaqdakı/otaqsız oyunçu görməməlidir');
  assert.ok(!cs[0].msgs.some((m) => m.t === 'room'), 'istifadə masa vəziyyətini yenidən göndərməməlidir');
  assert.equal(await bal(ids[0]), balBefore);
  assert.ok(before.round, 'raund davam edir');
  // tez-tez təkrar — limit
  const spam = await http('/api/shop/use', { body: { itemId: 'whisky' }, cookie: c0 });
  assert.equal(spam.status, 400);
  const uses = await app.db.get('SELECT uses FROM user_items WHERE user_id = $1 AND item_id = $2', [ids[0], 'whisky']);
  assert.equal(Number(uses.uses), 1);
  // başqası mənim əşyamı istifadə edə bilməz
  assert.equal((await http('/api/shop/use', { body: { itemId: 'whisky' }, cookie: c1 })).status, 400);
  await leaveAll([...cs, oc]);
});

test('admin: ad/qiymət/satış və şəkil; yeni qiymət yalnız sonrakı alışlara; oyunçu/moderator dəyişə bilməz', async () => {
  const pid = await makeUser('sh_adm_p', 1000);
  const pc = await login('sh_adm_p');
  const a = await adm();
  assert.notEqual((await http('/api/admin/shop', { cookie: pc })).status, 200);
  assert.notEqual((await http('/api/admin/shop/food', { body: { price: 1 }, cookie: pc })).status, 200);
  const modId = await makeUser('sh_mod', 0);
  await http(`/api/admin/users/${modId}/role`, { body: { role: 'moderator' }, cookie: a });
  const mc = (await http('/api/login', { body: { username: 'sh_mod', password: '123456' } })).cookie;
  assert.notEqual((await http('/api/admin/shop/food', { body: { price: 1 }, cookie: mc })).status, 200);

  await http('/api/shop/buy', { body: { itemId: 'cigarette', key: key() }, cookie: pc });
  const paid = Number((await app.db.get('SELECT price_paid FROM user_items WHERE user_id = $1 AND item_id = $2', [pid, 'cigarette'])).price_paid);
  const e = await http('/api/admin/shop/cigarette', { body: { name: '  Qızıl   siqaret ', price: 333, active: true }, cookie: a });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  assert.equal(e.data.item.name, 'Qızıl siqaret'); assert.equal(e.data.item.price, 333);
  assert.equal(Number((await app.db.get('SELECT price_paid FROM user_items WHERE user_id = $1 AND item_id = $2', [pid, 'cigarette'])).price_paid), paid);
  assert.equal((await http('/api/shop', { cookie: pc })).data.collection[0].name, 'Qızıl siqaret');
  for (const bad of [{ price: 0 }, { price: -5 }, { price: 1.5 }, { name: 'x' }, { name: 'a'.repeat(31) }]) {
    assert.equal((await http('/api/admin/shop/cigarette', { body: bad, cookie: a })).status, 400, JSON.stringify(bad));
  }
  // satışdan çıxarılır — alınmır, amma alınmışlar kolleksiyada qalır
  await http('/api/admin/shop/food', { body: { active: false }, cookie: a });
  assert.ok(!(await http('/api/shop', { cookie: pc })).data.items.some((i) => i.id === 'food'));
  const nb = await http('/api/shop/buy', { body: { itemId: 'food', key: key() }, cookie: pc });
  assert.equal(nb.status, 400); assert.match(nb.data.error, /satışda deyil/);
  assert.ok((await http('/api/admin/shop', { cookie: a })).data.items.some((i) => i.id === 'food' && !i.active));
  await http('/api/admin/shop/food', { body: { active: true }, cookie: a });

  // şəkil: saxta fayl rədd edilir, həqiqi PNG qəbul olunur və webp kimi verilir, sıfırlanır
  const fake = await raw('/api/admin/shop/energy/image', { method: 'POST', body: Buffer.from('<svg onload=alert(1)>'), cookie: a, type: 'image/png' });
  assert.equal(fake.status, 400);
  let sharp = null; try { sharp = (await import('sharp')).default; } catch { /* yoxdur */ }
  if (sharp) {
    const png = await sharp({ create: { width: 40, height: 30, channels: 4, background: { r: 200, g: 20, b: 20, alpha: 0.5 } } }).png().toBuffer();
    const up = await raw('/api/admin/shop/energy/image', { method: 'POST', body: png, cookie: a, type: 'image/png' });
    assert.equal(up.status, 200, JSON.stringify(up.data));
    const it = (await http('/api/shop', { cookie: pc })).data.items.find((i) => i.id === 'energy');
    assert.equal(it.hasImage, true); assert.equal(it.imageVer, up.data.imageVer);
    const img = await fetch(`${base}/api/shop/img/energy`, { headers: { cookie: pc } });
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/webp');
    const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
    assert.equal(meta.width, 256); assert.equal(meta.hasAlpha, true);
    assert.equal((await raw('/api/admin/shop/energy/image', { method: 'POST', body: png, cookie: pc, type: 'image/png' })).status === 200, false);
    const del = await raw('/api/admin/shop/energy/image', { method: 'DELETE', cookie: a });
    assert.equal(del.status, 200);
    assert.equal((await http('/api/shop', { cookie: pc })).data.items.find((i) => i.id === 'energy').hasImage, false);
    assert.equal((await fetch(`${base}/api/shop/img/energy`, { headers: { cookie: pc } })).status, 404);
  }
});

test('alış raund zamanı: aktiv raundun yaddaş balansı da yenilənir (növbə ilə), raund pozulmur', async () => {
  const { ids, cs } = await table('sh_rnd', [400, 400]);
  const c0 = await login('sh_rnd0');
  cs[0].send({ t: 'startRound' });
  await cs[0].waitRoom((r) => r.round && r.round.phase !== 'finished');
  const dbBefore = await bal(ids[0]);
  const r = await http('/api/shop/buy', { body: { itemId: 'energy', key: key() }, cookie: c0 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await bal(ids[0]), dbBefore - r.data.price);
  const room = [...app.rooms.rooms.values()].find((x) => x.name === 'sh_rnd');
  const mem = room.round.players.get(ids[0]);
  assert.equal(mem.balance, dbBefore - r.data.price);
  await leaveAll(cs);
});
