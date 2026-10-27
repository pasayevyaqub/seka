// Virtual oyun əskinasları — bu layihə üçün ORİJİNAL çəkilmiş SVG.
// Rənglər oyun xalı nominalını fərqləndirir; real pul vahidi və ya əskinas təsviri istifadə edilmir:
// üzərində "VİRTUAL" yazılır, heç bir real şəkil, imza, seriya və ya qoruyucu element yoxdur.
const NOTE = {
  200: { c1: '#b07a4f', c2: '#6e4526', ink: '#3b2414' },
  100: { c1: '#9a7cc4', c2: '#5d3f8a', ink: '#2c1b47' },
  50: { c1: '#4fae9e', c2: '#22675c', ink: '#0f3530' },
  20: { c1: '#c4b24a', c2: '#7e6f1c', ink: '#3b330a' },
  10: { c1: '#5d9fd0', c2: '#2a5f8c', ink: '#132f48' },
  5: { c1: '#e29a5b', c2: '#a35a22', ink: '#4d2a0e' },
  1: { c1: '#9fae9a', c2: '#5d6b58', ink: '#262e24' },
};
export const DENOMS = [200, 100, 50, 20, 10, 5, 1];

export function noteSVG(d, cls = '') {
  const k = NOTE[d] || NOTE[1];
  // dalğalı "gilyoş" xətləri
  let waves = '';
  for (let i = 0; i < 5; i++) {
    const y = 14 + i * 8;
    waves += `<path d="M6 ${y} Q 21 ${y - 5} 36 ${y} T 66 ${y} T 96 ${y} T 114 ${y}" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="1"/>`;
  }
  return `<svg class="note ${cls}" viewBox="0 0 120 60" aria-hidden="true">
    <rect x="0.5" y="0.5" width="119" height="59" rx="4" fill="${k.c2}"/>
    <rect x="3" y="3" width="114" height="54" rx="3" fill="${k.c1}"/>
    ${waves}
    <rect x="3" y="3" width="114" height="54" rx="3" fill="none" stroke="${k.ink}" stroke-opacity=".45" stroke-width="1"/>
    <rect x="7" y="7" width="106" height="46" rx="2" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".8" stroke-dasharray="2 1.5"/>
    <circle cx="82" cy="30" r="16" fill="#fff" fill-opacity=".18" stroke="${k.ink}" stroke-opacity=".35"/>
    <circle cx="82" cy="30" r="12" fill="none" stroke="#fff" stroke-opacity=".3" stroke-dasharray="1 1.4"/>
    <text x="82" y="37" text-anchor="middle" font-size="20" font-weight="700" fill="${k.ink}" font-family="Georgia, serif">★</text>
    <text x="12" y="22" font-size="15" font-weight="800" fill="${k.ink}" font-family="Georgia, serif">${d}</text>
    <text x="108" y="52" text-anchor="end" font-size="9" font-weight="800" fill="${k.ink}" font-family="Georgia, serif">${d}</text>
    <text x="12" y="47" font-size="7.5" font-weight="800" letter-spacing="1" fill="${k.ink}" fill-opacity=".85" font-family="system-ui, sans-serif">VİRTUAL</text>
    <text x="12" y="54" font-size="5.5" fill="${k.ink}" fill-opacity=".75" font-family="system-ui, sans-serif">OYUN XALI</text>
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

// Bankdakı əskinas yığını: eyni məbləğ hər dəfə eyni görünür (yenidən çəkiləndə "tullanmır")
export function potStackHTML(amount) {
  const notes = splitNotes(amount, 14);
  if (!notes.length) return '';
  const groups = [];
  for (const d of notes) {
    const g = groups.find((x) => x.d === d);
    if (g) g.n++; else groups.push({ d, n: 1 });
  }
  const cols = groups.length;
  let html = '';
  groups.forEach((g, gi) => {
    const x = (gi - (cols - 1) / 2) * 30;
    for (let i = 0; i < g.n; i++) {
      const rot = ((gi * 7 + i * 13) % 17) - 8;
      html += `<div class="pn" style="transform:translate(calc(-50% + ${x}px), calc(-50% - ${i * 3}px)) rotate(${rot}deg)">${noteSVG(g.d)}</div>`;
    }
  });
  return html;
}
