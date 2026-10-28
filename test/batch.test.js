// Baza səviyyəsində: paket (batch) idempotentliyi, rollback, v1 → v2 migration.
// Standart: SQLite (müvəqqəti fayl). TEST_DATABASE_URL verilsə eyni testlər PostgreSQL-də işləyir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb } from '../server/db.js';
import { Store, hashPassword, checkPassword } from '../server/store.js';

const PG = process.env.TEST_DATABASE_URL || null;

async function freshStore() {
  if (PG) {
    const db = await openDb({ url: PG });
    // hər test öz istifadəçiləri ilə işləyir (unikal adlar)
    return { db, store: new Store(db), cleanup: () => db.close() };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-batch-'));
  const db = await openDb({ file: path.join(dir, 't.db') });
  return { db, store: new Store(db), cleanup: async () => { await db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

let n = 0;
async function user(db, balance = 0) {
  const name = `u${Date.now().toString(36)}${++n}${crypto.randomInt(1e6)}`;
  await db.run(`INSERT INTO users(username, display_name, display_key, pass_hash, status, balance, created_at) VALUES($1, $1, $1, 'x:y', 'approved', $2, 1)`, [name, balance]);
  return Number((await db.get('SELECT id FROM users WHERE username = $1', [name])).id);
}
const bal = async (db, id) => Number((await db.get('SELECT balance FROM users WHERE id = $1', [id])).balance);
const txCount = async (db, id) => Number((await db.get('SELECT COUNT(*) AS n FROM transactions WHERE user_id = $1', [id])).n);
const uid = () => crypto.randomUUID();

test('eyni paket ardıcıl iki dəfə → balans yalnız bir dəfə dəyişir', async () => {
  const { db, store, cleanup } = await freshStore();
  const a = await user(db);
  const r = uid();
  const b = { batchId: `${r}:1`, uid: r, room: 'T', effects: [{ userId: a, delta: 10, reason: 'test' }], contrib: {}, end: { status: 'finished', flows: [] } };
  const first = await store.applyRoundBatch(b);
  const second = await store.applyRoundBatch(b);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.balances[a], 10);
  assert.equal(await bal(db, a), 10);
  assert.equal(await txCount(db, a), 1);
  await cleanup();
});

test('batchId olmadan yazılış qəbul edilmir', async () => {
  const { db, store, cleanup } = await freshStore();
  const a = await user(db);
  await assert.rejects(store.applyRoundBatch({ uid: uid(), room: 'T', effects: [{ userId: a, delta: 10, reason: 'x' }] }), /batchId/);
  assert.equal(await bal(db, a), 0);
  await cleanup();
});

test('eyni paket paralel 8 dəfə → yalnız bir dəfə tətbiq olunur', async () => {
  const { db, store, cleanup } = await freshStore();
  const a = await user(db, 100);
  const c = await user(db, 100);
  const r = uid();
  const b = { batchId: `${r}:1`, uid: r, room: 'T', effects: [{ userId: a, delta: -25, reason: 'Xod' }, { userId: c, delta: 25, reason: 'Bank udu' }], contrib: { [a]: 25 }, end: { status: 'finished', flows: [{ from: a, to: c, cents: 2500 }] } };
  const res = await Promise.all(Array.from({ length: 8 }, () => store.applyRoundBatch(b)));
  assert.equal(res.filter((x) => !x.duplicate).length, 1);
  assert.equal(await bal(db, a), 75);
  assert.equal(await bal(db, c), 125);
  assert.equal(await txCount(db, a), 1);
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM round_flows WHERE round_uid = $1', [r])).n), 1);
  await cleanup();
});

test('eyni raundda fərqli paketlərin hər biri bir dəfə tətbiq olunur', async () => {
  const { db, store, cleanup } = await freshStore();
  const a = await user(db, 100);
  const c = await user(db, 100);
  const r = uid();
  const batches = [
    { batchId: `${r}:1`, uid: r, room: 'T', effects: [{ userId: a, delta: -10, reason: 'Oyun haqqı' }, { userId: c, delta: -10, reason: 'Oyun haqqı' }], contrib: { [a]: 10, [c]: 10 }, end: null },
    { batchId: `${r}:2`, uid: r, room: 'T', effects: [{ userId: a, delta: -20, reason: 'Xod' }], contrib: { [a]: 30, [c]: 10 }, end: null },
    { batchId: `${r}:3`, uid: r, room: 'T', effects: [{ userId: c, delta: -20, reason: 'Xod' }], contrib: { [a]: 30, [c]: 30 }, end: null },
    { batchId: `${r}:4`, uid: r, room: 'T', effects: [{ userId: a, delta: 60, reason: 'Bank udu' }], contrib: { [a]: 30, [c]: 30 }, end: { status: 'finished', flows: [{ from: c, to: a, cents: 3000 }] } },
  ];
  for (const b of batches) await store.applyRoundBatch(b);
  for (const b of batches) assert.equal((await store.applyRoundBatch(b)).duplicate, true); // hamısının təkrarı
  assert.equal(await bal(db, a), 130);
  assert.equal(await bal(db, c), 70);
  assert.equal(await txCount(db, a), 3);
  assert.equal(await txCount(db, c), 2);
  const round = await db.get('SELECT status FROM rounds WHERE uid = $1', [r]);
  assert.equal(round.status, 'finished');
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM round_batches WHERE round_uid = $1', [r])).n), 4);
  await cleanup();
});

test('tranzaksiya ortasında xəta → tam rollback (paket qeydi də), sonra eyni paket düzgün yazılır', async () => {
  const { db, store, cleanup } = await freshStore();
  const a = await user(db, 100);
  const c = await user(db, 100);
  const r = uid();
  // ikinci effektin reason-u NULL → NOT NULL məhdudiyyəti pozulur, birinci UPDATE artıq icra olunub
  const bad = { batchId: `${r}:1`, uid: r, room: 'T', effects: [{ userId: a, delta: -10, reason: 'Xod' }, { userId: c, delta: 10, reason: null }], contrib: { [a]: 10 }, end: null };
  await assert.rejects(store.applyRoundBatch(bad));
  assert.equal(await bal(db, a), 100);
  assert.equal(await bal(db, c), 100);
  assert.equal(await txCount(db, a), 0);
  assert.equal(await db.get('SELECT * FROM round_batches WHERE batch_id = $1', [`${r}:1`]), null);
  assert.equal(await db.get('SELECT * FROM rounds WHERE uid = $1', [r]), null);
  const good = { ...bad, effects: [{ userId: a, delta: -10, reason: 'Xod' }, { userId: c, delta: 10, reason: 'Bank' }] };
  assert.equal((await store.applyRoundBatch(good)).duplicate, false);
  assert.equal(await bal(db, a), 90);
  assert.equal(await bal(db, c), 110);
  await cleanup();
});

test('COMMIT olub, cavab itib → təkrar cəhd balansı ikiqat dəyişmir', async () => {
  const { db, store, cleanup } = await freshStore();
  const a = await user(db, 50);
  const r = uid();
  const b = { batchId: `${r}:7`, uid: r, room: 'T', effects: [{ userId: a, delta: -15, reason: 'Xod' }], contrib: { [a]: 15 }, end: null };
  // "şəbəkə": tranzaksiya təsdiqlənir, amma çağırana xəta gedir
  const lossy = async () => { await store.applyRoundBatch(b); throw new Error('bağlantı kəsildi (cavab itdi)'); };
  await assert.rejects(lossy(), /cavab itdi/);
  const retry = await store.applyRoundBatch(b);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.balances[a], 35);
  assert.equal(await bal(db, a), 35);
  assert.equal(await txCount(db, a), 1);
  await cleanup();
});

test('server bərpası: yarımçıq raund yalnız yazılmış paketlərə görə və bir dəfə qaytarılır', async () => {
  const { db, store, cleanup } = await freshStore();
  const a = await user(db, 100);
  const r = uid();
  await store.applyRoundBatch({ batchId: `${r}:1`, uid: r, room: 'T', effects: [{ userId: a, delta: -10, reason: 'Oyun haqqı' }], contrib: { [a]: 10 }, end: null });
  await store.applyRoundBatch({ batchId: `${r}:2`, uid: r, room: 'T', effects: [{ userId: a, delta: -30, reason: 'Xod' }], contrib: { [a]: 40 }, end: null });
  // 3-cü paket yaddaşda qalıb, yazılmayıb (server çökdü) — bazada yoxdur
  assert.equal(await bal(db, a), 60);
  await store.recoverActiveRounds();
  await store.recoverActiveRounds(); // ikinci dəfə heç nə etmir
  assert.equal(await bal(db, a), 100);
  assert.equal((await db.get('SELECT status FROM rounds WHERE uid = $1', [r])).status, 'aborted');
  // ləğv olunmuş raunda gec gələn paket nəticə yaratmır
  await store.applyRoundBatch({ batchId: `${r}:3`, uid: r, room: 'T', effects: [], contrib: { [a]: 40 }, end: { status: 'finished', flows: [{ from: a, to: 999, cents: 100 }] } });
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM round_flows WHERE round_uid = $1', [r])).n), 0);
  await cleanup();
});

// ---------- v1 bazasından migration ----------
const V1_SQL = [
  `CREATE TABLE users (id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, display_key TEXT NOT NULL UNIQUE, phone TEXT, pass_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'player', status TEXT NOT NULL DEFAULT 'pending', balance BIGINT NOT NULL DEFAULT 0, created_at BIGINT NOT NULL)`,
  `CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at BIGINT NOT NULL)`,
  `CREATE TABLE transactions (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, delta BIGINT NOT NULL, balance_after BIGINT NOT NULL, reason TEXT NOT NULL, by_user INTEGER, room TEXT, created_at BIGINT NOT NULL)`,
  `CREATE INDEX tx_user_idx ON transactions(user_id, id)`,
];

test('v1 bazasından migration: hesablar, şifrə hash-ləri, balanslar, tarixçə qorunur', async () => {
  const hashA = hashPassword('admin-sirr');
  const hashY = hashPassword('yaqub123');
  const seed = [
    [`INSERT INTO users(username, display_name, display_key, pass_hash, role, status, balance, created_at) VALUES('admin', 'Admin', 'admin', $1, 'admin', 'approved', 0, 1)`, [hashA]],
    [`INSERT INTO users(username, display_name, display_key, pass_hash, role, status, balance, created_at) VALUES('yaqub', 'Yaqub', 'yaqub', $1, 'player', 'approved', -70, 2)`, [hashY]],
    [`INSERT INTO users(username, display_name, display_key, pass_hash, role, status, balance, created_at) VALUES('anar', 'Anar', 'anar', $1, 'player', 'pending', 0, 3)`, [hashY]],
    [`INSERT INTO transactions(user_id, delta, balance_after, reason, by_user, room, created_at) VALUES(2, 30, 30, 'Admin: əlavə', 1, NULL, 10)`, []],
    [`INSERT INTO transactions(user_id, delta, balance_after, reason, by_user, room, created_at) VALUES(2, -100, -70, 'Xod', NULL, 'ABCDE', 11)`, []],
    [`INSERT INTO sessions(token, user_id, created_at) VALUES('kohne-sessiya', 2, 5)`, []],
  ];
  let db, cleanup;
  if (PG) {
    const pg = (await import('pg')).default;
    const schema = `v1_${crypto.randomInt(1e9)}`;
    const raw = new pg.Pool({ connectionString: PG });
    await raw.query(`CREATE SCHEMA ${schema}`);
    await raw.query(`SET search_path TO ${schema}`);
    for (const q of V1_SQL) await raw.query(q);
    for (const [q, p] of seed) await raw.query(q, p);
    await raw.end();
    db = await openDb({ url: `${PG}${PG.includes('?') ? '&' : '?'}options=-c%20search_path%3D${schema}` });
    cleanup = async () => { await db.close(); };
  } else {
    const { DatabaseSync } = await import('node:sqlite');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-v1-'));
    const file = path.join(dir, 'seka.db');
    const sq = new DatabaseSync(file);
    for (const q of V1_SQL) sq.exec(q.replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT'));
    for (const [q, p] of seed) sq.prepare(q.replace(/\$(\d+)/g, '?$1')).run(...p);
    sq.close();
    db = await openDb({ file });
    cleanup = async () => { await db.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  }
  const store = new Store(db);
  const users = await db.all('SELECT id, username, pass_hash, status, role, balance FROM users ORDER BY id');
  assert.deepEqual(users.map((u) => [u.username, u.status, u.role, Number(u.balance)]), [['admin', 'approved', 'admin', 0], ['yaqub', 'approved', 'player', -70], ['anar', 'approved', 'player', 0]]); // köhnə pending → aktiv, bonus verilmir
  assert.equal(users[0].pass_hash, hashA);
  assert.ok(checkPassword('yaqub123', users[1].pass_hash));
  assert.equal((await store.login('admin', 'admin-sirr')).user.username, 'admin');
  assert.equal((await store.userByToken('kohne-sessiya')).username, 'yaqub');
  const tx = await db.all('SELECT delta, balance_after, reason, kind FROM transactions ORDER BY id');
  assert.deepEqual(tx.map((t) => [Number(t.delta), Number(t.balance_after), t.reason, t.kind ?? null]), [[30, 30, 'Admin: əlavə', null], [-100, -70, 'Xod', null]]);
  const migs = (await db.all('SELECT id FROM schema_migrations ORDER BY id')).map((m) => Number(m.id));
  assert.deepEqual(migs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal((await db.get(`SELECT value FROM app_settings WHERE key = 'player_login_open'`)).value, '1');
  // Migration 5: masa hədiyyələri — ilkin qiymətlər və 30%, mövcud balanslara toxunulmur
  assert.deepEqual((await db.all('SELECT id, price, active FROM gift_types ORDER BY sort')).map((g) => [g.id, Number(g.price), Number(g.active)]), [['card_rain', 100, 1], ['table_king', 300, 1], ['fire_ace', 1000, 1], ['lion', 500, 1]]);
  assert.equal((await db.get(`SELECT value FROM app_settings WHERE key = 'gift_share_pct'`)).value, '30');
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM table_gifts')).n), 0);
  assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM transactions WHERE kind = 'bonus'")).n), 0);
  // ensureAdmin mövcud admini dəyişmir
  await store.ensureAdmin('admin', 'basqa');
  assert.equal((await db.get(`SELECT pass_hash FROM users WHERE username = 'admin'`)).pass_hash, hashA);
  // yeni sxem işləyir
  const r = uid();
  await store.applyRoundBatch({ batchId: `${r}:1`, uid: r, room: 'T', effects: [{ userId: 2, delta: 5, reason: 'Bank udu' }], contrib: {}, end: null });
  assert.equal(Number((await db.get('SELECT balance FROM users WHERE id = 2')).balance), -65);
  await cleanup();
});
