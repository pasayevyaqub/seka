// Market əşyalarının təsviri və "istifadə" effekti.
// * İkonlar orijinal SVG-dir, bu faylda kodla çəkilib (xarici şəkil, brend, loqo yoxdur).
//   Enerji içkisi qəsdən brendsizdir: yaşıl-qara qutu, ümumi ildırım işarəsi, üzərində yalnız "ENERJİ" yazısı.
// * Admin şəkil yükləyibsə, /api/shop/img/<id> göstərilir; yoxdursa bu SVG-lər.
// * Effekt #fx qatındadır (pointer-events: none): kartlara, düymələrə, taymerə mane olmur; oyuna heç bir təsiri yoxdur.
import { esc, S } from './core.js';
import { motionAllowed } from './giftfx.js';

export const ITEM_SVG = {
  cigarette: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="igPaper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9dde2"/></linearGradient>
    <linearGradient id="igFilter" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0a85a"/><stop offset="1" stop-color="#b86a2a"/></linearGradient>
    <radialGradient id="igEmber" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff3a0"/><stop offset=".5" stop-color="#ff7a1a"/><stop offset="1" stop-color="#ff3d00" stop-opacity="0"/></radialGradient></defs>
    <path class="ig-smoke" d="M47 24c-4-4 3-7-1-11s2-7 0-10" fill="none" stroke="#cfd6df" stroke-width="2.4" stroke-linecap="round" opacity=".7"/>
    <path class="ig-smoke2" d="M52 26c-3-3 2-6-1-9" fill="none" stroke="#cfd6df" stroke-width="1.8" stroke-linecap="round" opacity=".5"/>
    <g transform="rotate(-28 32 40)">
      <rect x="8" y="35" width="46" height="9" rx="2" fill="url(#igPaper)"/>
      <rect x="8" y="35" width="14" height="9" rx="2" fill="url(#igFilter)"/>
      <path d="M11 37h1M14 40h1M17 38h1M12 42h1M19 41h1" stroke="#8a4a1a" stroke-width="1.2" stroke-linecap="round"/>
      <rect x="21" y="35" width="1.6" height="9" fill="#e3c06a"/>
      <rect x="51" y="35" width="4" height="9" rx="1.5" fill="#5a5a5a"/>
      <circle cx="55" cy="39.5" r="5.5" fill="url(#igEmber)"/>
    </g></svg>`,
  whisky: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="iwLiq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2b450"/><stop offset="1" stop-color="#9a4f12"/></linearGradient>
    <linearGradient id="iwGlass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".12"/><stop offset="1" stop-color="#ffffff" stop-opacity=".45"/></linearGradient></defs>
    <path d="M13 18h38l-4 36a5 5 0 0 1-5 4H22a5 5 0 0 1-5-4z" fill="url(#iwGlass)" stroke="#e9eef3" stroke-width="1.6"/>
    <path d="M15.6 34h32.8l-2.3 19.6a4 4 0 0 1-4 3.4H21.9a4 4 0 0 1-4-3.4z" fill="url(#iwLiq)"/>
    <rect x="22" y="27" width="11" height="11" rx="2" transform="rotate(-12 27 32)" fill="#eaf6ff" fill-opacity=".75" stroke="#fff" stroke-width=".8"/>
    <rect x="33" y="29" width="10" height="10" rx="2" transform="rotate(14 38 34)" fill="#eaf6ff" fill-opacity=".65" stroke="#fff" stroke-width=".8"/>
    <path d="M17 53h30" stroke="#5a2a08" stroke-width="2" opacity=".5"/>
    <path d="M19 22v26" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".6"/></svg>`,
  energy: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="ieCan" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0f2b1c"/><stop offset=".35" stop-color="#1f6b3f"/><stop offset=".55" stop-color="#2f9a5a"/><stop offset="1" stop-color="#0c2216"/></linearGradient>
    <linearGradient id="ieTop" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a9299"/><stop offset=".5" stop-color="#eef2f5"/><stop offset="1" stop-color="#7a828a"/></linearGradient></defs>
    <path d="M22 9h20l2 4v41l-2 3H22l-2-3V13z" fill="url(#ieCan)"/>
    <path d="M22 9h20l2 4H20z" fill="url(#ieTop)"/><path d="M20 54h24l-2 3H22z" fill="url(#ieTop)"/>
    <path d="M35 17l-9 15h6l-4 14 11-18h-6l4-11z" fill="#c6ff3d" stroke="#0c2216" stroke-width="1"/>
    <text x="32" y="51" text-anchor="middle" font-size="5.4" font-weight="800" letter-spacing=".4" fill="#e9ffe0" font-family="system-ui,sans-serif">ENERJİ</text>
    <path d="M25 14v38" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".28"/></svg>`,
  food: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <defs><radialGradient id="ifPlate" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfd6de"/></radialGradient>
    <radialGradient id="ifRice" cx=".45" cy=".35" r=".7"><stop offset="0" stop-color="#fff6d8"/><stop offset=".6" stop-color="#f3d27a"/><stop offset="1" stop-color="#d9a030"/></radialGradient></defs>
    <path class="if-steam" d="M24 18c-3-3 2-5 0-8M32 16c-3-3 2-5 0-8M40 18c-3-3 2-5 0-8" fill="none" stroke="#dfe6ee" stroke-width="2" stroke-linecap="round" opacity=".7"/>
    <ellipse cx="32" cy="44" rx="27" ry="12" fill="url(#ifPlate)" stroke="#9aa5b1" stroke-width="1"/>
    <ellipse cx="32" cy="43" rx="19" ry="7.5" fill="#e8edf2"/>
    <path d="M15 42c2-12 9-17 17-17s15 5 17 17c-6 3-28 3-34 0z" fill="url(#ifRice)"/>
    <path d="M22 34l1 .5M27 30l1 .4M35 29l1 .3M40 33l1 .5M30 36l1 .4M37 37l1 .4" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
    <ellipse cx="26" cy="38" rx="4" ry="2.6" fill="#8a3e1c"/><ellipse cx="37" cy="36" rx="4.5" ry="2.8" fill="#9a4a22"/>
    <circle cx="31" cy="32" r="1.6" fill="#7a1f2a"/><circle cx="42" cy="39" r="1.4" fill="#7a1f2a"/><circle cx="22" cy="41" r="1.3" fill="#3f7a2a"/></svg>`,
  doner: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="idWrap" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6dca6"/><stop offset="1" stop-color="#d8a75a"/></linearGradient>
    <linearGradient id="idPaper" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f4f1ea"/><stop offset="1" stop-color="#cfc8b8"/></linearGradient></defs>
    <g transform="rotate(-18 32 34)">
      <path d="M20 22c0-6 24-6 24 0l-3 34H23z" fill="url(#idWrap)"/>
      <path d="M21 22c2-4 6 1 8-3s5 3 7-1 6 2 8 4c-6 4-17 4-23 0z" fill="#5fae3a"/>
      <path d="M22 21c3-6 8-3 10-6 2 3 7 0 10 6-6 3-14 3-20 0z" fill="#8a3e1c"/>
      <circle cx="27" cy="19" r="2.4" fill="#e23b2e"/><circle cx="36" cy="18" r="2.2" fill="#e23b2e"/>
      <path d="M24 20h3M33 21h4" stroke="#f7f2d8" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M22 36h20l-1.6 20H23.6z" fill="url(#idPaper)"/>
      <path d="M22 36h20" stroke="#b8ad96" stroke-width="1.2"/>
      <path d="M25 41l1 11M31 41v12M37 41l-1 11" stroke="#d8d0bd" stroke-width="1"/>
    </g></svg>`,
};

const FALLBACK = '<span class="item-emoji" aria-hidden="true">🎁</span>';

/** Əşya ikonu: admin şəkli (varsa) və ya daxili SVG */
export function itemIconHTML(it, cls = '') {
  if (it?.hasImage) return `<img class="item-img ${cls}" src="/api/shop/img/${encodeURIComponent(it.id)}?v=${Number(it.imageVer) || 0}" alt="" loading="lazy" decoding="async">`;
  return `<span class="item-svg ${cls}">${ITEM_SVG[it?.id] || FALLBACK}</span>`;
}

// ---------- istifadə effekti: ikon profil şəklinin yanında ~2,6 saniyə ----------
const SHOW_MS = 2600;
const seen = new Set();
const live = new Map(); // userId → element (eyni oyunçu üçün bir ikon)

function anchor(userId) {
  const seat = document.querySelector(`[data-seat="${userId}"] .av`);
  if (seat) return seat;
  if (userId === S.user?.id) return document.querySelector('.prof-head .avatar') || document.querySelector('.topbar .avatar');
  return null;
}

function layer() {
  let l = document.getElementById('fx');
  if (!l) { l = document.createElement('div'); l.id = 'fx'; l.setAttribute('aria-hidden', 'true'); document.body.appendChild(l); }
  return l;
}

export function onItemUse(ev) {
  if (!ev) return;
  const k = `${ev.userId}:${ev.at}`;
  if (seen.has(k)) return;
  seen.add(k);
  if (seen.size > 200) seen.delete(seen.values().next().value);
  const serverNow = Date.now() + (S.clockOffset || 0);
  if (ev.at && Math.abs(serverNow - ev.at) > 10_000) return; // gecikmiş hadisə göstərilmir
  const a = anchor(ev.userId);
  if (!a) return;
  live.get(ev.userId)?.remove();
  const r = a.getBoundingClientRect();
  const size = Math.round(Math.max(30, Math.min(46, r.width * 0.8)));
  const el = document.createElement('div');
  el.className = 'item-pop';
  el.style.width = `${size}px`; el.style.height = `${size}px`;
  // avatarın sağ-yuxarı küncündə; ekrandan kənara çıxmasın
  const x = Math.min(innerWidth - size - 4, Math.max(4, r.right - size * 0.35));
  const y = Math.min(innerHeight - size - 4, Math.max(4, r.top - size * 0.55));
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  el.innerHTML = itemIconHTML({ id: ev.itemId, hasImage: ev.imageVer > 0, imageVer: ev.imageVer }) + `<span class="item-pop-name">${esc(ev.name || '')}</span>`;
  layer().appendChild(el);
  live.set(ev.userId, el);
  const done = () => { el.remove(); if (live.get(ev.userId) === el) live.delete(ev.userId); };
  if (motionAllowed()) {
    el.animate([
      { transform: 'translate(-6px, 8px) scale(.3) rotate(-14deg)', opacity: 0, offset: 0 },
      { transform: 'translate(0, -2px) scale(1.12) rotate(4deg)', opacity: 1, offset: 0.12 },
      { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1, offset: 0.2 },
      { transform: 'translate(0, -3px) scale(1.03) rotate(-2deg)', opacity: 1, offset: 0.55 },
      { transform: 'translate(0, -1px) scale(1) rotate(1deg)', opacity: 1, offset: 0.85 },
      { transform: 'translate(2px, -10px) scale(.7) rotate(6deg)', opacity: 0, offset: 1 },
    ], { duration: SHOW_MS, easing: 'linear' }).finished.then(done, done);
  } else {
    // animasiyalar söndürülüb / "hərəkəti azalt": hərəkətsiz göstərilir və itir
    setTimeout(done, SHOW_MS);
  }
}
