// SVG kartlar — orijinal dizayn. Suit simvolları index.html-dəki <symbol>-lardan gəlir.
const RED = new Set(['H', 'D']);
const PIPS = {
  '6': [[28, 32], [28, 70], [28, 108], [72, 32], [72, 70], [72, 108]],
  '7': [[28, 32], [28, 70], [28, 108], [72, 32], [72, 70], [72, 108], [50, 51]],
  '8': [[28, 32], [28, 70], [28, 108], [72, 32], [72, 70], [72, 108], [50, 51], [50, 89]],
  '9': [[28, 30], [28, 56], [28, 84], [28, 110], [72, 30], [72, 56], [72, 84], [72, 110], [50, 70]],
  '10': [[28, 30], [28, 56], [28, 84], [28, 110], [72, 30], [72, 56], [72, 84], [72, 110], [50, 43], [50, 97]],
};

const use = (s, x, y, size, flip = false) =>
  `<use href="#suit-${s}" x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}"${flip ? ` transform="rotate(180 ${x} ${y})"` : ''}/>`;

function corner(c, color) {
  return `
    <g fill="${color}">
      <text x="10" y="22" font-size="${c.r === '10' ? 17 : 20}" font-weight="800" font-family="Georgia, serif" text-anchor="middle" letter-spacing="-1">${c.r}</text>
      ${use(c.s, 10, 33, 12)}
      <g transform="rotate(180 50 70)">
        <text x="10" y="22" font-size="${c.r === '10' ? 17 : 20}" font-weight="800" font-family="Georgia, serif" text-anchor="middle" letter-spacing="-1">${c.r}</text>
        ${use(c.s, 10, 33, 12)}
      </g>
    </g>`;
}

// Valet / Dama / Karol — stilizə edilmiş orijinal fiqurlar
function face(c, color) {
  const accent = RED.has(c.s) ? '#c0392b' : '#1f3a5f';
  const gold = '#d4a017';
  let head;
  if (c.r === 'K') {
    head = `<path d="M36 40 L40 26 L46 36 L50 22 L54 36 L60 26 L64 40 Z" fill="${gold}" stroke="#8a6a00" stroke-width="1"/>
            <circle cx="50" cy="22" r="2.5" fill="${accent}"/>`;
  } else if (c.r === 'D') {
    head = `<path d="M38 40 Q50 24 62 40 Z" fill="${gold}" stroke="#8a6a00" stroke-width="1"/>
            <circle cx="50" cy="30" r="3.5" fill="${accent}"/>
            <path d="M34 50 Q30 66 36 76 M66 50 Q70 66 64 76" stroke="#6b4423" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  } else {
    head = `<path d="M36 41 Q50 30 64 41 Z" fill="${accent}"/>
            <path d="M60 36 Q72 22 78 28 Q70 30 64 40" fill="${gold}"/>`;
  }
  return `
    <rect x="20" y="16" width="60" height="108" rx="6" fill="${RED.has(c.s) ? '#fdf1ef' : '#eef3fa'}" stroke="${accent}" stroke-width="1.5"/>
    <path d="M30 124 L34 82 Q50 72 66 82 L70 124 Z" fill="${accent}"/>
    <path d="M40 84 L50 120 L60 84" fill="none" stroke="${gold}" stroke-width="2"/>
    <circle cx="50" cy="52" r="12" fill="#f3d2b3" stroke="#a0765a" stroke-width="1"/>
    <circle cx="45.5" cy="51" r="1.4" fill="#333"/><circle cx="54.5" cy="51" r="1.4" fill="#333"/>
    <path d="M46 57 Q50 60 54 57" stroke="#8a4b3a" stroke-width="1.2" fill="none"/>
    ${head}
    <g fill="${color}">${use(c.s, 50, 100, 16)}</g>`;
}

function ace(c, color) {
  return `
    <circle cx="50" cy="70" r="30" fill="none" stroke="${color}" stroke-width="1" opacity=".35"/>
    <circle cx="50" cy="70" r="34" fill="none" stroke="${color}" stroke-width=".6" opacity=".25" stroke-dasharray="3 3"/>
    <g fill="${color}">${use(c.s, 50, 70, 42)}</g>`;
}

export function cardSVG(c, cls = '') {
  const color = RED.has(c.s) ? '#d62828' : '#1b1b1b';
  let body;
  if (PIPS[c.r]) body = `<g fill="${color}">${PIPS[c.r].map(([x, y]) => use(c.s, x, y, 18, y > 75)).join('')}</g>`;
  else if (c.r === 'T') body = ace(c, color);
  else body = face(c, color);
  return `<svg class="card ${cls}" viewBox="0 0 100 140" role="img" aria-label="${c.r}${c.s}">
    <rect x="1" y="1" width="98" height="138" rx="9" fill="#fffdf8" stroke="#c9c2b4" stroke-width="1.5"/>
    ${body}
    ${corner(c, color)}
  </svg>`;
}

export function cardBackSVG(cls = '') {
  return `<svg class="card back ${cls}" viewBox="0 0 100 140" aria-label="kart">
    <rect x="1" y="1" width="98" height="138" rx="9" fill="#7a1022" stroke="#4d0a15" stroke-width="1.5"/>
    <rect x="8" y="8" width="84" height="124" rx="5" fill="url(#backPattern)" stroke="#e8c26a" stroke-width="1.5"/>
    <circle cx="50" cy="70" r="16" fill="#7a1022" stroke="#e8c26a" stroke-width="1.5"/>
    <text x="50" y="77" text-anchor="middle" font-size="20" font-weight="800" font-family="Georgia, serif" fill="#e8c26a">S</text>
  </svg>`;
}

export const SUIT_NAME = { S: 'Pika', H: 'Ürək', D: 'Kərpic', C: 'Xaç' };
