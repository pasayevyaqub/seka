// Virtual oyun əskinasları — bu layihə üçün ORİJİNAL çəkilmiş SVG.
// Virtual oyun xalı "əskinasları" — real pulun surəti DEYİL: üzərində "XAL" yazılır,
// heç bir real şəkil, imza, seriya və ya qoruyucu element yoxdur.
const NOTE = {
  200: { c1: '#b07a4f', c2: '#6e4526', ink: '#3b2414' },
  100: { c1: '#9a7cc4', c2: '#5d3f8a', ink: '#2c1b47' },
  50: { c1: '#4fae9e', c2: '#22675c', ink: '#0f3530' },
  20: { c1: '#c4b24a', c2: '#7e6f1c', ink: '#3b330a' },
  10: { c1: '#5d9fd0', c2: '#2a5f8c', ink: '#132f48' },
  5: { c1: '#e29a5b', c2: '#a35a22', ink: '#4d2a0e' },
  1: { c1: '#9fae9a', c2: '#5d6b58', ink: '#262e24' },
};
// mərkəzdəki səkkizguşəli ulduz
const STAR = (() => {
  let d = '';
  for (let k = 0; k < 16; k++) {
    const a = (Math.PI / 8) * k - Math.PI / 2;
    const r = k % 2 ? 4.5 : 9.5;
    d += `${k ? 'L' : 'M'}${(60 + r * Math.cos(a)).toFixed(2)} ${(27 + r * Math.sin(a)).toFixed(2)} `;
  }
  return d + 'Z';
})();
export const DENOMS = [200, 100, 50, 20, 10, 5, 1];

// İstinad şəklindəki kimi iki rəng: krem-qızılı (böyük nominal) və yaşıl (kiçik nominal)
const STYLE = {
  cream: { bg: '#efe0b4', band: '#c9a65a', ink: '#5b4316', line: '#a8843c' },
  green: { bg: '#2f6b48', band: '#d9b75e', ink: '#f1e2b0', line: '#cfe3c8' },
};
export function noteSVG(d, cls = '') {
  const k = d >= 20 ? STYLE.cream : STYLE.green;
  let waves = '';
  for (let i = 0; i < 4; i++) {
    const y = 18 + i * 8;
    waves += `<path d="M10 ${y} Q 25 ${y - 4} 40 ${y} T 70 ${y} T 110 ${y}" fill="none" stroke="${k.line}" stroke-opacity=".35" stroke-width=".8"/>`;
  }
  return `<svg class="note ${cls}" viewBox="0 0 120 60" aria-hidden="true">
    <rect x="0.5" y="0.5" width="119" height="59" rx="3" fill="${k.band}"/>
    <rect x="4" y="4" width="112" height="52" rx="2" fill="${k.bg}"/>
    ${waves}
    <rect x="7" y="7" width="106" height="46" rx="1.5" fill="none" stroke="${k.line}" stroke-opacity=".7" stroke-width=".9"/>
    <rect x="9.5" y="9.5" width="101" height="41" rx="1" fill="none" stroke="${k.line}" stroke-opacity=".45" stroke-width=".5" stroke-dasharray="1.5 1.2"/>
    <circle cx="60" cy="27" r="13" fill="none" stroke="${k.ink}" stroke-opacity=".7" stroke-width="1"/>
    <path d="${STAR}" fill="${k.ink}" fill-opacity=".85"/>
    <circle cx="60" cy="27" r="2.2" fill="${k.bg}"/>
    <text x="60" y="49" text-anchor="middle" font-size="9.5" font-weight="700" letter-spacing="2" fill="${k.ink}" font-family="Georgia, 'Times New Roman', serif">XAL</text>
    <text x="14" y="20" font-size="10" font-weight="700" fill="${k.ink}" font-family="Georgia, serif">${d}</text>
    <text x="106" y="48" text-anchor="end" font-size="8" font-weight="700" fill="${k.ink}" font-family="Georgia, serif">${d}</text>
  </svg>`;
}

// Məbləği əskinaslara bölür (ən çoxu `max` ədəd göstərilir — qalanı yalnız rəqəmlə)
export function splitNotes(amount, max = 12) {
  let left = Math.max(0, Math.floor(Number(amount) || 0));
  const out = [];
  for (const d of DENOMS) {
    while (left >= d && out.length < max) { out.push(d); left -= d; }
  }
  return out;
}

// Bankdakı əskinas yığını (istinad şəklindəki kimi səliqəli dəstə): məbləğə görə 0–9 vərəq,
// eyni məbləğ hər dəfə eyni görünür (yenidən çəkiləndə "tullanmır")
export function potStackHTML(amount) {
  const a = Math.max(0, Math.floor(Number(amount) || 0));
  if (!a) return '';
  const count = Math.min(9, 2 + Math.floor(Math.log10(a + 1) * 2.2));
  const notes = splitNotes(a, count);
  while (notes.length < count) notes.push(notes[notes.length - 1] || 10);
  let html = '';
  notes.reverse().forEach((d, i) => {
    const rot = [-8, 6, -3, 9, -6, 3, -10, 7, -1][i % 9];
    const dx = [-10, 8, -4, 12, -8, 4, -12, 10, 0][i % 9];
    html += `<div class="pn" style="transform:translate(calc(-50% + ${dx}px), calc(-50% - ${i * 2.2}px)) rotate(${rot}deg)">${noteSVG(d)}</div>`;
  });
  return html;
}
