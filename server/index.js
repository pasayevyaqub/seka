// Seka — HTTP API + WebSocket server
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { openDb } from './db.js';
import { Store, UserError, publicUser } from './store.js';
import { RoomManager } from './rooms.js';
import { GameError } from './game/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../public');
const PORT = Number(process.env.PORT) || 3000;
const COOKIE = 'seka_sid';
const SECURE = process.env.NODE_ENV === 'production';

const db = await openDb();
const store = new Store(db);
await store.ensureAdmin(process.env.ADMIN_USERNAME || 'admin', process.env.ADMIN_PASSWORD || 'admin123');
const rooms = new RoomManager(store);

// ---------- köməkçilər ----------
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
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

const sessionCookie = (token, maxAge) =>
  `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${SECURE ? '; Secure' : ''}`;

// Sadə sürət limiti (login/qeydiyyat üçün)
const hits = new Map();
function rateLimited(ip, key, max = 10, windowMs = 60_000) {
  const k = `${key}:${ip}`; const t = Date.now();
  const arr = (hits.get(k) || []).filter((x) => t - x < windowMs);
  arr.push(t); hits.set(k, arr);
  return arr.length > max;
}

const isStaff = (u) => u && (u.role === 'admin' || u.role === 'moderator');

// ---------- API ----------
async function api(req, res, url) {
  const cookies = parseCookies(req.headers.cookie);
  const me = await store.userByToken(cookies[COOKIE]);
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/register' && m === 'POST') {
    if (rateLimited(ip, 'reg', 5)) throw new UserError('Çox cəhd. Bir az gözləyin.');
    await store.register(await readBody(req));
    return json(res, 200, { ok: true, msg: 'Qeydiyyat tamamlandı. Admin təsdiq etdikdən sonra daxil ola bilərsiniz.' });
  }
  if (p === '/api/login' && m === 'POST') {
    if (rateLimited(ip, 'login', 10)) throw new UserError('Çox cəhd. Bir az gözləyin.');
    const b = await readBody(req);
    const { token, user } = await store.login(b.username, b.password);
    return json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token, 60 * 60 * 24 * 30) });
  }
  if (p === '/api/logout' && m === 'POST') {
    if (cookies[COOKIE]) await store.logout(cookies[COOKIE]);
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (p === '/api/me' && m === 'GET') {
    return json(res, 200, { user: publicUser(me) });
  }

  if (!me) return json(res, 401, { error: 'Daxil olun.' });

  if (p === '/api/password' && m === 'POST') {
    const b = await readBody(req);
    await store.changeOwnPassword(me.id, b.oldPassword, b.newPassword);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/my-transactions' && m === 'GET') {
    return json(res, 200, { items: await store.transactions(me.id, 100) });
  }

  // ---- admin / moderator ----
  if (!p.startsWith('/api/admin/')) return json(res, 404, { error: 'Tapılmadı.' });
  if (!isStaff(me)) return json(res, 403, { error: 'İcazə yoxdur.' });

  if (p === '/api/admin/users' && m === 'GET') {
    const users = await store.listUsers();
    return json(res, 200, { users: users.map(publicUser) });
  }
  if (p === '/api/admin/transactions' && m === 'GET') {
    const uid = Number(url.searchParams.get('userId')) || null;
    return json(res, 200, { items: await store.transactions(uid, 300) });
  }

  const mm = p.match(/^\/api\/admin\/users\/(\d+)\/(status|balance|name|role|password)$/);
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
      await store.setStatus(targetId, b.status);
      if (b.status !== 'approved') { rooms.leave(targetId); rooms.disconnectUser(targetId); }
    } else if (action === 'balance') {
      const amount = Math.trunc(Number(b.amount));
      if (!Number.isFinite(amount) || amount === 0) throw new UserError('Məbləğ düzgün deyil.');
      const note = String(b.note || '').slice(0, 100);
      const bal = await store.addBalance(targetId, amount, `Admin: ${amount > 0 ? 'əlavə' : 'çıxma'}${note ? ' — ' + note : ''}`, me.id);
      rooms.balanceChanged(targetId, bal);
    } else if (action === 'name') {
      await store.setDisplayName(targetId, b.displayName);
      rooms.nameChanged(targetId, String(b.displayName).trim());
    } else if (action === 'role') {
      if (me.role !== 'admin') throw new UserError('Rolları yalnız admin dəyişə bilər.');
      if (target.id === me.id) throw new UserError('Öz rolunuzu dəyişə bilməzsiniz.');
      await store.setRole(targetId, b.role);
    } else if (action === 'password') {
      await store.setPassword(targetId, b.password);
    }
    return json(res, 200, { user: publicUser(await store.getUser(targetId)) });
  }
  return json(res, 404, { error: 'Tapılmadı.' });
}

// ---------- statik fayllar ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function serveStatic(req, res, url) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof UserError || e instanceof GameError) return json(res, 400, { error: e.message });
    console.error(e);
    json(res, 500, { error: 'Server xətası.' });
  }
});

// ---------- WebSocket ----------
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

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    try {
      // istifadəçini hər dəfə yeniləyirik (blok/ad dəyişikliyi)
      const u = await store.getUser(user.id);
      if (!u || u.status !== 'approved') { ws.close(4001, 'blocked'); return; }
      switch (msg.t) {
        case 'createRoom': rooms.create(u, msg.settings); break;
        case 'joinRoom': rooms.join(u, msg.code); break;
        case 'leaveRoom': rooms.leave(u.id); break;
        case 'startRound': await rooms.startRound(u.id); break;
        case 'settings': rooms.updateSettings(u.id, msg.settings); break;
        case 'kick': rooms.kick(u.id, Number(msg.userId)); break;
        case 'act': await rooms.act(u.id, msg.action || {}); break;
        case 'ping': ws.send('{"t":"pong"}'); break;
        default: break;
      }
    } catch (e) {
      if (e instanceof GameError || e instanceof UserError) rooms.sendError(user.id, e.message);
      else { console.error(e); rooms.sendError(user.id, 'Server xətası.'); }
    }
  });
  ws.on('close', () => rooms.detach(user, ws));
}

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30_000).unref();

server.listen(PORT, () => console.log(`Seka işləyir: http://localhost:${PORT}`));
