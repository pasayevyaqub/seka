// İstifadəçilər, sessiyalar, balans əməliyyatları, raund qeydləri və qarşılıqlı nəticələr
import crypto from 'node:crypto';

export class UserError extends Error {}

const now = () => Date.now();

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function checkPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(String(pw), salt, 64);
  const b = Buffer.from(hash, 'hex');
  return b.length === h.length && crypto.timingSafeEqual(h, b);
}

export const publicUser = (u) => u && ({
  id: u.id, username: u.username, displayName: u.display_name, phone: u.phone,
  role: u.role, status: u.status, balance: Number(u.balance), createdAt: Number(u.created_at),
  creditDebt: Number(u.credit_debt || 0), creditLimit: Number(u.credit_limit || 0), avatarVer: Number(u.avatar_ver || 0),
});

// şəkil (avatar) binar məlumatı hər sorğuda daşınmasın deyə sütunlar açıq yazılır
const USER_COLS = 'id, username, display_name, display_key, phone, pass_hash, role, status, balance, created_at, credit_debt, credit_limit, avatar_ver';

const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;

export class Store {
  constructor(db) { this.db = db; }

  async ensureAdmin(username, password) {
    const admin = await this.db.get(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    if (admin) return;
    await this.db.run(
      `INSERT INTO users(username, display_name, display_key, pass_hash, role, status, balance, created_at)
       VALUES($1, $2, $3, $4, 'admin', 'approved', 0, $5)`,
      [username.toLowerCase(), 'Admin', 'admin', hashPassword(password), now()],
    );
    console.log(`Admin hesabı yaradıldı: istifadəçi adı "${username}". Şifrəni dərhal dəyişin!`);
  }

  /** Qeydiyyat: hesab dərhal aktivdir; başlanğıc bonusu eyni tranzaksiyada, bir dəfə verilir. */
  async register({ username, displayName, password, phone }, finance = null) {
    username = String(username || '').trim().toLowerCase();
    displayName = String(displayName || '').trim().replace(/\s+/g, ' ');
    phone = String(phone || '').trim().slice(0, 30) || null;
    if (!USERNAME_RE.test(username)) throw new UserError('İstifadəçi adı 3–20 simvol olmalıdır (kiçik latın hərfləri, rəqəm, _ və .).');
    if (displayName.length < 2 || displayName.length > 20) throw new UserError('Göstəriləcək ad 2–20 simvol olmalıdır.');
    if (/^bot\b/i.test(displayName) || displayName.includes('🤖')) throw new UserError('Bu ad botlar üçün ayrılıb.');
    if (String(password || '').length < 6) throw new UserError('Şifrə ən azı 6 simvol olmalıdır.');
    if (await this.db.get('SELECT id FROM users WHERE username = $1', [username])) throw new UserError('Bu istifadəçi adı artıq mövcuddur.');
    if (await this.db.get('SELECT id FROM users WHERE display_key = $1', [displayName.toLowerCase()])) throw new UserError('Bu ad artıq istifadə olunur.');
    const hash = hashPassword(password);
    const bonus = finance ? await finance.signupBonus() : 0;
    return this.db.tx(async (q) => {
      const row = await q.get(
        `INSERT INTO users(username, display_name, display_key, phone, pass_hash, status, created_at) VALUES($1, $2, $3, $4, $5, 'approved', $6) RETURNING id`,
        [username, displayName, displayName.toLowerCase(), phone, hash, now()],
      );
      const id = Number(row.id);
      const given = finance ? await finance.grantSignupBonus(q, id, bonus) : 0;
      return { id, bonus: given };
    });
  }

  // Təsdiq gözləyən istifadəçi də daxil olur — amma yalnız demo (botlarla məşq) rejimində
  async login(username, password) {
    const u = await this.db.get(`SELECT ${USER_COLS} FROM users WHERE username = $1`, [String(username || '').trim().toLowerCase()]);
    if (!u || !checkPassword(String(password || ''), u.pass_hash)) throw new UserError('İstifadəçi adı və ya şifrə yanlışdır.');
    if (u.status === 'rejected') throw new UserError('Qeydiyyatınız rədd edilib.');
    if (u.status === 'blocked') throw new UserError('Hesabınız bloklanıb.');
    const token = crypto.randomBytes(32).toString('hex');
    await this.db.run('INSERT INTO sessions(token, user_id, created_at) VALUES($1, $2, $3)', [token, u.id, now()]);
    return { token, user: u };
  }

  async logout(token) { await this.db.run('DELETE FROM sessions WHERE token = $1', [token]); }

  // approved və ya pending (demo) istifadəçi qaytarır
  async userByToken(token) {
    if (!token) return null;
    const s = await this.db.get('SELECT user_id FROM sessions WHERE token = $1', [token]);
    if (!s) return null;
    const u = await this.getUser(s.user_id);
    if (!u || (u.status !== 'approved' && u.status !== 'pending')) return null;
    return u;
  }

  getUser(id) { return this.db.get(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]); }

  listUsers() { return this.db.all(`SELECT ${USER_COLS} FROM users ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, id DESC`); }

  // ---- profil şəkli (DB-də saxlanılır: Render-in müvəqqəti diski istifadə olunmur) ----
  async setAvatar(id, buf) {
    const row = await this.db.get('UPDATE users SET avatar = $1, avatar_ver = avatar_ver + 1 WHERE id = $2 RETURNING avatar_ver', [buf, id]);
    return Number(row.avatar_ver);
  }
  async deleteAvatar(id) {
    const row = await this.db.get('UPDATE users SET avatar = NULL, avatar_ver = avatar_ver + 1 WHERE id = $1 RETURNING avatar_ver', [id]);
    return Number(row.avatar_ver);
  }
  async getAvatar(id) {
    const r = await this.db.get('SELECT avatar FROM users WHERE id = $1', [id]);
    let a = r?.avatar;
    if (!a) return null;
    if (typeof a === 'string' && a.startsWith('\\x')) a = Buffer.from(a.slice(2), 'hex'); // bəzi PG klientləri
    return Buffer.from(a);
  }

  async setStatus(id, status) {
    if (!['approved', 'rejected', 'blocked'].includes(status)) throw new UserError('Yanlış status.');
    await this.db.run('UPDATE users SET status = $1 WHERE id = $2', [status, id]);
    if (status !== 'approved') await this.db.run('DELETE FROM sessions WHERE user_id = $1', [id]);
  }

  async setRole(id, role) {
    if (!['player', 'moderator', 'admin'].includes(role)) throw new UserError('Yanlış rol.');
    await this.db.run('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
  }

  async setDisplayName(id, displayName) {
    displayName = String(displayName || '').trim().replace(/\s+/g, ' ');
    if (displayName.length < 2 || displayName.length > 20) throw new UserError('Ad 2–20 simvol olmalıdır.');
    if (/^bot\b/i.test(displayName) || displayName.includes('🤖')) throw new UserError('Bu ad botlar üçün ayrılıb.');
    const other = await this.db.get('SELECT id FROM users WHERE display_key = $1', [displayName.toLowerCase()]);
    if (other && other.id !== Number(id)) throw new UserError('Bu ad artıq istifadə olunur.');
    await this.db.run('UPDATE users SET display_name = $1, display_key = $2 WHERE id = $3', [displayName, displayName.toLowerCase(), id]);
  }

  async setPassword(id, password) {
    if (String(password || '').length < 6) throw new UserError('Şifrə ən azı 6 simvol olmalıdır.');
    await this.db.run('UPDATE users SET pass_hash = $1 WHERE id = $2', [hashPassword(password), id]);
  }

  async changeOwnPassword(id, oldPw, newPw) {
    const u = await this.getUser(id);
    if (!checkPassword(String(oldPw || ''), u.pass_hash)) throw new UserError('Köhnə şifrə yanlışdır.');
    await this.setPassword(id, newPw);
  }

  // Admin balans dəyişikliyi (atomik: balans + jurnal). Yeni balansı qaytarır.
  async addBalance(userId, delta, reason, byUser = null, kind = 'admin') {
    delta = Math.trunc(delta);
    return this.db.tx(async (q) => {
      const row = await q.get('UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance', [delta, userId]);
      if (!row) throw new UserError('İstifadəçi tapılmadı.');
      const bal = Number(row.balance);
      await q.run(
        `INSERT INTO transactions(user_id, delta, balance_after, prev_balance, reason, by_user, kind, created_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, delta, bal, bal - delta, reason, byUser, kind, now()],
      );
      return bal;
    });
  }

  // Mənfi balansı sıfırla — yalnız balans hələ də oxunan dəyərdədirsə (paralel sorğulara qarşı)
  async resetNegative(userId, adminId) {
    return this.db.tx(async (q) => {
      const u = await q.get('SELECT balance FROM users WHERE id = $1', [userId]);
      if (!u) throw new UserError('İstifadəçi tapılmadı.');
      const prev = Number(u.balance);
      if (prev >= 0) throw new UserError('Balans mənfi deyil.');
      const r = await q.run('UPDATE users SET balance = 0 WHERE id = $1 AND balance = $2', [userId, prev]);
      if (r.changes !== 1) throw new UserError('Balans bu an dəyişdi, yenidən cəhd edin.');
      await q.run(
        `INSERT INTO transactions(user_id, delta, balance_after, prev_balance, reason, by_user, kind, created_at)
         VALUES($1, $2, 0, $3, $4, $5, 'reset', $6)`,
        [userId, -prev, prev, `Mənfi balans sıfırlandı (əvvəlki: ${prev} oyun xalı)`, adminId, now()],
      );
      return { prev, delta: -prev, balance: 0 };
    });
  }

  /**
   * Raundun bir yazılış paketini atomik və idempotent yazır.
   * Paket qeydiyyatı (round_batches), balanslar, əməliyyat jurnalı, raund vəziyyəti və nəticələr
   * EYNİ tranzaksiyadadır: ya hamısı yazılır, ya heç biri.
   * Eyni batchId ikinci dəfə (ardıcıl, paralel və ya COMMIT-dən sonra cavab itəndə təkrar) gələrsə
   * heç nə dəyişmir — yalnız cari balanslar qaytarılır.
   * @param {object} b
   * @param {string} b.batchId  sabit, unikal paket ID-si (məs. "<raund uid>:<sıra>")
   * @param {string} b.uid  raundun unikal id-si
   * @param {string} b.room
   * @param {{userId:number,delta:number,reason:string}[]} b.effects
   * @param {object} b.contrib  id → banka qoyulan cəmi (bu paket daxil)
   * @param {null|{status:'finished'|'aborted', flows:{from,to,cents}[]}} b.end
   * @returns {Promise<{duplicate:boolean, balances:Record<number,number>}>}
   */
  async applyRoundBatch({ batchId, uid, room, effects = [], contrib = {}, end = null }) {
    if (!batchId || typeof batchId !== 'string') throw new Error('applyRoundBatch: batchId tələb olunur');
    if (!uid) throw new Error('applyRoundBatch: uid tələb olunur');
    return this.db.tx(async (q) => {
      const t = now();
      const reg = await q.run(
        'INSERT INTO round_batches(batch_id, round_uid, created_at) VALUES($1, $2, $3) ON CONFLICT(batch_id) DO NOTHING',
        [batchId, uid, t],
      );
      const balances = {};
      if (reg.changes !== 1) {
        // bu paket artıq tətbiq edilib — təkrar yazmırıq
        for (const id of new Set(effects.map((e) => e.userId))) {
          const u = await q.get('SELECT balance FROM users WHERE id = $1', [id]);
          if (u) balances[id] = Number(u.balance);
        }
        return { duplicate: true, balances };
      }
      // təhlükəsizlik: artıq bağlanmış (məs. bərpa zamanı ləğv edilmiş) raunda pul hərəkəti yazılmır
      const existing = await q.get('SELECT status FROM rounds WHERE uid = $1', [uid]);
      if (existing && existing.status !== 'active' && effects.length) {
        throw new Error(`Raund ${uid} artıq "${existing.status}" vəziyyətindədir — paket ${batchId} tətbiq edilmədi`);
      }
      const kind = end?.status === 'aborted' ? 'refund' : 'game';
      for (const e of effects) {
        // mənfi dəyişiklik balansı 0-dan aşağı sala bilməz (mühərrik bunu onsuz da yoxlayır — bu, ikinci qorumadır)
        const row = e.delta < 0
          ? await q.get('UPDATE users SET balance = balance + $1 WHERE id = $2 AND balance + $1 >= 0 RETURNING balance', [e.delta, e.userId])
          : await q.get('UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance', [e.delta, e.userId]);
        if (!row) {
          const exists = await q.get('SELECT balance FROM users WHERE id = $1', [e.userId]);
          if (!exists) continue; // istifadəçi silinibsə
          throw new Error(`Balans 0-dan aşağı düşərdi (istifadəçi ${e.userId}) — paket ${batchId} tətbiq edilmədi`);
        }
        const bal = Number(row.balance);
        balances[e.userId] = bal;
        await q.run(
          `INSERT INTO transactions(user_id, delta, balance_after, prev_balance, reason, room, kind, round_uid, batch_id, created_at)
           VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [e.userId, e.delta, bal, bal - e.delta, e.reason, room, kind, uid, batchId, t],
        );
      }
      await q.run(
        `INSERT INTO rounds(uid, room, status, contrib, created_at) VALUES($1, $2, 'active', $3, $4)
         ON CONFLICT(uid) DO UPDATE SET contrib = excluded.contrib WHERE rounds.status = 'active'`,
        [uid, room, JSON.stringify(contrib || {}), t],
      );
      if (end) {
        const r = await q.run(`UPDATE rounds SET status = $1, finished_at = $2 WHERE uid = $3 AND status = 'active'`, [end.status, t, uid]);
        // eyni raund iki dəfə hesablanmır: status yalnız bir dəfə "active"-dən çıxır
        if (r.changes === 1 && end.status === 'finished') {
          for (const f of end.flows || []) {
            if (f.from < 0 || f.to < 0) continue; // botlar
            await q.run(
              `INSERT INTO round_flows(round_uid, from_user, to_user, cents, created_at) VALUES($1, $2, $3, $4, $5)
               ON CONFLICT(round_uid, from_user, to_user) DO NOTHING`,
              [uid, f.from, f.to, f.cents, t],
            );
          }
        }
      }
      return { duplicate: false, balances };
    });
  }

  // Server yenidən başlayanda yarımçıq qalan raundların pulunu qaytar
  async recoverActiveRounds() {
    const rows = await this.db.all(`SELECT uid, room, contrib FROM rounds WHERE status = 'active'`);
    let count = 0;
    for (const r of rows) {
      await this.db.tx(async (q) => {
        const u = await q.run(`UPDATE rounds SET status = 'aborted', finished_at = $1 WHERE uid = $2 AND status = 'active'`, [now(), r.uid]);
        if (u.changes !== 1) return;
        // qaytarma da paket kimi qeyd olunur (eyni raund ikinci dəfə qaytarılmır)
        const reg = await q.run('INSERT INTO round_batches(batch_id, round_uid, created_at) VALUES($1, $2, $3) ON CONFLICT(batch_id) DO NOTHING', [`${r.uid}:recovery`, r.uid, now()]);
        if (reg.changes !== 1) return;
        const fresh = await q.get('SELECT contrib FROM rounds WHERE uid = $1', [r.uid]);
        const contrib = JSON.parse(fresh?.contrib || '{}');
        for (const [id, amt] of Object.entries(contrib)) {
          if (!(amt > 0) || Number(id) < 0) continue;
          const row = await q.get('UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance', [amt, Number(id)]);
          if (!row) continue;
          await q.run(
            `INSERT INTO transactions(user_id, delta, balance_after, prev_balance, reason, room, kind, round_uid, batch_id, created_at)
             VALUES($1, $2, $3, $4, $5, $6, 'refund', $7, $8, $9)`,
            [Number(id), amt, Number(row.balance), Number(row.balance) - amt, 'Server yenidən başladı — raund ləğv, geri qaytarma', r.room, r.uid, `${r.uid}:recovery`, now()],
          );
        }
        count++;
      });
    }
    if (count) console.log(`${count} yarımçıq raund ləğv edildi, pullar qaytarıldı.`);
    return count;
  }

  // ---- qarşılıqlı nəticələr (qəpiklə) ----
  async pairStats(userId) {
    const rows = await this.db.all(
      `SELECT opp, SUM(won) AS won, SUM(lost) AS lost FROM (
         SELECT from_user AS opp, cents AS won, 0 AS lost FROM round_flows WHERE to_user = $1
         UNION ALL
         SELECT to_user AS opp, 0 AS won, cents AS lost FROM round_flows WHERE from_user = $1
       ) t GROUP BY opp`, [userId]);
    const names = await this.namesFor(rows.map((r) => r.opp));
    return rows.map((r) => ({
      opponentId: Number(r.opp), name: names[r.opp] ?? '?',
      wonCents: Number(r.won), lostCents: Number(r.lost), netCents: Number(r.won) - Number(r.lost),
    })).sort((a, b) => b.netCents - a.netCents);
  }

  async allPairStats() {
    const rows = await this.db.all('SELECT from_user, to_user, SUM(cents) AS cents FROM round_flows GROUP BY from_user, to_user');
    const pairs = new Map();
    for (const r of rows) {
      const a = Math.min(r.from_user, r.to_user), b = Math.max(r.from_user, r.to_user);
      const k = `${a}-${b}`;
      if (!pairs.has(k)) pairs.set(k, { aId: a, bId: b, aWonCents: 0, bWonCents: 0 });
      const p = pairs.get(k);
      if (Number(r.to_user) === a) p.aWonCents += Number(r.cents); else p.bWonCents += Number(r.cents);
    }
    const list = [...pairs.values()];
    const names = await this.namesFor(list.flatMap((p) => [p.aId, p.bId]));
    return list.map((p) => ({ ...p, aName: names[p.aId] ?? '?', bName: names[p.bId] ?? '?', aNetCents: p.aWonCents - p.bWonCents }));
  }

  async namesFor(ids) {
    const uniq = [...new Set(ids.map(Number))];
    const out = {};
    for (const id of uniq) {
      const u = await this.db.get('SELECT display_name FROM users WHERE id = $1', [id]);
      out[id] = u?.display_name;
    }
    return out;
  }

  transactions(userId = null, limit = 200) {
    const base = `SELECT t.*, u.display_name AS user_name, b.display_name AS by_name FROM transactions t
         JOIN users u ON u.id = t.user_id LEFT JOIN users b ON b.id = t.by_user`;
    if (userId) return this.db.all(`${base} WHERE t.user_id = $1 ORDER BY t.id DESC LIMIT $2`, [userId, limit]);
    return this.db.all(`${base} ORDER BY t.id DESC LIMIT $1`, [limit]);
  }
}
