// İstifadəçilər, sessiyalar və balans əməliyyatları
import crypto from 'node:crypto';

export class UserError extends Error {}

const now = () => Date.now();

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}

export const publicUser = (u) => u && ({
  id: u.id, username: u.username, displayName: u.display_name, phone: u.phone,
  role: u.role, status: u.status, balance: u.balance, createdAt: u.created_at,
});

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

  async register({ username, displayName, password, phone }) {
    username = String(username || '').trim().toLowerCase();
    displayName = String(displayName || '').trim().replace(/\s+/g, ' ');
    phone = String(phone || '').trim().slice(0, 30) || null;
    if (!USERNAME_RE.test(username)) throw new UserError('İstifadəçi adı 3–20 simvol olmalıdır (kiçik latın hərfləri, rəqəm, _ və .).');
    if (displayName.length < 2 || displayName.length > 20) throw new UserError('Göstəriləcək ad 2–20 simvol olmalıdır.');
    if (String(password || '').length < 6) throw new UserError('Şifrə ən azı 6 simvol olmalıdır.');
    if (await this.db.get('SELECT id FROM users WHERE username = $1', [username])) throw new UserError('Bu istifadəçi adı artıq mövcuddur.');
    if (await this.db.get('SELECT id FROM users WHERE display_key = $1', [displayName.toLowerCase()])) throw new UserError('Bu ad artıq istifadə olunur.');
    await this.db.run(
      `INSERT INTO users(username, display_name, display_key, phone, pass_hash, created_at) VALUES($1, $2, $3, $4, $5, $6)`,
      [username, displayName, displayName.toLowerCase(), phone, hashPassword(password), now()],
    );
  }

  async login(username, password) {
    const u = await this.db.get('SELECT * FROM users WHERE username = $1', [String(username || '').trim().toLowerCase()]);
    if (!u || !checkPassword(String(password || ''), u.pass_hash)) throw new UserError('İstifadəçi adı və ya şifrə yanlışdır.');
    if (u.status === 'pending') throw new UserError('Hesabınız admin təsdiqini gözləyir.');
    if (u.status === 'rejected') throw new UserError('Qeydiyyatınız rədd edilib.');
    if (u.status === 'blocked') throw new UserError('Hesabınız bloklanıb.');
    const token = crypto.randomBytes(32).toString('hex');
    await this.db.run('INSERT INTO sessions(token, user_id, created_at) VALUES($1, $2, $3)', [token, u.id, now()]);
    return { token, user: u };
  }

  async logout(token) { await this.db.run('DELETE FROM sessions WHERE token = $1', [token]); }

  async userByToken(token) {
    if (!token) return null;
    const s = await this.db.get('SELECT user_id FROM sessions WHERE token = $1', [token]);
    if (!s) return null;
    const u = await this.getUser(s.user_id);
    if (!u || u.status !== 'approved') return null;
    return u;
  }

  getUser(id) { return this.db.get('SELECT * FROM users WHERE id = $1', [id]); }

  listUsers() { return this.db.all('SELECT * FROM users ORDER BY (status = \'pending\') DESC, id DESC'); }

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

  // Balans dəyişikliyi + jurnal. Yeni balansı qaytarır.
  async addBalance(userId, delta, reason, byUser = null, room = null) {
    delta = Math.trunc(delta);
    const row = await this.db.get('UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance', [delta, userId]);
    if (!row) throw new UserError('İstifadəçi tapılmadı.');
    await this.db.run(
      'INSERT INTO transactions(user_id, delta, balance_after, reason, by_user, room, created_at) VALUES($1, $2, $3, $4, $5, $6, $7)',
      [userId, delta, row.balance, reason, byUser, room, now()],
    );
    return row.balance;
  }

  transactions(userId = null, limit = 200) {
    if (userId) {
      return this.db.all(
        `SELECT t.*, u.display_name AS user_name, b.display_name AS by_name FROM transactions t
         JOIN users u ON u.id = t.user_id LEFT JOIN users b ON b.id = t.by_user
         WHERE t.user_id = $1 ORDER BY t.id DESC LIMIT $2`, [userId, limit]);
    }
    return this.db.all(
      `SELECT t.*, u.display_name AS user_name, b.display_name AS by_name FROM transactions t
       JOIN users u ON u.id = t.user_id LEFT JOIN users b ON b.id = t.by_user
       ORDER BY t.id DESC LIMIT $1`, [limit]);
  }
}
