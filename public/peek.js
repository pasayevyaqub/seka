// "Kartın küncünü qaldırıb baxma" (card squeeze / peek) — yalnız ÖZ kartlarım üçün.
//
// Necə işləyir (həndəsə):
//   Kart üzü aşağı yatır. Barmaq yuxarı küncü (C) P nöqtəsinə çəkir. Qatlanma xətti C–P parçasının orta perpendikulyarıdır.
//   * Arxa üz: kartın qatlanma xəttinin C tərəfində qalan hissəsi kəsilir (orada masa görünür).
//   * Qatlanan hissə (flap): kartın alt səthi = kağızın üz tərəfi. Qat qatlanma xəttinə görə əks etdirilmiş yerdə
//     (R(K)) çəkilir; üzərində kartın küncündəki rəqəm və işarə həmişə düz (oxunaqlı) göstərilir — istinad şəklindəki kimi.
//     Rəqəm qatın açılan hissəsi böyüdükcə tədricən görünür (qat sahəsi ilə kəsilir).
//   * İşıq/kölgə: qatın üzərində qıvrım parıltısı, arxa üzün üstündə qatın saldığı kölgə, qatın özünün kölgəsi.
//
// Qaydalar:
//   * Heç nə serverə göndərilmir: baxmaq xod deyil, növbəni dəyişmir, rəqiblərə heç nə açmır.
//     Serverdə "kartına baxıb-baxmamaq" (kor oyun) qaydası yoxdur — ona görə qeydə alınacaq bir şey də yoxdur.
//   * Rəqiblərin kartları klientə ümumiyyətlə gəlmir; bu modul yalnız serverin MƏNƏ göndərdiyi öz kartlarımla işləyir.
//   * Pointer Events + pointer capture. Capture #app-dan kənar daimi elementdədir, ona görə vəziyyət yeniləməsi
//     (masa yenidən çəkiləndə) hərəkəti kəsmir. Barmaq buraxılanda / ləğv olunanda / capture itəndə kart yumşaq örtülür.
//   * Səhifə sürüşməsi yalnız kartın üzərində bloklanır (touch-action: none yalnız .peek-card-da).
//   * Azaldılmış hərəkət, söndürülmüş animasiya və zəif cihazlar üçün sadə rejim: basıb saxlayanda kart açılır, buraxanda bağlanır.
import { cardSVG, cardBackSVG, rankLabel } from './cards.js';
import { motionAllowed } from './giftfx.js';

const HINT_KEY = 'seka-peek-hint';
const st = {
  active: null,   // { idx, hand, corner:'tl'|'tr', start:{x,y}, d:{x,y}, pointerId, simple }
  closing: null,  // { idx, hand, from:{x,y}, t0, corner }
  peeked: new Map(), // hand → Set(idx) — xal nişanı üçün (yalnız bu cihazda)
  onPeekedAll: null,
};
let layer = null;

const weakDevice = () => {
  // yalnız çox zəif cihazlar (1 nüvə və ya < 1 GB): orada sadə rejim; qalanında istifadəçi ☰ → Animasiyalar ilə söndürə bilər
  try { return (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 2) || (navigator.deviceMemory && navigator.deviceMemory < 1); } catch { return false; }
};
export const simpleMode = () => !motionAllowed() || weakDevice();

export function hintNeeded() {
  try { return localStorage.getItem(HINT_KEY) !== '1'; } catch { return true; }
}
function hintDone() {
  try { localStorage.setItem(HINT_KEY, '1'); } catch { /* yox */ }
  document.querySelectorAll('.peek-hint').forEach((h) => h.classList.add('gone'));
}

export function peekedAll(hand, n) {
  const s = st.peeked.get(hand);
  return !!s && s.size >= n;
}

/** Bir kart: arxa üz (default), qatlanma qatları. data-peek = indeks, data-hand = əl açarı */
export function peekCardHTML(card, i, hand, extraAttr = '') {
  return `<div class="peek-card ${simpleMode() ? 'simple' : ''}" data-peek="${i}" data-hand="${hand}" ${extraAttr} role="img" aria-label="Üzü bağlı kart ${i + 1}: küncünü sürüşdürüb baxın">
    <div class="pk-face">${cardSVG(card)}</div>
    <div class="pk-back">${cardBackSVG()}</div>
    <div class="pk-castshadow"></div>
    <div class="pk-flapwrap"><div class="pk-flap"><div class="pk-paper"></div>
      <div class="pk-idx" style="color:${card.s === 'H' || card.s === 'D' ? '#c8102e' : '#141414'}"><b>${rankLabel(card.r)}</b><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#suit-${card.s}"/></svg></div></div></div>
    <div class="pk-shine"></div>
    <span class="pk-grip tl" aria-hidden="true"></span><span class="pk-grip tr" aria-hidden="true"></span>
  </div>`;
}

// ---------------- həndəsə ----------------
// Düzbucaqlını yarım müstəvi ilə kəsmək (Sutherland–Hodgman, bir müstəvi). keep(q) > 0 olan tərəf saxlanılır.
function clip(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const fa = f(a); const fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}
const poly = (pts) => (pts.length >= 3 ? `polygon(${pts.map((p) => `${p.x.toFixed(2)}px ${p.y.toFixed(2)}px`).join(',')})` : 'polygon(0 0,0 0,0 0)');

function applyFold(el, corner, d) {
  const W = el.offsetWidth; const H = el.offsetHeight;
  if (!W || !H) return 0;
  const C = corner === 'tl' ? { x: 0, y: 0 } : { x: W, y: 0 };
  const P = { x: C.x + d.x, y: C.y + d.y };
  const len = Math.hypot(d.x, d.y);
  const back = el.querySelector('.pk-back');
  const wrap = el.querySelector('.pk-flapwrap');
  const flap = el.querySelector('.pk-flap');
  const shine = el.querySelector('.pk-shine');
  const cast = el.querySelector('.pk-castshadow');
  if (len < 2) {
    el.classList.remove('folding');
    back.style.clipPath = ''; wrap.style.display = 'none'; shine.style.display = 'none'; cast.style.display = 'none';
    return 0;
  }
  el.classList.add('folding');
  const n = { x: (C.x - P.x) / len, y: (C.y - P.y) / len }; // C tərəfə baxan normal
  const mid = { x: (C.x + P.x) / 2, y: (C.y + P.y) / 2 };
  const side = (q) => (q.x - mid.x) * n.x + (q.y - mid.y) * n.y;
  const rect = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const K = clip(rect, (q) => side(q));           // qalxan hissə
  const B = clip(rect, (q) => -side(q));          // yerində qalan arxa üz
  const refl = (q) => { const s = 2 * side(q); return { x: q.x - s * n.x, y: q.y - s * n.y }; };
  const RK = K.map(refl);                         // qatın ekrandakı yeri
  back.style.clipPath = poly(B);
  wrap.style.display = 'block';
  flap.style.clipPath = poly(RK);
  // rəqəm + işarə: qatın ucu (P) ilə qıvrım xətti arasında, düz durur
  const idx = el.querySelector('.pk-idx');
  if (idx) {
    const q = { x: P.x + (mid.x - P.x) * 0.58, y: P.y + (mid.y - P.y) * 0.58 };
    idx.style.left = `${q.x}px`; idx.style.top = `${q.y}px`;
    idx.style.fontSize = `${Math.round(W * 0.26)}px`;
  }
  // işıq: qıvrım xəttindən qatın ucuna doğru (qatın üstündə)
  const u = { x: -n.x, y: -n.y };
  const ang = (Math.atan2(u.x, -u.y) * 180) / Math.PI;
  const L = Math.abs(W * u.x) + Math.abs(H * u.y);
  const cen = { x: W / 2, y: H / 2 };
  const pos = (q) => (q.x - cen.x) * u.x + (q.y - cen.y) * u.y + L / 2;
  const s0 = pos(mid); const s1 = pos(P);
  shine.style.display = 'block';
  shine.style.clipPath = poly(RK);
  shine.style.background = `linear-gradient(${ang}deg, rgba(0,0,0,.28) ${s0}px, rgba(255,255,255,.55) ${s0 + (s1 - s0) * 0.18}px, rgba(255,255,255,.08) ${s0 + (s1 - s0) * 0.5}px, rgba(0,0,0,.12) ${s1}px)`;
  // qatın arxa üzə saldığı kölgə (qıvrım xəttinin yanında)
  const sw = Math.min(26, len * 0.35);
  cast.style.display = 'block';
  cast.style.clipPath = poly(B);
  cast.style.background = `linear-gradient(${ang}deg, transparent ${s0 - 1}px, rgba(0,0,0,.5) ${s0}px, rgba(0,0,0,.18) ${s0 + sw * 0.5}px, transparent ${s0 + sw}px)`;
  return len / Math.min(W, H);
}

function maxD(el, corner, d) {
  const W = el.offsetWidth; const H = el.offsetHeight;
  let x = d.x; let y = Math.max(0, d.y);
  x = corner === 'tr' ? Math.min(0, x) : Math.max(0, x);
  const lim = Math.min(W, H) * 0.92;
  const l = Math.hypot(x, y);
  if (l > lim) { x *= lim / l; y *= lim / l; }
  return { x, y };
}

const cardEl = (s) => document.querySelector(`.peek-card[data-peek="${s.idx}"][data-hand="${s.hand}"]`);

// ---------------- pointer hadisələri ----------------
function onDown(e) {
  const el = e.target.closest?.('.peek-card');
  if (!el || st.active) return;
  if (e.button !== undefined && e.button > 0) return;
  const r = el.getBoundingClientRect();
  const lx = e.clientX - r.left; const ly = e.clientY - r.top;
  const simple = el.classList.contains('simple');
  if (!simple && ly > r.height * 0.6) return; // künc tutuşu — kartın yuxarı hissəsi
  e.preventDefault();
  st.closing = null;
  st.active = { idx: el.dataset.peek, hand: el.dataset.hand, corner: lx < r.width / 2 ? 'tl' : 'tr', start: { x: e.clientX, y: e.clientY }, d: { x: 0, y: 0 }, pointerId: e.pointerId, simple };
  try { layer.setPointerCapture(e.pointerId); } catch { /* bəzi brauzerlər */ }
  if (simple) { el.classList.add('reveal'); markPeeked(st.active); }
}
function onMove(e) {
  const a = st.active;
  if (!a || e.pointerId !== a.pointerId || a.simple) return;
  e.preventDefault();
  const el = cardEl(a);
  if (!el) return;
  a.d = maxD(el, a.corner, { x: e.clientX - a.start.x, y: e.clientY - a.start.y });
  const k = applyFold(el, a.corner, a.d);
  if (k > 0.35) markPeeked(a);
}
function onUp(e) {
  const a = st.active;
  if (!a || (e && e.pointerId !== undefined && e.pointerId !== a.pointerId)) return;
  st.active = null;
  try { layer.releasePointerCapture(a.pointerId); } catch { /* artıq buraxılıb */ }
  const el = cardEl(a);
  if (a.simple) { el?.classList.remove('reveal'); return; }
  if (!el) return;
  // yumşaq örtülmə
  st.closing = { idx: a.idx, hand: a.hand, corner: a.corner, from: a.d, t0: performance.now() };
  requestAnimationFrame(closeStep);
}
function closeStep(t) {
  const c = st.closing;
  if (!c) return;
  const el = cardEl(c);
  const k = Math.min(1, (t - c.t0) / 230);
  const e = 1 - (1 - k) ** 3;
  const d = { x: c.from.x * (1 - e), y: c.from.y * (1 - e) };
  if (el) applyFold(el, c.corner, d);
  if (k < 1) requestAnimationFrame(closeStep); else st.closing = null;
}
function markPeeked(a) {
  let s = st.peeked.get(a.hand);
  if (!s) { s = new Set(); st.peeked.set(a.hand, s); }
  if (!s.has(a.idx)) { s.add(a.idx); hintDone(); st.onPeekedAll?.(a.hand, s.size); }
}

export function installPeek({ onPeekedAll } = {}) {
  if (layer) return;
  st.onPeekedAll = onPeekedAll;
  layer = document.createElement('div');
  layer.id = 'peekLayer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  document.addEventListener('pointerdown', onDown, { passive: false });
  layer.addEventListener('pointermove', onMove, { passive: false });
  layer.addEventListener('pointerup', onUp);
  layer.addEventListener('pointercancel', onUp);
  layer.addEventListener('lostpointercapture', onUp);
  // capture alınmayan brauzerlər üçün ehtiyat
  window.addEventListener('pointermove', (e) => { if (st.active && !layer.hasPointerCapture?.(e.pointerId)) onMove(e); }, { passive: false });
  window.addEventListener('pointerup', (e) => { if (st.active) onUp(e); });
  window.addEventListener('blur', () => { if (st.active) onUp(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && st.active) onUp(); });
  // iOS: kart üzərində uzun basma menyusu / mətn seçimi olmasın
  document.addEventListener('contextmenu', (e) => { if (e.target.closest?.('.peek-card')) e.preventDefault(); });
}

/** Masa yenidən çəkiləndən sonra davam edən baxışı yeni elementə tətbiq et */
export function afterRenderPeek() {
  const a = st.active || st.closing;
  if (!a) return;
  const el = cardEl(a);
  if (!el) { st.active = null; st.closing = null; return; } // əl dəyişib (yeni raund) — baxış dayanır
  if (st.active?.simple) { el.classList.add('reveal'); return; }
  applyFold(el, a.corner, st.active ? st.active.d : a.from);
}

export const peekActive = () => !!st.active;
