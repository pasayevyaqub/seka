// Seka oyun mühərriki (v2) — server-authoritative, socket/DB-dən asılı deyil.
// Pul hərəkətləri `effects` massivinə yazılır, server onları DB-yə (və ya məşq balansına) tətbiq edir.
import { newDeck, shuffle, handScore, jackpotKind, cardLabel } from './cards.js';

export const DEFAULT_SETTINGS = {
  ante: 10,          // oyun haqqı (oyun xalı)
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
  DECISION_MS: 30_000,   // "eyni xala baxaq" cavabı, bərabər xal qərarı, sekaya qoşulma
  DISCARD_MS: 30_000,    // sekada kart atma vaxtı
};

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
    this.contrib = {};          // id → banka qoyduğu cəmi (seka daxil)
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

  // Balans heç vaxt 0-dan aşağı düşmür
  canAfford(id, amount) {
    const p = this.players.get(id);
    return !!p && p.balance >= amount;
  }

  debitToPot(id, amount, reason) {
    if (amount <= 0) return;
    this.players.get(id).balance -= amount;
    this.pot += amount;
    this.contrib[id] = (this.contrib[id] || 0) + amount;
    this.effects.push({ userId: id, delta: -amount, reason });
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
    for (const id of this.order) if (!ids.includes(id)) this.say(`${this.name(id)} — balans oyun haqqına (${ante} oyun xalı) çatmır, bu raundda iştirak etmir.`);
    if (ids.length < 2) throw new GameError('Raund üçün balansı oyun haqqına çatan ən azı 2 oyunçu lazımdır.');
    this.order = ids;
    for (const id of ids) this.debitToPot(id, ante, 'Oyun haqqı');
    this.say(`Yeni raund. Hər oyunçu ${ante} oyun xalı oyun haqqı qoydu.`);
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
      this.say(`🎉 CƏKPOT (${kind === 'ace' ? '3 Tuz' : '3 dənə 6'})! ${this.name(h)}: ${this.ps[h].cards.map(cardLabel).join(' ')} — rəqiblərdən cəmi ${payments.reduce((s, x) => s + x.paid, 0)} oyun xalı`);
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
    this.pot = 0;
    this.phase = 'finished';
    this.turn = null;
    this.pending = null;
    const shown = shownIds.filter((id) => this.ps[id]?.cards).map((id) => ({
      id, name: this.name(id), cards: this.ps[id].cards, score: handScore(this.ps[id].cards),
    }));
    this.result = { winners, payouts, how, shown, jackpots: this.jackpots, flows: this.computeFlows(payouts) };
    const names = winners.map((id) => `${this.name(id)} (+${payouts[id]} oyun xalı)`).join(', ');
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
    this.phase = 'finished';
    this.turn = null;
    this.pending = null;
    this.secretAce = null;
    this.result = { winners: [], payouts: {}, how: 'aborted', shown: [], jackpots: [], flows: [] };
    this.say('Raund ləğv edildi, pullar qaytarıldı.');
    this.version++;
  }

  startSekaJoin(a, b, now) {
    if (this.secretAce) return this.openSecretAce('seka qərarı');
    const eligible = this.participants().filter((id) => id !== a && id !== b && !this.left.has(id));
    this.phase = 'sekaJoin';
    this.pending = null;
    this.turn = null;
    this.sekaJoin = { base: [a, b], eligible, joined: [], cost: this.settings.ante * 2, deadline: now + TIMING.DECISION_MS };
    this.say(`SEKA! Bank (${this.pot} oyun xalı) növbəti raunda keçir. Qoşulmaq üçün: ${this.sekaJoin.cost} oyun xalı.`);
  }

  startSekaHand(now) {
    const sj = this.sekaJoin;
    const ids = this.order.filter((id) => (sj.base.includes(id) || sj.joined.includes(id)) && !this.left.has(id));
    if (ids.length === 0) return this.abort();
    if (ids.length === 1) { this.sekaJoin = null; return this.finish([[ids[0]]], 'last'); }
    this.say(`Seka raundu başladı: ${ids.map((i) => this.name(i)).join(', ')}. Hər kəsə 4 kart.`);
    this.newHand(ids, true, now);
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
    if (action?.type !== 'jackpotHide') this.version++;
  }

  _act(id, action, now) {
    const t = action?.type;
    const me = this.ps[id];
    if (this.isSecretHolder(id) && ['xod', 'baxis', 'offerSeka', 'offerSplit'].includes(t)) this.secretAce.decided = true;
    if (this.left.has(id)) throw new GameError('Siz bu raundu tərk etmisiniz.');
    switch (t) {
      case 'xod': {
        this.mustTurn(id);
        const min = this.minXod();
        const amount = Math.floor(Number(action.amount));
        if (!Number.isFinite(amount) || amount < min) throw new GameError(`Minimum xod: ${min} oyun xalı`);
        const max = this.settings.maxBet;
        if (max > 0 && amount > Math.max(max, min)) throw new GameError(`Maksimum xod: ${Math.max(max, min)} oyun xalı`);
        if (!this.canAfford(id, amount)) throw new GameError('Balans limiti buna icazə vermir.');
        this.debitToPot(id, amount, 'Xod');
        me.acted = true;
        this.currentBet = amount;
        this.say(`${this.name(id)}: xod ${amount} oyun xalı`);
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
        this.debitToPot(id, cost, 'Baxışma');
        me.acted = true;
        this.say(`${this.name(id)} ${this.name(target)} ilə baxışır (${cost} oyun xalı).`);
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
        if (!this.canAfford(id, sj.cost)) throw new GameError('Balans limiti buna icazə vermir.');
        this.debitToPot(id, sj.cost, 'Sekaya qoşulma');
        sj.joined.push(id);
        this.say(`${this.name(id)} sekaya qoşuldu (${sj.cost} oyun xalı).`);
        return;
      }
      case 'sekaStart': {
        if (this.phase !== 'sekaJoin' || !this.sekaJoin.base.includes(id)) throw new GameError('Sekanı yalnız əsas iki oyunçu başlada bilər.');
        return this.startSekaHand(now);
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
    if (this.phase === 'sekaJoin' && now >= this.sekaJoin.deadline) { this.startSekaHand(now); return true; }
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
    if (this.phase === 'offer' || this.phase === 'tieOffer') {
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
        balance: this.players.get(id).balance,
        inHand: !!p,
        status: p ? p.status : 'out',
        attachedTo: p?.attachedTo ?? null,
        cardCount: p ? (p.cards ? p.cards.length : p.hand.length) : 0,
        put: this.contrib[id] || 0, // banka qoyduğu cəmi (hamıya açıq məlumat — masada pul görünür)
        discarded: !!(p && p.cards && this.isSeka),
        cards: visible ? p.cards : null,
        score: visible ? handScore(p.cards) : null,
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
        score: mine.cards ? handScore(mine.cards) : null,
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
        // gizli 3 Tuz — YALNIZ sahibinin görünüşündə
        secretJackpot: this.isSecretHolder(uid) ? { kind: 'ace', decided: this.secretAce.decided, amount: this.jackpotAmount('ace') } : null,
      };
    }
    let pending = null;
    if (this.pending) {
      const { votes, ...rest } = this.pending;
      pending = { ...rest, voted: votes ? Object.keys(votes).map(Number) : undefined };
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
      sekaJoin: this.sekaJoin,
      result,
      log: this.log.slice(-40),
    };
  }
}
