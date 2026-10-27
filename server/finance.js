// Virtual oyun balansı ilə maliyyə əməliyyatları: bonus, admin krediti, hədiyyə, oyunçular arası borc,
// avtomatik borc tutulması, bildirişlər. REAL PUL YOXDUR — bütün məbləğlər virtual oyun xalıdır.
//
// Təhlükəsizlik prinsipləri:
//  * Hər əməliyyat bir DB tranzaksiyasıdır (ya hamısı, ya heç biri).
//  * Balans azaldan hər UPDATE şərtlidir: "... WHERE balance >= $məbləğ" — paralel sorğular eyni balansı iki dəfə xərcləyə bilməz,
//    balans 0-dan aşağı düşmür (PostgreSQL-də sətir kilidi altında WHERE yenidən yoxlanılır; SQLite-da yazılar ardıcıldır).
//  * Hər maliyyə sorğusu idempotency açarı ilə gəlir (op_keys cədvəli, PRIMARY KEY). Eyni açar ikinci dəfə
//    (təkrar klik, itmiş cavab, paralel sorğu) heç nə dəyişmir, ilk nəticəni qaytarır.
import { UserError } from './store.js';

const now = () => Date.now();
export const MAX_AMOUNT = 10_000_000;
const DAY = 86_400_000;

export function amountOf(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) throw new UserError('Məbləğ müsbət tam ədəd olmalıdır.');
  if (n > MAX_AMOUNT) throw new UserError(`Məbləğ ${MAX_AMOUNT} xaldan çox ola bilməz.`);
  return n;
}

function cleanNote(n) { return String(n ?? '').trim().replace(/\s+/g, ' ').slice(0, 120) || null; }
function opKey(key) {
  const k = String(key ?? '');
  if (!/^[A-Za-z0-9_:\-]{8,100}$/.test(k)) throw new UserError('Sorğu açarı (idempotency key) yoxdur və ya yanlışdır.');
  return k;
}
const money = (n) => `${n} xal`;

export class Finance {
  constructor(db) { this.db = db; }

  // ---------- köməkçilər (tranzaksiya daxilində) ----------
  /** İdempotent əməliyyat: key artıq varsa saxlanmış nəticəni qaytarır, yoxdursa fn icra olunur. */
  async op(rawKey, userId, kind, fn) {
    const key = `${userId}:${kind}:${opKey(rawKey)}`;
    return this.db.tx(async (q) => {
      const ins = await q.run('INSERT INTO op_keys(key, user_id, kind, created_at) VALUES($1, $2, $3, $4) ON CONFLICT(key) DO NOTHING', [key, userId, kind, now()]);
      if (ins.changes !== 1) {
        const row = await q.get('SELECT result FROM op_keys WHERE key = $1', [key]);
        return { ...(JSON.parse(row?.result || '{}')), duplicate: true, changes: [], notify: [] };
      }
      const ctx = { q, key, changes: [], notify: [] };
      const res = await fn(ctx);
      const out = { ...(res || {}), changes: ctx.changes, notify: ctx.notify };
      await q.run('UPDATE op_keys SET result = $2 WHERE key = $1', [key, JSON.stringify({ ...out, changes: undefined, notify: undefined })]);
      return out;
    });
  }

  // balans azaldılması — çatmırsa xəta (heç vaxt mənfi olmur)
  async debit(ctx, userId, amount, msg = 'Balansınız çatmır.') {
    const row = await ctx.q.get('UPDATE users SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance', [amount, userId]);
    if (!row) throw new UserError(msg);
    const balance = Number(row.balance);
    ctx.changes.push({ userId, delta: -amount, balance });
    return balance;
  }

  async creditTo(ctx, userId, amount) {
    const row = await ctx.q.get('UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance', [amount, userId]);
    if (!row) throw new UserError('İstifadəçi tapılmadı.');
    const balance = Number(row.balance);
    ctx.changes.push({ userId, delta: amount, balance });
    return balance;
  }

  async journal(ctx, { userId, delta, balance, reason, kind, by = null, counterparty = null, note = null }) {
    await ctx.q.run(
      `INSERT INTO transactions(user_id, delta, balance_after, prev_balance, reason, by_user, kind, counterparty_id, op_key, note, created_at)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [userId, delta, balance, balance - delta, reason, by, kind, counterparty, ctx.key || null, note, now()],
    );
  }

  async notifyIn(ctx, userId, kind, text) {
    await ctx.q.run('INSERT INTO notifications(user_id, kind, text, created_at) VALUES($1, $2, $3, $4)', [userId, kind, text, now()]);
    ctx.notify.push({ userId, kind, text });
  }

  async userIn(q, id) {
    const u = await q.get('SELECT id, username, display_name, status, role, balance, credit_debt, credit_limit FROM users WHERE id = $1', [id]);
    return u && { ...u, balance: Number(u.balance), credit_debt: Number(u.credit_debt), credit_limit: Number(u.credit_limit) };
  }

  async activeUser(q, id, who = 'İstifadəçi') {
    const u = await this.userIn(q, Number(id));
    if (!u || Number(id) <= 0) throw new UserError(`${who} tapılmadı.`);
    if (u.status !== 'approved') throw new UserError(`${who} aktiv hesab deyil.`);
    return u;
  }

  // ---------- ayarlar və bonus ----------
  async getSetting(key, def) {
    const r = await this.db.get('SELECT value FROM app_settings WHERE key = $1', [key]);
    return r ? r.value : def;
  }
  // "Oyunçu girişini aç/bağla" — bazada saxlanılır, restartdan sonra qorunur
  async playerLoginOpen() { return (await this.getSetting('player_login_open', '1')) !== '0'; }
  async setPlayerLoginOpen(open) {
    await this.db.run(`INSERT INTO app_settings(key, value) VALUES('player_login_open', $1) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [open ? '1' : '0']);
    return open;
  }
  async signupBonus() { return Math.max(0, parseInt(await this.getSetting('signup_bonus', '100'), 10) || 0); }
  async setSignupBonus(amount) {
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 0 || n > MAX_AMOUNT) throw new UserError('Bonus 0 və ya müsbət tam ədəd olmalıdır.');
    await this.db.run(`INSERT INTO app_settings(key, value) VALUES('signup_bonus', $1) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(n)]);
    return n;
  }

  /** Qeydiyyat bonusu — hər hesaba yalnız bir dəfə (açar: bonus:<id>), qeydiyyatla eyni tranzaksiyada çağırılır */
  async grantSignupBonus(q, userId, amount) {
    if (!(amount > 0)) return 0;
    const ins = await q.run('INSERT INTO op_keys(key, user_id, kind, created_at) VALUES($1, $2, $3, $4) ON CONFLICT(key) DO NOTHING', [`bonus:${userId}`, userId, 'bonus', now()]);
    if (ins.changes !== 1) return 0;
    const row = await q.get('UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance', [amount, userId]);
    await q.run(
      `INSERT INTO transactions(user_id, delta, balance_after, prev_balance, reason, kind, op_key, created_at) VALUES($1, $2, $3, $4, $5, 'bonus', $6, $7)`,
      [userId, amount, Number(row.balance), Number(row.balance) - amount, 'Başlanğıc bonusu', `bonus:${userId}`, now()],
    );
    await q.run('INSERT INTO notifications(user_id, kind, text, created_at) VALUES($1, $2, $3, $4)', [userId, 'bonus', `Xoş gəldiniz! Hesabınıza ${money(amount)} başlanğıc bonusu yazıldı (virtual).`, now()]);
    return amount;
  }

  // ---------- admin krediti ----------
  async requestCredit(userId, amount, note, key) {
    amount = amountOf(amount);
    return this.op(key, userId, 'credit-req', async (ctx) => {
      await this.activeUser(ctx.q, userId);
      const p = await ctx.q.get(`SELECT id FROM credit_requests WHERE user_id = $1 AND status = 'pending'`, [userId]);
      if (p) throw new UserError('Sizin artıq gözləyən kredit müraciətiniz var.');
      const row = await ctx.q.get(`INSERT INTO credit_requests(user_id, amount, status, note, created_at) VALUES($1, $2, 'pending', $3, $4) RETURNING id`, [userId, amount, cleanNote(note), now()]);
      return { requestId: Number(row.id), amount };
    });
  }

  async cancelCreditRequest(userId, requestId, key) {
    return this.op(key, userId, 'credit-cancel', async (ctx) => {
      const r = await ctx.q.run(`UPDATE credit_requests SET status = 'cancelled', decided_at = $1 WHERE id = $2 AND user_id = $3 AND status = 'pending'`, [now(), requestId, userId]);
      if (r.changes !== 1) throw new UserError('Gözləyən müraciət tapılmadı.');
      return { ok: true };
    });
  }

  /** Admin təsdiqi: məbləğ eyni tranzaksiyada balansa və kredit borcuna yazılır. Eyni müraciət iki dəfə təsdiqlənə bilməz. */
  async approveCredit(adminId, requestId, amount, newLimit, note, key) {
    amount = amountOf(amount);
    return this.op(key, adminId, 'credit-approve', async (ctx) => {
      const req = await ctx.q.get('SELECT * FROM credit_requests WHERE id = $1', [requestId]);
      if (!req) throw new UserError('Müraciət tapılmadı.');
      const u = await this.activeUser(ctx.q, req.user_id, 'Oyunçu');
      if (newLimit !== undefined && newLimit !== null && newLimit !== '') {
        const lim = Number(newLimit);
        if (!Number.isInteger(lim) || lim < 0 || lim > MAX_AMOUNT) throw new UserError('Limit 0 və ya müsbət tam ədəd olmalıdır.');
        if (lim < u.credit_debt) throw new UserError(`Limit mövcud kredit borcundan (${u.credit_debt} xal) az ola bilməz.`);
        await ctx.q.run('UPDATE users SET credit_limit = $1 WHERE id = $2', [lim, u.id]);
      }
      const st = await ctx.q.run(`UPDATE credit_requests SET status = 'approved', approved_amount = $1, decided_by = $2, decided_at = $3, admin_note = $4 WHERE id = $5 AND status = 'pending'`,
        [amount, adminId, now(), cleanNote(note), requestId]);
      if (st.changes !== 1) throw new UserError('Bu müraciət artıq baxılıb.');
      const row = await ctx.q.get(
        'UPDATE users SET balance = balance + $1, credit_debt = credit_debt + $1 WHERE id = $2 AND credit_debt + $1 <= credit_limit RETURNING balance, credit_debt, credit_limit',
        [amount, u.id]);
      if (!row) {
        const cur = await this.userIn(ctx.q, u.id);
        throw new UserError(`Kredit limiti kifayət etmir: borc ${cur.credit_debt} + ${amount} > limit ${cur.credit_limit}. Limiti artırın.`);
      }
      const balance = Number(row.balance);
      ctx.changes.push({ userId: u.id, delta: amount, balance });
      await this.journal(ctx, { userId: u.id, delta: amount, balance, reason: `Admin krediti (borc: ${Number(row.credit_debt)} xal)`, kind: 'credit', by: adminId, note: cleanNote(note) });
      await this.notifyIn(ctx, u.id, 'credit', `Kredit müraciətiniz təsdiqləndi: +${money(amount)}. Kredit borcunuz: ${money(Number(row.credit_debt))} (faizsiz).`);
      return { userId: u.id, amount, creditDebt: Number(row.credit_debt) };
    });
  }

  async rejectCredit(adminId, requestId, note, key) {
    return this.op(key, adminId, 'credit-reject', async (ctx) => {
      const req = await ctx.q.get('SELECT * FROM credit_requests WHERE id = $1', [requestId]);
      if (!req) throw new UserError('Müraciət tapılmadı.');
      const st = await ctx.q.run(`UPDATE credit_requests SET status = 'rejected', decided_by = $1, decided_at = $2, admin_note = $3 WHERE id = $4 AND status = 'pending'`, [adminId, now(), cleanNote(note), requestId]);
      if (st.changes !== 1) throw new UserError('Bu müraciət artıq baxılıb.');
      await this.notifyIn(ctx, req.user_id, 'credit', `Kredit müraciətiniz (${money(Number(req.amount))}) rədd edildi.${note ? ' Qeyd: ' + cleanNote(note) : ''}`);
      return { userId: req.user_id };
    });
  }

  async setCreditLimit(adminId, userId, limit, key) {
    const lim = Number(limit);
    if (!Number.isInteger(lim) || lim < 0 || lim > MAX_AMOUNT) throw new UserError('Limit 0 və ya müsbət tam ədəd olmalıdır.');
    return this.op(key, adminId, 'credit-limit', async (ctx) => {
      const u = await this.activeUser(ctx.q, userId, 'Oyunçu');
      const r = await ctx.q.run('UPDATE users SET credit_limit = $1 WHERE id = $2 AND credit_debt <= $1', [lim, u.id]);
      if (r.changes !== 1) throw new UserError(`Limit mövcud kredit borcundan (${u.credit_debt} xal) az ola bilməz.`);
      await this.notifyIn(ctx, u.id, 'credit', `Kredit limitiniz ${money(lim)} təyin edildi.`);
      return { userId: u.id, limit: lim };
    });
  }

  /** "Borcu ödə" (admin krediti): balans və borc birlikdə azalır, heç biri mənfi olmur */
  async repayCredit(userId, amount, key) {
    amount = amountOf(amount);
    return this.op(key, userId, 'credit-repay', async (ctx) => {
      const row = await ctx.q.get(
        'UPDATE users SET balance = balance - $1, credit_debt = credit_debt - $1 WHERE id = $2 AND balance >= $1 AND credit_debt >= $1 RETURNING balance, credit_debt',
        [amount, userId]);
      if (!row) {
        const u = await this.userIn(ctx.q, userId);
        if (u.credit_debt < amount) throw new UserError(`Kredit borcunuz ${money(u.credit_debt)}-dir.`);
        throw new UserError('Balansınız çatmır.');
      }
      const balance = Number(row.balance);
      ctx.changes.push({ userId, delta: -amount, balance });
      await this.journal(ctx, { userId, delta: -amount, balance, reason: `Kredit borcu ödənildi (qalan: ${Number(row.credit_debt)} xal)`, kind: 'credit_repay' });
      return { amount, creditDebt: Number(row.credit_debt) };
    });
  }

  // ---------- hədiyyə ----------
  async giftPlayer(fromId, toId, amount, note, key) {
    amount = amountOf(amount);
    toId = Number(toId);
    if (toId === fromId) throw new UserError('Özünüzə hədiyyə göndərə bilməzsiniz.');
    if (!(toId > 0)) throw new UserError('Botlara hədiyyə göndərmək olmaz.');
    return this.op(key, fromId, 'gift', async (ctx) => {
      const from = await this.activeUser(ctx.q, fromId);
      const to = await this.activeUser(ctx.q, toId, 'Alıcı');
      const n = cleanNote(note);
      const b1 = await this.debit(ctx, fromId, amount, 'Balansınız bu hədiyyə üçün çatmır.');
      const b2 = await this.creditTo(ctx, toId, amount);
      await this.journal(ctx, { userId: fromId, delta: -amount, balance: b1, reason: `Hədiyyə → ${to.display_name}`, kind: 'gift_out', counterparty: toId, note: n });
      await this.journal(ctx, { userId: toId, delta: amount, balance: b2, reason: `Hədiyyə ← ${from.display_name}`, kind: 'gift_in', counterparty: fromId, note: n });
      await this.notifyIn(ctx, toId, 'gift', `🎁 ${from.display_name} sizə ${money(amount)} hədiyyə etdi.${n ? ' Qeyd: ' + n : ''}`);
      return { toId, toName: to.display_name, amount };
    });
  }

  /** Admin hədiyyəsi: sistemdən verilir, adminin öz balansından çıxılmır, borc deyil */
  async adminGift(adminId, toId, amount, note, key) {
    amount = amountOf(amount);
    return this.op(key, adminId, 'admin-gift', async (ctx) => {
      const to = await this.activeUser(ctx.q, toId, 'Alıcı');
      const n = cleanNote(note);
      const b = await this.creditTo(ctx, to.id, amount);
      await this.journal(ctx, { userId: to.id, delta: amount, balance: b, reason: 'Admin hədiyyəsi', kind: 'admin_gift', by: adminId, note: n });
      await this.notifyIn(ctx, to.id, 'gift', `🎁 Admin sizə ${money(amount)} hədiyyə etdi.${n ? ' Qeyd: ' + n : ''}`);
      return { toId: to.id, amount };
    });
  }

  /** Admin balans forması: "Əlavə et" / "Çıx" (məbləğ müsbət yazılır; çıxma balansı 0-dan aşağı salmır) */
  async adminAdjust(adminId, userId, opName, amount, note, key) {
    amount = amountOf(amount);
    if (opName !== 'add' && opName !== 'sub') throw new UserError('Əməliyyat seçin: əlavə et və ya çıx.');
    return this.op(key, adminId, 'admin-adjust', async (ctx) => {
      const u = await this.userIn(ctx.q, Number(userId));
      if (!u) throw new UserError('İstifadəçi tapılmadı.');
      const n = cleanNote(note);
      let b;
      if (opName === 'add') b = await this.creditTo(ctx, u.id, amount);
      else b = await this.debit(ctx, u.id, amount, `Balans ${u.balance} xaldır — ondan çox çıxmaq olmaz.`);
      const delta = opName === 'add' ? amount : -amount;
      await this.journal(ctx, { userId: u.id, delta, balance: b, reason: `Admin: ${opName === 'add' ? 'əlavə' : 'çıxma'}${n ? ' — ' + n : ''}`, kind: 'admin', by: adminId, note: n });
      return { userId: u.id, delta, balance: b };
    });
  }

  // ---------- oyunçular arası borc ----------
  async offerLoan(lenderId, borrowerId, amount, dueAt, note, key, t = now()) {
    amount = amountOf(amount);
    borrowerId = Number(borrowerId);
    dueAt = Number(dueAt);
    if (borrowerId === lenderId) throw new UserError('Özünüzə borc verə bilməzsiniz.');
    if (!(borrowerId > 0)) throw new UserError('Botlara borc vermək olmaz.');
    if (!Number.isFinite(dueAt) || dueAt < t + 10 * 60_000) throw new UserError('Qaytarma vaxtı ən azı 10 dəqiqə sonra olmalıdır.');
    if (dueAt > t + 366 * DAY) throw new UserError('Qaytarma vaxtı 1 ildən çox ola bilməz.');
    return this.op(key, lenderId, 'loan-offer', async (ctx) => {
      const lender = await this.activeUser(ctx.q, lenderId);
      const borrower = await this.activeUser(ctx.q, borrowerId, 'Borc alan');
      const row = await ctx.q.get(
        `INSERT INTO loans(lender_id, borrower_id, amount, remaining, due_at, status, note, created_at) VALUES($1, $2, $3, $3, $4, 'offered', $5, $6) RETURNING id`,
        [lenderId, borrowerId, amount, dueAt, cleanNote(note), t]);
      await this.notifyIn(ctx, borrowerId, 'loan', `💸 ${lender.display_name} sizə ${money(amount)} borc təklif edir. Masada 🤝 zolağından və ya Profilim bölməsindən cavab verin.`);
      return { loanId: Number(row.id), borrowerName: borrower.display_name };
    });
  }

  /** Borc alanın açıq qəbulu: borc verənin balansı yalnız indi yoxlanılır və köçürülür */
  async acceptLoan(borrowerId, loanId, key, t = now()) {
    return this.op(key, borrowerId, 'loan-accept', async (ctx) => {
      const loan = await ctx.q.get('SELECT * FROM loans WHERE id = $1', [loanId]);
      if (!loan || Number(loan.borrower_id) !== borrowerId) throw new UserError('Təklif tapılmadı.');
      if (loan.status !== 'offered') throw new UserError('Bu təklif artıq aktiv deyil.');
      if (Number(loan.due_at) <= t) throw new UserError('Qaytarma vaxtı artıq keçib — bu təklif qəbul edilə bilməz.');
      const lender = await this.activeUser(ctx.q, loan.lender_id, 'Borc verən');
      const borrower = await this.activeUser(ctx.q, borrowerId);
      const st = await ctx.q.run(`UPDATE loans SET status = 'active', accepted_at = $1 WHERE id = $2 AND status = 'offered' AND due_at > $1`, [t, loanId]);
      if (st.changes !== 1) throw new UserError('Bu təklif artıq aktiv deyil.');
      const amount = Number(loan.amount);
      const b1 = await this.debit(ctx, lender.id, amount, `${lender.display_name}-in balansı hazırda bu borc üçün çatmır.`);
      const b2 = await this.creditTo(ctx, borrowerId, amount);
      await this.journal(ctx, { userId: lender.id, delta: -amount, balance: b1, reason: `Borc verildi → ${borrower.display_name} (#${loanId})`, kind: 'loan_out', counterparty: borrowerId });
      await this.journal(ctx, { userId: borrowerId, delta: amount, balance: b2, reason: `Borc alındı ← ${lender.display_name} (#${loanId})`, kind: 'loan_in', counterparty: lender.id });
      await this.notifyIn(ctx, lender.id, 'loan', `${borrower.display_name} borc təklifinizi (${money(amount)}) qəbul etdi.`);
      return { loanId, amount };
    });
  }

  // ---------- "Borc istə": borc alan istəyir, borc verən təsdiqləyir ----------
  async requestLoan(borrowerId, lenderId, amount, dueAt, note, key, t = now()) {
    amount = amountOf(amount);
    lenderId = Number(lenderId);
    dueAt = Number(dueAt);
    if (lenderId === borrowerId) throw new UserError('Özünüzdən borc istəyə bilməzsiniz.');
    if (!(lenderId > 0)) throw new UserError('Botlardan borc istəmək olmaz.');
    if (!Number.isFinite(dueAt) || dueAt < t + 10 * 60_000) throw new UserError('Qaytarma vaxtı ən azı 10 dəqiqə sonra olmalıdır.');
    if (dueAt > t + 366 * DAY) throw new UserError('Qaytarma vaxtı 1 ildən çox ola bilməz.');
    return this.op(key, borrowerId, 'loan-request', async (ctx) => {
      const borrower = await this.activeUser(ctx.q, borrowerId);
      const lender = await this.activeUser(ctx.q, lenderId, 'Borc verən');
      const row = await ctx.q.get(
        `INSERT INTO loans(lender_id, borrower_id, amount, remaining, due_at, status, note, created_at) VALUES($1, $2, $3, $3, $4, 'requested', $5, $6) RETURNING id`,
        [lenderId, borrowerId, amount, dueAt, cleanNote(note), t]);
      await this.notifyIn(ctx, lenderId, 'loan', `🙏 ${borrower.display_name} sizdən ${money(amount)} borc istəyir. Masada 🤝 zolağından və ya Profilim bölməsindən təsdiqləyin və ya rədd edin.`);
      return { loanId: Number(row.id), lenderName: lender.display_name };
    });
  }

  /** Borc verənin təsdiqi: balans yalnız indi yoxlanılır; köçürmə və borcun yaranması bir tranzaksiyada */
  async approveLoanRequest(lenderId, loanId, key, t = now()) {
    return this.op(key, lenderId, 'loan-approve', async (ctx) => {
      const loan = await ctx.q.get('SELECT * FROM loans WHERE id = $1', [loanId]);
      if (!loan || Number(loan.lender_id) !== lenderId) throw new UserError('İstək tapılmadı.');
      if (loan.status !== 'requested') throw new UserError('Bu istək artıq aktiv deyil.');
      if (Number(loan.due_at) <= t) throw new UserError('Qaytarma vaxtı artıq keçib — bu istək təsdiqlənə bilməz.');
      const lender = await this.activeUser(ctx.q, lenderId);
      const borrower = await this.activeUser(ctx.q, loan.borrower_id, 'Borc alan');
      const st = await ctx.q.run(`UPDATE loans SET status = 'active', accepted_at = $1 WHERE id = $2 AND status = 'requested' AND due_at > $1`, [t, loanId]);
      if (st.changes !== 1) throw new UserError('Bu istək artıq aktiv deyil.');
      const amount = Number(loan.amount);
      const b1 = await this.debit(ctx, lenderId, amount, `Balansınız bu borc üçün çatmır (${money(amount)}).`);
      const b2 = await this.creditTo(ctx, borrower.id, amount);
      await this.journal(ctx, { userId: lenderId, delta: -amount, balance: b1, reason: `Borc verildi → ${borrower.display_name} (#${loanId})`, kind: 'loan_out', counterparty: borrower.id });
      await this.journal(ctx, { userId: borrower.id, delta: amount, balance: b2, reason: `Borc alındı ← ${lender.display_name} (#${loanId})`, kind: 'loan_in', counterparty: lenderId });
      await this.notifyIn(ctx, borrower.id, 'loan', `${lender.display_name} borc istəyinizi (${money(amount)}) təsdiqlədi.`);
      return { loanId, amount };
    });
  }

  async rejectLoanRequest(lenderId, loanId, key) {
    return this.op(key, lenderId, 'loan-reject', async (ctx) => {
      const loan = await ctx.q.get('SELECT * FROM loans WHERE id = $1', [loanId]);
      if (!loan || Number(loan.lender_id) !== lenderId) throw new UserError('İstək tapılmadı.');
      const st = await ctx.q.run(`UPDATE loans SET status = 'declined', closed_at = $1 WHERE id = $2 AND status = 'requested'`, [now(), loanId]);
      if (st.changes !== 1) throw new UserError('Bu istək artıq aktiv deyil.');
      await this.notifyIn(ctx, Number(loan.borrower_id), 'loan', `Borc istəyiniz (${money(Number(loan.amount))}) rədd edildi.`);
      return { loanId };
    });
  }

  async withdrawLoanRequest(borrowerId, loanId, key) {
    return this.op(key, borrowerId, 'loan-withdraw', async (ctx) => {
      const loan = await ctx.q.get('SELECT * FROM loans WHERE id = $1', [loanId]);
      if (!loan || Number(loan.borrower_id) !== borrowerId) throw new UserError('İstək tapılmadı.');
      const st = await ctx.q.run(`UPDATE loans SET status = 'cancelled', closed_at = $1 WHERE id = $2 AND status = 'requested'`, [now(), loanId]);
      if (st.changes !== 1) throw new UserError('İstək artıq cavablandırılıb — ləğv etmək olmaz.');
      await this.notifyIn(ctx, Number(loan.lender_id), 'loan', `Borc istəyi (${money(Number(loan.amount))}) geri götürüldü.`);
      return { loanId };
    });
  }

  async declineLoan(borrowerId, loanId, key) {
    return this.op(key, borrowerId, 'loan-decline', async (ctx) => {
      const loan = await ctx.q.get('SELECT * FROM loans WHERE id = $1', [loanId]);
      if (!loan || Number(loan.borrower_id) !== borrowerId) throw new UserError('Təklif tapılmadı.');
      const st = await ctx.q.run(`UPDATE loans SET status = 'declined', closed_at = $1 WHERE id = $2 AND status = 'offered'`, [now(), loanId]);
      if (st.changes !== 1) throw new UserError('Bu təklif artıq aktiv deyil.');
      await this.notifyIn(ctx, Number(loan.lender_id), 'loan', `Borc təklifiniz (${money(Number(loan.amount))}) rədd edildi.`);
      return { loanId };
    });
  }

  async cancelLoan(lenderId, loanId, key) {
    return this.op(key, lenderId, 'loan-cancel', async (ctx) => {
      const loan = await ctx.q.get('SELECT * FROM loans WHERE id = $1', [loanId]);
      if (!loan || Number(loan.lender_id) !== lenderId) throw new UserError('Təklif tapılmadı.');
      const st = await ctx.q.run(`UPDATE loans SET status = 'cancelled', closed_at = $1 WHERE id = $2 AND status = 'offered'`, [now(), loanId]);
      if (st.changes !== 1) throw new UserError('Təklif artıq qəbul və ya rədd edilib — ləğv etmək olmaz.');
      await this.notifyIn(ctx, Number(loan.borrower_id), 'loan', `Borc təklifi (${money(Number(loan.amount))}) borc verən tərəfindən ləğv edildi.`);
      return { loanId };
    });
  }

  // borc ödənişinin ortaq hissəsi (əl ilə və ya avtomatik)
  async payLoanPart(ctx, loan, amount, kind, t) {
    const borrowerId = Number(loan.borrower_id);
    const lenderId = Number(loan.lender_id);
    const before = Number(loan.remaining);
    const after = before - amount;
    const st = await ctx.q.run(
      `UPDATE loans SET remaining = $1, status = $2, closed_at = $3 WHERE id = $4 AND remaining = $5 AND status IN ('active', 'overdue')`,
      [after, after === 0 ? 'paid' : (kind === 'auto' ? 'overdue' : loan.status), after === 0 ? t : null, loan.id, before]);
    if (st.changes !== 1) throw new UserError('Borc bu an dəyişdi, yenidən cəhd edin.');
    const b1 = await this.debit(ctx, borrowerId, amount);
    const b2 = await this.creditTo(ctx, lenderId, amount);
    const names = await ctx.q.all('SELECT id, display_name FROM users WHERE id IN ($1, $2)', [borrowerId, lenderId]);
    const nm = (id) => names.find((x) => Number(x.id) === id)?.display_name ?? '?';
    const label = kind === 'auto' ? 'Avtomatik borc tutulması' : 'Borc ödənişi';
    await this.journal(ctx, { userId: borrowerId, delta: -amount, balance: b1, reason: `${label} → ${nm(lenderId)} (#${loan.id}, qalan ${after} xal)`, kind: kind === 'auto' ? 'loan_auto_out' : 'loan_repay_out', counterparty: lenderId });
    await this.journal(ctx, { userId: lenderId, delta: amount, balance: b2, reason: `${label} ← ${nm(borrowerId)} (#${loan.id}, qalan ${after} xal)`, kind: kind === 'auto' ? 'loan_auto_in' : 'loan_repay_in', counterparty: borrowerId });
    await ctx.q.run('INSERT INTO loan_payments(loan_id, amount, kind, remaining_after, executed_at) VALUES($1, $2, $3, $4, $5)', [loan.id, amount, kind, after, t]);
    const tail = after === 0 ? 'Borc tam bağlandı.' : `Qalan borc: ${money(after)}.`;
    await this.notifyIn(ctx, borrowerId, 'loan', `${label}: ${nm(lenderId)}-ə ${money(amount)} ödənildi. ${tail}`);
    await this.notifyIn(ctx, lenderId, 'loan', `${label}: ${nm(borrowerId)}-dən ${money(amount)} alındı. ${tail}`);
    return { loanId: Number(loan.id), paid: amount, remaining: after, lenderId, borrowerId };
  }

  /** Vaxtından əvvəl tam və ya qismən ödəniş */
  async repayLoan(borrowerId, loanId, amount, key, t = now()) {
    amount = amountOf(amount);
    return this.op(key, borrowerId, 'loan-repay', async (ctx) => {
      const loan = await ctx.q.get('SELECT * FROM loans WHERE id = $1', [loanId]);
      if (!loan || Number(loan.borrower_id) !== borrowerId) throw new UserError('Borc tapılmadı.');
      if (!['active', 'overdue'].includes(loan.status)) throw new UserError('Bu borc aktiv deyil.');
      if (amount > Number(loan.remaining)) throw new UserError(`Qalan borc ${money(Number(loan.remaining))}-dir.`);
      const u = await this.userIn(ctx.q, borrowerId);
      if (u.balance < amount) throw new UserError('Balansınız çatmır.');
      return this.payLoanPart(ctx, loan, amount, 'manual', t);
    });
  }

  /**
   * Vaxtı çatmış borcların avtomatik tutulması (bir borclu üçün).
   * Sıra: son ödəmə vaxtı köhnə olan əvvəl, eynidirsə ID kiçik olan. Yalnız mövcud əsas balans qədər tutulur.
   * İdempotentdir: hər ödəniş "remaining = köhnə dəyər" şərti ilə yazılır, təkrar çağırış ikiqat tutmur.
   */
  async collectDue(borrowerId, t = now()) {
    return this.db.tx(async (q) => {
      const ctx = { q, key: null, changes: [], notify: [] };
      const payments = await this.collectDueIn(ctx, borrowerId, t);
      return { payments, changes: ctx.changes, notify: ctx.notify };
    });
  }

  /** collectDue-nun gövdəsi: çağıranın tranzaksiyası (ctx) daxilində işləyir — məs. hədiyyə ilə eyni tranzaksiyada */
  async collectDueIn(ctx, borrowerId, t = now()) {
    const q = ctx.q;
    {
      const loans = await q.all(
        `SELECT * FROM loans WHERE borrower_id = $1 AND status IN ('active', 'overdue') AND remaining > 0 AND due_at <= $2 ORDER BY due_at ASC, id ASC`,
        [borrowerId, t]);
      const payments = [];
      if (!loans.length) return payments;
      const u = await this.userIn(q, borrowerId);
      let bal = u ? u.balance : 0;
      for (const loan of loans) {
        const pay = Math.min(Number(loan.remaining), Math.max(0, bal));
        if (pay > 0) {
          payments.push(await this.payLoanPart(ctx, loan, pay, 'auto', t));
          bal -= pay;
        } else if (loan.status === 'active') {
          // vaxt keçib, balans yoxdur — "Gecikib"
          const st = await q.run(`UPDATE loans SET status = 'overdue' WHERE id = $1 AND status = 'active'`, [loan.id]);
          if (st.changes === 1) {
            await this.notifyIn(ctx, borrowerId, 'loan', `Borcun qaytarma vaxtı keçdi (#${loan.id}). Balansınız olmadığı üçün ${money(Number(loan.remaining))} gecikmiş borc kimi qaldı — balansa daxil olan vəsaitdən avtomatik tutulacaq.`);
            await this.notifyIn(ctx, Number(loan.lender_id), 'loan', `Borc #${loan.id} gecikdi: borclunun balansı yoxdur, qalan ${money(Number(loan.remaining))}.`);
          }
        }
      }
      return payments;
    }
  }

  async dueBorrowers(t = now()) {
    const rows = await this.db.all(`SELECT DISTINCT borrower_id FROM loans WHERE status IN ('active', 'overdue') AND remaining > 0 AND due_at <= $1`, [t]);
    return rows.map((r) => Number(r.borrower_id));
  }

  // ---------- masa hədiyyələri (animasiyalı, oyun xalı ilə) ----------
  // sharePct: alana keçən EFFEKTİV faiz (hədiyyənin öz faizi, yoxdursa ümumi faiz); ownPct: yalnız hədiyyənin öz ayarı (null = ümumi)
  async giftTypes(q = this.db, onlyActive = false) {
    const rows = await q.all(`SELECT id, name, price, active, sort, share_pct FROM gift_types ${onlyActive ? 'WHERE active = 1' : ''} ORDER BY sort, id`);
    const common = await this.giftSharePct(q);
    return rows.map((g) => {
      const own = g.share_pct == null ? null : Number(g.share_pct);
      return { id: g.id, name: g.name, price: Number(g.price), active: Number(g.active) === 1, ownPct: own, sharePct: own ?? common };
    });
  }
  async giftSharePct(q = this.db) {
    const r = await q.get(`SELECT value FROM app_settings WHERE key = 'gift_share_pct'`);
    const n = parseInt(r?.value ?? '30', 10);
    return Number.isInteger(n) && n >= 0 && n <= 100 ? n : 30;
  }
  /** Admin: faiz (0–100) və hər hədiyyənin qiyməti/aktivliyi. Köhnə əməliyyatlara təsir etmir (onlarda o anki dəyərlər saxlanılıb). */
  async setGiftSettings({ sharePct, gifts } = {}) {
    return this.db.tx(async (q) => {
      if (sharePct !== undefined && sharePct !== null && sharePct !== '') {
        const n = Number(sharePct);
        if (!Number.isInteger(n) || n < 0 || n > 100) throw new UserError('Alana keçən faiz 0–100 arası tam ədəd olmalıdır.');
        await q.run(`INSERT INTO app_settings(key, value) VALUES('gift_share_pct', $1) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(n)]);
      }
      for (const g of Array.isArray(gifts) ? gifts : []) {
        const row = await q.get('SELECT id FROM gift_types WHERE id = $1', [String(g.id)]);
        if (!row) throw new UserError('Hədiyyə tapılmadı.');
        const price = Number(g.price);
        if (!Number.isInteger(price) || price < 1 || price > MAX_AMOUNT) throw new UserError('Hədiyyənin qiyməti müsbət tam ədəd olmalıdır.');
        await q.run('UPDATE gift_types SET price = $1, active = $2 WHERE id = $3', [price, g.active ? 1 : 0, row.id]);
        // hədiyyəyə ayrıca faiz: boş/null → ümumi faiz istifadə olunur
        if (g.sharePct !== undefined) {
          const own = g.sharePct === null || g.sharePct === '' ? null : Number(g.sharePct);
          if (own !== null && (!Number.isInteger(own) || own < 0 || own > 100)) throw new UserError('Hədiyyənin faizi 0–100 arası tam ədəd olmalıdır (boş = ümumi faiz).');
          await q.run('UPDATE gift_types SET share_pct = $1 WHERE id = $2', [own, row.id]);
        }
      }
      return { sharePct: await this.giftSharePct(q), gifts: await this.giftTypes(q) };
    });
  }

  /**
   * Hədiyyə göndərmək: göndərəndən qiymət çıxılır, alana faiz qədər (aşağı yuvarlaqlaşdırılmış) xal yazılır,
   * qalan hissə dövriyyədən çıxır. Alanın vaxtı çatmış borcları EYNİ tranzaksiyada avtomatik tutulur.
   * Qiymət, faiz, icazələr serverdə yoxlanılır; idempotency açarı təkrar/paralel sorğunu bir dəfə icra edir.
   */
  async sendTableGift(fromId, toId, giftId, roomCode, key, t = now()) {
    toId = Number(toId);
    if (toId === fromId) throw new UserError('Özünüzə hədiyyə göndərə bilməzsiniz.');
    if (!(toId > 0)) throw new UserError('Botlara hədiyyə göndərmək olmaz.');
    return this.op(key, fromId, 'tgift', async (ctx) => {
      const g = await ctx.q.get('SELECT id, name, price, active, share_pct FROM gift_types WHERE id = $1', [String(giftId ?? '')]);
      if (!g) throw new UserError('Hədiyyə tapılmadı.');
      if (Number(g.active) !== 1) throw new UserError('Bu hədiyyə hazırda aktiv deyil.');
      const from = await this.activeUser(ctx.q, fromId);
      const to = await this.activeUser(ctx.q, toId, 'Alıcı');
      const price = Number(g.price);
      const pct = g.share_pct == null ? await this.giftSharePct(ctx.q) : Number(g.share_pct);
      const credited = Math.floor((price * pct) / 100);
      const burned = price - credited;
      const b1 = await this.debit(ctx, fromId, price,
        `Balansınız çatmır: «${g.name}» ${price} xal, balansınız ${from.balance} xal.`);
      await this.journal(ctx, { userId: fromId, delta: -price, balance: b1, kind: 'tgift_out', counterparty: toId,
        reason: `Masa hədiyyəsi «${g.name}» → ${to.display_name} (qiymət ${price}, alana ${pct}% = ${credited})` });
      let toBal = to.balance;
      if (credited > 0) {
        toBal = await this.creditTo(ctx, toId, credited);
        await this.journal(ctx, { userId: toId, delta: credited, balance: toBal, kind: 'tgift_in', counterparty: fromId,
          reason: `Masa hədiyyəsi «${g.name}» ← ${from.display_name} (qiymət ${price}, ${pct}%)` });
      }
      const row = await ctx.q.get(
        `INSERT INTO table_gifts(from_id, to_id, gift_id, gift_name, price, share_pct, credited, burned, debt_paid, room_code, op_key, created_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11) RETURNING id`,
        [fromId, toId, g.id, g.name, price, pct, credited, burned, roomCode || null, ctx.key, t]);
      // alanın vaxtı çatmış borcları — mövcud avtomatik tutulma qaydası ilə (sıra: köhnə müddət, sonra kiçik ID)
      const payments = credited > 0 ? await this.collectDueIn(ctx, toId, t) : [];
      const debtPaid = payments.reduce((a, p) => a + p.paid, 0);
      if (debtPaid > 0) await ctx.q.run('UPDATE table_gifts SET debt_paid = $1 WHERE id = $2', [debtPaid, row.id]);
      const toBalance = toBal - debtPaid;
      await this.notifyIn(ctx, toId, 'tgift',
        `🎁 ${from.display_name} sizə «${g.name}» göndərdi. Hədiyyədən gələn: +${credited} xal.`
        + (debtPaid > 0 ? ` Borca tutulan: ${debtPaid} xal.` : '')
        + ` Qalan balans: ${toBalance} xal.`);
      return {
        giftLogId: Number(row.id), giftId: g.id, giftName: g.name, price, sharePct: pct, credited, burned, debtPaid,
        fromId, fromName: from.display_name, toId, toName: to.display_name, balance: b1, toBalance,
        payments: payments.map((p) => ({ loanId: p.loanId, paid: p.paid, lenderId: p.lenderId })),
      };
    });
  }

  async tableGiftsFor(userId, dir, limit = 100) {
    const col = dir === 'sent' ? 'from_id' : 'to_id';
    const other = dir === 'sent' ? 'to_id' : 'from_id';
    const rows = await this.db.all(
      `SELECT g.*, u.display_name AS other_name FROM table_gifts g LEFT JOIN users u ON u.id = g.${other}
       WHERE g.${col} = $1 ORDER BY g.id DESC LIMIT $2`, [userId, limit]);
    return rows.map(normTGift);
  }

  async adminTableGifts(limit = 1000) {
    const rows = await this.db.all(
      `SELECT g.*, a.display_name AS from_name, a.username AS from_username, b.display_name AS to_name, b.username AS to_username
       FROM table_gifts g LEFT JOIN users a ON a.id = g.from_id LEFT JOIN users b ON b.id = g.to_id ORDER BY g.id DESC LIMIT $1`, [limit]);
    return rows.map((r) => ({ ...normTGift(r), fromName: r.from_name, fromUsername: r.from_username, toName: r.to_name, toUsername: r.to_username }));
  }

  // ---------- oxuma ----------
  async notifications(userId, limit = 50) {
    return this.db.all('SELECT id, kind, text, created_at, read_at FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT $2', [userId, limit]);
  }
  async markNotificationsRead(userId) { await this.db.run('UPDATE notifications SET read_at = $1 WHERE user_id = $2 AND read_at IS NULL', [now(), userId]); }

  async loansFor(userId) {
    return this.db.all(
      `SELECT l.*, a.display_name AS lender_name, b.display_name AS borrower_name FROM loans l
       JOIN users a ON a.id = l.lender_id JOIN users b ON b.id = l.borrower_id
       WHERE (l.lender_id = $1 OR l.borrower_id = $1) ORDER BY l.id DESC LIMIT 200`, [userId]);
  }

  /** Masada göstərilən gözləyən borc təklifləri/istəkləri (yalnız mənə aid olanlar) */
  async pendingLoans(userId) {
    const rows = await this.db.all(
      `SELECT l.*, a.display_name AS lender_name, b.display_name AS borrower_name FROM loans l
       JOIN users a ON a.id = l.lender_id JOIN users b ON b.id = l.borrower_id
       WHERE l.status IN ('offered', 'requested') AND (l.lender_id = $1 OR l.borrower_id = $1) ORDER BY l.id DESC LIMIT 50`, [userId]);
    return rows.map(normLoan).map((l) => ({
      ...l,
      // mənim cavabımı gözləyən: mənə gələn təklif (borc alan mənəm) və ya məndən istənilən borc (borc verən mənəm)
      mine: (l.status === 'offered' && l.borrowerId === userId) || (l.status === 'requested' && l.lenderId === userId),
    }));
  }

  async profile(userId) {
    const u = await this.userIn(this.db, userId);
    const pending = await this.db.get(`SELECT * FROM credit_requests WHERE user_id = $1 AND status = 'pending'`, [userId]);
    const lastReq = await this.db.get('SELECT * FROM credit_requests WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [userId]);
    const loans = (await this.loansFor(userId)).map(normLoan);
    const history = await this.db.all(
      `SELECT t.*, c.display_name AS counterparty_name, b.display_name AS by_name FROM transactions t
       LEFT JOIN users c ON c.id = t.counterparty_id LEFT JOIN users b ON b.id = t.by_user
       WHERE t.user_id = $1 AND (t.kind IS NULL OR t.kind <> 'game') ORDER BY t.id DESC LIMIT 100`, [userId]);
    const unread = await this.db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId]);
    return {
      balance: u.balance, creditDebt: u.credit_debt, creditLimit: u.credit_limit, creditLeft: Math.max(0, u.credit_limit - u.credit_debt),
      pendingCredit: pending ? normReq(pending) : null,
      lastCredit: lastReq ? normReq(lastReq) : null,
      loans, history, unread: Number(unread?.n || 0),
      giftsSent: await this.tableGiftsFor(userId, 'sent'), giftsReceived: await this.tableGiftsFor(userId, 'received'),
    };
  }

  async adminCreditOverview() {
    const users = await this.db.all(
      `SELECT id, username, display_name, balance, credit_debt, credit_limit, avatar_ver FROM users WHERE credit_debt > 0 OR credit_limit > 0 ORDER BY credit_debt DESC, id`);
    const total = await this.db.get('SELECT COALESCE(SUM(credit_debt), 0) AS s FROM users');
    const requests = await this.db.all(
      `SELECT r.*, u.display_name, u.username, u.credit_debt, u.credit_limit, u.balance, d.display_name AS decided_name
       FROM credit_requests r JOIN users u ON u.id = r.user_id LEFT JOIN users d ON d.id = r.decided_by
       ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.id DESC LIMIT 300`);
    return {
      totalDebt: Number(total.s),
      users: users.map((x) => ({ id: x.id, username: x.username, displayName: x.display_name, balance: Number(x.balance), creditDebt: Number(x.credit_debt), creditLimit: Number(x.credit_limit), avatarVer: Number(x.avatar_ver) })),
      requests: requests.map((r) => ({ ...normReq(r), displayName: r.display_name, username: r.username, creditDebt: Number(r.credit_debt), creditLimit: Number(r.credit_limit), balance: Number(r.balance), decidedName: r.decided_name })),
    };
  }

  async adminLoans() {
    const rows = await this.db.all(
      `SELECT l.*, a.display_name AS lender_name, a.username AS lender_username, b.display_name AS borrower_name, b.username AS borrower_username
       FROM loans l JOIN users a ON a.id = l.lender_id JOIN users b ON b.id = l.borrower_id ORDER BY l.id DESC LIMIT 1000`);
    return rows.map((r) => ({ ...normLoan(r), lenderUsername: r.lender_username, borrowerUsername: r.borrower_username }));
  }

  async adminGiftHistory() {
    return this.db.all(
      `SELECT t.*, u.display_name AS user_name, c.display_name AS counterparty_name, b.display_name AS by_name FROM transactions t
       JOIN users u ON u.id = t.user_id LEFT JOIN users c ON c.id = t.counterparty_id LEFT JOIN users b ON b.id = t.by_user
       WHERE t.kind IN ('gift_in', 'admin_gift') ORDER BY t.id DESC LIMIT 300`);
  }
}

function normTGift(g) {
  return {
    id: Number(g.id), fromId: Number(g.from_id), toId: Number(g.to_id), giftId: g.gift_id, giftName: g.gift_name,
    price: Number(g.price), sharePct: Number(g.share_pct), credited: Number(g.credited), burned: Number(g.burned),
    debtPaid: Number(g.debt_paid), room: g.room_code, createdAt: Number(g.created_at), otherName: g.other_name,
  };
}

function normReq(r) {
  return { id: Number(r.id), userId: Number(r.user_id), amount: Number(r.amount), status: r.status, approvedAmount: r.approved_amount == null ? null : Number(r.approved_amount), note: r.note, adminNote: r.admin_note, createdAt: Number(r.created_at), decidedAt: r.decided_at == null ? null : Number(r.decided_at) };
}

function normLoan(l) {
  return {
    id: Number(l.id), lenderId: Number(l.lender_id), borrowerId: Number(l.borrower_id), lenderName: l.lender_name, borrowerName: l.borrower_name,
    amount: Number(l.amount), remaining: Number(l.remaining), dueAt: Number(l.due_at), status: l.status, note: l.note,
    createdAt: Number(l.created_at), acceptedAt: l.accepted_at == null ? null : Number(l.accepted_at), closedAt: l.closed_at == null ? null : Number(l.closed_at),
  };
}
