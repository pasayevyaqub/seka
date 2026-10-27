// Otaqlar: ad, açıq/gizli, şifrə, oturacaqlar, botlar, raundlar və real-time yayım
import crypto from 'node:crypto';
import { Round, GameError, DEFAULT_SETTINGS } from './game/engine.js';
import { decide } from './game/bot.js';
import { hashPassword, checkPassword } from './store.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EMPTY_ROOM_TTL = 30 * 60_000;      // heç bir insan qoşulu deyilsə 30 dəq sonra otaq bağlanır
const PW_MAX_FAILS = 5;                  // səhv otaq şifrəsi cəhdləri
const PW_WINDOW_MS = 5 * 60_000;
// Baza yazılışı alınmadıqda təkrar cəhd: əvvəl tez (5 dəfə), sonra hər 30 saniyədən bir — otaq bu müddətdə dondurulur
export const RETRY_FAST_MS = [1000, 2000, 4000, 8000, 15000];
export const RETRY_SLOW_MS = 30_000;
const BLOCKED_MSG = 'Baza bağlantısı gözlənilir — son hərəkət hələ yadda saxlanılmayıb. Bir az gözləyin.';
export const PRACTICE_START = 10_000;    // demo / botlu məşq otağında hər girişdə verilən virtual məşq balansı
export const EMOJIS = ['😂', '😎', '😡', '👏', '🤝', '🔥', '😭'];
const EMOJI_GAP_MS = 3000;
const CHAT_GAP_MS = 1500;
const CHAT_MAX = 120;
const CHAT_KEEP = 100;                   // otaqda saxlanılan son mesajlar (yaddaşda, bazada yox)
const ROOM_TASK_WARN_MS = 10_000;        // otaq növbəsində bundan uzun çəkən iş loga yazılır (donma diaqnostikası)

function int(v, min, max, def) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function cleanSettings(s = {}, base = DEFAULT_SETTINGS) {
  return {
    ante: int(s.ante, 1, 1e9, base.ante),
    minBet: int(s.minBet, 1, 1e9, base.minBet),
    maxBet: int(s.maxBet, 0, 1e9, base.maxBet),
    // köhnə tək "jackpotAmount" ayarı gəlirsə (köhnə klient), hər iki cəkpota tətbiq olunur
    jackpotSix: int(s.jackpotSix ?? s.jackpotAmount, 0, 1e9, base.jackpotSix),
    jackpotAce: int(s.jackpotAce ?? s.jackpotAmount, 0, 1e9, base.jackpotAce),
    turnSeconds: int(s.turnSeconds, 15, 600, base.turnSeconds),
    maxPlayers: int(s.maxPlayers, 2, 8, base.maxPlayers),
  };
}

function cleanName(name, fallback) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
  if (!n) return fallback;
  if (n.length < 2) throw new GameError('Otaq adı ən azı 2 simvol olmalıdır.');
  return n;
}

function cleanRoomPassword(pw) {
  const p = String(pw ?? '');
  if (!p) return null;
  if (p.length < 3 || p.length > 50) throw new GameError('Otaq şifrəsi 3–50 simvol olmalıdır.');
  return hashPassword(p);
}

let botSeq = 0; // bot id-ləri mənfi ədədlərdir (DB istifadəçiləri ilə qarışmır)

export class RoomManager {
  constructor(store, { botDelay = [700, 1600], tickMs = 1000, retryFast = RETRY_FAST_MS, retrySlow = RETRY_SLOW_MS } = {}) {
    this.store = store;
    this.botDelay = botDelay;
    this.retryFast = retryFast;
    this.retrySlow = retrySlow;
    this.rooms = new Map();      // code → room
    this.userRoom = new Map();   // userId → code
    this.sockets = new Map();    // userId → Set<ws>
    this.pwFails = new Map();    // userId → [vaxtlar]
    this.lastEmoji = new Map();  // userId → vaxt
    this.lastChat = new Map();
    this.onBalanceUp = null;     // (userId) => void — borc işçisini oyadır
    this.timer = setInterval(() => this.tick(), tickMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    for (const r of this.rooms.values()) { clearTimeout(r.botTimer); clearTimeout(r.retryTimer); }
  }

  // ---------- socket bağlantıları ----------
  attach(user, ws) {
    if (!this.sockets.has(user.id)) this.sockets.set(user.id, new Set());
    this.sockets.get(user.id).add(ws);
    const room = this.rooms.get(this.userRoom.get(user.id));
    const m = room?.members.get(user.id);
    if (m) { m.connected = true; clearTimeout(m.leaveTimer); this.broadcast(room); }
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
      // 2 dəqiqə ərzində qayıtmasa və raund getmirsə oturacağı boşaldırıq.
      // Raund gedirsə oyunçu yerində qalır: növbəsi gələndə digərləri "pas" səsi verə bilər.
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

  // ---------- köməkçilər ----------
  newCode() {
    let code;
    do code = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
    while (this.rooms.has(code));
    return code;
  }

  roomOf(userId) {
    const room = this.rooms.get(this.userRoom.get(userId));
    if (!room) throw new GameError('Siz heç bir otaqda deyilsiniz.');
    return room;
  }

  roomOfOrNull(userId) { return this.rooms.get(this.userRoom.get(userId)) || null; }

  roundRunning(room) { return !!(room.round && room.round.phase !== 'finished'); }
  // Bazaya hələ yazılmamış (təsdiqlənməmiş) paket varsa otaq dondurulub
  isBlocked(room) { return room.outbox.length > 0; }
  mustNotBlocked(room) { if (this.isBlocked(room)) throw new GameError(BLOCKED_MSG); }
  isPractice(room) { return room.demo || [...room.members.values()].some((m) => m.isBot); }
  humans(room) { return [...room.members.values()].filter((m) => !m.isBot); }

  mustHostBetweenRounds(room, userId, what) {
    this.mustNotBlocked(room);
    if (room.hostId !== userId) throw new GameError(`${what} yalnız otaq sahibi edə bilər.`);
    if (this.roundRunning(room)) throw new GameError('Raund gedərkən bunu etmək olmaz — raund bitsin.');
  }

  say(room, msg) {
    room.chatLog = room.chatLog || [];
    room.chatLog.push({ t: Date.now(), msg });
    if (room.chatLog.length > 30) room.chatLog.shift();
  }

  // Otaq növbəsi: oyun hərəkətləri, pul əməliyyatları və taymerlər ardıcıl icra olunur.
  // Uzun çəkən iş (məs. baza cavab vermir) loga yazılır — donmanın səbəbini tapmaq üçün.
  timed(room, fn) {
    return async () => {
      const t0 = Date.now();
      room.busySince = t0;
      try { return await fn(); } finally {
        room.busySince = 0;
        const ms = Date.now() - t0;
        if (ms > ROOM_TASK_WARN_MS) console.warn(`Otaq ${room.code}: növbədəki iş ${ms} ms çəkdi`);
      }
    };
  }

  enqueue(room, fn) {
    room.queue = room.queue.then(this.timed(room, fn)).catch((e) => console.error('room queue', e?.message || e));
    return room.queue;
  }

  // otaq növbəsində icra et və nəticəni/xətanı çağırana qaytar
  runQ(room, fn) {
    const p = room.queue.then(this.timed(room, fn));
    room.queue = p.catch(() => {});
    return p;
  }

  // istifadəçinin real (məşq olmayan) otağı — onun balansı bu otağın növbəsi ilə sinxron dəyişməlidir
  realRoomOf(userId) {
    const room = this.rooms.get(this.userRoom.get(userId));
    return room && !this.isPractice(room) ? room : null;
  }

  /**
   * Balansı AZALDAN maliyyə əməliyyatı (hədiyyə, borc vermə/ödəmə, avtomatik tutulma, admin çıxması).
   * İstifadəçi real otaqdadırsa əməliyyat həmin otağın növbəsində icra olunur: oyun hərəkətləri ilə paralel getmir,
   * otaqda təsdiqlənməmiş oyun paketi varsa gözləmir — rədd edilir. Beləliklə yaddaşdakı oyun balansı ilə baza
   * balansı həmişə eyni olur və eyni pul iki dəfə xərclənə bilmir.
   */
  async moneyOp(userId, fn) {
    const room = this.realRoomOf(userId);
    if (!room) { const res = await fn(); this.syncChanges(res?.changes, null); return res; }
    return this.runQ(room, async () => {
      this.mustNotBlocked(room);
      const res = await fn();
      this.syncChanges(res?.changes, room);
      return res;
    });
  }

  /** Bazada təsdiqlənmiş balans dəyişikliklərini klientlərə və aktiv oyunun yaddaşına çatdırır */
  syncChanges(changes, currentRoom) {
    for (const c of changes || []) {
      this.send(c.userId, { t: 'balance', balance: c.balance });
      if (c.delta > 0) this.onBalanceUp?.(c.userId);
      const room = this.rooms.get(this.userRoom.get(c.userId));
      if (!room || this.isPractice(room)) continue;
      const apply = () => {
        const m = room.members.get(c.userId);
        if (m) m.balance = c.balance;
        const r = room.round;
        if (r && !r.practice && r.phase !== 'finished') r.adjustBalance(c.userId, c.delta);
        this.broadcast(room);
      };
      if (room === currentRoom) apply(); else this.enqueue(room, async () => apply());
    }
  }

  // ---------- otaq əməliyyatları ----------
  create(user, opts = {}) {
    if (this.userRoom.has(user.id)) this.leave(user.id);
    const demo = user.status !== 'approved' || !!opts.demo;
    const botCount = demo ? Math.min(7, Math.max(1, Math.floor(Number(opts.bots) || 1))) : (opts.withBot ? Math.min(7, Math.max(1, Math.floor(Number(opts.bots) || 1))) : 0);
    const room = {
      code: this.newCode(),
      name: cleanName(opts.name, `${user.display_name} otağı`),
      visibility: demo ? 'private' : (opts.visibility === 'private' ? 'private' : 'public'),
      passHash: demo ? null : cleanRoomPassword(opts.password),
      demo,
      hostId: user.id,
      settings: cleanSettings(opts.settings),
      members: new Map(),
      seats: [],
      practice: new Map(),
      round: null,
      dealerIdx: 0,
      lastActive: Date.now(),
      overdueSent: false,
      queue: Promise.resolve(),
      botTimer: null,
      // baza yazılışı
      outbox: [],            // təsdiqlənməmiş paketlər (sıra ilə, sabit batchId)
      batchSeq: 0,
      roundEndQueued: false,
      dbWait: null,          // { since, attempts, lastError }
      retryTimer: null,
      afterUnblock: [],      // dondurulma zamanı gələn otaqdan çıxmalar
      closing: false,
      confirmedViews: new Map(),
    };
    this.rooms.set(room.code, room);
    if (demo) room.settings.maxPlayers = 8;
    if (botCount) room.settings.maxPlayers = Math.max(room.settings.maxPlayers, Math.min(8, botCount + 1));
    this.seat(room, user);
    for (let i = 0; i < botCount; i++) this.addBotTo(room);
    this.say(room, demo ? `Demo: hər girişdə ${PRACTICE_START} demo xal. Əsas balans, borclar və statistika dəyişmir.` : `"${room.name}" otağı yaradıldı.`);
    this.broadcast(room);
    return room.code;
  }

  seat(room, user) {
    // joinedAt: çat tarixçəsi yalnız otağa qoşulandan sonrakı mesajları göstərir (əvvəlki söhbət yeni gələnə açılmır)
    room.members.set(user.id, { id: user.id, name: user.display_name, balance: Number(user.balance), connected: this.sockets.has(user.id), isBot: false, avatarVer: Number(user.avatar_ver || 0), joinedAt: Date.now() });
    room.seats.push(user.id);
    this.userRoom.set(user.id, room.code);
    room.practice.set(user.id, PRACTICE_START); // məşq otağına hər girişdə demo balans yenidən 10 000
  }

  checkRoomPassword(user, room, password) {
    if (!room.passHash) return;
    const t = Date.now();
    const fails = (this.pwFails.get(user.id) || []).filter((x) => t - x < PW_WINDOW_MS);
    if (fails.length >= PW_MAX_FAILS) throw new GameError('Çox səhv şifrə cəhdi. 5 dəqiqə sonra yenidən yoxlayın.');
    if (!password) { const e = new GameError('Bu otaq şifrəlidir. Şifrəni daxil edin.'); e.code = 'PASSWORD'; throw e; }
    if (!checkPassword(String(password), room.passHash)) {
      fails.push(t); this.pwFails.set(user.id, fails);
      const e = new GameError('Otaq şifrəsi yanlışdır.'); e.code = 'PASSWORD'; throw e;
    }
    this.pwFails.delete(user.id);
  }

  join(user, code, password) {
    code = String(code || '').trim().toUpperCase();
    if (user.status !== 'approved') throw new GameError('Hesabınız təsdiqlənməyib — hələlik yalnız botlarla demo oynaya bilərsiniz.');
    const room = this.rooms.get(code);
    if (!room) throw new GameError('Bu kodla otaq tapılmadı.');
    const cur = this.userRoom.get(user.id);
    if (cur === code) { this.broadcast(room); return; }
    if (room.demo) throw new GameError('Bu demo otaqdır, ora qoşulmaq olmaz.');
    this.mustNotBlocked(room);
    if (room.seats.length >= room.settings.maxPlayers) throw new GameError('Otaq doludur.');
    this.checkRoomPassword(user, room, password);
    if (cur) this.leave(user.id);
    this.seat(room, user);
    this.say(room, `${user.display_name} otağa qoşuldu.`);
    this.broadcast(room);
  }

  leave(userId) {
    const code = this.userRoom.get(userId);
    const room = this.rooms.get(code);
    this.userRoom.delete(userId);
    if (!room) return;
    const m = room.members.get(userId);
    if (m) clearTimeout(m.leaveTimer);
    room.members.delete(userId);
    room.seats = room.seats.filter((id) => id !== userId);
    this.send(userId, { t: 'left' });
    if (this.roundRunning(room)) {
      const r = room.round;
      const remove = () => { if (room.round === r) r.removePlayer(userId, Date.now()); };
      this.enqueue(room, async () => {
        if (this.isBlocked(room)) { room.afterUnblock.push(remove); return; } // baza qayıdanda icra olunur
        remove();
        await this.applyEffects(room);
      });
    }
    if (m) this.say(room, `${m.name} otağı tərk etdi.`);
    const humans = this.humans(room);
    if (!humans.length) return this.enqueue(room, () => this.closeRoom(room));
    if (room.hostId === userId) room.hostId = humans[0].id;
    this.broadcast(room);
  }

  async closeRoom(room) {
    if (!this.rooms.has(room.code)) return;
    clearTimeout(room.botTimer);
    room.botTimer = null;
    // təsdiqlənməmiş paket varsa otaq silinmir: əvvəl yazılmalıdır (sonra avtomatik bağlanır)
    if (this.isBlocked(room)) { room.closing = true; return; }
    if (this.roundRunning(room)) {
      room.round.abort();
      await this.applyEffects(room, { silent: true });
      if (this.isBlocked(room)) { room.closing = true; return; }
    }
    clearTimeout(room.retryTimer);
    for (const id of room.members.keys()) { if (id > 0) { this.userRoom.delete(id); this.send(id, { t: 'left' }); } }
    this.rooms.delete(room.code);
  }

  updateSettings(userId, settings) {
    const room = this.roomOf(userId);
    this.mustHostBetweenRounds(room, userId, 'Ayarları');
    const s = cleanSettings(settings, room.settings);
    if (s.maxPlayers < room.seats.length) s.maxPlayers = room.seats.length;
    room.settings = s;
    this.say(room, 'Otaq ayarları yeniləndi.');
    this.broadcast(room);
  }

  updateMeta(userId, meta = {}) {
    const room = this.roomOf(userId);
    this.mustHostBetweenRounds(room, userId, 'Otaq məlumatlarını');
    if (meta.name !== undefined) room.name = cleanName(meta.name, room.name);
    if (!room.demo && (meta.visibility === 'public' || meta.visibility === 'private')) room.visibility = meta.visibility;
    if (!room.demo) {
      if (meta.removePassword) room.passHash = null;
      else if (meta.password) room.passHash = cleanRoomPassword(meta.password);
    }
    this.say(room, 'Otaq məlumatları yeniləndi.');
    this.broadcast(room);
  }

  kick(userId, targetId) {
    const room = this.roomOf(userId);
    if (room.hostId !== userId) throw new GameError('Yalnız otaq sahibi çıxara bilər.');
    const t = room.members.get(targetId);
    if (!t || targetId === userId) throw new GameError('Oyunçu tapılmadı.');
    if (t.isBot) return this.removeBot(userId, targetId);
    this.leave(targetId);
  }

  // ---------- emoji və çat (şəklin üzərində 2–3 saniyəlik balon) ----------
  emoji(userId, e) {
    const room = this.roomOf(userId);
    if (!EMOJIS.includes(e)) throw new GameError('Bu emoji icazəli deyil.');
    const t = Date.now();
    if (t - (this.lastEmoji.get(userId) || 0) < EMOJI_GAP_MS) throw new GameError('Emojini 3 saniyədə bir göndərmək olar.');
    this.lastEmoji.set(userId, t);
    this.bubble(room, { userId, kind: 'emoji', value: e });
  }

  chat(userId, text) {
    const room = this.roomOf(userId);
    const msg = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!msg) throw new GameError('Boş mesaj göndərmək olmaz.');
    const t = Date.now();
    if (t - (this.lastChat.get(userId) || 0) < CHAT_GAP_MS) throw new GameError('Mesajları bir az yavaş göndərin.');
    this.lastChat.set(userId, t);
    const m = room.members.get(userId);
    room.chatMsgs = room.chatMsgs || [];
    room.chatMsgs.push({ t, userId, name: m?.name ?? '?', text: msg });
    if (room.chatMsgs.length > CHAT_KEEP) room.chatMsgs.shift();
    this.bubble(room, { userId, kind: 'text', value: msg, name: m?.name, ts: t });
  }

  // yalnız otaq üzvlərinə; masa vəziyyətini yenidən göndərmir (formalar sıfırlanmır)
  /** Masa hədiyyəsi animasiyası — YALNIZ bazada uğurla yazılmış əməliyyatdan sonra, otaqdakı insanlara bir dəfə göndərilir.
   *  Yaddaşda saxlanılmır: yenidən qoşulan klient köhnə animasiyaları almır. */
  giftEvent(room, ev) {
    for (const id of room.members.keys()) if (id > 0) this.send(id, { t: 'tgift', ...ev, at: Date.now() });
  }

  bubble(room, b) {
    for (const id of room.members.keys()) if (id > 0) this.send(id, { t: 'bubble', ...b, at: Date.now() });
  }

  // ---------- botlar ----------
  addBotTo(room) {
    if (room.seats.length >= Math.min(8, room.settings.maxPlayers)) throw new GameError('Boş yer yoxdur (otaqda ən çox 8 yer).');
    const id = -(++botSeq);
    const used = new Set([...room.members.values()].filter((m) => m.isBot).map((m) => m.name));
    let n = 1; while (used.has(`Bot ${n}`)) n++;
    room.members.set(id, { id, name: `Bot ${n}`, isBot: true, connected: true, balance: PRACTICE_START });
    room.seats.push(id);
    room.practice.set(id, PRACTICE_START);
    this.say(room, `🤖 Bot ${n} əlavə edildi.`);
    return id;
  }

  addBot(userId) {
    const room = this.roomOf(userId);
    this.mustHostBetweenRounds(room, userId, 'Bot əlavə etməyi');
    this.addBotTo(room);
    this.broadcast(room);
  }

  removeBot(userId, botId) {
    const room = this.roomOf(userId);
    this.mustHostBetweenRounds(room, userId, 'Botu çıxarmağı');
    const m = room.members.get(Number(botId));
    if (!m?.isBot) throw new GameError('Bot tapılmadı.');
    if (room.demo && [...room.members.values()].filter((x) => x.isBot).length <= 1) throw new GameError('Demo otaqda ən azı 1 bot olmalıdır.');
    room.members.delete(m.id);
    room.seats = room.seats.filter((id) => id !== m.id);
    room.practice.delete(m.id);
    this.say(room, `🤖 ${m.name} çıxarıldı.`);
    this.broadcast(room);
  }

  // ---------- raund ----------
  async startRound(userId) {
    const room = this.roomOf(userId);
    // balanslar oxunduğu anla raund yaradılan an arasında başqa pul əməliyyatı keçməsin deyə növbədə icra olunur
    return this.runQ(room, () => this._startRound(room, userId));
  }

  async _startRound(room, userId) {
    if (this.rooms.get(room.code) !== room) throw new GameError('Otaq bağlanıb.');
    if (room.hostId !== userId) throw new GameError('Raundu yalnız otaq sahibi başlada bilər.');
    if (this.roundRunning(room)) throw new GameError('Raund artıq gedir.');
    this.mustNotBlocked(room);
    for (const id of [...room.seats]) {
      const m = room.members.get(id);
      if (m && !m.isBot && !m.connected) this.leave(id);
    }
    const practice = this.isPractice(room);
    const players = [];
    for (const id of room.seats) {
      const m = room.members.get(id);
      if (!m) continue;
      if (m.isBot) {
        let b = room.practice.get(id) ?? PRACTICE_START;
        if (b < room.settings.ante * 5) b = PRACTICE_START; // botun virtual balansı bitəndə yenilənir
        room.practice.set(id, b);
        players.push({ id, name: m.name, balance: b });
        continue;
      }
      const u = await this.store.getUser(id);
      if (!u || (u.status !== 'approved' && !(practice && u.status === 'pending'))) continue;
      m.name = u.display_name;
      m.avatarVer = Number(u.avatar_ver || 0);
      m.balance = Number(u.balance);
      if (practice) {
        if (!room.practice.has(id)) room.practice.set(id, PRACTICE_START);
        players.push({ id, name: u.display_name, balance: room.practice.get(id) });
      } else players.push({ id, name: u.display_name, balance: Number(u.balance) });
    }
    if (players.length < 2) throw new GameError('Ən azı 2 oyunçu lazımdır.');
    if (!practice) {
      const can = players.filter((p) => p.balance >= room.settings.ante);
      if (can.length < 2) throw new GameError(`Raund üçün balansı oyun haqqına (${room.settings.ante} xal) çatan ən azı 2 oyunçu lazımdır. Balansı çatmayan oyunçu "Kredit istə" və ya Demo seçə bilər.`);
    }
    const k = room.dealerIdx % players.length;
    const ordered = [...players.slice(k), ...players.slice(0, k)];
    room.dealerIdx++;
    room.round = new Round({ players: ordered, settings: room.settings, now: Date.now(), uid: practice ? null : crypto.randomUUID() });
    room.round.practice = practice;
    // "Borca oyna" yalnız real otaqda: bot yoxdur, demo deyil (iki aktiv insan şərtini mühərrik yoxlayır)
    room.round.allowCredit = !practice;
    room.round.botMem = new Map();
    room.roundEndQueued = false;
    room.batchSeq = 0;
    room.overdueSent = false;
    await this.applyEffects(room);
  }

  async act(userId, action = {}) {
    const room = this.roomOf(userId);
    if (!room.round) throw new GameError('Raund başlamayıb.');
    let err = null;
    await this.enqueue(room, async () => {
      const r = room.round;
      try {
        this.mustNotBlocked(room);
        // köhnəlmiş klik / təkrar klik: klient gördüyü versiyanı göndərir
        if (action.v != null && Number(action.v) !== r.version) throw new GameError('Vəziyyət artıq dəyişib — ekrana yenidən baxın.');
        const { v, ...a } = action;
        r.act(userId, a, Date.now());
        if (r.phase === 'betting') room.overdueSent = false;
      } catch (e) { err = e; }
      await this.applyEffects(room);
    });
    if (err) throw err;
  }

  // Oyunçu öz kartlarına baxdı: yalnız onun görünüşü dəyişir (xal nişanı) — başqalarına heç nə göndərilmir
  async look(userId) {
    const room = this.roomOf(userId);
    const r = room.round;
    if (!r || !r.ps[userId] || r.ps[userId].looked) return;
    await this.enqueue(room, async () => {
      if (room.round !== r || !r.ps[userId]) return;
      r.act(userId, { type: 'look' }, Date.now());
      if (!this.isBlocked(room)) {
        const v = this.view(room, userId);
        room.confirmedViews.set(userId, v);
        this.send(userId, { t: 'room', room: { ...v, dbWaiting: null } });
      }
    });
  }

  // Mühərrikin pul hərəkətlərini paketə yığ (sabit batchId ilə), bazaya yaz və hamıya göndər
  async applyEffects(room, { silent = false } = {}) {
    room.lastActive = Date.now();
    this.collect(room);
    await this.flush(room);
    if (!silent) { this.broadcast(room); this.scheduleBots(room); }
  }

  // Mühərrikdəki yeni pul hərəkətlərini təsdiqlənməmiş paket kimi növbəyə qoyur
  collect(room) {
    const r = room.round;
    if (!r) return;
    const effects = r.drainEffects();
    const ended = r.phase === 'finished' && !room.roundEndQueued;
    if (ended) room.roundEndQueued = true;
    if (r.practice) {
      for (const e of effects) room.practice.set(e.userId, (room.practice.get(e.userId) ?? 0) + e.delta);
      return;
    }
    if (!effects.length && !ended) return;
    room.outbox.push({
      batchId: `${r.uid}:${++room.batchSeq}`,
      uid: r.uid,
      room: room.code,
      effects,
      contrib: { ...r.contrib },
      end: ended ? {
        status: r.result.how === 'aborted' ? 'aborted' : 'finished',
        flows: r.result.flows,
        // borca oyundan yaranan borclar raundun son paketi ilə EYNİ tranzaksiyada yazılır
        loans: (r.result.creditLoans || []).map((l) => ({ ...l, note: `Borca oyun — otaq ${room.code} / raund ${String(r.uid).slice(0, 8)}` })),
      } : null,
    });
  }

  // Paketləri sıra ilə yazır. Uğursuz olarsa otaq dondurulur və təkrar cəhd planlaşdırılır.
  // Eyni paket təkrar göndərilsə (məs. COMMIT olub, cavab itib) baza onu ikinci dəfə tətbiq etmir.
  async flush(room) {
    for (;;) {
      while (room.outbox.length) {
        const b = room.outbox[0];
        try {
          const res = await this.store.applyRoundBatch(b);
          room.outbox.shift();
          if (!res.duplicate) {
            for (const l of b.end?.loans || []) {
              this.send(l.borrower, { t: 'notify', kind: 'loan', text: `${l.note}: borcunuz ${l.amount} xal.` });
              this.send(l.lender, { t: 'notify', kind: 'loan', text: `${l.note}: alacağınız ${l.amount} xal.` });
            }
          }
          for (const [id, bal] of Object.entries(res.balances || {})) {
            const m = room.members.get(Number(id));
            if (m) m.balance = bal;
            this.send(Number(id), { t: 'balance', balance: bal });
            if (b.effects.some((e) => e.userId === Number(id) && e.delta > 0)) this.onBalanceUp?.(Number(id));
          }
        } catch (err) {
          this.onDbFail(room, err);
          return false;
        }
      }
      // dondurulma zamanı gözləyən otaqdan çıxmaları indi icra et (onların da pul nəticəsi paketə düşür)
      if (room.afterUnblock.length) {
        const fn = room.afterUnblock.shift();
        fn();
        this.collect(room);
        continue;
      }
      break;
    }
    if (room.dbWait) {
      const paused = Date.now() - room.dbWait.since;
      console.log(`Otaq ${room.code}: baza bərpa olundu (${room.dbWait.attempts} cəhd).`);
      room.dbWait = null;
      clearTimeout(room.retryTimer);
      room.retryTimer = null;
      room.round?.shiftDeadlines(paused);
      this.say(room, 'Baza bağlantısı bərpa olundu, oyun davam edir.');
    }
    if (room.closing) { room.closing = false; await this.closeRoom(room); }
    return true;
  }

  onDbFail(room, err) {
    if (!room.dbWait) room.dbWait = { since: Date.now(), attempts: 0, lastError: '' };
    room.dbWait.attempts++;
    room.dbWait.lastError = String(err?.message || err).slice(0, 200);
    console.error(`Otaq ${room.code}: paket ${room.outbox[0]?.batchId} yazılmadı (cəhd ${room.dbWait.attempts}):`, room.dbWait.lastError);
    clearTimeout(room.botTimer);
    room.botTimer = null;
    clearTimeout(room.retryTimer);
    const delay = this.retryFast[room.dbWait.attempts - 1] ?? this.retrySlow;
    room.retryTimer = setTimeout(() => {
      room.retryTimer = null;
      this.enqueue(room, async () => {
        if (!this.rooms.has(room.code) || !this.isBlocked(room)) return;
        const ok = await this.flush(room);
        if (!this.rooms.has(room.code)) return;
        this.broadcast(room);
        if (ok) this.scheduleBots(room);
      });
    }, delay);
    room.retryTimer.unref?.();
  }

  // Server dayanarkən (SIGTERM) gözləyən paketləri yazmağa son cəhd
  async flushAll(timeoutMs = 8000) {
    const jobs = [...this.rooms.values()].filter((r) => this.isBlocked(r)).map((r) => this.enqueue(r, () => this.flush(r)));
    await Promise.race([Promise.all(jobs), new Promise((res) => setTimeout(res, timeoutMs))]);
    return [...this.rooms.values()].filter((r) => this.isBlocked(r)).length;
  }

  // Admin balansı dəyişəndə (delta ilə — davam edən raundun hesabını pozmur)
  balanceChanged(userId, balance, delta) {
    this.send(userId, { t: 'balance', balance });
    const room = this.rooms.get(this.userRoom.get(userId));
    if (!room) return;
    const m = room.members.get(userId);
    if (m) m.balance = balance;
    const r = room.round;
    if (r && !r.practice && r.phase !== 'finished') this.enqueue(room, async () => { r.adjustBalance(userId, delta); this.broadcast(room); });
    else this.broadcast(room);
  }

  // istifadəçi real raundda iştirak edirmi (mənfi balans sıfırlama üçün)
  inActiveRealRound(userId) {
    for (const room of this.rooms.values()) {
      const r = room.round;
      if (!r || r.practice || !Object.prototype.hasOwnProperty.call(r.contrib, String(userId))) continue;
      if (r.phase !== 'finished' && !r.left.has(userId)) return true;
      // raund yaddaşda bitib, amma nəticəsi hələ bazaya yazılmayıb
      if (this.isBlocked(room) && room.outbox.some((b) => b.effects.some((e) => e.userId === userId))) return true;
    }
    return false;
  }

  userUpdated(user) {
    this.send(user.id, { t: 'user', user });
    const room = this.rooms.get(this.userRoom.get(user.id));
    if (!room) return;
    const m = room.members.get(user.id);
    if (m) { m.name = user.displayName; m.balance = user.balance; m.avatarVer = user.avatarVer || 0; }
    const p = room.round?.players.get(user.id);
    if (p) p.name = user.displayName;
    this.broadcast(room);
  }

  // ---------- botların idarəsi ----------
  scheduleBots(room) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
    if (this.isBlocked(room)) return;
    const r = room.round;
    if (!r || r.phase === 'finished' || !this.rooms.has(room.code)) return;
    if (![...room.members.values()].some((m) => m.isBot)) return;
    const [a, b] = this.botDelay;
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      this.enqueue(room, () => this.runBots(room, r));
    }, a + Math.random() * (b - a));
    room.botTimer.unref?.();
  }

  async runBots(room, r) {
    if (this.isBlocked(room)) return; // baza gözlənilir — botlar da dayanır
    if (room.round !== r || r.phase === 'finished' || !this.rooms.has(room.code)) return;
    const now = Date.now();
    const bots = r.order.filter((id) => room.members.get(id)?.isBot && !r.left.has(id));
    for (const id of bots) {
      const key = `${id}:${r.handNo}`;
      if (!r.botMem.has(key)) r.botMem.set(key, {});
      const mem = r.botMem.get(key);
      const action = decide(r.viewFor(id, now), id, mem, now); // bot yalnız öz görünüşünü görür
      if (!action) continue;
      try {
        r.act(id, action, now);
      } catch (e) {
        // məs. limit — növbədədirsə pas deyir ki, oyun kilidlənməsin
        if (r.phase !== 'betting' || r.turn !== id) continue;
          try { r.act(id, { type: 'pas' }, now); } catch { try { r.act(id, { type: 'jackpotOpen' }, now); } catch { continue; } }
      }
      if (r.phase === 'betting') room.overdueSent = false;
      return this.applyEffects(room); // bir bot hərəkəti → yayım → növbəti yoxlama
    }
  }

  // ---------- görünüş ----------
  view(room, uid) {
    const now = Date.now();
    const practice = this.isPractice(room);
    const r = room.round;
    return {
      code: room.code,
      name: room.name,
      visibility: room.visibility,
      hasPassword: !!room.passHash,
      demo: room.demo,
      practice,
      practiceRound: !!r?.practice,
      hostId: room.hostId,
      isHost: room.hostId === uid,
      settings: room.settings,
      members: room.seats.map((id) => {
        const m = room.members.get(id);
        return {
          id, name: m.name, isBot: !!m.isBot, avatarVer: m.avatarVer || 0,
          // onlayn status: insan üçün canlı WebSocket bağlantısı var/yox. Bot üçün göstərilmir (insan kimi görünməsin).
          connected: m.isBot ? null : !!m.connected,
          // MƏXFİLİK: dəqiq balans yalnız oyunçunun özünə; başqalarına ümumiyyətlə göndərilmir
          balance: id === uid ? (practice ? (room.practice.get(id) ?? PRACTICE_START) : m.balance) : null,
        };
      }),
      round: r ? r.viewFor(uid, now) : null,
      chat: room.chatLog || [],
      // çat tarixçəsi: yalnız otaq üzvlərinə və yalnız onun otağa qoşulduğu andan sonrakı mesajlar
      chatMsgs: (room.chatMsgs || []).filter((c) => c.t >= (room.members.get(uid)?.joinedAt ?? Infinity)).slice(-CHAT_KEEP),
      serverNow: now,
      dbWaiting: null,
    };
  }

  // Baza gözlənilərkən oyunçulara təsdiqlənməmiş vəziyyət göstərilmir — son təsdiqlənmiş görünüş göndərilir
  broadcast(room) {
    const blocked = this.isBlocked(room);
    for (const id of room.members.keys()) {
      if (id < 0) continue;
      let v;
      if (blocked && room.confirmedViews.has(id)) {
        v = { ...room.confirmedViews.get(id), serverNow: Date.now(), members: this.view(room, id).members.map((m) => ({ ...m })) };
        if (v.round) v.round = { ...v.round, me: v.round.me ? { ...v.round.me, isTurn: false, canBaxis: false, canOffer: false, canVote: false, mustDiscard: false } : null };
      } else if (blocked) {
        v = { ...this.view(room, id), round: null };
      } else {
        v = this.view(room, id);
        room.confirmedViews.set(id, v);
      }
      v.dbWaiting = blocked ? { since: room.dbWait?.since ?? Date.now(), attempts: room.dbWait?.attempts ?? 0 } : null;
      this.send(id, { t: 'room', room: v });
    }
  }

  // Açıq otaqlar siyahısı (gizli və demo otaqlar daxil deyil; şifrə/hash heç vaxt göndərilmir)
  publicList() {
    return [...this.rooms.values()]
      .filter((r) => r.visibility === 'public' && !r.demo && !r.closing)
      .map((r) => ({
        code: r.code,
        name: r.name,
        players: r.seats.length,
        bots: [...r.members.values()].filter((m) => m.isBot).length,
        capacity: r.settings.maxPlayers,
        playing: this.roundRunning(r),
        locked: !!r.passHash,
        ante: r.settings.ante,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'az'));
  }

  // sağlamlıq yoxlaması üçün ümumi göstəricilər (şəxsi məlumat yoxdur)
  stats() {
    const now = Date.now();
    let blocked = 0; let busyLong = 0; let rounds = 0;
    for (const r of this.rooms.values()) {
      if (this.isBlocked(r)) blocked++;
      if (r.busySince && now - r.busySince > ROOM_TASK_WARN_MS) busyLong++;
      if (this.roundRunning(r)) rounds++;
    }
    return { rooms: this.rooms.size, activeRounds: rounds, roomsWaitingDb: blocked, roomsBusyLong: busyLong, sockets: this.sockets.size };
  }

  tick() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const r = room.round;
      // əvvəlki taymer işi hələ növbədədirsə yenisi əlavə edilmir (baza ləngiyəndə növbə və yaddaş şişməsin)
      if (r && r.phase !== 'finished' && !this.isBlocked(room) && !room.tickQueued) {
        room.tickQueued = true;
        this.enqueue(room, async () => {
          room.tickQueued = false;
          if (room.round !== r || r.phase === 'finished' || this.isBlocked(room)) return;
          const t = Date.now();
          if (r.tick(t)) return this.applyEffects(room);
          if (r.phase === 'betting' && t >= r.turnDeadline && !room.overdueSent) {
            room.overdueSent = true;
            this.broadcast(room);
            this.scheduleBots(room); // botlar gecikən insana "pas" səsi verə bilər
          } else if (!room.botTimer) this.scheduleBots(room);
        });
      }
      const anyone = this.humans(room).some((m) => m.connected);
      if (!anyone && now - room.lastActive > EMPTY_ROOM_TTL) this.enqueue(room, () => this.closeRoom(room));
      else if (anyone) room.lastActive = now;
    }
  }
}
