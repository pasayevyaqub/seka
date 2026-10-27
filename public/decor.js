// Masanın ətrafındakı bəzəklər (istinad şəklindəki kimi): armudu stəkanda çay, fənər, yarpaqlar, qoz-fındıq qabı, oyma qutu.
// Hamısı orijinal SVG-dir, yalnız görünüş üçündür — düymə deyil, kliki tutmur (pointer-events: none).
const TEA = `<svg viewBox="0 0 120 120" aria-hidden="true">
  <defs>
    <radialGradient id="dcSaucer" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#3b5f86"/><stop offset=".7" stop-color="#1b2f47"/><stop offset="1" stop-color="#0b1420"/></radialGradient>
    <linearGradient id="dcTea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4520f"/><stop offset=".6" stop-color="#9c2a06"/><stop offset="1" stop-color="#5c1503"/></linearGradient>
  </defs>
  <ellipse cx="60" cy="92" rx="54" ry="22" fill="url(#dcSaucer)" stroke="#d9b75e" stroke-width="2.2"/>
  <ellipse cx="60" cy="90" rx="42" ry="15" fill="none" stroke="#d9b75e" stroke-width="1.2" stroke-dasharray="2 3"/>
  <ellipse cx="60" cy="90" rx="22" ry="7" fill="#0b1420" opacity=".55"/>
  <path d="M40 18 C38 32 46 42 50 48 C44 56 38 68 42 82 C48 92 72 92 78 82 C82 68 76 56 70 48 C74 42 82 32 80 18 Z" fill="url(#dcTea)"/>
  <path d="M40 18 C38 32 46 42 50 48 C44 56 38 68 42 82 C48 92 72 92 78 82 C82 68 76 56 70 48 C74 42 82 32 80 18 Z" fill="none" stroke="#fff3df" stroke-opacity=".75" stroke-width="1.6"/>
  <ellipse cx="60" cy="18" rx="20" ry="4.5" fill="#e8823a" stroke="#fff3df" stroke-opacity=".8" stroke-width="1.3"/>
  <path d="M45 24 C44 33 48 41 52 46" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M46 60 C44 68 45 76 49 82" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2.2" stroke-linecap="round"/>
</svg>`;

const LANTERN = `<svg viewBox="0 0 120 150" aria-hidden="true">
  <defs>
    <radialGradient id="dcGlow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe9b0"/><stop offset=".4" stop-color="#ffb44a" stop-opacity=".8"/><stop offset="1" stop-color="#ff8c1a" stop-opacity="0"/></radialGradient>
    <linearGradient id="dcBrass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6b4f1a"/><stop offset=".45" stop-color="#e6c56e"/><stop offset="1" stop-color="#7a5a1e"/></linearGradient>
  </defs>
  <circle cx="60" cy="88" r="60" fill="url(#dcGlow)" opacity=".7"/>
  <path d="M60 4 v12" stroke="#c9a352" stroke-width="3"/><circle cx="60" cy="6" r="4" fill="none" stroke="#c9a352" stroke-width="2.5"/>
  <path d="M30 46 Q36 18 60 16 Q84 18 90 46 Z" fill="url(#dcBrass)" stroke="#4a3510" stroke-width="1.2"/>
  <rect x="28" y="44" width="64" height="8" rx="3" fill="url(#dcBrass)" stroke="#4a3510" stroke-width="1"/>
  <rect x="32" y="52" width="56" height="70" rx="6" fill="#ffd48a"/>
  <g fill="url(#dcBrass)" stroke="#4a3510" stroke-width=".8">
    <path d="M32 52h56v70H32z M42 62l6 6-6 6-6-6z M60 58l6 6-6 6-6-6z M78 62l6 6-6 6-6-6z M51 80l6 6-6 6-6-6z M69 80l6 6-6 6-6-6z M42 98l6 6-6 6-6-6z M60 102l6 6-6 6-6-6z M78 98l6 6-6 6-6-6z" fill-rule="evenodd"/>
  </g>
  <rect x="26" y="120" width="68" height="10" rx="3" fill="url(#dcBrass)" stroke="#4a3510" stroke-width="1"/>
  <path d="M34 130h52l-6 10H40z" fill="url(#dcBrass)" stroke="#4a3510" stroke-width="1"/>
</svg>`;

const LEAVES = `<svg viewBox="0 0 140 140" aria-hidden="true">
  <g fill="#1f4d2b" stroke="#0f2a17" stroke-width="1">
    <path d="M10 130 Q30 60 90 40 Q60 90 10 130 Z"/>
    <path d="M0 90 Q40 40 110 30 Q70 70 0 90 Z" fill="#2a6238"/>
    <path d="M30 140 Q60 90 130 80 Q90 120 30 140 Z" fill="#245a33"/>
    <path d="M5 60 Q35 15 90 5 Q55 40 5 60 Z" fill="#1b4527"/>
  </g>
  <g fill="none" stroke="#5f9a6b" stroke-opacity=".5" stroke-width="1"><path d="M10 130 Q50 80 90 40"/><path d="M0 90 Q55 50 110 30"/><path d="M30 140 Q80 100 130 80"/></g>
</svg>`;

const NUTS = `<svg viewBox="0 0 120 100" aria-hidden="true">
  <ellipse cx="60" cy="64" rx="56" ry="30" fill="#2a1c10" stroke="#c9a352" stroke-width="2"/>
  <ellipse cx="60" cy="56" rx="48" ry="22" fill="#4a2f17"/>
  <g fill="#b9844a" stroke="#6b4423" stroke-width="1">
    <ellipse cx="38" cy="52" rx="9" ry="6" transform="rotate(-20 38 52)"/><ellipse cx="54" cy="46" rx="9" ry="6" transform="rotate(15 54 46)"/>
    <ellipse cx="70" cy="50" rx="9" ry="6" transform="rotate(-10 70 50)"/><ellipse cx="84" cy="56" rx="9" ry="6" transform="rotate(25 84 56)"/>
    <ellipse cx="46" cy="62" rx="9" ry="6" transform="rotate(10 46 62)"/><ellipse cx="62" cy="60" rx="9" ry="6" transform="rotate(-25 62 60)"/>
    <ellipse cx="76" cy="64" rx="9" ry="6" transform="rotate(5 76 64)"/>
  </g>
</svg>`;

const BOX = `<svg viewBox="0 0 120 120" aria-hidden="true">
  <rect x="10" y="20" width="100" height="90" rx="6" fill="#3b2a14" stroke="#c9a352" stroke-width="2"/>
  <rect x="20" y="30" width="80" height="70" rx="4" fill="none" stroke="#d9b75e" stroke-width="1.5"/>
  <g fill="none" stroke="#d9b75e" stroke-width="1.4"><circle cx="60" cy="65" r="18"/><path d="M60 47 Q72 65 60 83 Q48 65 60 47 Z"/><path d="M42 65 Q60 53 78 65 Q60 77 42 65 Z"/></g>
</svg>`;

export function decorHTML() {
  return `<div class="decor" aria-hidden="true">
    <div class="dc dc-leaves1">${LEAVES}</div>
    <div class="dc dc-lantern">${LANTERN}</div>
    <div class="dc dc-tea">${TEA}</div>
    <div class="dc dc-nuts">${NUTS}</div>
    <div class="dc dc-box">${BOX}</div>
    <div class="dc dc-leaves2">${LEAVES}</div>
  </div>`;
}

// Keçənin ortasındakı zərif dairəvi naxış (istinad şəklindəki kimi, çox solğun)
export const FELT_MEDALLION = (() => {
  let petals = '';
  for (let k = 0; k < 16; k++) petals += `<path d="M100 32 Q108 52 100 66 Q92 52 100 32 Z" transform="rotate(${k * 22.5} 100 100)"/>`;
  let dots = '';
  for (let k = 0; k < 48; k++) { const a = (k / 48) * Math.PI * 2; dots += `<circle cx="${(100 + 88 * Math.cos(a)).toFixed(1)}" cy="${(100 + 88 * Math.sin(a)).toFixed(1)}" r="1.4"/>`; }
  return `<svg class="medallion" viewBox="0 0 200 200" aria-hidden="true"><g fill="none" stroke="#f1d488" stroke-width="1">
    <circle cx="100" cy="100" r="94"/><circle cx="100" cy="100" r="80" stroke-dasharray="2 3"/><circle cx="100" cy="100" r="30"/>${petals}</g>
    <g fill="#f1d488">${dots}</g></svg>`;
})();
