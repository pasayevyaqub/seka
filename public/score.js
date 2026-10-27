// Klientdə göstəriş üçün xal hesablaması — server/game/cards.js ilə EYNİ qaydalar (testlə yoxlanılır).
const val = (r) => (r === 'T' ? 11 : ['10', 'V', 'D', 'K'].includes(r) ? 10 : Number(r));
export function score3(cards) {
  const [a, b, c] = cards;
  if (a.r === b.r && b.r === c.r) return val(a.r) * 3;
  if (cards.filter((k) => k.r === 'T').length === 2) return 22;
  const by = {};
  for (const k of cards) by[k.s] = (by[k.s] || 0) + val(k.r);
  return Math.max(...Object.values(by));
}
