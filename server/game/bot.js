// Bot qərarları. Bot YALNIZ öz görünüşünü (Round.viewFor(botId)) görür:
// öz kartları + hamıya açıq məlumat. Başqasının kartı, deste və gizli vəziyyət ona verilmir.
import { score3 } from './cards.js';

const rnd = Math.random;

// 4 kartdan atılacaq kartın indeksi (bot öz qərarını verir)
export function chooseDiscard(hand) {
  let best = 0, bestScore = -1;
  for (let i = 0; i < hand.length; i++) {
    const s = score3(hand.filter((_, k) => k !== i));
    if (s > bestScore) { bestScore = s; best = i; }
  }
  return best;
}

/**
 * @param {object} view  Round.viewFor(botId)
 * @param {number} botId
 * @param {object} mem   bu bot üçün raund daxili yaddaş (öz növbə sayı)
 * @param {number} now
 * @returns {object|null} hərəkət və ya null (heç nə etmə)
 */
export function decide(view, botId, mem, now) {
  const me = view.me;
  if (!view || view.phase === 'finished') return null;

  if (view.phase === 'discard') {
    if (me?.mustDiscard) return { type: 'discard', index: chooseDiscard(me.hand) };
    return null;
  }

  const s = me?.score ?? 0;

  if (view.phase === 'offer' && view.pending?.to === botId) {
    if (view.pending.kind === 'split') return { type: s < 24 ? 'offerAccept' : 'offerDecline' };
    return { type: s < 21 ? 'offerAccept' : 'offerDecline' };
  }
  if (view.phase === 'tieOffer' && view.pending?.o === botId) {
    return { type: rnd() < 0.5 ? 'tieAccept' : 'tieDecline' };
  }
  if (view.phase === 'tieDecision' && (view.pending?.a === botId || view.pending?.b === botId)) {
    if (view.pending.voted?.includes(botId)) return null;
    return { type: 'tieVote', choice: rnd() < 0.5 ? 'seka' : 'bol' };
  }
  if (view.phase === 'sekaJoin') {
    const sj = view.sekaJoin;
    if (sj.eligible.includes(botId) && !sj.joined.includes(botId) && !mem.sekaDecided) {
      mem.sekaDecided = true;
      if (rnd() < 0.4) return { type: 'sekaJoin' };
    }
    // əsas oyunçu olan bot insanlara qoşulmaq üçün vaxt verir, sonra başladır
    if (sj.base.includes(botId) && sj.deadline - now < 20_000) return { type: 'sekaStart' };
    return null;
  }

  if (view.phase !== 'betting' || !me || me.status !== 'active') return null;

  if (!me.isTurn) {
    if (me.canVote) return { type: 'votePas' };
    return null;
  }

  // ---- bot növbəsi ----
  mem.turns = (mem.turns || 0) + 1;
  const min = view.minXod;
  const maxBet = view.maxBet > 0 ? Math.max(view.maxBet, min) : min * 4;
  const raise = (k) => ({ type: 'xod', amount: Math.min(maxBet, Math.max(min, Math.round(min * k))) });
  const two = view.activeCount === 2;

  if (two && me.canOffer && mem.turns >= 3 && s >= 18 && s <= 25 && rnd() < 0.2) {
    return { type: rnd() < 0.5 ? 'offerSplit' : 'offerSeka' };
  }
  if (s >= 31) {
    if (me.canBaxis && mem.turns >= 4) return { type: 'baxis' };
    return rnd() < 0.6 ? raise(2) : raise(1);
  }
  if (s >= 25) {
    if (me.canBaxis && (mem.turns >= 3 || rnd() < 0.25)) return { type: 'baxis' };
    return rnd() < 0.3 ? raise(1.5) : raise(1);
  }
  if (s >= 19) {
    if (me.canBaxis && (mem.turns >= 2 || rnd() < 0.4)) return { type: 'baxis' };
    return raise(1);
  }
  // zəif əl: bəzən blöf
  if (mem.turns === 1 && rnd() < 0.45) return raise(1);
  if (me.canBaxis && rnd() < 0.25) return { type: 'baxis' };
  return { type: 'pas' };
}
