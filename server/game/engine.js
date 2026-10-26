// Seka oyun mühərriki — server-authoritative, socket/DB-dən asılı deyil.
// Pul hərəkətləri `effects` massivinə yazılır, server onları DB-yə tətbiq edir.
import { newDeck, shuffle, handScore, isJackpot, cardLabel } from './cards.js';

export const DEFAULT_SETTINGS = {
  ante: 10,          // oyun haqqı
  minBet: 10,        // minimum xod
  maxBet: 0,         // maksimum xod (0 = limitsiz)
  jackpotAmount: 0,  // cəkpotda hər oyunçunun ödədiyi məbləğ
  turnSeconds: 60,   // xod üçün vaxt
  debtLimit: 0,      // mənfi balans limiti (0 = limitsiz)
  maxPlayers: 8,
};

const DECISION_MS = 30_000; // bərabərlik təklifi / seka qərarı / sekaya qoşulma

export class GameError extends Error {}

export class Round {
  /**
   * @param {object} o
   * @param {{id:string|number,name:string,balance:number}[]} o.players  oturma sırası ilə (ilk xod edən birinci)
   * @param {object} o.settings
   * @param {number} [o.now]
   * @param {(handNo:number, ids:any[], cardCount:number)=>Record<string,{r:string,s:string}[]>} [o.dealer] testlər üçün
   */
  constructor({ players, settings, now = Date.now(), dealer = null }) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.players = new Map(players.map((p) => [p.id, { id: p.id, name: p.name, balance: p.balance }]));
    this.order = players.map((p) => p.id);
    this.dealer = dealer;
    this.pot = 0;
    this.contrib = {};
    this.handNo = 0;
    this.effects = [];
    this.log = [];
    this.phase = 'init';
    this.result = null;
    this.ps = {};
    this.pending = null;
    this.sekaJoin = null;
    this.turn = null;
    this.turnDeadline = 0;
    this.votes = new Set();
    this.currentBet = 0;
    this.start(now);
  }

  // ---------- köməkçilər ----------
  name(id) { return this.players.get(id)?.name ?? '?'; }
  say(msg) { this.log.push({ t: Date.now(), msg }); if (this.log.length > 200) this.log.shift(); }

  canAfford(id, amount) {
    const p = this.players.get(id);
    const limit = this.settings.debtLimit;
    if (!limit) return true;
    return p.balance - amount >= -limit;
  }

  debitToPot(id, amount, reason) {
    if (amount <= 0) return;
    const p = this.players.get(id);
    p.balance -= amount;
    this.pot += amount;
    this.contrib[id] = (this.contrib[id] || 0) + amount;
    this.effects.push({ userId: id, delta: -amount, reason });
  }

  // Raund yarımçıq dayandırılır (məs. otaq bağlandı) — hər kəsin banka qoyduğu geri qaytarılır
  abort(reason = 'Raund ləğv edildi — geri qaytarma') {
    if (this.phase === 'finished') return;
    for (const [id, amt] of Object.entries(this.contrib)) {
      const key = this.order.find((x) => String(x) === id) ?? id;
      this.credit(key, amt, reason);
    }
    this.pot = 0;
    this.phase = 'finished';
    this.turn = null;
    this.result = { winners: [], payouts: {}, how: 'aborted' };
    this.say('Raund ləğv edildi, pullar qaytarıldı.');
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
    if (ids.length < 2) throw new GameError('Raund üçün kifayət qədər oyunçu yoxdur (balans limiti).');
    this.order = ids;
    for (const id of ids) this.debitToPot(id, ante, 'Oyun haqqı');
    this.say(`Yeni raund. Hər oyunçu ${ante} oyun haqqı qoydu.`);
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
      this.ps[id] = { cards: hands[id], status: 'active', declared: null, acted: false, attachedTo: null, seen: new Set() };
    }
    this.currentBet = 0;
    this.pending = null;
    this.sekaJoin = null;
    this.phase = 'betting';
    this.revealAll = false;

    // Cəkpot yoxlanışı
    const holders = ids.filter((id) => isJackpot(hands[id]));
    if (holders.length) {
      const amt = this.settings.jackpotAmount;
      const others = ids.filter((id) => !holders.includes(id));
      for (const h of holders) {
        this.say(`🎉 CƏKPOT! ${this.name(h)}: ${hands[h].map(cardLabel).join(' ')}`);
        for (const o of others) this.transfer(o, h, amt, 'Cəkpot');
      }
      this.finish(holders, 'jackpot');
      return;
    }
    this.beginTurn(ids[0], now);
  }

  beginTurn(id, now) {
    this.turn = id;
    this.turnDeadline = now + this.settings.turnSeconds * 1000;
    this.votes = new Set();
    // "Oyunum yoxdur" + sağındakı da "oyunum yoxdur" → məcburi baxışma
    const me = this.ps[id];
    if (this.firstCircleDone() && me.declared === 'yox') {
      const prev = this.prevActive(id);
      if (prev && prev !== id && this.ps[prev].declared === 'yox') {
        const cost = this.currentBet;
        if (cost > 0) this.debitToPot(id, cost, 'Məcburi baxışma');
        this.say(`${this.name(id)} və ${this.name(prev)} — ikisinin də oyunu yoxdur, məcburi baxışma.`);
        this.resolveCompare(id, prev, false, now);
      }
    }
  }

  advance(fromId, now) {
    if (this.phase !== 'betting') return;
    const act = this.active();
    if (act.length <= 1) return this.finish(act, 'last');
    this.beginTurn(this.nextActive(fromId), now);
  }

  lose(id) { this.ps[id].status = 'lost'; }

  resolveCompare(c, o, tieDeal, now) {
    const sc = handScore(this.ps[c].cards);
    const so = handScore(this.ps[o].cards);
    this.ps[c].seen.add(o);
    this.ps[o].seen.add(c);
    const finalTwo = this.active().length === 2;
    if (sc > so) {
      this.lose(o);
      this.say(`Baxışma: ${this.name(c)} qalib gəldi, ${this.name(o)} çıxdı.`);
    } else if (sc < so) {
      this.lose(c);
      this.say(`Baxışma: ${this.name(o)} qalib gəldi, ${this.name(c)} çıxdı.`);
    } else if (finalTwo) {
      this.phase = 'tieDecision';
      this.pending = { type: 'tieDecision', a: c, b: o, votes: {}, deadline: now + DECISION_MS, score: sc };
      this.revealAll = true;
      this.say(`Xallar bərabərdir (${sc})! ${this.name(c)} və ${this.name(o)}: Seka və ya bankı bölmək?`);
      return;
    } else if (tieDeal) {
      this.ps[c].status = 'attached';
      this.ps[c].attachedTo = o;
      this.say(`Baxışma bərabər çıxdı. Razılığa görə ${this.name(c)} ${this.name(o)} ilə şərikdir (qalib gəlsə bank bölünəcək).`);
    } else {
      this.lose(c);
      this.say(`Baxışma bərabər çıxdı — çağıran ${this.name(c)} çıxdı.`);
    }
    if (this.active().length <= 1) return this.finish(this.active(), 'compare');
    this.phase = 'betting';
    this.pending = null;
    this.advance(c, now);
  }

  // qalib + ona bağlanmış (attached) oyunçular
  groupOf(winners) {
    const group = [...winners];
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of this.participants()) {
        const p = this.ps[id];
        if (p.status === 'attached' && group.includes(p.attachedTo) && !group.includes(id)) {
          group.push(id); changed = true;
        }
      }
    }
    return group;
  }

  finish(winners, how) {
    const group = this.groupOf(winners);
    const pot = this.pot;
    const share = Math.floor(pot / group.length);
    let rest = pot - share * group.length;
    const payouts = {};
    for (const id of group) {
      const amt = share + (rest > 0 ? 1 : 0);
      if (rest > 0) rest--;
      payouts[id] = amt;
      this.credit(id, amt, group.length > 1 ? 'Bank bölündü' : 'Bank udu');
    }
    this.pot = 0;
    this.phase = 'finished';
    this.turn = null;
    this.pending = null;
    this.revealAll = how !== 'last';
    this.result = { winners: group, payouts, how };
    const names = group.map((id) => `${this.name(id)} (+${payouts[id]})`).join(', ');
    this.say(group.length > 1 ? `Bank bölündü: ${names}` : `Qalib: ${names}`);
  }

  startSekaJoin(now) {
    const { a, b } = this.pending;
    const eligible = this.participants().filter((id) => id !== a && id !== b);
    this.phase = 'sekaJoin';
    this.pending = null;
    this.sekaJoin = { base: [a, b], eligible, joined: [], cost: this.settings.ante * 2, deadline: now + DECISION_MS };
    this.say(`SEKA! Bank (${this.pot}) növbəti raunda keçir. Qoşulmaq üçün: ${this.sekaJoin.cost}.`);
  }

  startSekaHand(now) {
    const sj = this.sekaJoin;
    const ids = this.order.filter((id) => sj.base.includes(id) || sj.joined.includes(id));
    if (ids.length < 2) return this.finish(ids, 'last');
    this.say(`Seka raundu başladı: ${ids.map((i) => this.name(i)).join(', ')}. Hər kəsə 4 kart.`);
    this.newHand(ids, true, now);
  }

  // ---------- oyunçu hərəkətləri ----------
  act(id, action, now = Date.now()) {
    const t = action?.type;
    const me = this.ps[id];
    switch (t) {
      case 'xod': {
        this.mustTurn(id);
        const min = this.minXod();
        const amount = Math.floor(Number(action.amount));
        if (!Number.isFinite(amount) || amount < min) throw new GameError(`Minimum xod: ${min}`);
        const max = this.settings.maxBet;
        if (max > 0 && amount > Math.max(max, min)) throw new GameError(`Maksimum xod: ${Math.max(max, min)}`);
        if (!this.canAfford(id, amount)) throw new GameError('Balans limiti buna icazə vermir.');
        this.debitToPot(id, amount, 'Xod');
        if (!me.declared) me.declared = 'var';
        me.acted = true;
        this.currentBet = amount;
        this.say(`${this.name(id)}: xod ${amount}`);
        return this.advance(id, now);
      }
      case 'yox': {
        this.mustTurn(id);
        if (me.declared) throw new GameError('Artıq seçim etmisiniz.');
        const amount = this.minXod();
        if (!this.canAfford(id, amount)) throw new GameError('Balans limiti buna icazə vermir.');
        this.debitToPot(id, amount, 'Oyunum yoxdur');
        me.declared = 'yox';
        me.acted = true;
        this.currentBet = Math.max(this.currentBet, amount);
        this.say(`${this.name(id)}: oyunum yoxdur (${amount})`);
        return this.advance(id, now);
      }
      case 'pas': {
        this.mustTurn(id);
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
        this.say(`${this.name(id)} ${this.name(target)} ilə baxışır (${cost}).`);
        if (action.tieOffer && this.active().length > 2) {
          this.phase = 'tieOffer';
          this.pending = { type: 'tieOffer', c: id, o: target, deadline: now + DECISION_MS };
          this.say(`${this.name(id)} "eyni xala baxaq" təklif edir. ${this.name(target)} cavab verir...`);
          return;
        }
        return this.resolveCompare(id, target, false, now);
      }
      case 'tieAccept':
      case 'tieDecline': {
        if (this.phase !== 'tieOffer' || this.pending.o !== id) throw new GameError('Sizdən cavab gözlənilmir.');
        const { c, o } = this.pending;
        const ok = t === 'tieAccept';
        this.say(`${this.name(o)} bərabərlik təklifini ${ok ? 'qəbul etdi' : 'rədd etdi'}.`);
        this.phase = 'betting';
        this.pending = null;
        return this.resolveCompare(c, o, ok, now);
      }
      case 'tieVote': {
        const p = this.pending;
        if (this.phase !== 'tieDecision' || (p.a !== id && p.b !== id)) throw new GameError('Sizdən cavab gözlənilmir.');
        if (action.choice !== 'seka' && action.choice !== 'bol') throw new GameError('Yanlış seçim.');
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
        this.say(`${this.name(id)} sekaya qoşuldu (${sj.cost}).`);
        return;
      }
      case 'sekaStart': {
        if (this.phase !== 'sekaJoin' || !this.sekaJoin.base.includes(id)) throw new GameError('Sekanı yalnız bərabər xallı oyunçular başlada bilər.');
        return this.startSekaHand(now);
      }
      case 'votePas': {
        if (this.phase !== 'betting') throw new GameError('İndi səsvermə mümkün deyil.');
        if (!me || me.status !== 'active' || id === this.turn) throw new GameError('Səs verə bilməzsiniz.');
        if (now < this.turnDeadline) throw new GameError('Vaxt hələ bitməyib.');
        this.votes.add(id);
        const needed = Math.ceil((this.active().length - 1) / 2);
        this.say(`${this.name(id)} ${this.name(this.turn)} üçün "pas" səsi verdi (${this.votes.size}/${needed}).`);
        if (this.votes.size >= needed) {
          const target = this.turn;
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

  mustTurn(id) {
    if (this.phase !== 'betting') throw new GameError('İndi xod etmək olmaz.');
    if (this.turn !== id) throw new GameError('Növbə sizdə deyil.');
  }

  decideTie(now) {
    const p = this.pending;
    if (p.votes[p.a] === 'seka' && p.votes[p.b] === 'seka') return this.startSekaJoin(now);
    return this.finish([p.a, p.b], 'split');
  }

  // Vaxtı keçmiş qərarlar (server hər saniyə çağırır)
  tick(now = Date.now()) {
    if (this.phase === 'tieOffer' && now >= this.pending.deadline) {
      const { c, o } = this.pending;
      this.say(`${this.name(o)} vaxtında cavab vermədi — təklif rədd sayılır.`);
      this.phase = 'betting';
      this.pending = null;
      this.resolveCompare(c, o, false, now);
      return true;
    }
    if (this.phase === 'tieDecision' && now >= this.pending.deadline) {
      const p = this.pending;
      for (const id of [p.a, p.b]) if (!p.votes[id]) p.votes[id] = 'bol';
      this.decideTie(now);
      return true;
    }
    if (this.phase === 'sekaJoin' && now >= this.sekaJoin.deadline) {
      this.startSekaHand(now);
      return true;
    }
    return false;
  }

  // Oyunçu otaqdan çıxdı
  removePlayer(id, now = Date.now()) {
    const me = this.ps[id];
    if (this.phase === 'finished') return;
    if (this.phase === 'sekaJoin') {
      const sj = this.sekaJoin;
      sj.eligible = sj.eligible.filter((x) => x !== id);
      sj.base = sj.base.filter((x) => x !== id);
      if (sj.base.length === 0) this.startSekaHand(now);
      return;
    }
    if (!me || me.status !== 'active') return;
    if (this.phase === 'tieDecision') {
      const p = this.pending;
      const other = p.a === id ? p.b : p.a;
      me.status = 'folded';
      this.say(`${this.name(id)} oyunu tərk etdi.`);
      return this.finish([other], 'last');
    }
    if (this.phase === 'tieOffer') {
      const { c, o } = this.pending;
      this.phase = 'betting';
      this.pending = null;
      me.status = 'folded';
      this.say(`${this.name(id)} oyunu tərk etdi.`);
      if (this.active().length <= 1) return this.finish(this.active(), 'last');
      return this.advance(c, now);
    }
    me.status = 'folded';
    this.say(`${this.name(id)} oyunu tərk etdi (pas).`);
    if (this.turn === id || this.active().length <= 1) this.advance(id, now);
  }

  setBalance(id, balance) {
    const p = this.players.get(id);
    if (p) p.balance = balance;
  }

  // ---------- oyunçuya görünən vəziyyət ----------
  viewFor(uid, now = Date.now()) {
    const mine = this.ps[uid];
    const players = this.order.map((id) => {
      const p = this.ps[id];
      const visible = p && (id === uid || (mine && mine.seen.has(id)) || (this.revealAll && p.status !== 'folded'));
      return {
        id,
        name: this.name(id),
        balance: this.players.get(id).balance,
        inHand: !!p,
        status: p?.status ?? 'out',
        declared: p?.declared ?? null,
        attachedTo: p?.attachedTo ?? null,
        cardCount: p ? p.cards.length : 0,
        cards: visible ? p.cards : null,
        score: visible ? handScore(p.cards) : null,
      };
    });
    const isTurn = this.phase === 'betting' && this.turn === uid;
    const overdue = this.phase === 'betting' && now >= this.turnDeadline;
    return {
      phase: this.phase,
      handNo: this.handNo,
      isSeka: !!this.isSeka,
      pot: this.pot,
      currentBet: this.currentBet,
      minXod: this.minXod(),
      maxBet: this.settings.maxBet,
      turn: this.turn,
      turnDeadline: this.turnDeadline,
      players,
      me: mine ? {
        cards: mine.cards,
        score: handScore(mine.cards),
        status: mine.status,
        declared: mine.declared,
        isTurn,
        canYox: isTurn && !mine.declared,
        canBaxis: isTurn && this.firstCircleDone(),
        baxisTarget: isTurn ? this.prevActive(uid) : null,
        canVote: overdue && mine.status === 'active' && this.turn !== uid && !this.votes.has(uid),
      } : null,
      votes: this.votes.size,
      votesNeeded: Math.ceil((this.active().length - 1) / 2),
      pending: this.pending ? { ...this.pending, votes: this.pending.votes ? Object.keys(this.pending.votes) : undefined } : null,
      sekaJoin: this.sekaJoin,
      result: this.result,
      log: this.log.slice(-40),
    };
  }
}
