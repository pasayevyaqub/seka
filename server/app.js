// Seka — HTTP API + WebSocket server (testlər üçün createApp kimi ixrac olunur)
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { openDb } from './db.js';
import { Store, UserError, publicUser } from './store.js';
import { RoomManager } from './rooms.js';
import { Finance } from './finance.js';
import { DebtWorker } from './debts.js';
import { GameError } from './game/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../public');
const COOKIE = 'seka_sid';

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* pozuq cookie */ }
    }
  }
  return out;
}

function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 50_000) { reject(new UserError('Sorğu çox böyükdür.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new UserError('Yanlış JSON.')); } });
    req.on('error', reject);
  });
}

const isStaff = (u) => u && u.status === 'approved' && (u.role === 'admin' || u.role === 'moderator');
const isAdmin = (u) => u && u.status === 'approved' && u.role === 'admin';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

// masada borc istəyi: borc verən bu müddətdə cavab verməsə istək avtomatik ləğv olunur
export const LOAN_ASK_MS = 10_000;

export async function createApp({ dbUrl = process.env.DATABASE_URL, dbFile, secure = process.env.NODE_ENV === 'production', botDelay, retryFast, retrySlow, adminUser = process.env.ADMIN_USERNAME || 'admin', adminPass = process.env.ADMIN_PASSWORD || 'admin123', limits = { register: 5, login: 10 }, debtIntervalMs = 30_000, consentMs, loanAskMs = LOAN_ASK_MS } = {}) {
  const db = await openDb({ url: dbUrl, file: dbFile });
  const store = new Store(db);
  await store.ensureAdmin(adminUser, adminPass);
  await store.recoverActiveRounds();
  const rooms = new RoomManager(store, { botDelay, retryFast, retrySlow, consentMs });
  // Səsli danışıq: kim səsə qoşulub (userId → { muted }). Media WebRTC ilə birbaşa gedir, server yalnız siqnalı ötürür.
  const voiceActive = new Map();
  const voiceToRoom = (room, userId, payload) => { for (const id of room.members.keys()) if (id !== userId && id > 0) rooms.send(id, { t: 'voiceState', userId, ...payload }); };
  // otaqdakı aktiv səs iştirakçılarını bir istifadəçiyə göndər (otağa girəndə, səsi açanda, yenidən qoşulanda)
  const voiceSnapshot = (userId) => {
    const room = rooms.roomOfOrNull(userId);
    if (!room) return;
    for (const [id, st] of voiceActive) if (id !== userId && room.members.has(id)) rooms.send(userId, { t: 'voiceState', userId: id, enabled: true, muted: !!st.muted });
  };
  const voiceOff = (userId) => {
    if (!voiceActive.delete(userId)) return;
    const room = rooms.roomOfOrNull(userId);
    if (room) voiceToRoom(room, userId, { enabled: false, muted: false });
  };
  // TURN: 1) Cloudflare Realtime TURN (CF_TURN_KEY_ID + CF_TURN_API_TOKEN) — qısamüddətli parolu server API-dən alır;
  // 2) öz coturn serveri (TURN_URLS + TURN_SHARED_SECRET, "TURN REST" HMAC); 3) heç biri yoxdursa yalnız STUN.
  // Gizli açarlar yalnız serverdə qalır, brauzerə yalnız müddətli istifadəçi adı/parol gedir.
  async function iceFor(userId, roomCode) {
    const stun = [{ urls: 'stun:stun.cloudflare.com:3478' }];
    if (process.env.CF_TURN_KEY_ID && process.env.CF_TURN_API_TOKEN) {
      try {
        const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 5000);
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(process.env.CF_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
          method: 'POST', signal: ctl.signal,
          headers: { Authorization: `Bearer ${process.env.CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 4 * 3600 }),
        }).finally(() => clearTimeout(tm));
        if (r.ok) { const d = await r.json(); if (Array.isArray(d.iceServers)) return { iceServers: d.iceServers, turn: true }; }
        console.error('Cloudflare TURN: parol alınmadı, status', r.status);
      } catch (e) { console.error('Cloudflare TURN: sorğu alınmadı:', e?.name || 'xəta'); }
    }
    const urls = String(process.env.TURN_URLS || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (urls.length && process.env.TURN_SHARED_SECRET) {
      const username = `${Math.floor(Date.now() / 1000) + 4 * 3600}:${userId}:${roomCode}`;
      const credential = crypto.createHmac('sha1', process.env.TURN_SHARED_SECRET).update(username).digest('base64');
      return { iceServers: [...stun, { urls, username, credential }], turn: true };
    }
    return { iceServers: stun, turn: false };
  }
  const finance = new Finance(db);
  const debts = new DebtWorker(finance, rooms, { intervalMs: debtIntervalMs });
  rooms.onBalanceUp = (id) => debts.kick(id);
  debts.scan(); // açılışda vaxtı keçmiş borcları yoxla (server yatıbsa)

  // masa borc istəklərinin 10 saniyəlik cavab müddəti: hər istək üçün bir taymer + açılışda bir dəfə yoxlama
  // (dövri sorğu yoxdur — Neon bazası boş vaxtı yata bilsin)
  const loanTimers = new Set();
  async function expireLoanAsks() {
    try {
      for (const r of await finance.expireLoanRequests()) {
        pushNotify(r);
        for (const id of [r.lenderId, r.borrowerId]) rooms.send(id, { t: 'loanAskDone', id: r.loanId, status: 'expired' });
      }
    } catch (e) { console.error('Borc istəyi müddəti yoxlanmadı:', e?.message || e); }
  }
  expireLoanAsks();

  const sessionCookie = (token, maxAge) =>
    `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

  const hits = new Map();
  // köhnə sürət limiti qeydlərini təmizlə (əks halda Map hər IP/istifadəçi üçün böyüyür — yaddaş artımı)
  const prune = setInterval(() => {
    const t = Date.now();
    for (const [k, arr] of hits) if (!arr.length || t - arr[arr.length - 1] > 10 * 60_000) hits.delete(k);
  }, 5 * 60_000);
  prune.unref?.();
  const startedAt = Date.now();
  let dbCheck = { at: 0, ok: true, ms: 0 };
  // Sağlamlıq yoxlaması: baza 3 saniyəyə cavab verirmi + otaq növbələrinin vəziyyəti. Nəticə 5 san keşlənir.
  async function health() {
    if (Date.now() - dbCheck.at > 5000) {
      const t0 = Date.now();
      let ok = true;
      try { await Promise.race([db.get('SELECT 1 AS x'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]); } catch { ok = false; }
      dbCheck = { at: Date.now(), ok, ms: Date.now() - t0 };
    }
    const mem = process.memoryUsage();
    return {
      ok: dbCheck.ok, db: dbCheck.ok ? 'ok' : 'cavab vermir', dbMs: dbCheck.ms,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000), rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576),
      ...rooms.stats(),
    };
  }
  function rateLimited(ip, key, max = 10, windowMs = 60_000) {
    const k = `${key}:${ip}`; const t = Date.now();
    const arr = (hits.get(k) || []).filter((x) => t - x < windowMs);
    arr.push(t); hits.set(k, arr);
    return arr.length > max;
  }

  function readRaw(req, max) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > max) { reject(new UserError('Fayl 2 MB-dan böyükdür.')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  // maliyyə nəticəsindən sonra: bildirişlər canlı göndərilir (yalnız aidiyyəti oyunçuya)
  const pushNotify = (r) => { for (const n of r?.notify || []) rooms.send(n.userId, { t: 'notify', kind: n.kind, text: n.text }); return r; };
  const toStaff = (msg) => { for (const id of rooms.sockets.keys()) staffIds.has(id) && rooms.send(id, msg); };
  const staffIds = new Set((await db.all(`SELECT id FROM users WHERE role IN ('admin', 'moderator') AND status = 'approved'`)).map((r) => Number(r.id)));
  const azLower = (x) => String(x ?? '').toLocaleLowerCase('az');
  const strip = (r) => { const { changes, notify, ...rest } = r || {}; return rest; };

  async function processAvatar(buf) {
    let sharp;
    try { sharp = (await import('sharp')).default; } catch { throw new UserError('Şəkil emalı serverdə mövcud deyil (sharp paketi quraşdırılmayıb).'); }
    let meta;
    try { meta = await sharp(buf, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata(); } catch { throw new UserError('Fayl həqiqi şəkil deyil və ya zədəlidir.'); }
    if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new UserError('Yalnız JPG, PNG və WebP şəkillər qəbul olunur.');
    // kiçildilir (256×256), EXIF/GPS və digər metadata atılır (sharp standart olaraq metadata yazmır)
    return sharp(buf, { failOn: 'error' }).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
  }

  // market əşyasının şəkli: şəffaflıq qalır, 256×256-ya sığışdırılır, metadata atılır
  async function processItemImage(buf) {
    let sharp;
    try { sharp = (await import('sharp')).default; } catch { throw new UserError('Şəkil emalı serverdə mövcud deyil (sharp paketi quraşdırılmayıb).'); }
    let meta;
    try { meta = await sharp(buf, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata(); } catch { throw new UserError('Fayl həqiqi şəkil deyil və ya zədəlidir.'); }
    if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new UserError('Yalnız JPG, PNG və WebP şəkillər qəbul olunur.');
    return sharp(buf, { failOn: 'error' }).rotate().resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 82 }).toBuffer();
  }
  const lastItemUse = new Map();

  async function api(req, res, url) {
    const cookies = parseCookies(req.headers.cookie);
    const me = await store.userByToken(cookies[COOKIE]);
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    const p = url.pathname;
    const m = req.method;

    // Açıq qeydiyyat BAĞLIDIR (hər iki giriş rejimində). Hesabları yalnız admin yaradır: POST /api/admin/users
    if (p === '/api/register') return json(res, 403, { error: 'Qeydiyyat bağlıdır. Hesabı admin yaradır — istifadəçi adı və şifrəni admindən alın.' });
    if (p === '/api/login' && m === 'POST') {
      if (rateLimited(ip, 'login', limits.login)) throw new UserError('Çox cəhd. Bir az gözləyin.');
      const b = await readBody(req);
      const { token, user } = await store.login(b.username, b.password);
      // "Oyunçu girişi bağlı": adi oyunçuların YENİ girişi dayanır; admin/moderator həmişə daxil olur.
      // Artıq daxil olmuş oyunçuların sessiyalarına toxunulmur.
      if (user.role === 'player' && !(await finance.playerLoginOpen())) {
        await store.logout(token);
        throw new UserError('Oyunçu girişi hazırda bağlıdır. Admin açanda yenidən cəhd edin.');
      }
      return json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token, 60 * 60 * 24 * 30) });
    }
    if (p === '/api/login-status' && m === 'GET') return json(res, 200, { playerLoginOpen: await finance.playerLoginOpen(), registration: false });
    if (p === '/api/logout' && m === 'POST') {
      if (cookies[COOKIE]) await store.logout(cookies[COOKIE]);
      return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }
    if (p === '/api/me' && m === 'GET') return json(res, 200, { user: publicUser(me) });

    if (!me) return json(res, 401, { error: 'Daxil olun.' });

    // hesab ayarları: ad, telefon, şifrə — mövcud şifrə ilə
    if (p === '/api/me/account' && m === 'POST') {
      if (rateLimited(me.id, 'account', 8, 10 * 60_000)) throw new UserError('Çox cəhd. 10 dəqiqə sonra yenidən yoxlayın.');
      const b = await readBody(req);
      const r = await store.updateOwnAccount(me.id, b, cookies[COOKIE]);
      const pu = publicUser(r.user);
      if (r.changed.includes('ad')) rooms.userUpdated(pu); else rooms.send(me.id, { t: 'user', user: pu });
      return json(res, 200, { ok: true, changed: r.changed, user: pu, smsVerification: false });
    }
    if (p === '/api/password' && m === 'POST') {
      const b = await readBody(req);
      await store.changeOwnPassword(me.id, b.oldPassword, b.newPassword);
      return json(res, 200, { ok: true });
    }

    const av = p.match(/^\/api\/avatar\/(\d+)$/);
    if (av && m === 'GET') {
      const img = await store.getAvatar(Number(av[1]));
      if (!img) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
      return res.end(img);
    }

    const si = p.match(/^\/api\/shop\/img\/([a-z0-9_-]{1,40})$/);
    if (si && m === 'GET') {
      const img = await finance.getShopImage(si[1]);
      if (!img) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
      return res.end(img);
    }

    if (me.status !== 'approved') return json(res, 403, { error: 'Hesabınız aktiv deyil.' });

    // ---- market: yalnız virtual xal, real ödəniş/sifariş/pul çıxarışı YOXDUR ----
    if (p === '/api/shop' && m === 'GET') {
      return json(res, 200, { items: await finance.shopItems(true), collection: await finance.collection(me.id), balance: (await store.getUser(me.id)).balance });
    }
    if (p === '/api/shop/buy' && m === 'POST') {
      if (rateLimited(me.id, 'shopbuy', 20)) throw new UserError('Çox sorğu. Bir az gözləyin.');
      const b = await readBody(req);
      // qiymət klientdən QƏBUL EDİLMİR — server bazadakı qiyməti götürür; açar təkrar emalın qarşısını alır
      const r = await rooms.moneyOp(me.id, () => finance.buyItem(me.id, b.itemId, b.key));
      return json(res, 200, { ...strip(r), collection: await finance.collection(me.id) });
    }
    if (p === '/api/shop/use' && m === 'POST') {
      const b = await readBody(req);
      const t = Date.now();
      if (t - (lastItemUse.get(me.id) || 0) < 3000) throw new UserError('Əşyanı 3 saniyədə bir istifadə etmək olar.');
      const r = await finance.useItem(me.id, b.itemId);
      lastItemUse.set(me.id, t);
      const room = rooms.roomOfOrNull(me.id);
      const ev = { userId: me.id, itemId: r.itemId, name: r.name, imageVer: r.imageVer };
      if (room && room.members.has(me.id)) rooms.itemEvent(room, ev); else rooms.send(me.id, { t: 'itemUse', ...ev, at: t });
      return json(res, 200, { ok: true, ...r, inRoom: !!room });
    }

    if (p === '/api/voice/ice' && m === 'GET') {
      const room = rooms.roomOfOrNull(me.id);
      if (!room || !room.members.has(me.id)) return json(res, 403, { error: 'Əvvəl otağa qoşulun.' });
      if (rateLimited(me.id, 'voiceice', 20)) throw new UserError('Çox sorğu. Bir az gözləyin.');
      return json(res, 200, await iceFor(me.id, room.code));
    }

    if (p === '/api/me/avatar' && m === 'POST') {
      if (rateLimited(me.id, 'avatar', 10)) throw new UserError('Çox cəhd. Bir az gözləyin.');
      const raw = await readRaw(req, 2 * 1024 * 1024);
      if (!raw.length) throw new UserError('Şəkil seçin.');
      const ver = await store.setAvatar(me.id, await processAvatar(raw));
      rooms.userUpdated(publicUser(await store.getUser(me.id)));
      return json(res, 200, { avatarVer: ver });
    }
    if (p === '/api/me/avatar' && m === 'DELETE') {
      const ver = await store.deleteAvatar(me.id);
      rooms.userUpdated(publicUser(await store.getUser(me.id)));
      return json(res, 200, { avatarVer: ver, removed: true });
    }

    if (p === '/api/rooms' && m === 'GET') return json(res, 200, { rooms: rooms.publicList() });
    if (p === '/api/my-transactions' && m === 'GET') return json(res, 200, { items: await store.transactions(me.id, 100) });
    if (p === '/api/my-stats' && m === 'GET') return json(res, 200, { items: await store.pairStats(me.id) });
    if (p === '/api/profile' && m === 'GET') {
      const prof = await finance.profile(me.id);
      return json(res, 200, { ...prof, stats: await store.pairStats(me.id), rank: await store.playerStats(me.id), collection: await finance.collection(me.id), user: publicUser(await store.getUser(me.id)) });
    }
    if (p === '/api/loans/pending' && m === 'GET') return json(res, 200, { loans: await finance.pendingLoans(me.id) });
    if (p === '/api/notifications' && m === 'GET') return json(res, 200, { items: await finance.notifications(me.id) });
    if (p === '/api/notifications/read' && m === 'POST') { await finance.markNotificationsRead(me.id); return json(res, 200, { ok: true }); }

    // alıcı axtarışı (hədiyyə/borc üçün): yalnız aktiv insan hesabları, özü xaric
    if (p === '/api/users/search' && m === 'GET') {
      const qx = azLower(url.searchParams.get('q')).trim();
      if (qx.length < 1) return json(res, 200, { users: [] });
      const all = await store.listUsers();
      const users = all.filter((u) => u.status === 'approved' && u.id !== me.id && (azLower(u.display_name).includes(qx) || azLower(u.username).includes(qx)))
        .slice(0, 20).map((u) => ({ id: u.id, displayName: u.display_name, username: u.username, avatarVer: Number(u.avatar_ver || 0) }));
      return json(res, 200, { users });
    }

    // ---- masa hədiyyələri ----
    if (p === '/api/table-gifts' && m === 'GET') {
      return json(res, 200, { gifts: await finance.giftTypes(db, true), sharePct: await finance.giftSharePct() });
    }
    if (p === '/api/table-gift' && m === 'POST') {
      if (rateLimited(me.id, 'tgift', 20)) throw new UserError('Çox sorğu. Bir az gözləyin.');
      const b = await readBody(req);
      const toId = Number(b.toId);
      const anyRoom = rooms.roomOfOrNull(me.id);
      if (!anyRoom) throw new UserError('Hədiyyə yalnız masada, eyni otaqdakı oyunçuya göndərilir.');
      if (rooms.isPractice(anyRoom)) throw new UserError('Demo və botlu (məşq) otaqlarda hədiyyə göndərmək olmaz.');
      if (toId === me.id) throw new UserError('Özünüzə hədiyyə göndərə bilməzsiniz.');
      if (!(toId > 0)) throw new UserError('Botlara hədiyyə göndərmək olmaz.');
      // pul göndərənin otaq növbəsində: aktiv raundun yaddaş balansı ilə ardıcıl və uyğun
      const r = await rooms.moneyOp(me.id, async () => {
        const room = rooms.realRoomOf(me.id);
        if (!room || room !== anyRoom) throw new UserError('Otaq dəyişdi, yenidən cəhd edin.');
        if (!room.members.has(toId)) throw new UserError('Alıcı bu masada deyil.');
        return finance.sendTableGift(me.id, toId, b.giftId, room.code, b.key);
      });
      // animasiya yalnız ilk (uğurlu) icrada — təkrar açarla gələn sorğu yenidən oynatmır
      if (!r.duplicate) {
        const room = rooms.realRoomOf(me.id);
        if (room) rooms.giftEvent(room, { id: r.giftLogId, giftId: r.giftId, giftName: r.giftName, fromId: r.fromId, fromName: r.fromName, toId: r.toId, toName: r.toName, credited: r.credited });
      }
      pushNotify(r);
      const { payments, ...rest } = strip(r);
      return json(res, 200, rest);
    }

    // ---- oyunçunun maliyyə əməliyyatları ----
    if (p.startsWith('/api/credit/') || p === '/api/gift' || p.startsWith('/api/loans/')) {
      if (m !== 'POST') return json(res, 405, { error: 'POST gözlənilir.' });
      if (rateLimited(me.id, 'fin', 30)) throw new UserError('Çox sorğu. Bir az gözləyin.');
      const b = await readBody(req);
      let r;
      if (p === '/api/credit/request') {
        r = await finance.requestCredit(me.id, b.amount, b.note, b.key);
        if (!r.duplicate) toStaff({ t: 'staff', kind: 'credit', text: `${me.display_name} ${r.amount} xal kredit istəyir.` });
      } else if (p === '/api/credit/cancel') r = await finance.cancelCreditRequest(me.id, Number(b.requestId), b.key);
      else if (p === '/api/credit/repay') r = await rooms.moneyOp(me.id, () => finance.repayCredit(me.id, b.amount, b.key));
      else if (p === '/api/gift') r = await rooms.moneyOp(me.id, () => finance.giftPlayer(me.id, Number(b.toId), b.amount, b.note, b.key));
      else if (p === '/api/loans/offer') r = await finance.offerLoan(me.id, Number(b.borrowerId), b.amount, Number(b.dueAt), b.note, b.key);
      else if (p === '/api/loans/request') {
        // eyni masadakı oyunçudan istək: ekranda kiçik bildiriş, 10 san cavab vaxtı
        const myRoom = rooms.roomOfOrNull(me.id);
        const atTable = !!myRoom && myRoom.members.has(Number(b.lenderId)) && myRoom === rooms.roomOfOrNull(Number(b.lenderId));
        r = await finance.requestLoan(me.id, Number(b.lenderId), b.amount, Number(b.dueAt), b.note, b.key, Date.now(), atTable ? loanAskMs : null);
        if (atTable && !r.duplicate) {
          rooms.send(Number(b.lenderId), { t: 'loanAsk', id: r.loanId, borrowerId: me.id, borrowerName: r.borrowerName, lenderName: r.lenderName, amount: r.amount, dueAt: r.dueAt, respondBy: r.respondBy });
          const tm = setTimeout(() => { loanTimers.delete(tm); expireLoanAsks(); }, loanAskMs + 300);
          tm.unref?.(); loanTimers.add(tm);
        }
      }
      else {
        const lm = p.match(/^\/api\/loans\/(\d+)\/(accept|decline|cancel|repay|approve|reject|withdraw)$/);
        if (!lm) return json(res, 404, { error: 'Tapılmadı.' });
        const loanId = Number(lm[1]);
        if (lm[2] === 'approve' || lm[2] === 'reject') {
          try {
            r = lm[2] === 'approve'
              ? await rooms.moneyOp(me.id, () => finance.approveLoanRequest(me.id, loanId, b.key)) // pul borc verəndən çıxır
              : await finance.rejectLoanRequest(me.id, loanId, b.key);
          } catch (e) { if (/Cavab vaxtı bitib/.test(e.message)) expireLoanAsks(); throw e; }
          // bildiriş kartı borc verənin bütün cihazlarında və borc istəyəndə dərhal bağlansın
          const st = lm[2] === 'approve' ? 'accepted' : 'rejected';
          rooms.send(me.id, { t: 'loanAskDone', id: loanId, status: st });
          if (r.borrowerId) rooms.send(r.borrowerId, { t: 'loanAskDone', id: loanId, status: st });
        }
        else if (lm[2] === 'withdraw') r = await finance.withdrawLoanRequest(me.id, loanId, b.key);
        else if (lm[2] === 'accept') {
          const loan = await db.get('SELECT lender_id FROM loans WHERE id = $1', [loanId]);
          if (!loan) throw new UserError('Təklif tapılmadı.');
          // pul borc verənin balansından çıxır → onun otaq növbəsində
          r = await rooms.moneyOp(Number(loan.lender_id), () => finance.acceptLoan(me.id, loanId, b.key));
        } else if (lm[2] === 'decline') r = await finance.declineLoan(me.id, loanId, b.key);
        else if (lm[2] === 'cancel') r = await finance.cancelLoan(me.id, loanId, b.key);
        else r = await rooms.moneyOp(me.id, () => finance.repayLoan(me.id, loanId, b.amount, b.key));
      }
      pushNotify(r);
      return json(res, 200, strip(r));
    }

    // ---- admin / moderator ----
    if (!p.startsWith('/api/admin/')) return json(res, 404, { error: 'Tapılmadı.' });
    if (!isStaff(me)) return json(res, 403, { error: 'İcazə yoxdur.' });

    if (p === '/api/admin/users' && m === 'GET') return json(res, 200, { users: (await store.listUsers()).map(publicUser) });
    if (p === '/api/admin/transactions' && m === 'GET') {
      const uid = Number(url.searchParams.get('userId')) || null;
      return json(res, 200, { items: await store.transactions(uid, 300) });
    }
    if (p === '/api/admin/stats' && m === 'GET') return json(res, 200, { pairs: await store.allPairStats() });
    if (p === '/api/admin/credit' && m === 'GET') return json(res, 200, await finance.adminCreditOverview());
    if (p === '/api/admin/loans' && m === 'GET') return json(res, 200, { loans: await finance.adminLoans() });
    if (p === '/api/admin/gifts' && m === 'GET') return json(res, 200, { items: await finance.adminGiftHistory() });
    if (p === '/api/admin/settings' && m === 'GET') return json(res, 200, { signupBonus: await finance.signupBonus(), playerLoginOpen: await finance.playerLoginOpen() });
    // adminin oyunçu yaratması: görünən ad, unikal istifadəçi adı, ilkin şifrə; başlanğıc bonusu bir dəfə (mövcud ayarla)
    if (p === '/api/admin/users' && m === 'POST') {
      if (!isAdmin(me)) throw new UserError('Oyunçunu yalnız admin yarada bilər.');
      const b = await readBody(req);
      const r = await store.register({ username: b.username, displayName: b.displayName, password: b.password }, finance);
      return json(res, 200, { ok: true, id: r.id, bonus: r.bonus, user: publicUser(await store.getUser(r.id)) });
    }
    if (p === '/api/admin/login-switch' && m === 'POST') {
      if (!isAdmin(me)) throw new UserError('Girişi yalnız admin aça/bağlaya bilər.');
      const b = await readBody(req);
      return json(res, 200, { playerLoginOpen: await finance.setPlayerLoginOpen(!!b.open) });
    }
    // ---- toplu balans əməliyyatları (yalnız admin) ----
    if (p === '/api/admin/bulk/preview' && m === 'GET') {
      if (!isAdmin(me)) throw new UserError('Bu əməliyyatı yalnız admin edə bilər.');
      const pv = await finance.bulkPreview(url.searchParams.get('op'), url.searchParams.get('amount'));
      return json(res, 200, { ...pv, activeRounds: rooms.anyActiveRealRound() });
    }
    if (p === '/api/admin/bulk' && m === 'POST') {
      if (!isAdmin(me)) throw new UserError('Bu əməliyyatı yalnız admin edə bilər.');
      const b = await readBody(req);
      if (b.confirm !== true) throw new UserError('İkinci təsdiq tələb olunur.');
      // gedən raundların yaddaşdakı balansı pozulmasın: əvvəl raundlar bitməlidir
      if (rooms.anyActiveRealRound()) throw new UserError('Hazırda real otaqlarda raund gedir. Raundlar bitəndən sonra yenidən cəhd edin.');
      // əməliyyat müddətində yeni real raund başlamasın (raund balansları bazadan oxunur)
      rooms.bulkBusy = true;
      let r;
      try { r = await finance.adminBulk(me.id, b.op, b.amount, b.expectCount, b.key); } finally { rooms.bulkBusy = false; }
      rooms.syncChanges(r.changes, null);
      pushNotify(r);
      return json(res, 200, strip(r));
    }
    if (p === '/api/admin/log' && m === 'GET') {
      if (!isAdmin(me)) throw new UserError('Qeydiyyatı yalnız admin görə bilər.');
      return json(res, 200, { items: await finance.adminLog() });
    }
    // ---- market idarəsi (yalnız admin): ad, qiymət, satışda/deyil, şəkil ----
    if (p === '/api/admin/shop' && m === 'GET') {
      if (!isAdmin(me)) throw new UserError('Marketi yalnız admin idarə edə bilər.');
      return json(res, 200, { items: await finance.shopItems(false), stats: await finance.shopStats() });
    }
    const sm = p.match(/^\/api\/admin\/shop\/([a-z0-9_-]{1,40})(\/image)?$/);
    if (sm) {
      if (!isAdmin(me)) throw new UserError('Marketi yalnız admin idarə edə bilər.');
      if (!sm[2] && m === 'POST') {
        const b = await readBody(req);
        const item = await finance.setShopItem(sm[1], { name: b.name, price: b.price, active: b.active });
        return json(res, 200, { item });
      }
      if (sm[2] && m === 'POST') {
        const raw = await readRaw(req, 3 * 1024 * 1024);
        if (!raw.length) throw new UserError('Şəkil seçin.');
        const imageVer = await finance.setShopImage(sm[1], await processItemImage(raw));
        return json(res, 200, { imageVer });
      }
      if (sm[2] && m === 'DELETE') return json(res, 200, { imageVer: await finance.setShopImage(sm[1], null), removed: true });
    }
    if (p === '/api/admin/table-gifts' && m === 'GET') {
      return json(res, 200, { items: await finance.adminTableGifts(), gifts: await finance.giftTypes(), sharePct: await finance.giftSharePct() });
    }
    if (p === '/api/admin/table-gifts/settings' && m === 'POST') {
      if (!isAdmin(me)) throw new UserError('Hədiyyə ayarlarını yalnız admin dəyişə bilər.');
      const b = await readBody(req);
      return json(res, 200, await finance.setGiftSettings({ sharePct: b.sharePct, gifts: b.gifts }));
    }
    if (p === '/api/admin/settings' && m === 'POST') {
      if (!isAdmin(me)) throw new UserError('Ayarları yalnız admin dəyişə bilər.');
      const b = await readBody(req);
      return json(res, 200, { signupBonus: await finance.setSignupBonus(b.signupBonus) });
    }

    const cm = p.match(/^\/api\/admin\/credit\/(\d+)\/(approve|reject)$/);
    if (cm && m === 'POST') {
      const b = await readBody(req);
      const r = cm[2] === 'approve'
        ? await finance.approveCredit(me.id, Number(cm[1]), b.amount, b.newLimit, b.note, b.key)
        : await finance.rejectCredit(me.id, Number(cm[1]), b.note, b.key);
      rooms.syncChanges(r.changes, null);
      pushNotify(r);
      return json(res, 200, strip(r));
    }

    const mm = p.match(/^\/api\/admin\/users\/(\d+)\/(status|balance|name|role|password|reset-negative|gift|credit-limit)$/);
    if (mm && m === 'POST') {
      const targetId = Number(mm[1]);
      const action = mm[2];
      const target = await store.getUser(targetId);
      if (!target) throw new UserError('İstifadəçi tapılmadı.');
      if (me.role !== 'admin' && (target.role === 'admin' || target.role === 'moderator') && target.id !== me.id)
        throw new UserError('Moderator admin və moderatorları dəyişə bilməz.');
      const b = await readBody(req);

      if (action === 'status') {
        if (target.id === me.id) throw new UserError('Öz statusunuzu dəyişə bilməzsiniz.');
        if (b.status !== 'approved' && target.role === 'admin' && (await store.activeAdminCount()) <= 1) throw new UserError('Son aktiv admini bloklamaq olmaz.');
        await store.setStatus(targetId, b.status);
        if (b.status === 'approved') rooms.userUpdated(publicUser(await store.getUser(targetId)));
        else { rooms.leave(targetId); rooms.disconnectUser(targetId); }
      } else if (action === 'balance') {
        // "Əlavə et / Çıx": məbləğ həmişə müsbət yazılır; çıxma balansı 0-dan aşağı salmır
        const run = () => finance.adminAdjust(me.id, targetId, b.op, b.amount, b.note, b.key);
        const r = b.op === 'sub' ? await rooms.moneyOp(targetId, run) : await run();
        if (b.op !== 'sub') rooms.syncChanges(r.changes, null);
      } else if (action === 'gift') {
        const r = await finance.adminGift(me.id, targetId, b.amount, b.note, b.key);
        rooms.syncChanges(r.changes, null);
        pushNotify(r);
      } else if (action === 'credit-limit') {
        pushNotify(await finance.setCreditLimit(me.id, targetId, b.limit, b.key));
      } else if (action === 'reset-negative') {
        if (!isAdmin(me)) throw new UserError('Mənfi balansı yalnız admin sıfırlaya bilər.');
        if (b.confirm !== true) throw new UserError('Təsdiq tələb olunur.');
        if (rooms.inActiveRealRound(targetId)) throw new UserError('Oyunçu hazırda raunddadır. Raund bitəndən sonra sıfırlayın.');
        const r = await store.resetNegative(targetId, me.id);
        rooms.syncChanges([{ userId: targetId, delta: r.delta, balance: r.balance }], null);
      } else if (action === 'name') {
        await store.setDisplayName(targetId, b.displayName);
        rooms.userUpdated(publicUser(await store.getUser(targetId)));
      } else if (action === 'role') {
        if (!isAdmin(me)) throw new UserError('Rolları yalnız admin dəyişə bilər.');
        if (target.id === me.id) throw new UserError('Öz rolunuzu dəyişə bilməzsiniz.');
        if (target.role === 'admin' && b.role !== 'admin' && (await store.activeAdminCount()) <= 1) throw new UserError('Son aktiv adminin səlahiyyətini silmək olmaz.');
        await store.setRole(targetId, b.role);
        if (b.role === 'player') staffIds.delete(targetId); else staffIds.add(targetId);
        rooms.userUpdated(publicUser(await store.getUser(targetId)));
      } else if (action === 'password') {
        await store.setPassword(targetId, b.password);
        // admin şifrəni dəyişəndə həmin hesabın köhnə sessiyaları etibarsız olur
        await store.dropSessions(targetId);
        rooms.disconnectUser(targetId);
      }
      return json(res, 200, { user: publicUser(await store.getUser(targetId)) });
    }
    return json(res, 404, { error: 'Tapılmadı.' });
  }

  function serveStatic(req, res, url) {
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
    let file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (url.pathname === '/health') { const h = await health(); return json(res, h.ok ? 200 : 503, h); }
      serveStatic(req, res, url);
    } catch (e) {
      if (e instanceof UserError || e instanceof GameError) return json(res, 400, { error: e.message });
      console.error(e);
      json(res, 500, { error: 'Server xətası.' });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16_384 });

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws') return socket.destroy();
    const user = await store.userByToken(parseCookies(req.headers.cookie)[COOKIE]).catch(() => null);
    if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, user));
  });

  function onConnection(ws, user) {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    rooms.attach(user, ws);
    ws.send(JSON.stringify({ t: 'hello', user: publicUser(user), roomCode: rooms.userRoom.get(user.id) || null }));
    voiceSnapshot(user.id);

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      // ürək döyüntüsü bazaya müraciət etmir (baza ləngisə də bağlantının sağ olduğu bilinsin)
      if (msg.t === 'ping') { try { ws.send('{"t":"pong"}'); } catch { /* bağlanıb */ } return; }
      try {
        // istifadəçini hər dəfə yeniləyirik (blok, təsdiq, ad dəyişikliyi)
        const u = await store.getUser(user.id);
        if (!u || (u.status !== 'approved' && u.status !== 'pending')) { ws.close(4001, 'blocked'); return; }
        switch (msg.t) {
          case 'createRoom': rooms.create(u, msg); break;
          case 'emoji': rooms.emoji(u.id, msg.e); break;
          case 'chat': rooms.chat(u.id, msg.text); break;
          case 'joinRoom': {
            const before = rooms.roomOfOrNull(u.id);
            if (before && before.code !== String(msg.code || '').trim().toUpperCase()) voiceOff(u.id);
            rooms.join(u, msg.code, msg.password);
            voiceSnapshot(u.id); // yeni otaqda kimin səsdə olduğu (🎙 nişanları)
            break;
          }
          case 'leaveRoom': voiceOff(u.id); rooms.leave(u.id); break;
          case 'startRound': await rooms.startRound(u.id); break;
          case 'consent': await rooms.consentAnswer(u.id, msg.yes === true); break;
          case 'settings': rooms.updateSettings(u.id, msg.settings); break;
          case 'roomMeta': rooms.updateMeta(u.id, msg.meta); break;
          case 'addBot': rooms.addBot(u.id); break;
          case 'removeBot': rooms.removeBot(u.id, Number(msg.botId)); break;
          case 'kick': rooms.kick(u.id, Number(msg.userId)); break;
          case 'act': await rooms.act(u.id, msg.action || {}); break;
          case 'look': await rooms.look(u.id); break;
          case 'voiceState': {
            const room = rooms.roomOfOrNull(u.id);
            if (msg.enabled !== true || !room || !room.members.has(u.id)) { voiceOff(u.id); break; }
            const muted = msg.muted === true;
            const fresh = !voiceActive.has(u.id) || msg.restart === true;
            voiceActive.set(u.id, { muted });
            // restart: klient yenidən qoşulub və ya səsi yenidən açıb — digərləri köhnə bağlantını bağlayıb yenisini qurur
            voiceToRoom(room, u.id, { enabled: true, muted, restart: fresh });
            if (fresh) voiceSnapshot(u.id);
            break;
          }
          case 'voiceSignal': {
            const room = rooms.roomOfOrNull(u.id);
            const target = Number(msg.to);
            if (!room || !room.members.has(u.id) || !room.members.has(target) || target <= 0 || !voiceActive.has(u.id) || !voiceActive.has(target)) break;
            if (!msg.signal || typeof msg.signal !== 'object' || Array.isArray(msg.signal) || JSON.stringify(msg.signal).length > 12_000) break;
            rooms.send(target, { t: 'voiceSignal', fromId: u.id, signal: msg.signal });
            break;
          }
          default: break;
        }
      } catch (e) {
        if (e instanceof GameError || e instanceof UserError) rooms.send(user.id, { t: 'error', msg: e.message, code: e.code, roomCode: msg.code });
        else { console.error(e); rooms.sendError(user.id, 'Server xətası.'); }
      }
    });
    ws.on('close', () => {
      rooms.detach(user, ws);
      // istifadəçinin başqa açıq bağlantısı (məs. ikinci vərəq) qalmayıbsa səsdən çıxarılır; qayıdanda klient özü yenidən elan edir
      if (!rooms.sockets.has(user.id)) voiceOff(user.id);
    });
  }

  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false; ws.ping();
    }
  }, 15_000); // ölü bağlantılar ən gec ~30 saniyəyə aşkarlanır → oyunçunun statusu qırmızı olur
  ping.unref?.();

  return {
    server, store, rooms, db, finance, debts,
    listen: (port) => new Promise((resolve) => server.listen(port, () => resolve(server.address().port))),
    // Server dayanarkən: yeni bağlantı qəbul etmə, gözləyən paketləri yazmağa çalış
    async shutdown(timeoutMs = 8000) {
      const left = await rooms.flushAll(timeoutMs);
      if (left) console.error(`${left} otaqda yazılmamış paket qaldı — növbəti başlanğıcda həmin raundlar ləğv edilib pul qaytarılacaq.`);
      await this.close();
    },
    async close() {
      clearInterval(ping);
      clearInterval(prune);
      for (const tm of loanTimers) clearTimeout(tm);
      debts.stop();
      rooms.stop();
      for (const ws of wss.clients) ws.terminate();
      await new Promise((r) => server.close(() => r()));
      await db.close();
    },
  };
}
