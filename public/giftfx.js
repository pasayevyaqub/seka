// Masa hədiyyələrinin animasiyaları — orijinal SVG + CSS + (Odlu Tuz qığılcımları üçün) Canvas.
// Bütün təsvirlər bu faylda koddur, xarici fayl/sayt yoxdur.
//
// Qaydalar:
//  * Yalnız serverin uğurlu əməliyyatdan sonra göndərdiyi "tgift" hadisəsi oynadılır; eyni id iki dəfə oynamır.
//  * Effektlər növbə ilə; növbə məhduddur (MAX_QUEUE), köhnəlmiş effektlər (STALE_MS) buraxılır.
//  * Animasiya qatı #fx — pointer-events: none: kartlara və düymələrə toxunmağa mane olmur, oyunu dayandırmır.
//  * Hər effekt bitəndə yaratdığı elementlər, taymerlər və requestAnimationFrame dövrü təmizlənir.
//  * "Animasiyalar" söndürülübsə və ya sistemdə "hərəkəti azalt" seçilibsə yalnız qısa bildiriş göstərilir.
import { cardSVG, cardBackSVG } from './cards.js';
import { play } from './sound.js';
import { esc, S } from './core.js';

const MAX_QUEUE = 4;
const STALE_MS = 12_000;
const seen = new Set();
const queue = [];
let busy = false;

// ---------- animasiya seçimi (yadda saxlanılır) ----------
let animOff = false;
try { animOff = localStorage.getItem('seka-anim-off') === '1'; } catch { /* gizli rejim */ }
export const animationsOff = () => animOff;
export function toggleAnimations() {
  animOff = !animOff;
  try { localStorage.setItem('seka-anim-off', animOff ? '1' : '0'); } catch { /* yox */ }
  return animOff;
}
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
// zəif telefon: 2 və ya daha az nüvə, ya da ≤ 2 GB yaddaş (brauzer bildirirsə)
const weakDevice = () => { try { return (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) || (navigator.deviceMemory && navigator.deviceMemory <= 2); } catch { return false; } };
export const motionAllowed = () => !animOff && !reduced() && typeof Element.prototype.animate === 'function';

// ---------- Azərbaycan dilində yönlük hal: "Anar" → "Anara", "Leyla" → "Leylaya" ----------
const BACK = 'aıou';
const FRONT = 'eəiöü';
export function dative(name) {
  const n = String(name || '').trim();
  const last = n.slice(-1).toLocaleLowerCase('az');
  if (!/\p{L}/u.test(last)) return `${n}-a`;
  let v = '';
  for (const ch of n.toLocaleLowerCase('az')) if (BACK.includes(ch) || FRONT.includes(ch)) v = ch;
  const back = !v || BACK.includes(v);
  const vowelEnd = BACK.includes(last) || FRONT.includes(last);
  return n + (vowelEnd ? (back ? 'ya' : 'yə') : (back ? 'a' : 'ə'));
}

// ---------- hadisə qəbulu ----------
export function onGiftEvent(ev) {
  if (!ev || seen.has(ev.id)) return; // eyni hadisə iki dəfə oynamır
  seen.add(ev.id);
  if (seen.size > 300) seen.delete(seen.values().next().value);
  // köhnə hadisə (məs. gecikmiş bağlantı) — oynatmırıq
  const serverNow = Date.now() + (S.clockOffset || 0);
  if (ev.at && serverNow - ev.at > STALE_MS) return;
  queue.push({ ...ev, recv: performance.now() });
  while (queue.length > MAX_QUEUE) queue.shift(); // növbə məhduddur: ən köhnəsi buraxılır
  pump();
}

export function clearGiftQueue() { queue.length = 0; }

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const ev = queue.shift();
      if (performance.now() - ev.recv > STALE_MS) continue; // köhnəlib
      banner(ev);
      if (document.hidden || S.view !== 'room') { await wait(400); continue; }
      // Şir: "hərəkəti azalt" / zəif cihaz → yüngül alternativ (yalnız yumşaq görünüb-itmə, transform/canvas yoxdur).
      // "Animasiyalar" istifadəçi tərəfindən söndürülübsə — yalnız bildiriş zolağı (digər hədiyyələr kimi).
      if (ev.giftId === 'lion' && !animOff && (reduced() || weakDevice())) { play('gift_lion'); await lionLight(ev); await wait(150); continue; }
      if (ev.giftId === 'lion' && motionAllowed()) preloadLion();
      if (!motionAllowed()) { await wait(400); continue; }
      play(`gift_${ev.giftId}`);
      try {
        if (ev.giftId === 'lion') await lion(ev);
        else if (ev.giftId === 'card_rain') await cardRain(ev);
        else if (ev.giftId === 'table_king') await tableKing(ev);
        else if (ev.giftId === 'fire_ace') await fireAce(ev);
        else await wait(500);
      } catch { /* animasiya xətası oyunu dayandırmamalıdır */ }
      await wait(150);
    }
  } finally { busy = false; }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function layer() {
  let l = document.getElementById('fx');
  if (!l) { l = document.createElement('div'); l.id = 'fx'; l.setAttribute('aria-hidden', 'true'); document.body.appendChild(l); }
  return l;
}
function anchorOf(id) {
  const el = document.querySelector(`[data-seat="${id}"] .av`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
}
function tableCenter() {
  const el = document.querySelector('.felt');
  if (!el) return { x: innerWidth / 2, y: innerHeight / 2.5 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function mk(cls, html = '') {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  return d;
}
const finished = (anim) => new Promise((res) => { anim.onfinish = res; anim.oncancel = res; });

// ---------- bildiriş: "Yaqub Anara Odlu Tuz göndərdi" ----------
function banner(ev) {
  S.lastGift = { ...ev, code: S.room?.code };
  const tk = document.getElementById('giftTicker');
  if (tk) {
    // masada: alt sətirdəki hədiyyə zolağı yenilənir və parlayır (yer tutmur, düymələri örtmür)
    tk.innerHTML = `<span class="gt-ico">${ICON[ev.giftId] || '🎁'}</span><b>${esc(ev.fromName)}</b> → <b>${esc(ev.toName)}</b> <span class="gt-dot">·</span> <span class="gt-name">${esc(ev.giftName)}</span>`;
    tk.setAttribute('aria-label', `${ev.fromName} ${dative(ev.toName)} ${ev.giftName} göndərdi`);
    tk.classList.remove('flash'); void tk.offsetWidth; tk.classList.add('flash');
    return;
  }
  const b = mk('gift-banner', `<span class="gb-ico">${ICON[ev.giftId] || '🎁'}</span><span><b>${esc(ev.fromName)}</b> ${esc(dative(ev.toName))} <b>${esc(ev.giftName)}</b> göndərdi</span>`);
  b.setAttribute('role', 'status');
  layer().appendChild(b);
  setTimeout(() => b.classList.add('out'), 2600);
  setTimeout(() => b.remove(), 3100);
}
export const ICON = { card_rain: '🃏', table_king: '👑', fire_ace: '🔥', lion: '🦁' };

// ---------- 1) Kart yağışı: kartlar göndərəndən alana uçur, ətrafa səpələnib yox olur ----------
const SUITS = ['H', 'D', 'S', 'C'];
const RANKS = ['T', 'K', 'D', 'V', '10', '9'];
async function cardRain(ev) {
  const a = anchorOf(ev.fromId) || tableCenter();
  const b = anchorOf(ev.toId);
  if (!b) return wait(300);
  const host = mk('gift-fx');
  layer().appendChild(host);
  const anims = [];
  const N = 14;
  for (let i = 0; i < N; i++) {
    const c = i % 3 === 0 ? cardBackSVG() : cardSVG({ r: RANKS[i % RANKS.length], s: SUITS[(i * 7) % 4] });
    const el = mk('gf-card', c);
    el.style.left = `${a.x}px`; el.style.top = `${a.y}px`;
    host.appendChild(el);
    const ang = (i / N) * Math.PI * 2 + Math.random() * 0.4;
    const rad = 45 + Math.random() * 45;
    const dx = b.x - a.x; const dy = b.y - a.y;
    const midX = dx / 2 + (Math.random() - 0.5) * 80; const midY = dy / 2 - 70 - Math.random() * 50; // qövs
    const rot0 = Math.random() * 60 - 30; const rot1 = rot0 + (Math.random() < 0.5 ? -1 : 1) * (200 + Math.random() * 200);
    anims.push(el.animate([
      { transform: `translate(-50%,-50%) scale(.4) rotate(${rot0}deg)`, opacity: 0 },
      { transform: `translate(calc(-50% + ${midX}px), calc(-50% + ${midY}px)) scale(.9) rotate(${(rot0 + rot1) / 2}deg)`, opacity: 1, offset: 0.35 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${rot1}deg)`, opacity: 1, offset: 0.6 },
      { transform: `translate(calc(-50% + ${dx + Math.cos(ang) * rad}px), calc(-50% + ${dy + Math.sin(ang) * rad}px)) scale(.7) rotate(${rot1 + 90}deg)`, opacity: 0 },
    ], { duration: 1700, delay: i * 70, easing: 'cubic-bezier(.25,.7,.3,1)', fill: 'both' }));
  }
  await Promise.all(anims.map(finished));
  host.remove();
}

// ---------- 2) Masa kralı: qızılı tac avatara enir, parıldayır, 3 san sonra çəkilir ----------
const CROWN = `<svg viewBox="0 0 120 90" class="crown-svg">
  <defs>
    <linearGradient id="gcr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2b0"/><stop offset=".45" stop-color="#f2c84b"/><stop offset="1" stop-color="#a8741a"/></linearGradient>
    <linearGradient id="gcb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7d76a"/><stop offset="1" stop-color="#8a5a12"/></linearGradient>
  </defs>
  <path d="M10 70 L6 22 L34 46 L60 8 L86 46 L114 22 L110 70 Z" fill="url(#gcr)" stroke="#6b4510" stroke-width="2.5" stroke-linejoin="round"/>
  <rect x="9" y="66" width="102" height="16" rx="4" fill="url(#gcb)" stroke="#6b4510" stroke-width="2.5"/>
  <circle cx="6" cy="20" r="6" fill="#fff2b0" stroke="#6b4510" stroke-width="2"/><circle cx="60" cy="6" r="6.5" fill="#fff2b0" stroke="#6b4510" stroke-width="2"/><circle cx="114" cy="20" r="6" fill="#fff2b0" stroke="#6b4510" stroke-width="2"/>
  <ellipse cx="60" cy="74" rx="7" ry="5" fill="#d0182f" stroke="#5a0b14" stroke-width="1.5"/>
  <ellipse cx="32" cy="74" rx="5" ry="4" fill="#1f6fd0" stroke="#0c2e5a" stroke-width="1.5"/><ellipse cx="88" cy="74" rx="5" ry="4" fill="#1f6fd0" stroke="#0c2e5a" stroke-width="1.5"/>
  <path d="M60 30 l5 9 l-5 9 l-5 -9 z" fill="#2fbf71" stroke="#0e4d2c" stroke-width="1.5"/>
  <path d="M20 40 Q40 52 60 48 Q80 52 100 40" fill="none" stroke="#fff6c8" stroke-opacity=".7" stroke-width="2"/>
</svg>`;
// "Masa kralı" (v3.0, konsept şəkil əsasında): dörd kart (♥ ♦ ♣ ♠) yelpik kimi açılıb fırlanır → nişanlardan
// qızılı işıq izləri yuxarı axır və tac formalaşır → tac alanın avatarına uçur → xırda qızılı xallar səpələnir.
// ~3,6 san. Yalnız transform/opacity/stroke-dashoffset (GPU) — zəif telefonda da yüngül. #fx qatı toxunuşları buraxır.
async function tableKing(ev) {
  const c = tableCenter();
  const b = anchorOf(ev.toId) || { x: c.x, y: c.y + 120, w: 50 };
  const lite = weakDevice();
  const host = mk('gift-fx king-fx');
  layer().appendChild(host);
  const CW = Math.max(46, Math.min(74, innerWidth * 0.15)); // kart eni
  const T = 3600;
  const A = (el, kf, o = {}) => el.animate(kf, { duration: T, fill: 'both', ...o });
  const anims = [];
  // ad sətri: kim → kimə
  const cap = mk('kg-cap', `<b>${esc(ev.fromName)}</b> → <b>${esc(ev.toName)}</b> · ${esc(ev.giftName)}`);
  cap.style.left = `${c.x}px`; cap.style.top = `${Math.max(70, c.y - CW * 2.9)}px`;
  host.appendChild(cap);
  anims.push(A(cap, [{ opacity: 0, transform: 'translate(-50%, 6px)' }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.08 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }]));
  // işıq dairəsi
  const glow = mk('kg-glow'); glow.style.left = `${c.x}px`; glow.style.top = `${c.y}px`; glow.style.width = glow.style.height = `${CW * 5}px`;
  host.appendChild(glow);
  anims.push(A(glow, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.4)' }, { opacity: 0.9, transform: 'translate(-50%,-50%) scale(1)', offset: 0.3 }, { opacity: 0.6, offset: 0.55 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1.2)', offset: 0.75 }, { opacity: 0 }]));
  // 1) kartlar: ortada yığın → yelpik → fırlanma → nişanlardan işıq çıxanda solur
  const suits = ['H', 'D', 'C', 'S'];
  const fanAng = [-36, -12, 12, 36];
  const crownPt = { x: c.x, y: c.y - CW * 1.9 };
  suits.forEach((su, k) => {
    const card = mk('kg-card', cardSVG({ r: 'T', s: su }));
    card.style.width = `${CW}px`; card.style.left = `${c.x}px`; card.style.top = `${c.y}px`;
    host.appendChild(card);
    const a = fanAng[k];
    const dx = Math.sin((a * Math.PI) / 180) * CW * 1.55; const dy = -Math.cos((a * Math.PI) / 180) * CW * 0.9;
    anims.push(A(card, [
      { transform: 'translate(-50%,-50%) scale(.3) rotate(0deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(.8) rotate(0deg)', opacity: 1, offset: 0.06 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${a}deg) scale(1)`, offset: 0.2, easing: 'ease-in-out' },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${a}deg) rotateY(360deg) scale(1)`, offset: 0.36 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy - 8}px)) rotate(${a}deg) scale(1.03)`, opacity: 1, offset: 0.46 },
      { transform: `translate(calc(-50% + ${dx * 1.15}px), calc(-50% + ${dy + 10}px)) rotate(${a * 1.2}deg) scale(.85)`, opacity: 0, offset: 0.62 },
      { opacity: 0 },
    ]));
    // 2) işıq izi: kartın nişanından tacın yerinə doğru qıvrılan qızılı xətt
    if (!lite || k % 2 === 0) {
      const sx = c.x + dx; const sy = c.y + dy;
      const mx = (sx + crownPt.x) / 2 + (k < 2 ? -1 : 1) * CW * 0.6; const my = Math.min(sy, crownPt.y) - CW * 0.35;
      const minX = Math.min(sx, crownPt.x, mx) - 10; const minY = Math.min(sy, crownPt.y, my) - 10;
      const w = Math.max(sx, crownPt.x, mx) - minX + 20; const h = Math.max(sy, crownPt.y, my) - minY + 20;
      const svg = mk('kg-trail', `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="M${sx - minX} ${sy - minY} Q${mx - minX} ${my - minY} ${crownPt.x - minX} ${crownPt.y - minY}" pathLength="100" fill="none" stroke="url(#kgT)" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="100" stroke-dashoffset="100"/><defs><linearGradient id="kgT"><stop offset="0" stop-color="#fff3c0"/><stop offset="1" stop-color="#f2b53a"/></linearGradient></defs></svg>`);
      svg.style.left = `${minX}px`; svg.style.top = `${minY}px`;
      host.appendChild(svg);
      const path = svg.querySelector('path');
      anims.push(A(path, [{ strokeDashoffset: 100, opacity: 0 }, { strokeDashoffset: 100, opacity: 1, offset: 0.34 }, { strokeDashoffset: 0, opacity: 1, offset: 0.5 }, { strokeDashoffset: -100, opacity: 0, offset: 0.66 }, { strokeDashoffset: -100, opacity: 0 }]));
    }
  });
  // 3) tac: işıqlardan formalaşır → parlayır → alanın avatarına uçur
  const size = Math.max(64, CW * 1.5);
  const crown = mk('kg-crown', CROWN);
  crown.style.width = `${size}px`; crown.style.left = `${crownPt.x}px`; crown.style.top = `${crownPt.y}px`;
  host.appendChild(crown);
  const tx = b.x - crownPt.x; const ty = b.y - b.w * 0.55 - crownPt.y;
  anims.push(A(crown, [
    { transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(.2)', opacity: 0, offset: 0.44 },
    { transform: 'translate(-50%,-50%) scale(1.15)', opacity: 1, offset: 0.54, easing: 'ease-out' },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.62, easing: 'cubic-bezier(.5,0,.3,1)' },
    { transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(${Math.max(0.45, (b.w * 1.1) / size)})`, opacity: 1, offset: 0.8 },
    { transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(${Math.max(0.45, (b.w * 1.1) / size)})`, opacity: 1, offset: 0.92 },
    { transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty - 20}px)) scale(.4)`, opacity: 0 },
  ]));
  // 4) xırda qızılı xallar alanın avatarından səpələnir
  const N = lite ? 6 : 12;
  for (let k = 0; k < N; k++) {
    const coin = mk('kg-coin');
    coin.style.left = `${b.x}px`; coin.style.top = `${b.y}px`;
    host.appendChild(coin);
    const ang = (k / N) * Math.PI * 2 + Math.random() * 0.4; const rad = b.w * (0.9 + Math.random() * 0.9);
    anims.push(A(coin, [
      { transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(.2)', opacity: 0, offset: 0.78 },
      { transform: `translate(calc(-50% + ${Math.cos(ang) * rad * 0.6}px), calc(-50% + ${Math.sin(ang) * rad * 0.6 - 18}px)) scale(1) rotateY(180deg)`, opacity: 1, offset: 0.88 },
      { transform: `translate(calc(-50% + ${Math.cos(ang) * rad}px), calc(-50% + ${Math.sin(ang) * rad + 14}px)) scale(.7) rotateY(360deg)`, opacity: 0 },
    ]));
  }
  await Promise.all(anims.map(finished));
  host.remove();
}

// ---------- 3) Odlu Tuz: masanın ortasında böyük tuz açılır, alov və qığılcımlar, sonra alana kiçilib gedir ----------
const FLAME = `<svg viewBox="0 0 200 240" class="flame-svg">
  <defs>
    <radialGradient id="gfl1" cx=".5" cy=".75" r=".7"><stop offset="0" stop-color="#fff6c2"/><stop offset=".35" stop-color="#ffc533"/><stop offset=".75" stop-color="#ff6a12"/><stop offset="1" stop-color="#c41a0a" stop-opacity="0"/></radialGradient>
    <radialGradient id="gfl2" cx=".5" cy=".8" r=".6"><stop offset="0" stop-color="#fffbe6"/><stop offset=".5" stop-color="#ffd34d"/><stop offset="1" stop-color="#ff7b1a" stop-opacity="0"/></radialGradient>
  </defs>
  <path class="fl f1" d="M100 235 C30 225 18 160 48 118 C58 150 70 152 74 140 C66 104 82 64 112 30 C110 70 132 92 148 112 C150 96 158 88 166 80 C190 130 182 228 100 235 Z" fill="url(#gfl1)"/>
  <path class="fl f2" d="M100 232 C56 226 46 180 66 150 C74 170 84 170 86 160 C82 136 94 112 112 92 C114 120 130 136 140 150 C150 186 138 228 100 232 Z" fill="url(#gfl2)"/>
</svg>`;
async function fireAce(ev) {
  const b = anchorOf(ev.toId);
  const c = tableCenter();
  const host = mk('gift-fx');
  layer().appendChild(host);
  const W = Math.min(150, innerWidth * 0.36);
  const stage = mk('gf-ace');
  stage.style.left = `${c.x}px`; stage.style.top = `${c.y}px`; stage.style.width = `${W}px`;
  stage.innerHTML = `<div class="gf-flame">${FLAME}</div><div class="gf-acecard">${cardSVG({ r: 'T', s: 'H' })}</div>`;
  host.appendChild(stage);
  // qığılcımlar — Canvas
  const cv = document.createElement('canvas');
  const CW = Math.round(W * 2.6); const CH = Math.round(W * 2.6);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = CW * dpr; cv.height = CH * dpr;
  cv.className = 'gf-sparks';
  cv.style.width = `${CW}px`; cv.style.height = `${CH}px`; cv.style.left = `${c.x}px`; cv.style.top = `${c.y}px`;
  host.insertBefore(cv, stage);
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const parts = [];
  let raf = 0; let stop = false;
  const t0 = performance.now();
  const loop = (t) => {
    if (stop) return;
    const el = t - t0;
    if (el < 2300 && parts.length < 140) {
      for (let k = 0; k < 4; k++) {
        parts.push({ x: CW / 2 + (Math.random() - 0.5) * W * 0.8, y: CH / 2 + W * 0.5, vx: (Math.random() - 0.5) * 2.4, vy: -2 - Math.random() * 3.2, life: 0, max: 40 + Math.random() * 40, r: 1 + Math.random() * 2.2 });
      }
    }
    ctx.clearRect(0, 0, CW, CH);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life++; p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.vx *= 0.99;
      const k = 1 - p.life / p.max;
      if (k <= 0) { parts.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(255, ${Math.round(150 + 100 * k)}, ${Math.round(40 * k)}, ${k})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.6 + k), 0, Math.PI * 2); ctx.fill();
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  const card = stage.querySelector('.gf-acecard');
  const flame = stage.querySelector('.gf-flame');
  const open = card.animate([
    { transform: 'perspective(600px) rotateY(180deg) scale(.3)', opacity: 0 },
    { transform: 'perspective(600px) rotateY(0) scale(1.08)', opacity: 1, offset: 0.6 },
    { transform: 'perspective(600px) rotateY(0) scale(1)', opacity: 1 },
  ], { duration: 650, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' });
  flame.animate([{ opacity: 0, transform: 'translate(-50%,-68%) scale(.4)' }, { opacity: 1, transform: 'translate(-50%,-68%) scale(1)' }], { duration: 500, delay: 250, fill: 'both' });
  await finished(open);
  await wait(1500);
  // alana tərəf kiçilib yox olur
  const to = b || c;
  const move = stage.animate([
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
    { transform: `translate(calc(-50% + ${to.x - c.x}px), calc(-50% + ${to.y - c.y}px)) scale(.12)`, opacity: 0.1 },
  ], { duration: 800, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'both' });
  const fade = cv.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: 'both' });
  await Promise.all([finished(move), finished(fade)]);
  stop = true;
  cancelAnimationFrame(raf);
  host.remove();
}

// ---------- 4) Şir: tam ekran — əzəmətli qızılı şir səhnəyə yaxınlaşır, nərildəyir, sonra çəkilir ----------
// Qrafika tamamilə bu faylda, kodla yaradılır (xarici şəkil yoxdur): yal yüzlərlə incə tükdən (sabit "toxumlu"
// təsadüfi generatorla — hər dəfə eyni şəkil), üz işıq-kölgə qradiyentləri ilə, gözlər parıltılı. Səs sound.js-də sintez olunur.
// Qat #fx — pointer-events: none: kartlar, düymələr, növbə taymeri və çat yazısı işləməyə davam edir; fokus götürülmür.
function rng(seed) { let t = seed >>> 0; return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
const CX = 200; const CY = 206;
// bir tük qatı: üzün ətrafındakı ellipsdən çıxan, S-şəkilli dalğalanan, ucu bir az aşağı/kənara axan tutamlar
function strands(n, seed, { r0x, r0y, len, extraDown, width, fill, curl }) {
  const R = rng(seed);
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (R() - 0.5) * 0.25;
    let dx = Math.cos(a); let dy = Math.sin(a) + 0.38; // tüklər bir az aşağı axır (ağırlıq)
    const m = Math.hypot(dx, dy); dx /= m; dy /= m;
    const px0 = -dy; const py0 = dx; // perpendikulyar
    const bx = CX + Math.cos(a) * r0x * (0.9 + R() * 0.14); const by = CY + Math.sin(a) * r0y * (0.9 + R() * 0.14);
    const L = len[0] + R() * (len[1] - len[0]) + Math.max(0, Math.sin(a)) * extraDown * (0.7 + R() * 0.5);
    const w1 = curl * (0.5 + R()) * (R() < 0.5 ? -1 : 1);
    const w2 = -w1 * (0.6 + R() * 0.6);
    const tipSide = w1 * 0.9;
    const tx = bx + dx * L + px0 * tipSide; const ty = by + dy * L + py0 * tipSide;
    const c1x = bx + dx * L * 0.35 + px0 * w1; const c1y = by + dy * L * 0.35 + py0 * w1;
    const c2x = bx + dx * L * 0.72 + px0 * w2; const c2y = by + dy * L * 0.72 + py0 * w2;
    const w = width * (0.75 + R() * 0.55);
    const f = (x) => x.toFixed(1);
    d += `M${f(bx + px0 * w / 2)} ${f(by + py0 * w / 2)}C${f(c1x + px0 * w * 0.4)} ${f(c1y + py0 * w * 0.4)} ${f(c2x + px0 * w * 0.22)} ${f(c2y + py0 * w * 0.22)} ${f(tx)} ${f(ty)}`
      + `C${f(c2x - px0 * w * 0.22)} ${f(c2y - py0 * w * 0.22)} ${f(c1x - px0 * w * 0.4)} ${f(c1y - py0 * w * 0.4)} ${f(bx - px0 * w / 2)} ${f(by - py0 * w / 2)}Z`;
  }
  return `<path d="${d}" fill="${fill}"/>`;
}
function hairLines(n, seed, color, op) {
  const R = rng(seed);
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2; const ca = Math.cos(a); const sa = Math.sin(a);
    const r1 = 100 + R() * 40; const r2 = r1 + 40 + R() * 60 + Math.max(0, sa) * 40;
    const c = (R() - 0.5) * 30;
    d += `M${(CX + ca * r1).toFixed(1)} ${(CY + sa * r1 * 1.1).toFixed(1)}Q${(CX + ca * (r1 + r2) / 2 - sa * c).toFixed(1)} ${(CY + sa * (r1 + r2) / 2 * 1.1 + ca * c).toFixed(1)} ${(CX + ca * r2).toFixed(1)} ${(CY + sa * r2 * 1.1).toFixed(1)}`;
  }
  return `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="${op}" stroke-width="1.6" stroke-linecap="round"/>`;
}
// çənə altında saqqal tutamları (çənə ilə birlikdə hərəkət edir)
function beard(n) {
  const R = rng(77);
  let d = '';
  for (let i = 0; i < n; i++) {
    const bx = 166 + (68 * i) / Math.max(1, n - 1) + (R() - 0.5) * 6; const by = 372 + (R() - 0.5) * 6;
    const L = 26 + R() * 34 - Math.abs(bx - 200) * 0.25; const sw = (bx - 200) * 0.35 + (R() - 0.5) * 10;
    const w = 7 + R() * 5;
    d += `M${(bx - w / 2).toFixed(1)} ${by.toFixed(1)}Q${(bx + sw * 0.4).toFixed(1)} ${(by + L * 0.6).toFixed(1)} ${(bx + sw).toFixed(1)} ${(by + L).toFixed(1)}Q${(bx + sw * 0.4 + w * 0.3).toFixed(1)} ${(by + L * 0.55).toFixed(1)} ${(bx + w / 2).toFixed(1)} ${by.toFixed(1)}Z`;
  }
  return `<path d="${d}" fill="url(#lnFront)"/>`;
}
function lionSVG(light = false) {
  const k = light ? 0.45 : 1;
  const N = (x) => Math.round(x * k);
  return `<svg viewBox="0 0 400 460" class="lion-svg" aria-hidden="true">
  <defs>
    <radialGradient id="lnBack" gradientUnits="userSpaceOnUse" cx="${CX}" cy="${CY}" r="250"><stop offset=".25" stop-color="#9a5418"/><stop offset=".6" stop-color="#6a3110"/><stop offset="1" stop-color="#2a1205"/></radialGradient>
    <radialGradient id="lnMid" gradientUnits="userSpaceOnUse" cx="${CX}" cy="${CY - 10}" r="210"><stop offset=".3" stop-color="#e7a23e"/><stop offset=".65" stop-color="#b06520"/><stop offset="1" stop-color="#5a2a0c"/></radialGradient>
    <radialGradient id="lnFront" gradientUnits="userSpaceOnUse" cx="${CX}" cy="${CY - 30}" r="170"><stop offset=".35" stop-color="#ffd27a"/><stop offset=".7" stop-color="#d98a2e"/><stop offset="1" stop-color="#8a4714"/></radialGradient>
    <radialGradient id="lnFace" gradientUnits="userSpaceOnUse" cx="${CX}" cy="${CY - 20}" r="150"><stop offset="0" stop-color="#ffd896"/><stop offset=".45" stop-color="#eeb466"/><stop offset=".8" stop-color="#c47c33"/><stop offset="1" stop-color="#8f5020"/></radialGradient>
    <radialGradient id="lnMuz" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="#fff6e4"/><stop offset=".7" stop-color="#f1d7aa"/><stop offset="1" stop-color="#d6ab6d"/></radialGradient>
    <radialGradient id="lnIris" cx=".42" cy=".38" r=".62"><stop offset="0" stop-color="#fff0a0"/><stop offset=".35" stop-color="#f5b52a"/><stop offset=".8" stop-color="#b9650c"/><stop offset="1" stop-color="#5a2a04"/></radialGradient>
    <linearGradient id="lnNose" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a4a36"/><stop offset=".6" stop-color="#4a2014"/><stop offset="1" stop-color="#2a0f08"/></linearGradient>
    <radialGradient id="lnMouth" cx=".5" cy=".3" r=".7"><stop offset="0" stop-color="#7a1622"/><stop offset="1" stop-color="#2a0508"/></radialGradient>
    <filter id="lnSoft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>
    <filter id="lnSoft2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
    <filter id="lnSoft3" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>
  </defs>
  <g class="ln-mane">
    <ellipse cx="${CX}" cy="${CY + 30}" rx="175" ry="195" fill="#4a2209" filter="url(#lnSoft3)"/>
    ${strands(N(110), 11, { r0x: 112, r0y: 122, len: [95, 140], extraDown: 55, width: 40, fill: 'url(#lnBack)', curl: 22 })}
    ${strands(N(120), 23, { r0x: 106, r0y: 116, len: [72, 112], extraDown: 42, width: 32, fill: 'url(#lnMid)', curl: 18 })}
    ${hairLines(N(80), 5, '#ffd99a', 0.22)}
    ${strands(N(95), 37, { r0x: 98, r0y: 108, len: [40, 78], extraDown: 26, width: 24, fill: 'url(#lnFront)', curl: 12 })}
    ${hairLines(N(50), 9, '#fff0c8', 0.3)}
  </g>
  <!-- qulaqlar -->
  <g><ellipse cx="128" cy="118" rx="28" ry="26" fill="#c47c33"/><ellipse cx="130" cy="122" rx="15" ry="14" fill="#5a2a12"/>
     <ellipse cx="272" cy="118" rx="28" ry="26" fill="#c47c33"/><ellipse cx="270" cy="122" rx="15" ry="14" fill="#5a2a12"/></g>
  <!-- baş -->
  <path d="M200 100 C258 100 300 146 304 204 C308 258 276 306 242 330 C224 342 176 342 158 330 C124 306 92 258 96 204 C100 146 142 100 200 100 Z" fill="url(#lnFace)"/>
  <!-- üzün kənarında qısa tüklər (sərt kontur görünməsin) -->
  ${strands(N(90), 51, { r0x: 98, r0y: 114, len: [12, 30], extraDown: 22, width: 13, fill: 'url(#lnFront)', curl: 5 })}
  <!-- yanaq kölgələri -->
  <g filter="url(#lnSoft)" opacity=".45"><ellipse cx="122" cy="250" rx="26" ry="44" fill="#8f4f1c"/><ellipse cx="278" cy="250" rx="26" ry="44" fill="#8f4f1c"/></g>
  <!-- alın kölgələri və qaş -->
  <g filter="url(#lnSoft2)" opacity=".55"><path d="M200 112 L194 168 M200 112 L206 168 M182 120 L188 160 M218 120 L212 160" stroke="#9a5a22" stroke-width="4" stroke-linecap="round"/></g>
  <g filter="url(#lnSoft)" opacity=".7"><ellipse cx="156" cy="196" rx="34" ry="20" fill="#6e3a12"/><ellipse cx="244" cy="196" rx="34" ry="20" fill="#6e3a12"/></g>
  <path d="M126 180 Q156 160 186 182" fill="none" stroke="#7a4216" stroke-width="6" stroke-linecap="round" opacity=".7"/>
  <path d="M214 182 Q244 160 274 180" fill="none" stroke="#7a4216" stroke-width="6" stroke-linecap="round" opacity=".7"/>
  <!-- burun körpüsü (işıq) -->
  <path d="M184 190 Q200 182 216 190 L222 262 Q200 270 178 262 Z" fill="#ffe2a8" opacity=".55" filter="url(#lnSoft2)"/>
  <!-- gözlər -->
  <g class="ln-eyes">
    <g transform="translate(157 203) rotate(10)">
      <path d="M-27 0 Q-6 -20 25 -4 Q4 15 -27 0 Z" fill="#1d0c03"/>
      <path d="M-22 0 Q-5 -15 20 -3 Q3 11 -22 0 Z" fill="url(#lnIris)"/>
      <circle cx="0" cy="-2" r="5.6" fill="#0d0502"/><circle cx="3.5" cy="-5" r="2.4" fill="#fff"/><circle cx="-6" cy="2" r="1.2" fill="#fff" opacity=".7"/>
    </g>
    <g transform="translate(243 203) rotate(-10) scale(-1 1)">
      <path d="M-27 0 Q-6 -20 25 -4 Q4 15 -27 0 Z" fill="#1d0c03"/>
      <path d="M-22 0 Q-5 -15 20 -3 Q3 11 -22 0 Z" fill="url(#lnIris)"/>
      <circle cx="0" cy="-2" r="5.6" fill="#0d0502"/><circle cx="-3.5" cy="-5" r="2.4" fill="#fff"/><circle cx="6" cy="2" r="1.2" fill="#fff" opacity=".7"/>
    </g>
  </g>
  <!-- alt çənə (nəriltidə aşağı düşür) -->
  <g class="ln-jaw">
    <path d="M160 300 Q200 292 240 300 Q246 352 200 372 Q154 352 160 300 Z" fill="url(#lnMouth)"/>
    <path d="M178 352 Q200 340 222 352 Q214 366 200 368 Q186 366 178 352 Z" fill="#d3485e"/>
    <path d="M166 312 l9 26 l7 -24 Z M234 312 l-9 26 l-7 -24 Z" fill="#fffaf0" stroke="#d8cbb0" stroke-width="1"/>
    <path d="M176 356 l6 -18 l6 17 Z M224 356 l-6 -18 l-6 17 Z" fill="#fffaf0" stroke="#d8cbb0" stroke-width="1"/>
    <ellipse cx="200" cy="370" rx="38" ry="17" fill="#e9b468"/>
    ${beard(N(26))}
  </g>
  <!-- üst dodaq / bığ yastıqları -->
  <g class="ln-muzzle">
    <ellipse cx="176" cy="292" rx="34" ry="24" fill="url(#lnMuz)"/><ellipse cx="224" cy="292" rx="34" ry="24" fill="url(#lnMuz)"/>
    <g fill="#8a5a2a" opacity=".75"><circle cx="164" cy="288" r="2"/><circle cx="174" cy="296" r="2"/><circle cx="160" cy="300" r="2"/><circle cx="236" cy="288" r="2"/><circle cx="226" cy="296" r="2"/><circle cx="240" cy="300" r="2"/></g>
    <g stroke="#fffaf0" stroke-width="1.3" opacity=".85" fill="none" stroke-linecap="round">
      <path d="M150 292 Q110 284 74 290"/><path d="M150 300 Q112 300 78 312"/><path d="M152 306 Q118 314 90 332"/>
      <path d="M250 292 Q290 284 326 290"/><path d="M250 300 Q288 300 322 312"/><path d="M248 306 Q282 314 310 332"/>
    </g>
    <path d="M200 276 L200 300 M200 300 Q186 312 172 306 M200 300 Q214 312 228 306" stroke="#4a2014" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M170 262 Q200 248 230 262 Q228 284 210 292 L200 298 L190 292 Q172 284 170 262 Z" fill="url(#lnNose)"/>
    <ellipse cx="192" cy="262" rx="9" ry="4" fill="#c98a74" opacity=".55"/>
    <path d="M182 280 q8 6 14 0 M218 280 q-8 6 -14 0" stroke="#1a0804" stroke-width="3" fill="none" stroke-linecap="round"/>
  </g>
</svg>`;
}
let lionCache = null; let lionLightCache = null;
const lionFull = () => (lionCache ||= lionSVG(false));
const lionLite = () => (lionLightCache ||= lionSVG(true));
export const LION_SVG = lionFull;

// qızılı qığılcımlar (Canvas): nəriltidə partlayış
function sparkles(host, at, k = 1) {
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  cv.className = 'ln-sparks';
  host.appendChild(cv);
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  const parts = []; let raf = 0; const t0 = performance.now(); let burst = false;
  const cx = innerWidth / 2; const cy = innerHeight * 0.46;
  const loop = (t) => {
    const el = t - t0;
    if (el < 2600 && parts.length < 160 * k) parts.push({ x: cx + (Math.random() - 0.5) * innerWidth * 0.7, y: cy + (Math.random() - 0.3) * innerHeight * 0.5, vx: (Math.random() - 0.5) * 0.4, vy: -0.3 - Math.random() * 0.6, life: 0, max: 60 + Math.random() * 60, r: 0.8 + Math.random() * 1.8 });
    if (!burst && el > at) {
      burst = true;
      for (let i = 0; i < 90 * k; i++) { const a = Math.random() * Math.PI * 2; const v = 2 + Math.random() * 5; parts.push({ x: cx, y: cy + 30, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 40 + Math.random() * 40, r: 1 + Math.random() * 2.4 }); }
    }
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life++; p.x += p.vx; p.y += p.vy; p.vx *= 0.97; p.vy *= 0.97;
      const k = 1 - p.life / p.max;
      if (k <= 0) { parts.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(255, ${Math.round(190 + 60 * k)}, ${Math.round(90 * k)}, ${k})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + k), 0, Math.PI * 2); ctx.fill();
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}

// Şirin şəkli: istifadəçinin verdiyi təsvir (public/lion.webp, zəif cihaz üçün lion-sm.webp).
// Qabaqcadan yüklənir ki, hədiyyə gələndə animasiya gecikməsin; şəkil yüklənməsə kodla çəkilmiş SVG şir göstərilir.
const LION_IMG = '/lion.webp'; const LION_IMG_SM = '/lion-sm.webp';
const imgReady = new Map();
export function preloadLion() {
  for (const src of [LION_IMG, LION_IMG_SM]) {
    if (imgReady.has(src)) continue;
    const im = new Image(); im.decoding = 'async';
    imgReady.set(src, new Promise((res) => { im.onload = () => res(true); im.onerror = () => res(false); }));
    im.src = src;
  }
}
async function imgOk(src) {
  preloadLion();
  return Promise.race([imgReady.get(src), wait(1500).then(() => false)]);
}

// Animasiya (~3.2 san, yalnız transform/opacity/clip-path — GPU ilə, telefonu yükləmir):
//  1) qızılı dairə (portal) açılır; 2) şir dairənin içindən görünür və ekrana tullanır;
//  3) nərilti: zərbə kimi yaxınlaşma, titrəmə, işıq çaxması, qızılı halqalar və qığılcımlar yayılır;
//  4) yal küləkdə yellənir (şəklin yal hissəsi ayrıca qatdır, üz hissəsi maska ilə sabit qalır); 5) işığa qarışıb çəkilir.
async function lion(ev) {
  const ok = await imgOk(LION_IMG);
  if (!ok) return lionSvgFallback(ev);
  const host = mk('gift-fx lion-fx');
  host.innerHTML = `<div class="ln-dim"></div><div class="ln-rays"></div>
    <div class="ln-portal"><i class="p1"></i><i class="p2"></i></div>
    <div class="ln-stage photo"><div class="ln-shake"><div class="ln-pic">
      <img class="ln-photo" src="${LION_IMG}" alt="" draggable="false">
      <img class="ln-photo ln-mane-layer" src="${LION_IMG}" alt="" draggable="false">
      <div class="ln-flash"></div>
    </div></div></div>
    <div class="ln-rings"><i></i><i></i><i></i></div>
    <div class="ln-cap"><b>${esc(ev.fromName)}</b> → <b>${esc(ev.toName)}</b> · ${esc(ev.giftName)}</div>`;
  layer().appendChild(host);
  const T = 3200; const ROAR = 0.4; // nəriltinin anı (~1.3 san) — səs də bu an (sound.js)
  const stopSparks = sparkles(host, T * ROAR, 0.6);
  const q = (sel) => host.querySelector(sel);
  const A = (el, kf, o = {}) => el.animate(kf, { duration: T, fill: 'both', ...o });
  const anims = [
    A(q('.ln-dim'), [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }]),
    // portal: kiçik nöqtədən açılan fırlanan qızılı dairə; şir çıxandan sonra işığa qarışır
    A(q('.ln-portal'), [
      { transform: 'translate(-50%,-50%) scale(.1) rotate(0deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(90deg)', opacity: 1, offset: 0.16, easing: 'ease-out' },
      { transform: 'translate(-50%,-50%) scale(1.05) rotate(140deg)', opacity: 1, offset: 0.3 },
      { transform: 'translate(-50%,-50%) scale(1.9) rotate(220deg)', opacity: 0, offset: 0.5 },
      { transform: 'translate(-50%,-50%) scale(1.9) rotate(220deg)', opacity: 0 },
    ]),
    // şəkil əvvəl portalın içində (dairəvi kəsik), sonra kəsik açılır və şir irəli tullanır
    A(q('.ln-pic'), [
      { clipPath: 'circle(0% at 50% 44%)' },
      { clipPath: 'circle(0% at 50% 44%)', offset: 0.08 },
      { clipPath: 'circle(30% at 50% 44%)', offset: 0.24 },
      { clipPath: 'circle(95% at 50% 44%)', offset: 0.38 },
      { clipPath: 'circle(95% at 50% 44%)' },
    ]),
    A(q('.ln-stage'), [
      { transform: 'translate(-50%,-50%) scale(.42)', opacity: 0, filter: 'brightness(1.8)' },
      { transform: 'translate(-50%,-50%) scale(.46)', opacity: 1, offset: 0.12, filter: 'brightness(1.6)' },
      { transform: 'translate(-50%,-48%) scale(.55)', offset: 0.24, easing: 'cubic-bezier(.3,0,.2,1)' },
      { transform: 'translate(-50%,-53%) scale(1.06)', offset: ROAR - 0.03, filter: 'brightness(1)' },
      { transform: 'translate(-50%,-50%) scale(1.12)', offset: ROAR + 0.05, filter: 'brightness(1.25)' },
      { transform: 'translate(-50%,-50%) scale(1.06)', opacity: 1, offset: 0.82, filter: 'brightness(1)', easing: 'ease-in' },
      { transform: 'translate(-50%,-50%) scale(1.25)', opacity: 0, filter: 'brightness(2)' },
    ]),
    A(q('.ln-shake'), [
      { transform: 'translate(0,0)' }, { transform: 'translate(0,0)', offset: ROAR },
      { transform: 'translate(-8px,4px) rotate(-.7deg)', offset: ROAR + 0.02 }, { transform: 'translate(8px,-3px) rotate(.7deg)', offset: ROAR + 0.04 },
      { transform: 'translate(-6px,2px)', offset: ROAR + 0.06 }, { transform: 'translate(4px,-2px)', offset: ROAR + 0.09 },
      { transform: 'translate(-2px,1px)', offset: ROAR + 0.13 }, { transform: 'translate(0,0)', offset: ROAR + 0.2 }, { transform: 'translate(0,0)' },
    ]),
    A(q('.ln-flash'), [{ opacity: 0 }, { opacity: 0, offset: ROAR - 0.01 }, { opacity: 0.55, offset: ROAR + 0.02 }, { opacity: 0, offset: ROAR + 0.14 }, { opacity: 0 }]),
    A(q('.ln-rays'), [
      { opacity: 0, transform: 'translate(-50%,-50%) rotate(0deg) scale(.5)' }, { opacity: 0, offset: ROAR - 0.04, transform: 'translate(-50%,-50%) rotate(10deg) scale(.6)' },
      { opacity: 1, offset: ROAR + 0.06, transform: 'translate(-50%,-50%) rotate(30deg) scale(1.1)' }, { opacity: 0.6, offset: 0.8 },
      { opacity: 0, transform: 'translate(-50%,-50%) rotate(55deg) scale(1.3)' },
    ]),
    // yal küləkdə: yalnız kənar (yal) qatı yellənir, üz maskalanıb sabit qalır
    q('.ln-mane-layer').animate([
      { transform: 'rotate(0deg) scale(1)' }, { transform: 'rotate(-1.4deg) scale(1.018) skewX(.6deg)' },
      { transform: 'rotate(.9deg) scale(1.025) skewX(-.5deg)' }, { transform: 'rotate(0deg) scale(1)' },
    ], { duration: 900, iterations: 3, delay: T * 0.3, easing: 'ease-in-out' }),
    A(q('.ln-cap'), [{ opacity: 0, transform: 'translate(-50%, 10px)' }, { opacity: 0, offset: 0.3 }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.42 }, { opacity: 1, offset: 0.84 }, { opacity: 0 }]),
  ];
  host.querySelectorAll('.ln-rings i').forEach((ring, i) => anims.push(A(ring, [
    { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0, offset: ROAR + i * 0.05 },
    { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0.9, offset: ROAR + 0.02 + i * 0.05 },
    { transform: 'translate(-50%,-50%) scale(2.8)', opacity: 0, offset: Math.min(0.95, ROAR + 0.3 + i * 0.05) }, { transform: 'translate(-50%,-50%) scale(2.8)', opacity: 0 },
  ])));
  await Promise.all(anims.map(finished));
  stopSparks();
  host.remove();
}

// şəkil yüklənməsə: kodla çəkilmiş SVG şir (əvvəlki versiya)
async function lionSvgFallback(ev) {
  const host = mk('gift-fx lion-fx');
  host.innerHTML = `<div class="ln-dim"></div><div class="ln-stage"><div class="ln-shake">${lionFull()}</div></div><div class="ln-cap"><b>${esc(ev.fromName)}</b> → <b>${esc(ev.toName)}</b> · ${esc(ev.giftName)}</div>`;
  layer().appendChild(host);
  const a = host.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 2800, fill: 'both' });
  await finished(a);
  host.remove();
}

// yüngül alternativ: kiçik şəkil, yalnız görünüb-itmə (zəif telefon / "hərəkəti azalt")
async function lionLight(ev) {
  const ok = await imgOk(LION_IMG_SM);
  const host = mk('gift-fx lion-fx light');
  host.innerHTML = `<div class="ln-dim"></div><div class="ln-stage photo still">${ok ? `<img class="ln-photo" src="${LION_IMG_SM}" alt="" draggable="false">` : `<div class="ln-svgwrap">${lionLite()}</div>`}</div><div class="ln-cap"><b>${esc(ev.fromName)}</b> → <b>${esc(ev.toName)}</b> · ${esc(ev.giftName)}</div>`;
  layer().appendChild(host);
  if (typeof host.animate !== 'function') { await wait(2200); host.remove(); return; }
  const a = host.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 2600, fill: 'both' });
  await finished(a);
  host.remove();
}
