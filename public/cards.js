// SVG kartlar — ənənəvi (klassik) kart üslubunda ORİJİNAL çəkilmiş dizayn.
// Saray kartları (Valet, Dama, Karol) iki başlıdır: yuxarı yarı çəkilir, aşağı yarı 180° fırladılır.
// Suit simvolları index.html-dəki <symbol>-lardan gəlir.
const RED = new Set(['H', 'D']);
const PIPS = {
  '6': [[28, 32], [28, 70], [28, 108], [72, 32], [72, 70], [72, 108]],
  '7': [[28, 32], [28, 70], [28, 108], [72, 32], [72, 70], [72, 108], [50, 51]],
  '8': [[28, 32], [28, 70], [28, 108], [72, 32], [72, 70], [72, 108], [50, 51], [50, 89]],
  '9': [[28, 30], [28, 56], [28, 84], [28, 110], [72, 30], [72, 56], [72, 84], [72, 110], [50, 70]],
  '10': [[28, 30], [28, 56], [28, 84], [28, 110], [72, 30], [72, 56], [72, 84], [72, 110], [50, 43], [50, 97]],
};

const C = { red: '#c8102e', yellow: '#f2b705', blue: '#1f4e9c', black: '#151515', skin: '#f7dcbc', white: '#ffffff', grey: '#d9dde3', line: '#151515' };

const use = (s, x, y, size, flip = false) =>
  `<use href="#suit-${s}" x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}"${flip ? ` transform="rotate(180 ${x} ${y})"` : ''}/>`;

// Ekranda klassik indekslər: Valet = J, Dama = Q, Karol = K, Tuz = A (daxili kodlar V/D/K/T dəyişmir)
export const RANK_LABEL = { V: 'J', D: 'Q', K: 'K', T: 'A' };
const RANK_NAME = { V: 'Valet', D: 'Dama', K: 'Karol', T: 'Tuz' };
export const SUIT_NAME = { S: 'Pika', H: 'Ürək', D: 'Kərpic', C: 'Xaç' };
export const rankLabel = (r) => RANK_LABEL[r] || r;

function corner(c, color) {
  const fs = c.r === '10' ? 17 : 21;
  const idx = `<text x="10.5" y="21" font-size="${fs}" font-weight="700" font-family="'Times New Roman', Georgia, serif" text-anchor="middle" letter-spacing="-1.5">${rankLabel(c.r)}</text>${use(c.s, 10.5, 31.5, 12)}`;
  return `<g fill="${color}">${idx}<g transform="rotate(180 50 70)">${idx}</g></g>`;
}

// Yarım fiqurun rəng sxemi suitə görə dəyişir (ənənəvi kartlardakı kimi)
function scheme(s) {
  return {
    S: { robe: C.blue, robe2: C.red, trim: C.yellow },
    H: { robe: C.red, robe2: C.blue, trim: C.yellow },
    D: { robe: C.red, robe2: C.yellow, trim: C.blue },
    C: { robe: C.blue, robe2: C.yellow, trim: C.red },
  }[s];
}

// Yuxarı yarı: 0..70 (kəsik y=70-də). Çərçivə daxili: x 19..81, y 13..70
function halfFigure(rank, s, suitColor) {
  const k = scheme(s);
  const dots = (y, x0, x1, step, color) => {
    let o = '';
    for (let x = x0; x <= x1; x += step) o += `<circle cx="${x}" cy="${y}" r="0.9" fill="${color}"/>`;
    return o;
  };
  // paltar (çiyinlər, mərkəzi zolaq, naxışlı yaxalıq)
  const robe = `
    <path d="M19 70 L19 60 Q24 52 38 51 L62 51 Q76 52 81 60 L81 70 Z" fill="${k.robe}" stroke="${C.line}" stroke-width="0.8"/>
    <path d="M42 51 L58 51 L56 70 L44 70 Z" fill="${k.robe2}" stroke="${C.line}" stroke-width="0.7"/>
    <path d="M46 51 L54 51 L53 70 L47 70 Z" fill="${k.trim}" stroke="${C.line}" stroke-width="0.5"/>
    ${dots(56, 48, 52, 2, C.black)}${dots(62, 48, 52, 2, C.black)}${dots(68, 48, 52, 2, C.black)}
    <path d="M22 62 Q30 56 40 56 L40 70 L22 70 Z" fill="${k.robe2}" opacity=".9" stroke="${C.line}" stroke-width="0.5"/>
    <path d="M78 62 Q70 56 60 56 L60 70 L78 70 Z" fill="${k.robe2}" opacity=".9" stroke="${C.line}" stroke-width="0.5"/>
    <path d="M24 64 L38 60 M24 67 L38 63 M76 64 L62 60 M76 67 L62 63" stroke="${k.trim}" stroke-width="1.2"/>
    <path d="M33 51 Q50 58 67 51 L64 48 Q50 53 36 48 Z" fill="${C.white}" stroke="${C.line}" stroke-width="0.7"/>
    ${dots(50.5, 38, 62, 4, C.black)}`;
  // baş və üz
  const face = `
    <path d="M46 47 L54 47 L54 51 L46 51 Z" fill="${C.skin}" stroke="${C.line}" stroke-width="0.5"/>
    <ellipse cx="50" cy="37" rx="8.2" ry="9.6" fill="${C.skin}" stroke="${C.line}" stroke-width="0.7"/>
    <path d="M45.5 35 Q47 34 48.3 35 M51.7 35 Q53 34 54.5 35" stroke="${C.line}" stroke-width="0.7" fill="none"/>
    <circle cx="47" cy="36.2" r="0.7" fill="${C.line}"/><circle cx="53" cy="36.2" r="0.7" fill="${C.line}"/>
    <path d="M50 36.5 L49.2 40.5 L50.6 40.8" stroke="${C.line}" stroke-width="0.55" fill="none"/>`;
  let hair = '', head = '', extra = '', item = '';
  if (rank === 'K') {
    hair = `<path d="M41.5 33 Q38 40 40 47 Q42 50 44 48 Q42 42 43.5 35 Z M58.5 33 Q62 40 60 47 Q58 50 56 48 Q58 42 56.5 35 Z" fill="${C.grey}" stroke="${C.line}" stroke-width="0.6"/>`;
    extra = `<path d="M44 42 Q47 41 50 42.3 Q53 41 56 42 Q55 44 50 43.6 Q45 44 44 42 Z" fill="${C.grey}" stroke="${C.line}" stroke-width="0.5"/>
      <path d="M44.5 43.5 Q50 52 55.5 43.5 Q53 46 50 46 Q47 46 44.5 43.5 Z" fill="${C.grey}" stroke="${C.line}" stroke-width="0.5"/>`;
    head = `<path d="M40.5 28 L41.5 18 L45 23 L50 15 L55 23 L58.5 18 L59.5 28 Z" fill="${C.yellow}" stroke="${C.line}" stroke-width="0.8"/>
      <rect x="40.5" y="26" width="19" height="3.4" fill="${C.red}" stroke="${C.line}" stroke-width="0.6"/>
      <circle cx="50" cy="20.5" r="1.5" fill="${C.red}"/><circle cx="44" cy="24" r="1" fill="${C.blue}"/><circle cx="56" cy="24" r="1" fill="${C.blue}"/>
      ${dots(27.7, 43, 57, 3.5, C.yellow)}`;
    item = `<path d="M71 15 L73 15 L73 52 L71 52 Z" fill="${C.grey}" stroke="${C.line}" stroke-width="0.6"/>
      <path d="M71.2 18 L72.8 18 L72.8 50 L71.2 50 Z" fill="#9fb3d1"/>
      <rect x="67" y="52" width="10" height="2.4" rx="1" fill="${C.yellow}" stroke="${C.line}" stroke-width="0.6"/>
      <rect x="70.8" y="54.4" width="2.4" height="6" fill="${C.red}" stroke="${C.line}" stroke-width="0.5"/>
      <path d="M66 58 Q70 54 74 58 L74 62 Q70 60 66 62 Z" fill="${C.skin}" stroke="${C.line}" stroke-width="0.6"/>`;
  } else if (rank === 'D') {
    hair = `<path d="M41.8 30 Q37 40 39.5 50 Q42 52 44.5 49 Q42 42 43.3 33 Z M58.2 30 Q63 40 60.5 50 Q58 52 55.5 49 Q58 42 56.7 33 Z" fill="${C.yellow}" stroke="${C.line}" stroke-width="0.6"/>
      <path d="M42 31 Q50 25 58 31 Q55 29 50 29 Q45 29 42 31 Z" fill="${C.yellow}" stroke="${C.line}" stroke-width="0.5"/>`;
    extra = `<path d="M48 43.2 Q50 44.4 52 43.2" stroke="${C.red}" stroke-width="0.9" fill="none"/>`;
    head = `<path d="M42 27 L43 19 L46.5 23 L50 17 L53.5 23 L57 19 L58 27 Z" fill="${C.yellow}" stroke="${C.line}" stroke-width="0.8"/>
      <circle cx="50" cy="21.5" r="1.4" fill="${C.blue}"/><circle cx="45" cy="24.5" r="0.9" fill="${C.red}"/><circle cx="55" cy="24.5" r="0.9" fill="${C.red}"/>
      <path d="M38 30 Q36 22 44 21 L43 27 Z M62 30 Q64 22 56 21 L57 27 Z" fill="${k.robe}" stroke="${C.line}" stroke-width="0.5"/>`;
    item = `<path d="M30 62 Q29 46 31 30" stroke="#2e7d32" stroke-width="1.3" fill="none"/>
      <path d="M31 40 Q26 37 25 41 Q28 42 31 40 Z" fill="#2e7d32"/>
      <circle cx="31" cy="27" r="4" fill="${C.red}" stroke="${C.line}" stroke-width="0.6"/>
      <circle cx="31" cy="27" r="1.6" fill="${C.yellow}"/>
      <path d="M27 60 Q31 56 35 60 L35 64 Q31 62 27 64 Z" fill="${C.skin}" stroke="${C.line}" stroke-width="0.6"/>`;
  } else {
    hair = `<path d="M41.8 31 Q38.5 38 40.5 45 Q43 47 44.2 44 Q42.6 38 43.6 33 Z M58.2 31 Q61.5 38 59.5 45 Q57 47 55.8 44 Q57.4 38 56.4 33 Z" fill="${C.yellow}" stroke="${C.line}" stroke-width="0.6"/>`;
    extra = `<path d="M47.5 42.8 Q50 44 52.5 42.8" stroke="${C.line}" stroke-width="0.6" fill="none"/>`;
    head = `<path d="M40 30 Q41 19 50 18 Q59 19 60 30 Z" fill="${k.robe}" stroke="${C.line}" stroke-width="0.8"/>
      <rect x="39.5" y="28" width="21" height="3.2" rx="1" fill="${C.yellow}" stroke="${C.line}" stroke-width="0.6"/>
      ${dots(29.6, 42, 58, 4, C.black)}
      <path d="M58 24 Q68 12 74 16 Q67 18 61 27 Z" fill="${C.white}" stroke="${C.line}" stroke-width="0.6"/>
      <path d="M60 25 Q67 16 72 17" stroke="${C.line}" stroke-width="0.4" fill="none"/>`;
    item = `<path d="M29 66 L29 22" stroke="#8d5524" stroke-width="1.6"/>
      <path d="M29 22 L24 28 L29 26 L34 28 Z" fill="${C.grey}" stroke="${C.line}" stroke-width="0.6"/>
      <path d="M29 30 Q23 33 24 38 Q27 34 29 34 Z" fill="${C.grey}" stroke="${C.line}" stroke-width="0.5"/>
      <path d="M25 58 Q29 54 33 58 L33 62 Q29 60 25 62 Z" fill="${C.skin}" stroke="${C.line}" stroke-width="0.6"/>`;
  }
  const pip = `<g fill="${suitColor}">${use(s, 26, 21, 9)}</g>`;
  return `${robe}${item}${hair}${face}${extra}${head}${pip}`;
}

// Valet / Dama / Karol — ənənəvi iki başlı saray kartı
function face(c, color) {
  const id = `f${c.r}${c.s}`;
  const half = halfFigure(c.r, c.s, color);
  return `
    <defs><clipPath id="clip-${id}"><rect x="19" y="13" width="62" height="114"/></clipPath></defs>
    <rect x="19" y="13" width="62" height="114" fill="#fff" stroke="${C.line}" stroke-width="0.9"/>
    <g clip-path="url(#clip-${id})">
      <g>${half}</g>
      <g transform="rotate(180 50 70)">${half}</g>
    </g>
    <path d="M19 70 L81 70" stroke="${C.line}" stroke-width="0.6"/>
    <rect x="19" y="13" width="62" height="114" fill="none" stroke="${C.line}" stroke-width="0.9"/>`;
}

// Tuz — ortada böyük suit (Pika Tuzu bəzəkli)
function ace(c, color) {
  const big = c.s === 'S' ? 50 : 40;
  const orn = c.s === 'S' ? `
    <circle cx="50" cy="70" r="31" fill="none" stroke="${color}" stroke-width="0.8"/>
    <circle cx="50" cy="70" r="28.5" fill="none" stroke="${color}" stroke-width="0.4" stroke-dasharray="1.5 1.5"/>
    <path d="M50 37 Q44 33 50 30 Q56 33 50 37 Z M50 103 Q44 107 50 110 Q56 107 50 103 Z" fill="${color}"/>` : '';
  return `${orn}<g fill="${color}">${use(c.s, 50, 70, big)}</g>`;
}

export function cardSVG(c, cls = '') {
  const color = RED.has(c.s) ? '#d0021b' : '#111111';
  let body;
  if (PIPS[c.r]) body = `<g fill="${color}">${PIPS[c.r].map(([x, y]) => use(c.s, x, y, 18, y > 75)).join('')}</g>`;
  else if (c.r === 'T') body = ace(c, color);
  else body = face(c, color);
  return `<svg class="card ${cls}" viewBox="0 0 100 140" role="img" aria-label="${RANK_NAME[c.r] || c.r} ${SUIT_NAME[c.s]}">
    <rect x="0.75" y="0.75" width="98.5" height="138.5" rx="8" fill="#ffffff" stroke="#bdb8ad" stroke-width="1.2"/>
    ${body}
    ${corner(c, color)}
  </svg>`;
}

// Arxa üz: qızılı haşiyə, tünd yaşıl sahə, səkkizguşəli ulduz medalyonu və künc bəzəkləri (orijinal çəkilib)
function star8(cx, cy, r1, r2) {
  let d = '';
  for (let k = 0; k < 16; k++) {
    const a = (Math.PI / 8) * k - Math.PI / 2;
    const r = k % 2 ? r2 : r1;
    d += `${k ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)} `;
  }
  return d + 'Z';
}
const STAR_OUT = star8(50, 70, 21, 13);
const STAR_IN = star8(50, 70, 12, 7.5);
export function cardBackSVG(cls = '') {
  return `<svg class="card back ${cls}" viewBox="0 0 100 140" aria-label="kart">
    <rect x="0.75" y="0.75" width="98.5" height="138.5" rx="8" fill="#e9d79c" stroke="#8a6a24" stroke-width="1.2"/>
    <rect x="4" y="4" width="92" height="132" rx="5.5" fill="#174a32"/>
    <rect x="4" y="4" width="92" height="132" rx="5.5" fill="url(#backPattern)" opacity=".55"/>
    <rect x="8" y="8" width="84" height="124" rx="3.5" fill="none" stroke="#d9b75e" stroke-width="1.6"/>
    <rect x="11" y="11" width="78" height="118" rx="2.5" fill="none" stroke="#d9b75e" stroke-width=".6" stroke-dasharray="1.2 1.4"/>
    <g fill="#d9b75e">
      <path d="M11 11 l9 0 q-6 3 -9 9 z"/><path d="M89 11 l-9 0 q6 3 9 9 z"/><path d="M11 129 l9 0 q-6 -3 -9 -9 z"/><path d="M89 129 l-9 0 q6 -3 9 -9 z"/>
      <path d="M50 16 l3 5 l-3 5 l-3 -5 z"/><path d="M50 114 l3 5 l-3 5 l-3 -5 z"/>
    </g>
    <circle cx="50" cy="70" r="27" fill="#123d29" stroke="#d9b75e" stroke-width="1.4"/>
    <circle cx="50" cy="70" r="24" fill="none" stroke="#d9b75e" stroke-width=".6" stroke-dasharray="1 1.3"/>
    <path d="${STAR_OUT}" fill="none" stroke="#e8c96f" stroke-width="1.4"/>
    <path d="${STAR_IN}" fill="#d9b75e" opacity=".9"/>
    <circle cx="50" cy="70" r="3.2" fill="#123d29" stroke="#f2dc95" stroke-width=".8"/>
    <path d="M50 30 Q60 40 50 43 Q40 40 50 30 Z M50 110 Q60 100 50 97 Q40 100 50 110 Z" fill="none" stroke="#d9b75e" stroke-width=".9"/>
  </svg>`;
}

