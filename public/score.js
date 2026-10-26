// Klientdə yalnız göstəriş üçün (kart atma zamanı qalan 3 kartın xalı). Rəsmi hesablama serverdədir.
const val = (r) => (r === 'T' ? 11 : ['10', 'V', 'D', 'K'].includes(r) ? 10 : Number(r));
export function score3(cards) {
  const [a, b, c] = cards;
  if (a.r === b.r && b.r === c.r) return val(a.r) * 3;
  const by = {};
  for (const k of cards) by[k.s] = (by[k.s] || 0) + val(k.r);
  return Math.max(...Object.values(by));
}
