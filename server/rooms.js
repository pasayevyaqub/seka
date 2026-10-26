// Otaqlar: oturacaqlar, ayarlar, raundlar və real-time yayım
import crypto from 'node:crypto';
import { Round, GameError, DEFAULT_SETTINGS } from './game/engine.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EMPTY_ROOM_TTL = 30 * 60_000; // heç kim qoşulu deyilsə 30 dəq sonra otaq bağlanır

function int(v, min, max, def) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function cleanSettings(s = {}, base = DEFAULT_SETTINGS) {
  const ante = int(s.ante, 1, 1e9, base.ante);
  return {
    ante,
    minBet: int(s.minBet, 1, 1e9, base.minBet),
    maxBet: int(s.maxBet, 0, 1e9, base.maxBet),
    jackpotAmount: int(s.jackpotAmount, 0, 1e9, base.jackpotAmount),
    turnSeconds: int(s.turnSeconds, 15, 600, base.turnSeconds),
    debtLimit: int(s.debtLimit, 0, 1e12, base.debtLimit),
    maxPlayers: int(s.maxPlayers, 2, 8, base.maxPlayers),
  };
}

export class RoomManager {
  constructor(store) {
    this.store = store;
    this.rooms = new Map();      // code → room
    this.userRoom = new Map();   // userId → code
    this.sockets = new Map();    // userId → Set<ws>
    setInterval(() => this.tick(), 1000).unref();
  }

  // ---------- socket bağlantıları ----------
  attach(user, ws) {
    if (!this.sockets.has(user.id)) this.sockets.set(user.id, new Set());
    this.sockets.get(user.id).add(ws);
    const code = this.userRoom.get(user.id);
    if (code) {
      const room = this.rooms.get(code);
      const m = room?.members.get(user.id);
      if (m) { m.connected = true; this.broadcast(room); }
    }
  }

  detach(user, ws) {
    const set = this.sockets.get(user.id);
    if (!set) return;
    set.delete(ws);
    if (set.size) return;
    this.sockets.delete(user.id);
    const room = this.rooms.get(this.userRoom.get(user.id));
    const m = room?.members.get(user.id);
    if (m) {
      m.connected = false;
      this.broadcast(room);
      // 2 dəqiqə ərzində qayıtmasa və raund getmirsə oturacağı boşaldırıq
      clearTimeout(m.leaveTimer);
      m.leaveTimer = setTimeout(() => {
        if (m.connected || !room.members.has(user.id)) return;
        if (!room.round || room.round.phase === 'finished') this.leave(user.id);
      }, 120_000);
      m.leaveTimer.unref?.();
    }
  }

  send(userId, msg) {
    const set = this.sockets.get(userId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const ws of set) if (ws.readyState === 1) ws.send(data);
  }

  sendError(userId, msg) { this.send(userId, { t: 'error', msg }); }

  disconnectUser(userId) {
    const set = this.sockets.get(userId);
    if (set) for (const ws of set) ws.close(4001, 'logout');
  }

  // ---------- otaq əməliyyatları ----------
  newCode() {
    let code;
    do code = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
    while (this.rooms.has(code));
    return code;
  }

  create(user, settings) {
    if (this.userRoom.has(user.id)) this.leave(user.id);
    const code = this.newCode();
    const room = {
      code,
      hostId: user.id,
      settings: cleanSettings(settings),
      members: new Map(),
      seats: [],
      round: null,
      dealerIdx: 0,
      lastActive: Date.now(),
      overdueSent: false,
      queue: Promise.resolve(),
    };
    this.rooms.set(code, room);
    this.join(user, code);
    return code;
  }

  join(user, code) {
    code = String(code || '').trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) throw new GameError('Bu kodla otaq tapılmadı.');
    const cur = this.userRoom.get(user.id);
    if (cur === code) { this.broadcast(room); return; }
    if (cur) this.leave(user.id);
    if (room.seats.length >= room.settings.maxPlayers) throw new GameError('Otaq doludur.');
    room.members.set(user.id, { id: user.id, name: user.display_name, balance: user.balance, connected: true });
    room.seats.push(user.id);
    this.userRoom.set(user.id, code);
    this.say(room, `${user.display_name} otağa qoşuldu.`);
    this.broadcast(room);
  }

  leave(userId) {
    const code = this.userRoom.get(userId);
    const room = this.rooms.get(code);
    this.userRoom.delete(userId);
    if (!room) return;
    const m = room.members.get(userId);
    room.members.delete(userId);
    room.seats = room.seats.filter((id) => id !== userId);
    this.send(userId, { t: 'left' });
    if (room.round && room.round.phase !== 'finished') {
      this.enqueue(room, async () => {
        room.round.removePlayer(userId, Date.now());
        await this.applyEffects(room);
      });
    }
    if (m) this.say(room, `${m.name} otağı tərk etdi.`);
    if (room.hostId === userId && room.seats.length) room.hostId = room.seats[0];
    if (!room.seats.length) return this.closeRoom(room);
    this.broadcast(room);
  }

  async closeRoom(room) {
    if (room.round && room.round.phase !== 'finished') {
      room.round.abort();
      await this.applyEffects(room);
    }
    for (const id of room.members.keys()) { this.userRoom.delete(id); this.send(id, { t: 'left' }); }
    this.rooms.delete(room.code);
  }

  say(room, msg) {
    room.chatLog = room.chatLog || [];
    room.chatLog.push({ t: Date.now(), msg });
    if (room.chatLog.length > 30) room.chatLog.shift();
  }

  roomOf(userId) {
    const room = this.rooms.get(this.userRoom.get(userId));
    if (!room) throw new GameError('Siz heç bir otaqda deyilsiniz.');
    return room;
  }

  updateSettings(userId, settings) {
    const room = this.roomOf(userId);
    if (room.hostId !== userId) throw new GameError('Ayarları yalnız otaq sahibi dəyişə bilər.');
    if (room.round && room.round.phase !== 'finished') throw new GameError('Raund gedərkən ayarları dəyişmək olmaz.');
    const s = cleanSettings(settings, room.settings);
    if (s.maxPlayers < room.seats.length) s.maxPlayers = room.seats.length;
    room.settings = s;
    this.say(room, 'Otaq ayarları yeniləndi.');
    this.broadcast(room);
  }

  kick(userId, targetId) {
    const room = this.roomOf(userId);
    if (room.hostId !== userId) throw new GameError('Yalnız otaq sahibi çıxara bilər.');
    if (!room.members.has(targetId) || targetId === userId) throw new GameError('Oyunçu tapılmadı.');
    this.leave(targetId);
  }

  async startRound(userId) {
    const room = this.roomOf(userId);
    if (room.hostId !== userId) throw new GameError('Raundu yalnız otaq sahibi başlada bilər.');
    if (room.round && room.round.phase !== 'finished') throw new GameError('Raund artıq gedir.');
    for (const id of [...room.seats]) if (!room.members.get(id)?.connected) this.leave(id);
    const ids = room.seats.filter((id) => room.members.get(id)?.connected);
    if (ids.length < 2) throw new GameError('Ən azı 2 oyunçu lazımdır.');
    // təzə balanslar
    const players = [];
    for (const id of ids) {
      const u = await this.store.getUser(id);
      if (!u || u.status !== 'approved') continue;
      room.members.get(id).balance = u.balance;
      room.members.get(id).name = u.display_name;
      players.push({ id, name: u.display_name, balance: u.balance });
    }
    // növbə hər raundda bir nəfər sürüşür
    const k = room.dealerIdx % players.length;
    const ordered = [...players.slice(k), ...players.slice(0, k)];
    room.dealerIdx++;
    room.round = new Round({ players: ordered, settings: room.settings, now: Date.now() });
    room.overdueSent = false;
    await this.applyEffects(room);
  }

  enqueue(room, fn) {
    room.queue = room.queue.then(fn).catch((e) => console.error('room queue', e));
    return room.queue;
  }

  async act(userId, action) {
    const room = this.roomOf(userId);
    if (!room.round) throw new GameError('Raund başlamayıb.');
    let err = null;
    await this.enqueue(room, async () => {
      try {
        room.round.act(userId, action, Date.now());
        if (room.round.phase === 'betting') room.overdueSent = false;
      } catch (e) { err = e; }
      await this.applyEffects(room);
    });
    if (err) throw err;
  }

  // Mühərrikin pul hərəkətlərini bazaya yaz və hamıya göndər
  async applyEffects(room) {
    room.lastActive = Date.now();
    const effects = room.round ? room.round.drainEffects() : [];
    for (const e of effects) {
      try {
        const bal = await this.store.addBalance(e.userId, e.delta, e.reason, null, room.code);
        const m = room.members.get(e.userId);
        if (m) m.balance = bal;
        this.send(e.userId, { t: 'balance', balance: bal });
      } catch (err) { console.error('balance effect failed', e, err); }
    }
    this.broadcast(room);
  }

  // Admin balansı dəyişəndə
  balanceChanged(userId, balance) {
    this.send(userId, { t: 'balance', balance });
    const room = this.rooms.get(this.userRoom.get(userId));
    if (!room) return;
    const m = room.members.get(userId);
    if (m) m.balance = balance;
    room.round?.setBalance(userId, balance);
    this.broadcast(room);
  }

  nameChanged(userId, name) {
    const room = this.rooms.get(this.userRoom.get(userId));
    if (!room) return;
    const m = room.members.get(userId);
    if (m) m.name = name;
    const p = room.round?.players.get(userId);
    if (p) p.name = name;
    this.broadcast(room);
  }

  view(room, uid) {
    const now = Date.now();
    return {
      code: room.code,
      hostId: room.hostId,
      isHost: room.hostId === uid,
      settings: room.settings,
      members: room.seats.map((id) => {
        const m = room.members.get(id);
        return { id, name: m.name, balance: m.balance, connected: m.connected };
      }),
      round: room.round ? room.round.viewFor(uid, now) : null,
      chat: room.chatLog || [],
      serverNow: now,
    };
  }

  broadcast(room) {
    for (const id of room.members.keys()) this.send(id, { t: 'room', room: this.view(room, id) });
  }

  tick() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const r = room.round;
      if (r && r.phase !== 'finished') {
        this.enqueue(room, async () => {
          if (room.round !== r || r.phase === 'finished') return;
          const t = Date.now();
          if (r.tick(t)) return this.applyEffects(room);
          if (r.phase === 'betting' && t >= r.turnDeadline && !room.overdueSent) {
            room.overdueSent = true;
            this.broadcast(room);
          }
        });
      }
      const anyone = [...room.members.values()].some((m) => m.connected);
      if (!anyone && now - room.lastActive > EMPTY_ROOM_TTL) this.enqueue(room, () => this.closeRoom(room));
      else if (anyone) room.lastActive = now;
    }
  }
}
