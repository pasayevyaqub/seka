// Masa hədiyyələri (animasiyalı, oyun xalı ilə): qiymət, faiz, borc tutulması, idempotency, paralel sorğular, rollback.
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-tg-'));
    db = await openDb({ file: path.join(dir, 't.db') });
    cleanup = async () => { await db.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  }
  const store = new Store(db);
  const fin = new Finance(db);
  // PostgreSQL-də baza testlər arasında paylaşılır — standart ayarları bərpa edirik
  await fin.setGiftSettings({ sharePct: 30, gifts: [{ id: 'card_rain', price: 100, active: true }, { id: 'table_king', price: 300, active: true }, { id: 'fire_ace', price: 1000, active: true }] });
  let n = 0;
  const user = async (balance = 0) => {
    const name = `g${crypto.randomInt(1e9).toString(36)}${++n}`;
    const r = await store.register({ username: name, displayName: name, password: '123456' }, null);
    await db.run('UPDATE users SET balance = $1 WHERE id = $2', [balance, r.id]);
    return r.id;
  };
  const bal = async (id) => Number((await db.get('SELECT balance FROM users WHERE id = $1', [id])).balance);
  const count = async (sql, p) => Number((await db.get(sql, p)).n);
  return { db, store, fin, user, bal, count, cleanup };
}

test('ilkin hədiyyələr və faiz: Kart yağışı 100, Masa kralı 300, Odlu Tuz 1000, Şir 500; alana 30%', async () => {
  const t = await setup();
  const gifts = await t.fin.giftTypes();
  assert.deepEqual(gifts.map((g) => [g.id, g.name, g.price, g.active]), [
    ['card_rain', 'Kart yağışı', 100, true], ['table_king', 'Masa kralı', 300, true], ['fire_ace', 'Odlu Tuz', 1000, true], ['lion', 'Şir', 500, true]]);
  assert.ok(gifts.every((g) => g.sharePct === 30 && g.ownPct === null));
  assert.equal(await t.fin.giftSharePct(), 30);
  await t.cleanup();
});

test('Odlu Tuz: göndərəndən 1000 çıxır, alana 300 yazılır, 700 dövriyyədən çıxır; hamısı tarixçədə ayrıca', async () => {
  const t = await setup();
  const A = await t.user(1200); const B = await t.user(5);
  const r = await t.fin.sendTableGift(A, B, 'fire_ace', 'ROOM1', key());
  assert.equal(r.price, 1000); assert.equal(r.sharePct, 30); assert.equal(r.credited, 300); assert.equal(r.burned, 700); assert.equal(r.debtPaid, 0);
  assert.equal(await t.bal(A), 200);
  assert.equal(await t.bal(B), 305);
  const row = await t.db.get('SELECT * FROM table_gifts WHERE id = $1', [r.giftLogId]);
  assert.deepEqual([row.gift_id, row.gift_name, Number(row.price), Number(row.share_pct), Number(row.credited), Number(row.burned), row.room_code],
    ['fire_ace', 'Odlu Tuz', 1000, 30, 300, 700, 'ROOM1']);
  const tx = await t.db.all('SELECT user_id, delta, kind, counterparty_id FROM transactions WHERE user_id IN ($1, $2) ORDER BY id', [A, B]);
  assert.deepEqual(tx.map((x) => [Number(x.user_id), Number(x.delta), x.kind, Number(x.counterparty_id)]), [[A, -1000, 'tgift_out', B], [B, 300, 'tgift_in', A]]);
  const nt = await t.db.get(`SELECT text FROM notifications WHERE user_id = $1 AND kind = 'tgift'`, [B]);
  assert.match(nt.text, /Odlu Tuz/); assert.match(nt.text, /\+300 xal/); assert.match(nt.text, /Qalan balans: 305 xal/);
  // profil: göndərdiyim / aldığım
  assert.equal((await t.fin.profile(A)).giftsSent[0].credited, 300);
  assert.equal((await t.fin.profile(B)).giftsReceived[0].giftName, 'Odlu Tuz');
  assert.equal((await t.fin.profile(B)).giftsSent.length, 0);
  // hədiyyə oyun statistikasına (cüt nəticələr) qarışmır
  assert.deepEqual(await t.store.pairStats(A), []);
  await t.cleanup();
});

test('balans çatmayanda aydın mesaj; heç nə dəyişmir, açar saxlanılmır', async () => {
  const t = await setup();
  const A = await t.user(299); const B = await t.user(0);
  const k = key();
  await assert.rejects(t.fin.sendTableGift(A, B, 'table_king', 'R', k), /Balansınız çatmır: «Masa kralı» 300 xal, balansınız 299 xal/);
  assert.equal(await t.bal(A), 299); assert.equal(await t.bal(B), 0);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM table_gifts WHERE from_id = $1', [A]), 0);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM op_keys WHERE key LIKE $1', [`%${k}`]), 0);
  // balans artdıqdan sonra eyni açarla uğurlu
  await t.db.run('UPDATE users SET balance = 300 WHERE id = $1', [A]);
  const r = await t.fin.sendTableGift(A, B, 'table_king', 'R', k);
  assert.equal(r.credited, 90);
  assert.equal(await t.bal(A), 0);
  await t.cleanup();
});

test('özünə, bota, deaktiv hədiyyə, bloklanmış alıcı — qadağandır', async () => {
  const t = await setup();
  const A = await t.user(5000); const B = await t.user(0);
  await assert.rejects(t.fin.sendTableGift(A, A, 'card_rain', 'R', key()), /Özünüzə/);
  await assert.rejects(t.fin.sendTableGift(A, -3, 'card_rain', 'R', key()), /Botlara/);
  await assert.rejects(t.fin.sendTableGift(A, B, 'yoxdur', 'R', key()), /tapılmadı/);
  await t.fin.setGiftSettings({ gifts: [{ id: 'card_rain', price: 100, active: false }] });
  await assert.rejects(t.fin.sendTableGift(A, B, 'card_rain', 'R', key()), /aktiv deyil/);
  await t.fin.setGiftSettings({ gifts: [{ id: 'card_rain', price: 100, active: true }] });
  await t.db.run(`UPDATE users SET status = 'blocked' WHERE id = $1`, [B]);
  await assert.rejects(t.fin.sendTableGift(A, B, 'card_rain', 'R', key()), /aktiv hesab deyil/);
  await t.db.run(`UPDATE users SET status = 'blocked' WHERE id = $1`, [A]);
  await t.db.run(`UPDATE users SET status = 'approved' WHERE id = $1`, [B]);
  await assert.rejects(t.fin.sendTableGift(A, B, 'card_rain', 'R', key()), /aktiv hesab deyil/);
  assert.equal(await t.bal(A), 5000); assert.equal(await t.bal(B), 0);
  await t.cleanup();
});

test('faiz hesabı aşağı yuvarlaqlaşır; 0% və 100%; yanlış faiz/qiymət rədd edilir; köhnə qeydlər dəyişmir', async () => {
  const t = await setup();
  const A = await t.user(100000); const B = await t.user(0);
  await t.fin.setGiftSettings({ sharePct: 33, gifts: [{ id: 'card_rain', price: 155, active: true }] });
  const r1 = await t.fin.sendTableGift(A, B, 'card_rain', 'R', key());
  assert.equal(r1.credited, 51); assert.equal(r1.burned, 104); // 155 × 33% = 51.15 → 51
  await t.fin.setGiftSettings({ sharePct: 0 });
  const r2 = await t.fin.sendTableGift(A, B, 'card_rain', 'R', key());
  assert.equal(r2.credited, 0); assert.equal(r2.burned, 155);
  await t.fin.setGiftSettings({ sharePct: 100 });
  const r3 = await t.fin.sendTableGift(A, B, 'card_rain', 'R', key());
  assert.equal(r3.credited, 155); assert.equal(r3.burned, 0);
  assert.equal(await t.bal(B), 51 + 0 + 155);
  assert.equal(await t.bal(A), 100000 - 3 * 155);
  // 0% olanda alana jurnal yazılmır (dəyişiklik yoxdur), göndərənə yazılır
  assert.equal(await t.count(`SELECT COUNT(*) AS n FROM transactions WHERE user_id = $1 AND kind = 'tgift_in'`, [B]), 2);
  for (const bad of [-1, 101, 2.5, 'x']) await assert.rejects(t.fin.setGiftSettings({ sharePct: bad }), /0–100/);
  for (const bad of [0, -5, 1.5]) await assert.rejects(t.fin.setGiftSettings({ gifts: [{ id: 'card_rain', price: bad, active: true }] }), /qiyməti/);
  // qiymət/faiz dəyişəndə əvvəlki əməliyyatlar dəyişmir
  await t.fin.setGiftSettings({ sharePct: 30, gifts: [{ id: 'card_rain', price: 100, active: true }] });
  const old = await t.db.get('SELECT price, share_pct, credited FROM table_gifts WHERE id = $1', [r1.giftLogId]);
  assert.deepEqual([Number(old.price), Number(old.share_pct), Number(old.credited)], [155, 33, 51]);
  await t.cleanup();
});

test('təkrar klik və paralel sorğu: eyni açar bir dəfə; fərqli açarlarla paralel — balans mənfi olmur', async () => {
  const t = await setup();
  const A = await t.user(250); const B = await t.user(0);
  const k = key();
  const same = await Promise.all([1, 2, 3, 4, 5].map(() => t.fin.sendTableGift(A, B, 'card_rain', 'R', k)));
  assert.equal(same.filter((r) => !r.duplicate).length, 1);
  assert.ok(same.every((r) => r.giftLogId === same[0].giftLogId));
  assert.equal(await t.bal(A), 150); assert.equal(await t.bal(B), 30);
  // 150 xal qalıb → 6 paralel Kart yağışından yalnız 1-i keçə bilər
  const res = await Promise.allSettled([1, 2, 3, 4, 5, 6].map(() => t.fin.sendTableGift(A, B, 'card_rain', 'R', key())));
  assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1);
  assert.ok(res.filter((x) => x.status === 'rejected').every((x) => /çatmır/.test(x.reason.message)));
  assert.equal(await t.bal(A), 50); assert.equal(await t.bal(B), 60);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM table_gifts WHERE from_id = $1', [A]), 2);
  await t.cleanup();
});

test('tranzaksiya xətası: hamısı geri qaytarılır (balans, tarixçə, qeyd, açar); sonra eyni açarla uğurlu', async () => {
  const t = await setup();
  const A = await t.user(1000); const B = await t.user(0);
  const k = key();
  const real = t.fin.collectDueIn.bind(t.fin);
  t.fin.collectDueIn = async () => { throw new Error('süni xəta: yazılış ortasında'); };
  await assert.rejects(t.fin.sendTableGift(A, B, 'fire_ace', 'R', k), /süni xəta/);
  t.fin.collectDueIn = real;
  assert.equal(await t.bal(A), 1000); assert.equal(await t.bal(B), 0);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM table_gifts WHERE from_id = $1', [A]), 0);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM transactions WHERE user_id IN ($1, $2)', [A, B]), 0);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1', [B]), 0);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM op_keys WHERE key LIKE $1', [`%${k}`]), 0);
  const ok = await t.fin.sendTableGift(A, B, 'fire_ace', 'R', k);
  assert.equal(ok.duplicate, undefined);
  // COMMIT olub, cavab itib → təkrar: ikiqat yox
  const again = await t.fin.sendTableGift(A, B, 'fire_ace', 'R', k);
  assert.equal(again.duplicate, true);
  assert.equal(await t.bal(A), 0); assert.equal(await t.bal(B), 300);
  await t.cleanup();
});

test('alana gələn xal vaxtı çatmış borclara tutulur (köhnə müddət əvvəl); bildirişdə hissələr ayrıca', async () => {
  const t = await setup();
  const A = await t.user(1000); const B = await t.user(100); const L1 = await t.user(500); const L2 = await t.user(500);
  const o1 = await t.fin.offerLoan(L1, B, 150, Date.now() + 2 * H, '', key());
  const o2 = await t.fin.offerLoan(L2, B, 100, Date.now() + 2 * H, '', key());
  await t.fin.acceptLoan(B, o1.loanId, key());
  await t.fin.acceptLoan(B, o2.loanId, key());
  // B balansı 350; hamısını xərcləyir, borcların vaxtı keçir
  await t.db.run('UPDATE users SET balance = 0 WHERE id = $1', [B]);
  await t.db.run('UPDATE loans SET due_at = $1 WHERE id = $2', [Date.now() - 2 * H, o2.loanId]); // o2 daha köhnə
  await t.db.run('UPDATE loans SET due_at = $1 WHERE id = $2', [Date.now() - H, o1.loanId]);
  const r = await t.fin.sendTableGift(A, B, 'fire_ace', 'R', key());
  assert.equal(r.credited, 300);
  assert.equal(r.debtPaid, 250);   // əvvəl o2 (100), sonra o1 (150)
  assert.equal(r.toBalance, 50);
  assert.deepEqual(r.payments.map((p) => [p.loanId, p.paid]), [[o2.loanId, 100], [o1.loanId, 150]]);
  assert.equal(await t.bal(B), 50); assert.equal(await t.bal(L1), 500); assert.equal(await t.bal(L2), 500);
  assert.equal(Number((await t.db.get('SELECT debt_paid FROM table_gifts WHERE id = $1', [r.giftLogId])).debt_paid), 250);
  const nt = await t.db.get(`SELECT text FROM notifications WHERE user_id = $1 AND kind = 'tgift'`, [B]);
  assert.match(nt.text, /\+300 xal/); assert.match(nt.text, /Borca tutulan: 250 xal/); assert.match(nt.text, /Qalan balans: 50 xal/);
  await t.cleanup();
});
