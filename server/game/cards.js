import { randomInt } from 'node:crypto';

// Suits: S=♠ Pika, H=♥ Ürək (Çiçək), D=♦ Kərpic (Bubi), C=♣ Xaç (Trefl)
export const SUITS = ['S', 'H', 'D', 'C'];
// 6,7,8,9,10, V=Valet, D=Dama, K=Karol, T=Tuz
export const RANKS = ['6', '7', '8', '9', '10', 'V', 'D', 'K', 'T'];

export function cardValue(rank) {
  if (rank === 'T') return 11;
  if (rank === '10' || rank === 'V' || rank === 'D' || rank === 'K') return 10;
  return Number(rank);
}

export function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  return deck;
}

// Fisher–Yates, kriptoqrafik təsadüfi
export function shuffle(deck, rand = randomInt) {
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// Tam 3 kartın xalı
export function score3(cards) {
  if (cards.length !== 3) throw new Error('score3 needs 3 cards');
  const [a, b, c] = cards;
  if (a.r === b.r && b.r === c.r) {
    return cardValue(a.r) * 3; // 7-7-7 = 21, D-D-D = 30, T-T-T = 33 (cəkpot)
  }
  // 2 Tuz həmişə 22 xaldır (eyni suitli ən yaxşı kombinasiya ən çox 21 ola bilər)
  if (cards.filter((k) => k.r === 'T').length === 2) return 22;
  const bySuit = {};
  for (const k of cards) bySuit[k.s] = (bySuit[k.s] || 0) + cardValue(k.r);
  return Math.max(...Object.values(bySuit));
}

function combos3(cards) {
  if (cards.length === 3) return [cards];
  const out = [];
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++)
      for (let k = j + 1; k < cards.length; k++) out.push([cards[i], cards[j], cards[k]]);
  return out;
}

// 3 və ya 4 kart: ən yaxşı 3-ün xalı
export function handScore(cards) {
  return Math.max(...combos3(cards).map(score3));
}

export function bestThree(cards) {
  let best = null, bestScore = -1;
  for (const c of combos3(cards)) {
    const s = score3(c);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best;
}

// Cəkpot növü (saxlanılan 3 karta görə): 'six' = 3 dənə 6, 'ace' = 3 dənə Tuz, yoxdursa null
export function jackpotKind(cards) {
  const count = (r) => cards.filter((c) => c.r === r).length;
  if (count('6') >= 3) return 'six';
  if (count('T') >= 3) return 'ace';
  return null;
}
export function isJackpot(cards) { return jackpotKind(cards) !== null; }

export const RANK_LABEL = { V: 'J', D: 'Q', K: 'K', T: 'A' };
export function cardLabel(c) {
  const suit = { S: '♠', H: '♥', D: '♦', C: '♣' }[c.s];
  // ekranda klassik indekslər: Valet=J, Dama=Q, Karol=K, Tuz=A (daxili kodlar dəyişmir)
  return `${RANK_LABEL[c.r] || c.r}${suit}`;
}
