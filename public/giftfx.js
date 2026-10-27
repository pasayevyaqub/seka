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
      if (document.hidden || !motionAllowed() || S.view !== 'room') { await wait(400); continue; }
      play(`gift_${ev.giftId}`);
      try {
        if (ev.giftId === 'card_rain') await cardRain(ev);
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
export const ICON = { card_rain: '🃏', table_king: '👑', fire_ace: '🔥' };

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
async function tableKing(ev) {
  const b = anchorOf(ev.toId);
  if (!b) return wait(300);
  const host = mk('gift-fx');
  layer().appendChild(host);
  const size = Math.max(54, b.w * 1.15);
  const halo = mk('gf-halo');
  halo.style.left = `${b.x}px`; halo.style.top = `${b.y}px`; halo.style.width = halo.style.height = `${b.w * 1.7}px`;
  host.appendChild(halo);
  const crown = mk('gf-crown', CROWN + '<i class="spark s1"></i><i class="spark s2"></i><i class="spark s3"></i><i class="spark s4"></i>');
  crown.style.width = `${size}px`;
  crown.style.left = `${b.x}px`; crown.style.top = `${b.y - b.w * 0.55}px`;
  host.appendChild(crown);
  const a1 = crown.animate([
    { transform: 'translate(-50%,-100%) translateY(-140px) scale(.6) rotate(-12deg)', opacity: 0 },
    { transform: 'translate(-50%,-100%) translateY(6px) scale(1.05) rotate(3deg)', opacity: 1, offset: 0.17 },
    { transform: 'translate(-50%,-100%) translateY(0) scale(1) rotate(0)', opacity: 1, offset: 0.22 },
    { transform: 'translate(-50%,-100%) translateY(0) scale(1) rotate(0)', opacity: 1, offset: 0.86 },
    { transform: 'translate(-50%,-100%) translateY(-60px) scale(.8)', opacity: 0 },
  ], { duration: 3800, easing: 'ease-in-out', fill: 'both' });
  const a2 = halo.animate([
    { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.22 },
    { transform: 'translate(-50%,-50%) scale(1.1)', opacity: 0.8, offset: 0.6 },
    { transform: 'translate(-50%,-50%) scale(1.25)', opacity: 0 },
  ], { duration: 3800, easing: 'ease-out', fill: 'both' });
  await Promise.all([finished(a1), finished(a2)]);
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
