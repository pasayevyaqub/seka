// Seka oyun mühərriki (v2) — server-authoritative, socket/DB-dən asılı deyil.
// Pul hərəkətləri `effects` massivinə yazılır, server onları DB-yə (və ya məşq balansına) tətbiq edir.
import { newDeck, shuffle, handScore, jackpotKind, cardLabel } from './cards.js';

export const DEFAULT_SETTINGS = {
  ante: 10,          // oyun haqqı (xal)
  minBet: 10,        // minimum xod
  maxBet: 0,         // maksimum xod (0 = limitsiz)
  jackpotSix: 0,     // 3 dənə 6: hər rəqibdən tutulan məbləğ
  jackpotAce: 0,     // 3 Tuz: hər rəqibdən tutulan məbləğ
  turnSeconds: 60,   // xod üçün vaxt
  maxPlayers: 8,
};

export const TIMING = {
  OFFER_MS: 20_000,      // Seka / bölmə təklifinə cavab vaxtı (növbə vaxtından çox ola bilməz)
  MIN_OFFER_MS: 5_000,   // növbədən bu qədərdən az vaxt qalıbsa təklif göndərmək olmaz
  DECISION_MS: 30_000,   // "eyni xala baxaq" cavabı, bərabər xal qərarı
  SEKA_JOIN_MS: 60_000,  // sekaya qoşulma vaxtı (ayrıca)
  DISCARD_MS: 30_000,    // sekada 4 kartdan birini atma vaxtı (ayrıca)
  CREDIT_OFFER_MS: 30_000, // "Borca oyna" təklifinə cavab vaxtı
  CREDIT_MIN_RESUME_MS: 15_000, // təklifdən sonra borclunun növbəsinə ən azı bu qədər vaxt qalır
};
export const CREDIT_MAX_LIMIT = 1_000_000;
const DAY_MS = 86_400_000;

export class GameError extends Error {}

export class Round {
  /**
   * @param {object} o
   * @param {{id:number,name:string,balance:number}[]} o.players  oturma sırası ilə (ilk xod edən birinci)
   * @param {object} o.settings
   * @param {number} [o.now]
   * @param {Function} [o.dealer] testlər üçün: (handNo, ids, cardCount) => {id: cards}
   */
  constructor({ players, settings, now = Date.now(), dealer = null, uid = null }) {
    this.uid = uid;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.players = new Map(players.map((p) => [p.id, { id: p.id, name: p.name, balance: p.balance }]));
    this.order = players.map((p) => p.id);
    this.dealer = dealer;
    this.version = 0;
    this.pot = 0;
    this.contrib = {};          // id → banka REAL balansdan qoyduğu cəmi (seka daxil)
    // "Borca oyna": şərti (təminatsız) qoyuluşlar ayrıca uçotdadır — balans kimi heç kimə yazılmır
    this.creditPot = 0;         // bankdakı şərti qoyuluşların cəmi
    this.creditContrib = {};    // id → şərti qoyuluş
    this.creditDeal = null;     // {debtor, creditor, limit, used, dueDays}
    this.creditLoans = [];      // raund bitəndə yaranan borclar: {borrower, lender, amount, dueDays}
    this.allowCredit = false;   // otaq təyin edir: yalnız real (botsuz, demo olmayan) otaqda
    this.jackpotFlows = [];     // cəkpot ödənişləri (birbaşa)
    this.jackpots = [];         // açılmış cəkpotlar: {holder, kind, declared, payments:[{from, paid}]}
    this.secretAce = null;      // gizli 3 Tuz: {holder, decided, hidden} — yalnız sahibinə görünür
    this.handNo = 0;
    this.effects = [];
    this.log = [];
    this.phase = 'init';
    this.result = null;
    this.ps = {};
    this.left = new Set();
    this.pending = null;
    this.sekaJoin = null;
    this.turn = null;
    this.turnDeadline = 0;
    this.offerUsed = false;
    this.votes = new Set();
    this.currentBet = 0;
    this.start(now);
    this.version++;
  }

  // ---------- köməkçilər ----------
  name(id) { return this.players.get(id)?.name ?? '?'; }
  say(msg) { this.log.push({ t: Date.now(), msg }); if (this.log.length > 200) this.log.shift(); }

  // Balans heç vaxt 0-dan aşağı düşmür. Borca oyun razılaşması varsa borclu üçün qalan limit də nəzərə alınır.
  creditLeft(id) {
    const d = this.creditDeal;
    return d && d.debtor === id ? Math.max(0, d.limit - d.used) : 0;
  }
  available(id) {
    const p = this.players.get(id);
    return p ? Math.max(0, p.balance) + this.creditLeft(id) : 0;
  }
  canAfford(id, amount) {
    return !!this.players.get(id) && this.available(id) >= amount;
  }

  // Qoyuluş: əvvəl real balans, çatmayan hissə təsdiqlənmiş şərti limitdən (yalnız xod/baxışda)
  debitToPot(id, amount, reason, allowCredit = false) {
    if (amount <= 0) return;
    const p = this.players.get(id);
    const real = Math.min(amount, Math.max(0, p.balance));
    const cred = amount - real;
    if (cred > 0) {
      if (!allowCredit || this.creditLeft(id) < cred) throw new GameError('Balans limiti buna icazə vermir.');
      this.creditDeal.used += cred;
      this.creditPot += cred;
      this.creditContrib[id] = (this.creditContrib[id] || 0) + cred;
    }
    if (real > 0) {
      p.balance -= real;
      this.pot += real;
      this.contrib[id] = (this.contrib[id] || 0) + real;
      this.effects.push({ userId: id, delta: -real, reason });
    }
  }

  /**
   * Şərti qoyuluşları bağlayır. shares: {id: pay} — bankın kimə hansı payla düşdüyü (real bankdakı nisbət).
   * Borclunun şərti qoyuluşu qaliblər arasında eyni nisbətlə bölünür: borclunun öz payı ləğv olur (yeni xal yaranmır),
   * başqa qalibə düşən pay isə borc kimi qeydə alınır (balansa indi yazılmır). Yuvarlaqlaşdırma aşağı — borclunun xeyrinə.
   */
  settleCredit(shares, label) {
    const d = this.creditDeal;
    if (!this.creditPot || !d) { this.creditPot = 0; this.creditContrib = {}; return []; }
    const total = Object.values(shares).reduce((a, b) => a + b, 0);
    const ids = Object.keys(shares);
    const loans = [];
    for (const k of ids) {
      const id = this.order.find((x) => String(x) === k) ?? Number(k);
      if (id === d.debtor) continue;
      const amount = total > 0 ? Math.floor((this.creditPot * shares[k]) / total) : Math.floor(this.creditPot / ids.length);
      if (amount > 0) {
        loans.push({ borrower: d.debtor, lender: id, amount, dueDays: d.dueDays });
        this.say(`Borca oyun: ${this.name(d.debtor)} → ${this.name(id)} ${amount} xal borc yazıldı (${label}).`);
      }
    }
    if (!loans.length) this.say(`Borca oyun: ${this.name(d.debtor)} borc yaranmadı (${label}).`);
    this.creditLoans.push(...loans);
    this.creditPot = 0;
    this.creditContrib = {};
    this.creditDeal = null;
    return loans;
  }

  transfer(fromId, toId, amount, reason) {
    if (amount <= 0) return;
    this.players.get(fromId).balance -= amount;
    this.players.get(toId).balance += amount;
    this.effects.push({ userId: fromId, delta: -amount, reason });
    this.effects.push({ userId: toId, delta: amount, reason });
  }

  credit(id, amount, reason) {
    if (amount <= 0) return;
    this.players.get(id).balance += amount;
    this.effects.push({ userId: id, delta: amount, reason });
  }

  drainEffects() { const e = this.effects; this.effects = []; return e; }

  // Baza gözlənilərkən keçən vaxt oyunçuların hesabına yazılmasın: bütün son tarixləri sürüşdür
  shiftDeadlines(ms) {
    if (!(ms > 0) || this.phase === 'finished') return;
    if (this.turnDeadline) this.turnDeadline += ms;
    if (this.discardDeadline) this.discardDeadline += ms;
    if (this.pending?.deadline) this.pending.deadline += ms;
    if (this.sekaJoin?.deadline) this.sekaJoin.deadline += ms;
    this.version++;
  }
  adjustBalance(id, delta) { const p = this.players.get(id); if (p) p.balance += delta; }

  participants() { return this.order.filter((id) => this.ps[id]); }
  active() { return this.order.filter((id) => this.ps[id]?.status === 'active'); }

  nextActive(fromId) {
    const n = this.order.length;
    const i = this.order.indexOf(fromId);
    for (let k = 1; k <= n; k++) {
      const id = this.order[(i + k) % n];
      if (this.ps[id]?.status === 'active') return id;
    }
    return null;
  }

  prevActive(fromId) {
    const n = this.order.length;
    const i = this.order.indexOf(fromId);
    for (let k = 1; k <= n; k++) {
      const id = this.order[(i - k + n) % n];
      if (this.ps[id]?.status === 'active') return id;
    }
    return null;
  }

  firstCircleDone() { return this.active().every((id) => this.ps[id].acted); }
  minXod() { return Math.max(this.currentBet, this.settings.minBet, 1); }

  // ---------- raund ----------
  start(now) {
    const ante = this.settings.ante;
    const ids = this.order.filter((id) => this.canAfford(id, ante));
    for (const id of this.order) if (!ids.includes(id)) this.say(`${this.name(id)} — balans oyun haqqına (${ante} xal) çatmır, bu raundda iştirak etmir.`);
    if (ids.length < 2) throw new GameError('Raund üçün balansı oyun haqqına çatan ən azı 2 oyunçu lazımdır.');
    this.order = ids;
    for (const id of ids) this.debitToPot(id, ante, 'Oyun haqqı');
    this.say(`Yeni raund. Hər oyunçu ${ante} xal oyun haqqı qoydu.`);
    this.newHand(ids, false, now);
  }

  newHand(ids, isSeka, now) {
    this.handNo++;
    this.isSeka = isSeka;
    this.cardCount = isSeka ? 4 : 3;
    let hands;
    if (this.dealer) hands = this.dealer(this.handNo, ids, this.cardCount);
    else {
      const deck = shuffle(newDeck());
      hands = {};
      ids.forEach((id, i) => { hands[id] = deck.slice(i * this.cardCount, (i + 1) * this.cardCount); });
    }
    this.ps = {};
    for (const id of ids) {
      this.ps[id] = {
        hand: hands[id],                 // paylanan bütün kartlar
        cards: isSeka ? null : hands[id], // oynanılan 3 kart
        discarded: null,
        status: 'active', acted: false, attachedTo: null, seen: new Set(),
        // "baxıb": oyunçu kartlarına baxıb (küncdən baxma və ya "Göstər"). Xal nişanı yalnız bundan sonra göndərilir.
        // Botlar avtomatik "baxır". Yeni əl (seka) yeni kartlar deməkdir — sıfırlanır.
        looked: id < 0,
      };
    }
    this.currentBet = 0;
    this.pending = null;
    this.sekaJoin = null;
    this.turn = null;
    if (isSeka) {
      this.phase = 'discard';
      this.discardDeadline = now + TIMING.DISCARD_MS;
      this.say('Hər oyunçu 4 kartdan istəmədiyi 1 kartı atmalıdır.');
      return;
    }
    this.afterDeal(now);
  }

  // Kartlar hazır olandan sonra: cəkpot yoxlanışı və ya xod mərhələsi
  afterDeal(now) {
    const ids = this.active();
    if (ids.length === 0) return this.abort();
    if (ids.length === 1) return this.finish([[ids[0]]], 'last');
    this.secretAce = null;
    const sixes = ids.filter((id) => jackpotKind(this.ps[id].cards) === 'six');
    const ace = ids.find((id) => jackpotKind(this.ps[id].cards) === 'ace');
    if (sixes.length) {
      // 3 dənə 6 dərhal açılır. Eyni anda 3 Tuz da varsa, o da açılır (deterministik qayda, sənədləşdirilib).
      const holders = this.order.filter((id) => sixes.includes(id) || id === ace);
      return this.openJackpots(holders, 'deal');
    }
    if (ace != null) {
      // 3 Tuz: sahibinə gizli seçim — "Cəkpotu aç" və ya "Gizli saxla, davam et"
      this.secretAce = { holder: ace, decided: false, hidden: false };
    }
    this.phase = 'betting';
    this.beginTurn(ids[0], now);
  }

  beginTurn(id, now) {
    this.turn = id;
    this.turnDeadline = now + this.settings.turnSeconds * 1000;
    this.votes = new Set();
    this.offerUsed = false;
    this.creditOffersThisTurn = 0;
    // gizli 3 Tuz sahibi pas edə bilmədiyi üçün xoda balansı çatmırsa cəkpot avtomatik açılır
    if (this.isSecretHolder(id) && !this.canAfford(id, this.minXod())) this.openSecretAce('balans xoda çatmadı');
  }

  // ---------- cəkpot ----------
  isSecretHolder(id) { return !!(this.secretAce && this.secretAce.holder === id && this.phase !== 'finished'); }

  jackpotAmount(kind) { return Math.max(0, Math.floor(kind === 'ace' ? this.settings.jackpotAce : this.settings.jackpotSix) || 0); }

  /**
   * Cəkpot(lar)ı açır və raundu bitirir. Qaydalar:
   *  - hər rəqib (cəkpot sahibi olmayan raund iştirakçısı) hər sahibə elan edilmiş məbləğ ilə öz balansının MİNİMUMUNU ödəyir;
   *  - bir neçə sahib varsa, onlar oturma sırası ilə emal olunur (balans azaldıqca sonrakı sahib daha az ala bilər);
   *  - sahiblər bir-birinə ödəmir; bank sahiblər arasında bərabər bölünür;
   *  - çatışmayan hissə borc və ya kredit yaratmır.
   */
  openJackpots(holders, why) {
    this.secretAce = null;
    const others = this.participants().filter((id) => !holders.includes(id));
    for (const h of holders) {
      const kind = jackpotKind(this.ps[h].cards);
      const declared = this.jackpotAmount(kind);
      const payments = [];
      for (const o of others) {
        const paid = Math.min(declared, Math.max(0, this.players.get(o).balance));
        if (paid > 0) {
          this.transfer(o, h, paid, kind === 'ace' ? 'Cəkpot (3 Tuz)' : 'Cəkpot (3 dənə 6)');
          this.jackpotFlows.push({ from: o, to: h, cents: paid * 100 });
        }
        payments.push({ from: o, name: this.name(o), declared, paid });
      }
      this.jackpots.push({ holder: h, name: this.name(h), kind, declared, payments, total: payments.reduce((s, x) => s + x.paid, 0) });
      this.say(`🎉 CƏKPOT (${kind === 'ace' ? '3 Tuz' : '3 dənə 6'})! ${this.name(h)}: ${this.ps[h].cards.map(cardLabel).join(' ')} — rəqiblərdən cəmi ${payments.reduce((s, x) => s + x.paid, 0)} xal`);
    }
    return this.finish(holders.map((h) => [h]), 'jackpot', holders);
  }

  openSecretAce(why) {
    const h = this.secretAce?.holder;
    if (h == null) return;
    this.secretAce = null;
    this.pending = null;
    if (why) this.say(`Gizli cəkpot açıldı (${why}).`);
    return this.openJackpots([h], why);
  }

  advance(fromId, now) {
    if (this.phase !== 'betting') return;
    const act = this.active();
    if (act.length === 0) return this.abort();
    if (act.length === 1) return this.finish([[act[0]]], 'last');
    this.beginTurn(this.nextActive(fromId), now);
  }

  lose(id) { this.ps[id].status = 'lost'; }

  resolveCompare(c, o, tieDeal, now) {
    // gizli 3 Tuz baxışmada üzə çıxacaqdı — cəkpot elə həmin an açılır (sahib onsuz da qalib gəlir: 33 xal)
    if (this.isSecretHolder(c) || this.isSecretHolder(o)) return this.openSecretAce('baxışma');
    const sc = handScore(this.ps[c].cards);
    const so = handScore(this.ps[o].cards);
    this.ps[c].seen.add(o);
    this.ps[o].seen.add(c);
    const finalTwo = this.active().length === 2;
    this.phase = 'betting';
    this.pending = null;
    if (sc !== so) {
      const [w, l] = sc > so ? [c, o] : [o, c];
      this.lose(l);
      this.say(`Baxışma: ${this.name(w)} qalib gəldi, ${this.name(l)} çıxdı.`);
      if (finalTwo) return this.finish([[w]], 'compare', [w, l]);
    } else if (finalTwo) {
      this.phase = 'tieDecision';
      this.pending = { type: 'tieDecision', a: c, b: o, votes: {}, deadline: now + TIMING.DECISION_MS, score: sc };
      this.say(`Xallar bərabərdir (${sc} xal)! ${this.name(c)} və ${this.name(o)}: Seka və ya bankı bölmək?`);
      return;
    } else if (tieDeal) {
      this.ps[c].status = 'attached';
      this.ps[c].attachedTo = o;
      this.say(`Baxışma bərabər çıxdı. Razılığa görə ${this.name(c)} ${this.name(o)} ilə şərikdir (qalib gəlsə bank bölünəcək).`);
    } else {
      this.lose(c);
      this.say(`Baxışma bərabər çıxdı — çağıran ${this.name(c)} çıxdı.`);
    }
    this.advance(c, now);
  }

  // id + ona bağlanmış (attached) oyunçular
  groupOf(id) {
    const group = [id];
    let changed = true;
    while (changed) {
      changed = false;
      for (const x of this.participants()) {
        const p = this.ps[x];
        if (p.status === 'attached' && group.includes(p.attachedTo) && !group.includes(x)) { group.push(x); changed = true; }
      }
    }
    return group;
  }

  /**
   * Bankı tərəflər arasında bərabər bölür (hər tərəf öz şərikləri ilə bərabər bölüşür).
   * @param {number[][]} sides  hər tərəf üçün əsas oyunçu(lar)
   * @param {string} how  last | compare | split | jackpot
   * @param {number[]} [shownIds]  nəticədə kartları açılan oyunçular
   */
  finish(sides, how, shownIds = []) {
    // Gizli 3 Tuz varsa raund bağlanmazdan (bank bölgüsü, son qalan və s.) əvvəl cəkpot açılır
    if (this.secretAce && this.ps[this.secretAce.holder]) return this.openSecretAce('raundun sonu');
    const groups = sides.map((s) => [...new Set(s.flatMap((id) => this.groupOf(id)))]);
    const pot = this.pot;
    const payouts = {};
    const sideShare = Math.floor(pot / groups.length);
    let sideRest = pot - sideShare * groups.length;
    for (const g of groups) {
      let amount = sideShare + (sideRest > 0 ? 1 : 0);
      if (sideRest > 0) sideRest--;
      const each = Math.floor(amount / g.length);
      let rest = amount - each * g.length;
      for (const id of g) {
        const amt = each + (rest > 0 ? 1 : 0);
        if (rest > 0) rest--;
        payouts[id] = (payouts[id] || 0) + amt;
      }
    }
    for (const [id, amt] of Object.entries(payouts)) {
      const key = this.order.find((x) => String(x) === id);
      this.credit(key, amt, groups.flat().length > 1 ? 'Bank bölündü' : 'Bank udu');
    }
    const winners = groups.flat();
    // şərti qoyuluşlar real bankın bölündüyü nisbətlə bağlanır (bax settleCredit)
    const shares = {};
    if (pot > 0) Object.assign(shares, payouts);
    else for (const g of groups) for (const id of g) shares[id] = 1;
    this.settleCredit(shares, { last: 'qalib', compare: 'baxışma', split: 'bank bölündü', jackpot: 'cəkpot' }[how] || how);
    this.pot = 0;
    this.phase = 'finished';
    this.turn = null;
    this.pending = null;
    const shown = shownIds.filter((id) => this.ps[id]?.cards).map((id) => ({
      id, name: this.name(id), cards: this.ps[id].cards, score: handScore(this.ps[id].cards),
    }));
    this.result = { winners, payouts, how, shown, jackpots: this.jackpots, flows: this.computeFlows(payouts), creditLoans: this.creditLoans };
    const names = winners.map((id) => `${this.name(id)} (+${payouts[id]} xal)`).join(', ');
    this.say(winners.length > 1 ? `Bank bölündü: ${names}` : `Qalib: ${names}`);
  }

  /**
   * Kim kimə nə qədər uduzub (qəpiklə). Hər oyunçunun banka qoyduğu məbləğ
   * qaliblər arasında onların bankdan aldığı paya mütənasib bölünür; qalibin öz payı özünə yazılmır.
   */
  computeFlows(payouts) {
    const pot = Object.values(payouts).reduce((a, b) => a + b, 0);
    const map = new Map();
    const add = (from, to, cents) => {
      if (cents <= 0 || String(from) === String(to)) return;
      const k = `${from}>${to}`;
      map.set(k, (map.get(k) || 0) + cents);
    };
    if (pot > 0) {
      // Matris yuvarlaqlaşdırması: həm hər oyunçunun qoyduğu (sətir), həm hər qalibin aldığı (sütun) qəpiyə qədər dəqiq qalır
      const rows = Object.entries(this.contrib).filter(([, c]) => c > 0).map(([id, c]) => ({ id, need: c * 100 }));
      const cols = Object.entries(payouts).filter(([, w]) => w > 0).map(([id, w]) => ({ id, w, need: w * 100 }));
      const cells = [];
      for (const r of rows) {
        for (const col of cols) {
          const exact = (r.need * col.w) / pot;
          const base = Math.floor(exact);
          cells.push({ r, col, v: base, frac: exact - base });
          r.need -= base; col.need -= base;
        }
      }
      cells.slice().sort((a, b) => b.frac - a.frac).forEach((x) => {
        if (x.r.need > 0 && x.col.need > 0) { x.v++; x.r.need--; x.col.need--; }
      });
      for (const x of cells) {
        const t = Math.min(x.r.need, x.col.need);
        if (t > 0) { x.v += t; x.r.need -= t; x.col.need -= t; }
      }
      for (const x of cells) add(x.r.id, x.col.id, x.v);
    }
    for (const f of this.jackpotFlows) add(f.from, f.to, f.cents);
    return [...map.entries()].map(([k, cents]) => {
      const [from, to] = k.split('>');
      return { from: Number(from), to: Number(to), cents };
    });
  }

  // Raund yarımçıq dayandırılır — hər kəsin banka qoyduğu geri qaytarılır
  abort(reason = 'Raund ləğv edildi — geri qaytarma') {
    if (this.phase === 'finished') return;
    for (const [id, amt] of Object.entries(this.contrib)) {
      const key = this.order.find((x) => String(x) === id);
      this.credit(key, amt, reason);
    }
    this.pot = 0;
    // istifadə olunmamış və yekunlaşmamış şərti borc silinir (borc yaranmır)
    if (this.creditPot) this.say('Raund ləğv edildi — şərti (borca) qoyuluşlar silindi, borc yaranmadı.');
    this.creditPot = 0; this.creditContrib = {}; this.creditDeal = null; this.creditLoans = [];
    this.phase = 'finished';
    this.turn = null;
    this.pending = null;
    this.secretAce = null;
    this.result = { winners: [], payouts: {}, how: 'aborted', shown: [], jackpots: [], flows: [], creditLoans: [] };
    this.say('Raund ləğv edildi, pullar qaytarıldı.');
    this.version++;
  }

  startSekaJoin(a, b, now) {
    if (this.secretAce) return this.openSecretAce('seka qərarı');
    // bərabər nəticə: şərti qoyuluşlar sekadan ƏVVƏL bağlanır (iki tərəf arasında bərabər) — növbəti raunda gizli borc keçmir
    if (this.creditPot) this.settleCredit({ [a]: 1, [b]: 1 }, 'seka');
    const eligible = this.participants().filter((id) => id !== a && id !== b && !this.left.has(id));
    this.phase = 'sekaJoin';
    this.pending = null;
    this.turn = null;
    // QAYDA (README 5d): bank bölünmür, TAM HƏCMİ ilə seka əlinə keçir (yalnız real xal — şərti qoyuluş yuxarıda bağlanıb).
    // Əsas iki oyunçu əlavə ödəmir. Bu raundda iştirak edib pas/uduzan oyunçu 2 × oyun haqqı ödəyib qoşula bilər.
    // Raund başlayandan sonra otağa gələn oyunçu bu sekaya qoşula bilməz (cari bankdan pay almır) — növbəti yeni raundu gözləyir.
    this.carry = { pot: this.pot, hands: (this.carry?.hands || 0) + 1 };
    this.sekaJoin = { base: [a, b], eligible, joined: [], skipped: [], cost: this.settings.ante * 2, carried: this.pot, deadline: now + TIMING.SEKA_JOIN_MS };
    this.say(`SEKA! Bank (${this.pot} xal) itirilmir — tam həcmi ilə seka əlinə keçir. Əsas oyunçular əlavə ödəmir; qoşulmaq üçün: ${this.sekaJoin.cost} xal.`);
  }

  startSekaHand(now) {
    const sj = this.sekaJoin;
    const ids = this.order.filter((id) => (sj.base.includes(id) || sj.joined.includes(id)) && !this.left.has(id));
    if (ids.length === 0) return this.abort();
    if (ids.length === 1) { this.sekaJoin = null; return this.finish([[ids[0]]], 'last'); }
    this.say(`Seka raundu başladı: ${ids.map((i) => this.name(i)).join(', ')}. Hər kəsə 4 kart.`);
    this.newHand(ids, true, now);
  }

  // Qoşulmaq hüququ olan, hələ qərar verməmiş oyunçular (balansı çatan, otaqda qalan)
  sekaWaiting() {
    const sj = this.sekaJoin;
    if (!sj) return [];
    return sj.eligible.filter((id) => !sj.joined.includes(id) && !(sj.skipped || []).includes(id) && !this.left.has(id) && this.canAfford(id, sj.cost));
  }

  allDiscarded() { return this.active().every((id) => this.ps[id].cards); }

  doDiscard(id, index, auto = false) {
    const me = this.ps[id];
    me.discarded = me.hand[index];
    me.cards = me.hand.filter((_, i) => i !== index);
    if (auto) this.say(`${this.name(id)} vaxtında kart seçmədi — 4-cü kart avtomatik atıldı.`);
    else this.say(`${this.name(id)} kartını atdı.`);
  }

  // ---------- oyunçu hərəkətləri ----------
  act(id, action, now = Date.now()) {
    this._act(id, action, now);
    // gizli seçim başqalarına görünən heç nəyi (versiya daxil) dəyişmir
    if (action?.type !== 'jackpotHide' && action?.type !== 'look') this.version++;
  }

  _act(id, action, now) {
    const t = action?.type;
    const me = this.ps[id];
    if (this.isSecretHolder(id) && ['xod', 'baxis', 'offerSeka', 'offerSplit'].includes(t)) this.secretAce.decided = true;
    if (this.left.has(id) && t !== 'look') throw new GameError('Siz bu raundu tərk etmisiniz.');
    switch (t) {
      case 'xod': {
        this.mustTurn(id);
        const min = this.minXod();
        const amount = Math.floor(Number(action.amount));
        if (!Number.isFinite(amount) || amount < min) throw new GameError(`Minimum xod: ${min} xal`);
        const max = this.settings.maxBet;
        if (max > 0 && amount > Math.max(max, min)) throw new GameError(`Maksimum xod: ${Math.max(max, min)} xal`);
        if (!this.canAfford(id, amount)) throw new GameError('Balans limiti buna icazə vermir.');
        this.debitToPot(id, amount, 'Xod', true);
        me.acted = true;
        this.currentBet = amount;
        this.say(`${this.name(id)}: xod ${amount} xal`);
        return this.advance(id, now);
      }
      case 'pas': {
        this.mustTurn(id);
        if (this.isSecretHolder(id)) throw new GameError('Cəkpot sahibi pas edə bilməz — cəkpotu açın və ya xod edin.');
        me.status = 'folded';
        this.say(`${this.name(id)}: pas`);
        return this.advance(id, now);
      }
      case 'baxis': {
        this.mustTurn(id);
        if (!this.firstCircleDone()) throw new GameError('Baxışma yalnız hamı ilk xodunu edəndən sonra mümkündür.');
        const target = this.prevActive(id);
        if (!target || target === id) throw new GameError('Baxışmaq üçün rəqib yoxdur.');
        const cost = this.minXod();
        if (!this.canAfford(id, cost)) throw new GameError('Balans limiti buna icazə vermir.');
        this.debitToPot(id, cost, 'Baxışma', true);
        me.acted = true;
        this.say(`${this.name(id)} ${this.name(target)} ilə baxışır (${cost} xal).`);
        if (action.tieOffer && this.active().length > 2) {
          this.phase = 'tieOffer';
          this.pending = { type: 'tieOffer', c: id, o: target, deadline: now + TIMING.DECISION_MS };
          this.say(`${this.name(id)} "eyni xala baxaq" təklif edir. ${this.name(target)} cavab verir...`);
          return;
        }
        return this.resolveCompare(id, target, false, now);
      }
      case 'offerSeka':
      case 'offerSplit': {
        this.mustTurn(id);
        const act = this.active();
        if (act.length !== 2) throw new GameError('Təklif yalnız 2 oyunçu qalanda mümkündür.');
        if (this.offerUsed) throw new GameError('Bu növbədə artıq təklif göndərmisiniz.');
        const left = this.turnDeadline - now;
        if (left < TIMING.MIN_OFFER_MS) throw new GameError('Təklif üçün vaxt azdır — xod edin.');
        const to = act.find((x) => x !== id);
        const kind = t === 'offerSeka' ? 'seka' : 'split';
        this.offerUsed = true;
        this.phase = 'offer';
        this.pending = { type: 'offer', kind, from: id, to, deadline: Math.min(now + TIMING.OFFER_MS, this.turnDeadline) };
        this.say(`${this.name(id)} ${kind === 'seka' ? 'Seka' : 'bankı bölməyi'} təklif edir.`);
        return;
      }
      case 'offerAccept':
      case 'offerDecline': {
        const p = this.pending;
        if (this.phase !== 'offer' || p.to !== id) throw new GameError('Sizdən cavab gözlənilmir.');
        if (t === 'offerDecline') return this.endOffer(false);
        this.say(`${this.name(id)} təklifi qəbul etdi.`);
        if (p.kind === 'split') return this.finish([[p.from], [p.to]], 'split');
        return this.startSekaJoin(p.from, p.to, now);
      }
      case 'tieAccept':
      case 'tieDecline': {
        if (this.phase !== 'tieOffer' || this.pending.o !== id) throw new GameError('Sizdən cavab gözlənilmir.');
        const { c, o } = this.pending;
        const ok = t === 'tieAccept';
        this.say(`${this.name(o)} bərabərlik təklifini ${ok ? 'qəbul etdi' : 'rədd etdi'}.`);
        return this.resolveCompare(c, o, ok, now);
      }
      case 'tieVote': {
        const p = this.pending;
        if (this.phase !== 'tieDecision' || (p.a !== id && p.b !== id)) throw new GameError('Sizdən cavab gözlənilmir.');
        if (action.choice !== 'seka' && action.choice !== 'bol') throw new GameError('Yanlış seçim.');
        if (p.votes[id]) throw new GameError('Artıq seçim etmisiniz.');
        p.votes[id] = action.choice;
        this.say(`${this.name(id)}: ${action.choice === 'seka' ? 'Seka' : 'Bölək'}`);
        if (p.votes[p.a] && p.votes[p.b]) return this.decideTie(now);
        return;
      }
      case 'sekaJoin': {
        const sj = this.sekaJoin;
        if (this.phase !== 'sekaJoin' || !sj.eligible.includes(id)) throw new GameError('Sekaya qoşula bilməzsiniz.');
        if (sj.joined.includes(id)) throw new GameError('Artıq qoşulmusunuz.');
        if ((sj.skipped || []).includes(id)) throw new GameError('Qoşulmayacağınızı bildirmisiniz.');
        if (!this.canAfford(id, sj.cost)) throw new GameError('Balans limiti buna icazə vermir.');
        this.debitToPot(id, sj.cost, 'Sekaya qoşulma');
        sj.joined.push(id);
        this.say(`${this.name(id)} sekaya qoşuldu (${sj.cost} xal).`);
        return;
      }
      case 'sekaSkip': {
        const sj = this.sekaJoin;
        if (this.phase !== 'sekaJoin' || !sj.eligible.includes(id) || sj.joined.includes(id)) throw new GameError('Sizdən cavab gözlənilmir.');
        if (!sj.skipped.includes(id)) { sj.skipped.push(id); this.say(`${this.name(id)} sekaya qoşulmur.`); }
        return;
      }
      case 'sekaStart': {
        if (this.phase !== 'sekaJoin' || !this.sekaJoin.base.includes(id)) throw new GameError('Sekanı yalnız əsas iki oyunçu başlada bilər.');
        const waiting = this.sekaWaiting();
        if (waiting.length) throw new GameError(`Qoşulma vaxtı bitməyib: ${waiting.map((x) => this.name(x)).join(', ')} hələ qərar verməyib.`);
        return this.startSekaHand(now);
      }
      // ---------- "Borca oyna" (yalnız iki aktiv insan oyunçu qalanda) ----------
      case 'creditOffer': {
        this.mustTurn(id);
        if (!this.allowCredit) throw new GameError('Borca oyun yalnız real otaqda (botsuz, demo olmayan) mümkündür.');
        const act = this.active();
        if (act.length !== 2 || act.some((x) => x < 0)) throw new GameError('Borca oyun yalnız iki aktiv oyunçu qalanda mümkündür.');
        const to = act.find((x) => x !== id);
        const d = this.creditDeal;
        if (d && d.debtor !== id) throw new GameError('Bu raundda borca oyun razılaşması artıq qarşı tərəf üçündür.');
        if (this.isSecretHolder(id)) throw new GameError('İndi borca oyun təklif etmək olmaz.');
        if ((this.creditOffersThisTurn || 0) >= 2) throw new GameError('Bu növbədə təklif limiti bitib.');
        const limit = Math.floor(Number(action.limit));
        const dueDays = Math.floor(Number(action.dueDays ?? 7));
        if (!Number.isFinite(limit) || limit < 1 || limit > CREDIT_MAX_LIMIT) throw new GameError('Limit müsbət tam ədəd olmalıdır.');
        if (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 30) throw new GameError('Qaytarma müddəti 1–30 gün olmalıdır.');
        if (d && limit <= d.limit) throw new GameError(`Yeni limit mövcud limitdən (${d.limit} xal) böyük olmalıdır.`);
        const used = d ? d.used : 0;
        if (limit <= used) throw new GameError('Limit artıq istifadə olunan məbləğdən böyük olmalıdır.');
        const shortfall = Math.max(0, this.minXod() - Math.max(0, this.players.get(id).balance) - (d ? d.limit - d.used : 0));
        if (!d && shortfall <= 0) throw new GameError('Balansınız xoda çatır — borca oynamağa ehtiyac yoxdur.');
        if (limit - used < shortfall) throw new GameError(`Limit ən azı çatışmayan məbləğ qədər olmalıdır (${shortfall + used} xal).`);
        this.creditOffersThisTurn = (this.creditOffersThisTurn || 0) + 1;
        this.phase = 'creditOffer';
        this.pending = { type: 'creditOffer', from: id, to, limit, prevLimit: d ? d.limit : 0, used, shortfall, dueDays,
          deadline: now + TIMING.CREDIT_OFFER_MS, turnLeft: Math.max(0, this.turnDeadline - now) };
        this.say(`${this.name(id)} ${this.name(to)}-a "borca oyna" təklif edir: ${limit} xala qədər${d ? ` (əvvəlki limit ${d.limit})` : ''}, qaytarma ${dueDays} gün.`);
        return;
      }
      case 'creditAccept':
      case 'creditDecline': {
        const p = this.pending;
        if (this.phase !== 'creditOffer' || !p || p.to !== id) throw new GameError('Sizdən cavab gözlənilmir.');
        if (t === 'creditAccept' && Number(action.limit) !== p.limit) throw new GameError('Təklifin məbləği dəyişib — yenidən baxın.');
        return this.endCreditOffer(t === 'creditAccept', now, false);
      }
      case 'discard': {
        if (this.phase !== 'discard') throw new GameError('İndi kart atmaq olmaz.');
        if (!me || me.status !== 'active') throw new GameError('Siz bu sekada iştirak etmirsiniz.');
        if (me.cards) throw new GameError('Artıq kart atmısınız.');
        const index = Number(action.index);
        if (!Number.isInteger(index) || index < 0 || index >= me.hand.length) throw new GameError('Kart seçin.');
        this.doDiscard(id, index);
        if (this.allDiscarded()) return this.afterDeal(now);
        return;
      }
      case 'jackpotOpen': {
        if (!this.isSecretHolder(id)) throw new GameError('Sizdə açılmamış cəkpot yoxdur.');
        if (!['betting', 'offer', 'tieOffer'].includes(this.phase)) throw new GameError('İndi cəkpotu açmaq olmaz.');
        return this.openSecretAce(null);
      }
      // Oyunçu kartlarına baxdı (küncdən baxma / "Göstər"). Yalnız özünə aiddir, başqalarına heç nə dəyişmir.
      case 'look': {
        if (!me) throw new GameError('Sizin kartınız yoxdur.');
        me.looked = true;
        return;
      }
      case 'jackpotHide': {
        if (!this.isSecretHolder(id)) throw new GameError('Sizdə açılmamış cəkpot yoxdur.');
        this.secretAce.decided = true;
        this.secretAce.hidden = true;
        return; // heç kimə bildiriş getmir
      }
      case 'votePas': {
        if (this.phase !== 'betting') throw new GameError('İndi səsvermə mümkün deyil.');
        if (!me || me.status !== 'active' || id === this.turn) throw new GameError('Səs verə bilməzsiniz.');
        if (now < this.turnDeadline) throw new GameError('Vaxt hələ bitməyib.');
        if (this.votes.has(id)) throw new GameError('Artıq səs vermisiniz.');
        this.votes.add(id);
        const needed = Math.ceil((this.active().length - 1) / 2);
        this.say(`${this.name(id)} ${this.name(this.turn)} üçün "pas" səsi verdi (${this.votes.size}/${needed}).`);
        if (this.votes.size >= needed) {
          const target = this.turn;
          // gizli cəkpot sahibi səsvermə ilə pas edilmir — cəkpot avtomatik açılır
          if (this.isSecretHolder(target)) return this.openSecretAce('növbə vaxtı bitdi');
          this.ps[target].status = 'folded';
          this.say(`${this.name(target)} səsvermə ilə avtomatik pas edildi.`);
          return this.advance(target, now);
        }
        return;
      }
      default:
        throw new GameError('Naməlum hərəkət.');
    }
  }

  endOffer(timeout) {
    const p = this.pending;
    this.say(timeout ? `${this.name(p.to)} vaxtında cavab vermədi — təklif rədd sayılır.` : `${this.name(p.to)} təklifi rədd etdi. Oyun davam edir.`);
    this.phase = 'betting';
    this.pending = null;
  }

  endCreditOffer(ok, now, timeout) {
    const p = this.pending;
    this.phase = 'betting';
    this.pending = null;
    // növbə taymeri təklif müddətində dayanmışdı — qalan vaxtla davam edir
    this.turnDeadline = now + Math.max(p.turnLeft, TIMING.CREDIT_MIN_RESUME_MS);
    if (ok) {
      const d = this.creditDeal;
      if (d) { d.limit = p.limit; d.dueDays = p.dueDays; } else this.creditDeal = { debtor: p.from, creditor: p.to, limit: p.limit, used: 0, dueDays: p.dueDays };
      this.say(`${this.name(p.to)} qəbul etdi: ${this.name(p.from)} ${p.limit} xala qədər borca oynaya bilər (istifadə olunan hissə uduzanda borc yazılır).`);
      return;
    }
    this.say(timeout ? `${this.name(p.to)} 30 saniyədə cavab vermədi — borca oyun təklifi rədd sayılır.` : `${this.name(p.to)} borca oyun təklifini rədd etdi.`);
    // balansı (və əvvəl razılaşdırılmış limiti) xoda çatmırsa — avtomatik pas
    if (!this.canAfford(p.from, this.minXod()) && this.ps[p.from]?.status === 'active') {
      this.ps[p.from].status = 'folded';
      this.say(`${this.name(p.from)} balansı çatmadığı üçün avtomatik pas oldu.`);
      return this.advance(p.from, now);
    }
  }

  mustTurn(id) {
    if (this.phase !== 'betting') throw new GameError('İndi xod etmək olmaz.');
    if (this.turn !== id) throw new GameError('Növbə sizdə deyil.');
  }

  decideTie(now) {
    const p = this.pending;
    if (p.votes[p.a] === 'seka' && p.votes[p.b] === 'seka') return this.startSekaJoin(p.a, p.b, now);
    return this.finish([[p.a], [p.b]], 'split', [p.a, p.b]);
  }

  // Vaxtı keçmiş qərarlar (server hər saniyə çağırır). Dəyişiklik olubsa true qaytarır.
  tick(now = Date.now()) {
    const changed = this._tick(now);
    if (changed) this.version++;
    return changed;
  }

  _tick(now) {
    // gizli cəkpot sahibinin növbə vaxtı bitdi → cəkpot açılır (oyun kilidlənmir)
    if (this.phase === 'betting' && this.isSecretHolder(this.turn) && now >= this.turnDeadline) { this.openSecretAce('növbə vaxtı bitdi'); return true; }
    if (this.phase === 'offer' && now >= this.pending.deadline) { this.endOffer(true); return true; }
    if (this.phase === 'creditOffer' && now >= this.pending.deadline) { this.endCreditOffer(false, now, true); return true; }
    if (this.phase === 'tieOffer' && now >= this.pending.deadline) {
      const { c, o } = this.pending;
      this.say(`${this.name(o)} vaxtında cavab vermədi — təklif rədd sayılır.`);
      this.resolveCompare(c, o, false, now);
      return true;
    }
    if (this.phase === 'tieDecision' && now >= this.pending.deadline) {
      const p = this.pending;
      for (const id of [p.a, p.b]) if (!p.votes[id]) p.votes[id] = 'bol';
      this.decideTie(now);
      return true;
    }
    if (this.phase === 'sekaJoin' && now >= this.sekaJoin.deadline) { this.say('Qoşulma vaxtı bitdi — seka qoşulanlarla davam edir.'); this.startSekaHand(now); return true; }
    if (this.phase === 'discard' && now >= this.discardDeadline) {
      for (const id of this.active()) if (!this.ps[id].cards) this.doDiscard(id, this.ps[id].hand.length - 1, true);
      this.afterDeal(now);
      return true;
    }
    return false;
  }

  // Oyunçu otaqdan çıxdı (və ya çıxarıldı)
  removePlayer(id, now = Date.now()) {
    this._remove(id, now);
    this.version++;
  }

  _remove(id, now) {
    if (this.phase === 'finished' || this.left.has(id)) return;
    this.left.add(id);
    // cəkpot sahibi çıxsa cəkpot səssiz ləğv olunmur — açılır və hesablanır
    if (this.isSecretHolder(id)) { this.openSecretAce('sahib otaqdan çıxdı'); return; }
    const me = this.ps[id];
    if (this.phase === 'sekaJoin') {
      const sj = this.sekaJoin;
      sj.eligible = sj.eligible.filter((x) => x !== id);
      if (sj.base.every((x) => this.left.has(x))) this.startSekaHand(now);
      return;
    }
    if (!me || me.status !== 'active') return;
    me.status = 'folded';
    this.say(`${this.name(id)} oyunu tərk etdi (pas).`);
    if (this.phase === 'discard') {
      if (this.active().length <= 1 || this.allDiscarded()) this.afterDeal(now);
      return;
    }
    if (this.phase === 'tieDecision') {
      const p = this.pending;
      return this.finish([[p.a === id ? p.b : p.a]], 'last');
    }
    if (this.phase === 'offer' || this.phase === 'tieOffer' || this.phase === 'creditOffer') {
      this.phase = 'betting';
      this.pending = null;
      if (this.turn === id || this.active().length <= 1) return this.advance(id, now);
      return;
    }
    if (this.turn === id || this.active().length <= 1) this.advance(id, now);
  }

  // ---------- oyunçuya görünən vəziyyət (yalnız icazəli məlumat) ----------
  viewFor(uid, now = Date.now()) {
    const mine = this.ps[uid];
    const shownIds = new Set((this.result?.shown || []).map((s) => s.id));
    const players = this.order.map((id) => {
      const p = this.ps[id];
      // başqasının kartı yalnız: baxışmada qarşılaşdıqda (yalnız ikisi görür) və ya nəticədə açıldıqda
      const visible = p && p.cards && (id === uid || (mine && mine.seen.has(id)) || shownIds.has(id));
      return {
        id,
        name: this.name(id),
        // MƏXFİLİK: dəqiq balans yalnız oyunçunun özünə göndərilir (başqalarının balansı brauzerə ümumiyyətlə getmir)
        balance: id === uid ? this.players.get(id).balance : null,
        inHand: !!p,
        status: p ? p.status : 'out',
        attachedTo: p?.attachedTo ?? null,
        cardCount: p ? (p.cards ? p.cards.length : p.hand.length) : 0,
        put: this.contrib[id] || 0, // banka REAL balansdan qoyduğu cəmi (hamıya açıq məlumat — masada pul görünür)
        creditPut: this.creditContrib[id] || 0, // şərti (borca) qoyuluş — ayrıca nişanla göstərilir
        discarded: !!(p && p.cards && this.isSeka),
        cards: visible ? p.cards : null,
        // öz xalım yalnız kartlara baxandan sonra (və ya raund bitəndə); başqasınınkı yalnız açıldıqda
        score: visible && (id !== uid || p.looked || this.phase === 'finished' || shownIds.has(id)) ? handScore(p.cards) : null,
      };
    });
    const isTurn = this.phase === 'betting' && this.turn === uid;
    const overdue = this.phase === 'betting' && now >= this.turnDeadline;
    const activeCount = this.active().length;
    let me = null;
    if (mine) {
      const fc = this.firstCircleDone();
      me = {
        hand: mine.hand,
        cards: mine.cards,
        discarded: mine.discarded,
        mustDiscard: this.phase === 'discard' && mine.status === 'active' && !mine.cards,
        // xal yalnız kartlara baxandan sonra; raund bitəndə öz xalım həmişə görünür
        score: mine.cards && (mine.looked || this.phase === 'finished') ? handScore(mine.cards) : null,
        looked: !!mine.looked,
        status: mine.status,
        attachedTo: mine.attachedTo,
        isTurn,
        canBaxis: isTurn && fc,
        baxisHint: fc ? null : 'Baxış hamı ilk xodunu edəndən sonra açılır.',
        baxisTarget: isTurn ? this.prevActive(uid) : null,
        canOffer: isTurn && activeCount === 2 && !this.offerUsed && this.turnDeadline - now >= TIMING.MIN_OFFER_MS,
        canVote: overdue && mine.status === 'active' && this.turn !== uid && !this.votes.has(uid),
        canPas: isTurn && !this.isSecretHolder(uid),
        canAffordMin: this.canAfford(uid, this.minXod()),
        available: this.available(uid),
        creditLeft: this.creditLeft(uid),
        creditShortfall: Math.max(0, this.minXod() - this.available(uid)),
        // borca oyun təklifi: növbə məndə, iki aktiv insan, real otaq, qarşı tərəf borclu deyil
        canCreditOffer: isTurn && this.allowCredit && activeCount === 2 && this.active().every((x) => x > 0)
          && !(this.creditDeal && this.creditDeal.debtor !== uid) && !this.isSecretHolder(uid) && (this.creditOffersThisTurn || 0) < 2
          && (!!this.creditDeal || !this.canAfford(uid, this.minXod())),
        // gizli 3 Tuz — YALNIZ sahibinin görünüşündə
        secretJackpot: this.isSecretHolder(uid) ? { kind: 'ace', decided: this.secretAce.decided, amount: this.jackpotAmount('ace') } : null,
      };
    }
    let pending = null;
    if (this.pending) {
      const { votes, ...rest } = this.pending;
      pending = { ...rest, voted: votes ? Object.keys(votes).map(Number) : undefined };
      // borca oyun təklifində "çatışmayan məbləğ" borclunun balansını göstərir — yalnız iki tərəfə (risk məlumatı)
      if (pending.type === 'creditOffer' && uid !== pending.from && uid !== pending.to) { delete pending.shortfall; delete pending.turnLeft; }
    }
    let result = null;
    if (this.result) {
      const { flows, ...r } = this.result; // axınlar yalnız serverdə qalır
      result = r;
    }
    return {
      version: this.version,
      phase: this.phase,
      handNo: this.handNo,
      isSeka: !!this.isSeka,
      pot: this.pot,
      currentBet: this.currentBet,
      minXod: this.minXod(),
      maxBet: this.settings.maxBet,
      turn: this.turn,
      turnDeadline: this.turnDeadline,
      discardDeadline: this.phase === 'discard' ? this.discardDeadline : null,
      activeCount,
      players,
      me,
      votes: this.votes.size,
      votesNeeded: Math.ceil((activeCount - 1) / 2),
      pending,
      sekaJoin: this.sekaJoin ? { ...this.sekaJoin, waiting: this.sekaWaiting() } : null,
      carry: this.carry ? { ...this.carry } : null, // sekadan keçən bank (göstəriş üçün)
      creditPot: this.creditPot,
      creditDeal: this.creditDeal ? { ...this.creditDeal } : null,
      result,
      log: this.log.slice(-40),
    };
  }
}
