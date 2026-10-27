// Maliyyə nüvəsi: bonus, kredit, hədiyyə, oyunçular arası borc, avtomatik tutulma, idempotency.
// Standart: SQLite (müvəqqəti fayl). TEST_DATABASE_URL verilsə eyni testlər PostgreSQL-də işləyir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb } from '../server/db.js';
import { Store } from '../server/store.js';
import { Finance } from '../server/finance.js';

const PG = process.env.TEST_DATABASE_URL || null;
const key = () => crypto.randomUUID();
const H = 3_600_000;

async function setup() {
  let db, cleanup;
  if (PG) { db = await openDb({ url: PG }); cleanup = () => db.close(); }
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-fin-'));
    db = await openDb({ file: path.join(dir, 't.db') });
    cleanup = async () => { await db.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  }
  const store = new Store(db);
  const fin = new Finance(db);
  let n = 0;
  const user = async (balance = 0) => {
    const name = `f${crypto.randomInt(1e9).toString(36)}${++n}`;
    const r = await store.register({ username: name, displayName: name, password: '123456' }, null);
    await db.run('UPDATE users SET balance = $1 WHERE id = $2', [balance, r.id]);
    return r.id;
  };
  const bal = async (id) => Number((await db.get('SELECT balance FROM users WHERE id = $1', [id])).balance);
  const debt = async (id) => Number((await db.get('SELECT credit_debt FROM users WHERE id = $1', [id])).credit_debt);
  const loan = async (id) => db.get('SELECT * FROM loans WHERE id = $1', [id]);
  return { db, store, fin, user, bal, debt, loan, cleanup };
}

// ---------------- bonus ----------------
test('qeydiyyat bonusu: 100 xal, bir dəfə, admin dəyişəndə yalnız gələcək qeydiyyatlara', async () => {
  const t = await setup();
  const name = `b${crypto.randomInt(1e9)}`;
  const r = await t.store.register({ username: name, displayName: name, password: '123456' }, t.fin);
  assert.equal(r.bonus, 100);
  assert.equal(await t.bal(r.id), 100);
  // ikinci dəfə cəhd (məs. təkrar sorğu) — heç nə vermir
  await t.db.tx((q) => t.fin.grantSignupBonus(q, r.id, 100));
  assert.equal(await t.bal(r.id), 100);
  assert.equal(Number((await t.db.get(`SELECT COUNT(*) AS n FROM transactions WHERE user_id = $1 AND kind = 'bonus'`, [r.id])).n), 1);
  await t.fin.setSignupBonus(50);
  const name2 = `b${crypto.randomInt(1e9)}`;
  const r2 = await t.store.register({ username: name2, displayName: name2, password: '123456' }, t.fin);
  assert.equal(await t.bal(r2.id), 50);
  assert.equal(await t.bal(r.id), 100);
  assert.equal(Number((await t.db.get(`SELECT COUNT(*) AS n FROM credit_requests WHERE user_id = $1`, [r.id])).n), 0); // bonus borc deyil
  assert.equal(await t.debt(r.id), 0);
  await t.fin.setSignupBonus(100);
  // eyni istifadəçi adı ilə paralel qeydiyyat: yalnız biri yaranır, bonus bir dəfə
  const name3 = `b${crypto.randomInt(1e9)}`;
  const res = await Promise.allSettled([1, 2, 3].map(() => t.store.register({ username: name3, displayName: name3, password: '123456' }, t.fin)));
  assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1);
  await t.cleanup();
});

// ---------------- kredit ----------------
test('kredit: limit 0 olsa da müraciət olur; bir gözləyən müraciət; təkrar/paralel təsdiq bir dəfə', async () => {
  const t = await setup();
  const admin = await t.user(); const u = await t.user(0);
  const r1 = await t.fin.requestCredit(u, 200, 'balans bitdi', key());
  await assert.rejects(t.fin.requestCredit(u, 50, '', key()), /gözləyən/);
  // limit 0 → limitsiz təsdiq alınmır, müraciət gözləyir qalır
  await assert.rejects(t.fin.approveCredit(admin, r1.requestId, 200, null, '', key()), /limit/i);
  assert.equal((await t.db.get('SELECT status FROM credit_requests WHERE id = $1', [r1.requestId])).status, 'pending');
  // eyni açar ilə təkrar və fərqli açarlarla paralel təsdiq
  const k = key();
  const results = await Promise.allSettled([
    t.fin.approveCredit(admin, r1.requestId, 150, 300, 'ok', k),
    t.fin.approveCredit(admin, r1.requestId, 150, 300, 'ok', k),
    t.fin.approveCredit(admin, r1.requestId, 150, 300, 'ok', key()),
    t.fin.approveCredit(admin, r1.requestId, 150, 300, 'ok', key()),
  ]);
  const applied = results.filter((x) => x.status === 'fulfilled' && !x.value.duplicate);
  assert.equal(applied.length, 1);
  assert.equal(await t.bal(u), 150);
  assert.equal(await t.debt(u), 150);
  assert.equal(Number((await t.db.get(`SELECT COUNT(*) AS n FROM transactions WHERE user_id = $1 AND kind = 'credit'`, [u])).n), 1);
  // limit keçilmir
  const r2 = await t.fin.requestCredit(u, 500, '', key());
  await assert.rejects(t.fin.approveCredit(admin, r2.requestId, 200, null, '', key()), /limit/i);
  await t.fin.rejectCredit(admin, r2.requestId, 'yox', key());
  await assert.rejects(t.fin.approveCredit(admin, r2.requestId, 100, null, '', key()), /artıq baxılıb/);
  // limit borcdan az ola bilməz
  await assert.rejects(t.fin.setCreditLimit(admin, u, 100, key()), /az ola bilməz/);
  await t.cleanup();
});

test('kredit borcunu ödə: nə balans, nə borc mənfi olmur; faiz yoxdur', async () => {
  const t = await setup();
  const admin = await t.user(); const u = await t.user(0);
  const r = await t.fin.requestCredit(u, 100, '', key());
  await t.fin.approveCredit(admin, r.requestId, 100, 100, '', key());
  await t.db.run('UPDATE users SET balance = 40 WHERE id = $1', [u]); // oyunda 60 uduzdu
  await assert.rejects(t.fin.repayCredit(u, 50, key()), /Balans/);
  await t.fin.repayCredit(u, 40, key());
  assert.equal(await t.bal(u), 0);
  assert.equal(await t.debt(u), 60);
  await t.db.run('UPDATE users SET balance = 500 WHERE id = $1', [u]);
  await assert.rejects(t.fin.repayCredit(u, 61, key()), /borcunuz 60/);
  await t.fin.repayCredit(u, 60, key());
  assert.equal(await t.debt(u), 0);
  assert.equal(await t.bal(u), 440);
  await t.cleanup();
});

// ---------------- hədiyyə ----------------
test('hədiyyə: eyni tranzaksiyada köçür, özünə/bota yox, paralel hədiyyələr balansı keçmir, açar təkrarı bir dəfə', async () => {
  const t = await setup();
  const a = await t.user(100); const b = await t.user(0); const c = await t.user(0);
  await assert.rejects(t.fin.giftPlayer(a, a, 10, '', key()), /Özünüzə/);
  await assert.rejects(t.fin.giftPlayer(a, -3, 10, '', key()), /Bot/);
  await assert.rejects(t.fin.giftPlayer(a, b, 0, '', key()), /müsbət/);
  await assert.rejects(t.fin.giftPlayer(a, b, 101, '', key()), /çatmır/);
  await t.db.run(`UPDATE users SET status = 'blocked' WHERE id = $1`, [c]);
  await assert.rejects(t.fin.giftPlayer(a, c, 10, '', key()), /aktiv/);
  // 5 paralel hədiyyə × 30 = 150 > 100 → yalnız 3-ü keçir
  const res = await Promise.allSettled([1, 2, 3, 4, 5].map(() => t.fin.giftPlayer(a, b, 30, 'paralel', key())));
  assert.equal(res.filter((x) => x.status === 'fulfilled').length, 3);
  assert.equal(await t.bal(a), 10);
  assert.equal(await t.bal(b), 90);
  // təkrar klik / itmiş cavab: eyni açar
  const k = key();
  const g1 = await t.fin.giftPlayer(a, b, 10, 'son', k);
  const g2 = await t.fin.giftPlayer(a, b, 10, 'son', k);
  assert.equal(g1.duplicate, undefined);
  assert.equal(g2.duplicate, true);
  assert.equal(await t.bal(a), 0);
  assert.equal(await t.bal(b), 100);
  const hist = await t.db.all('SELECT kind, counterparty_id, note FROM transactions WHERE user_id = $1 ORDER BY id', [b]);
  assert.ok(hist.every((h) => h.kind === 'gift_in' && Number(h.counterparty_id) === a));
  assert.ok((await t.fin.notifications(b)).length >= 4);
  // hədiyyə qarşılıqlı oyun nəticəsinə yazılmır
  assert.equal(Number((await t.db.get('SELECT COUNT(*) AS n FROM round_flows WHERE from_user IN ($1, $2) OR to_user IN ($1, $2)', [a, b])).n), 0);
  await t.cleanup();
});

test('admin: hədiyyə sistemdən verilir; "çıx" balansı 0-dan aşağı salmır; mənfi işarəsiz məbləğ', async () => {
  const t = await setup();
  const admin = await t.user(5); const u = await t.user(30);
  await t.fin.adminGift(admin, u, 70, 'təbrik', key());
  assert.equal(await t.bal(admin), 5);
  assert.equal(await t.bal(u), 100);
  await assert.rejects(t.fin.adminAdjust(admin, u, 'sub', 101, '', key()), /çox çıxmaq olmaz/);
  await assert.rejects(t.fin.adminAdjust(admin, u, 'sub', -5, '', key()), /müsbət/);
  await t.fin.adminAdjust(admin, u, 'sub', 100, '', key());
  assert.equal(await t.bal(u), 0);
  await t.fin.adminAdjust(admin, u, 'add', 25, '', key());
  assert.equal(await t.bal(u), 25);
  const tx = await t.db.all('SELECT kind, by_user FROM transactions WHERE user_id = $1 ORDER BY id', [u]);
  assert.deepEqual(tx.map((x) => x.kind), ['admin_gift', 'admin', 'admin']);
  assert.ok(tx.every((x) => Number(x.by_user) === admin));
  await t.cleanup();
});

// ---------------- oyunçular arası borc ----------------
test('borc təklifi: qəbula qədər pul köçmür, qəbulda balans yoxlanılır, təkrar/paralel qəbul bir dəfə', async () => {
  const t = await setup();
  const L = await t.user(50); const B = await t.user(0);
  const now = Date.now();
  await assert.rejects(t.fin.offerLoan(L, L, 10, now + 2 * H, '', key()), /Özünüzə/);
  await assert.rejects(t.fin.offerLoan(L, -1, 10, now + 2 * H, '', key()), /Bot/);
  await assert.rejects(t.fin.offerLoan(L, B, 10, now + 60_000, '', key()), /10 dəqiqə/);
  const o = await t.fin.offerLoan(L, B, 80, now + 2 * H, 'cümə', key());
  assert.equal(await t.bal(L), 50); // rezerv yoxdur
  await assert.rejects(t.fin.acceptLoan(B, o.loanId, key()), /çatmır/);
  assert.equal((await t.loan(o.loanId)).status, 'offered');
  await t.db.run('UPDATE users SET balance = 100 WHERE id = $1', [L]);
  const k = key();
  const res = await Promise.allSettled([t.fin.acceptLoan(B, o.loanId, k), t.fin.acceptLoan(B, o.loanId, k), t.fin.acceptLoan(B, o.loanId, key()), t.fin.acceptLoan(B, o.loanId, key())]);
  assert.equal(res.filter((x) => x.status === 'fulfilled' && !x.value.duplicate).length, 1);
  assert.equal(await t.bal(L), 20);
  assert.equal(await t.bal(B), 80);
  const l = await t.loan(o.loanId);
  assert.equal(l.status, 'active');
  assert.equal(Number(l.remaining), 80);
  // qəbul olunmuş borcu ləğv etmək olmaz
  await assert.rejects(t.fin.cancelLoan(L, o.loanId, key()), /ləğv etmək olmaz/);
  await t.cleanup();
});

test('borc: rədd, ləğv, vaxtı keçmiş təklif qəbul edilmir', async () => {
  const t = await setup();
  const L = await t.user(100); const B = await t.user(0);
  const now = Date.now();
  const o1 = await t.fin.offerLoan(L, B, 10, now + 2 * H, '', key());
  await t.fin.declineLoan(B, o1.loanId, key());
  await assert.rejects(t.fin.acceptLoan(B, o1.loanId, key()), /aktiv deyil/);
  const o2 = await t.fin.offerLoan(L, B, 10, now + 2 * H, '', key());
  await t.fin.cancelLoan(L, o2.loanId, key());
  assert.equal((await t.loan(o2.loanId)).status, 'cancelled');
  const o3 = await t.fin.offerLoan(L, B, 10, now + 2 * H, '', key());
  await assert.rejects(t.fin.acceptLoan(B, o3.loanId, key(), now + 3 * H), /vaxtı artıq keçib/);
  assert.equal(await t.bal(L), 100);
  await t.cleanup();
});

test('vaxtından əvvəl qismən/tam ödəniş; qalıqdan çox ödəmək olmaz', async () => {
  const t = await setup();
  const L = await t.user(100); const B = await t.user(0);
  const o = await t.fin.offerLoan(L, B, 60, Date.now() + 5 * H, '', key());
  await t.fin.acceptLoan(B, o.loanId, key());
  await assert.rejects(t.fin.repayLoan(B, o.loanId, 61, key()), /Qalan borc/);
  await t.fin.repayLoan(B, o.loanId, 20, key());
  assert.equal(Number((await t.loan(o.loanId)).remaining), 40);
  await t.db.run('UPDATE users SET balance = 10 WHERE id = $1', [B]);
  await assert.rejects(t.fin.repayLoan(B, o.loanId, 40, key()), /çatmır/);
  await t.db.run('UPDATE users SET balance = 40 WHERE id = $1', [B]);
  await t.fin.repayLoan(B, o.loanId, 40, key());
  const l = await t.loan(o.loanId);
  assert.equal(l.status, 'paid');
  assert.equal(Number(l.remaining), 0);
  assert.equal(await t.bal(L), 100);
  assert.equal(await t.bal(B), 0);
  await t.cleanup();
});

test('avtomatik tutulma: qismən → "Gecikib", sonra gələn vəsaitdən qalanı; təkrar/paralel ikiqat tutmur', async () => {
  const t = await setup();
  const L = await t.user(100); const B = await t.user(0);
  const now = Date.now();
  const o = await t.fin.offerLoan(L, B, 100, now + 2 * H, '', key());
  await t.fin.acceptLoan(B, o.loanId, key());
  await t.db.run('UPDATE users SET balance = 30 WHERE id = $1', [B]); // 70 xərclədi
  assert.equal((await t.fin.collectDue(B, now + H)).payments.length, 0); // vaxt çatmayıb
  const due = now + 3 * H;
  const all = await Promise.allSettled([t.fin.collectDue(B, due), t.fin.collectDue(B, due), t.fin.collectDue(B, due)]);
  const paid = all.filter((x) => x.status === 'fulfilled').flatMap((x) => x.value.payments).reduce((s, p) => s + p.paid, 0);
  assert.equal(paid, 30);
  assert.equal(await t.bal(B), 0);
  assert.equal(await t.bal(L), 30);
  let l = await t.loan(o.loanId);
  assert.equal(l.status, 'overdue');
  assert.equal(Number(l.remaining), 70);
  // balans 0 → yenidən çağırış heç nə etmir, mənfi yox
  await t.fin.collectDue(B, due);
  assert.equal(await t.bal(B), 0);
  // sonradan vəsait daxil olur (məs. hədiyyə) → qalan borc tutulur
  const G = await t.user(500);
  await t.fin.giftPlayer(G, B, 100, '', key());
  await t.fin.collectDue(B, due + 1000);
  l = await t.loan(o.loanId);
  assert.equal(l.status, 'paid');
  assert.equal(await t.bal(B), 30);
  assert.equal(await t.bal(L), 100);
  const pays = await t.db.all('SELECT amount, kind FROM loan_payments WHERE loan_id = $1 ORDER BY id', [o.loanId]);
  assert.deepEqual(pays.map((p) => [Number(p.amount), p.kind]), [[30, 'auto'], [70, 'auto']]);
  const n = await t.fin.notifications(B);
  assert.ok(n.some((x) => /Qalan borc: 70 xal/.test(x.text)));
  await t.cleanup();
});

test('bir neçə gecikmiş borc: əvvəl köhnə son tarix, eynidirsə kiçik ID ödənilir', async () => {
  const t = await setup();
  const L1 = await t.user(1000); const L2 = await t.user(1000); const L3 = await t.user(1000); const B = await t.user(0);
  const now = Date.now();
  const due1 = now + 3 * H; const due2 = now + 2 * H;
  const a = await t.fin.offerLoan(L1, B, 50, due1, 'a', key());
  const b = await t.fin.offerLoan(L2, B, 50, due2, 'b', key());
  const c = await t.fin.offerLoan(L3, B, 50, due1, 'c', key());
  for (const x of [a, b, c]) await t.fin.acceptLoan(B, x.loanId, key());
  await t.db.run('UPDATE users SET balance = 80 WHERE id = $1', [B]);
  const r = await t.fin.collectDue(B, now + 4 * H);
  assert.deepEqual(r.payments.map((p) => [p.loanId, p.paid]), [[b.loanId, 50], [a.loanId, 30]]);
  assert.equal(Number((await t.loan(c.loanId)).remaining), 50);
  assert.equal((await t.loan(c.loanId)).status, 'overdue');
  assert.equal(await t.bal(B), 0);
  await t.cleanup();
});

test('borc ödənişi, hədiyyə və kredit eyni anda — balans mənfi olmur, cəmi qorunur', async () => {
  const t = await setup();
  const admin = await t.user(); const L = await t.user(100); const B = await t.user(0); const X = await t.user(0);
  const now = Date.now();
  const o = await t.fin.offerLoan(L, B, 100, now + 2 * H, '', key());
  await t.fin.acceptLoan(B, o.loanId, key());
  const cr = await t.fin.requestCredit(B, 50, '', key());
  const ops = [
    t.fin.collectDue(B, now + 3 * H),
    t.fin.giftPlayer(B, X, 60, '', key()),
    t.fin.giftPlayer(B, X, 60, '', key()),
    t.fin.repayLoan(B, o.loanId, 40, key()),
    t.fin.approveCredit(admin, cr.requestId, 50, 50, '', key()),
  ];
  await Promise.allSettled(ops);
  const sum = (await t.bal(B)) + (await t.bal(X)) + (await t.bal(L));
  assert.equal(sum, 100 + 50); // ilkin 100 + kredit 50
  for (const id of [B, X, L]) assert.ok((await t.bal(id)) >= 0);
  const l = await t.loan(o.loanId);
  assert.equal(Number(l.remaining) + (await t.bal(L)) - 0, 100); // L-ə qaytarılan + qalan = 100
  await t.cleanup();
});

test('xəta zamanı tam rollback; idempotency açarı da geri alınır, sonra eyni açarla uğurlu', async () => {
  const t = await setup();
  const L = await t.user(10); const B = await t.user(0);
  const o = await t.fin.offerLoan(L, B, 50, Date.now() + 2 * H, '', key());
  const k = key();
  await assert.rejects(t.fin.acceptLoan(B, o.loanId, k), /çatmır/);
  assert.equal(await t.db.get('SELECT key FROM op_keys WHERE key LIKE $1', [`%${k}`]), null);
  assert.equal((await t.loan(o.loanId)).status, 'offered');
  await t.db.run('UPDATE users SET balance = 50 WHERE id = $1', [L]);
  const ok = await t.fin.acceptLoan(B, o.loanId, k);
  assert.equal(ok.duplicate, undefined);
  assert.equal(await t.bal(B), 50);
  // COMMIT olub, cavab itib → eyni açarla təkrar: ikiqat yox
  const again = await t.fin.acceptLoan(B, o.loanId, k);
  assert.equal(again.duplicate, true);
  assert.equal(await t.bal(B), 50);
  assert.equal(await t.bal(L), 0);
  await t.cleanup();
});
