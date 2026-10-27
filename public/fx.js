// Masa animasiyaları: yalnız serverin təsdiqlədiyi vəziyyət dəyişikliklərindən yaranır.
// Klient heç vaxt gizli kart almır — paylama animasiyası yalnız kartların ARXA üzü ilə edilir,
// açılma (flip) isə server kartı görünən etdikdən sonra baş verir.
// Yenidən çəkilmədə animasiya sıfırdan başlamır: başlanğıc vaxtı yadda saxlanılır və mənfi gecikmə ilə davam etdirilir.
import { noteSVG, splitNotes } from './notes.js';
import { play } from './sound.js';
import { S } from './core.js';
import { motionAllowed } from './giftfx.js';

const st = { dealKey: '', dealStart: 0, flips: new Map(), queue: [] };
const DEAL_STEP = 70;
const DEAL_MS = 420;
const FLIP_MS = 360;

const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// Server yeni otaq vəziyyəti göndərəndə (render-dən ƏVVƏL) çağırılır
export function onRoom(prev, next) {
  const nr = next?.round;
  if (!nr || !prev || prev.code !== next.code) {
    if (nr && next) st.dealKey = `${next.code}:${nr.handNo}`; // ilk dəfə girəndə köhnə paylamanı oynatmırıq
    return;
  }
  const pr = prev.round;
  const now = performance.now();
  const sameHand = pr && pr.handNo === nr.handNo;
  if (sameHand && nr.version <= pr.version) return; // təkrar göndərilən eyni vəziyyət

  if (!sameHand && nr.phase !== 'finished') {
    const key = `${next.code}:${nr.handNo}`;
    if (st.dealKey !== key) {
      st.dealKey = key; st.dealStart = now;
      const n = nr.players.reduce((a, p) => a + (p.inHand ? p.cardCount : 0), 0);
      play('deal', n);
      for (const p of nr.players) if (p.put > 0) st.queue.push({ from: p.id, to: 'pot', amount: p.put, delay: n * DEAL_STEP + 250 });
    }
  }
  if (sameHand) {
    let flipped = false;
    for (const p of nr.players) {
      const q = pr.players.find((x) => x.id === p.id);
      if (!q) continue;
      if (p.put > q.put) st.queue.push({ from: p.id, to: 'pot', amount: p.put - q.put, delay: 0 });
      if (p.cards && !q.cards && p.id !== S.user?.id) { st.flips.set(`${nr.handNo}:${p.id}`, now); flipped = true; }
    }
    if (flipped) play('flip');
    if (nr.phase === 'finished' && pr.phase !== 'finished' && nr.result) {
      const res = nr.result;
      const after = flipped ? 700 : 250;
      if (res.how === 'aborted') {
        for (const p of nr.players) if (p.put > 0) st.queue.push({ from: 'pot', to: p.id, amount: p.put, delay: after });
      } else {
        for (const id of res.winners || []) st.queue.push({ from: 'pot', to: id, amount: res.payouts?.[id] || 1, delay: after });
      }
      for (const j of res.jackpots || []) {
        for (const pay of j.payments || []) if (pay.paid > 0) st.queue.push({ from: pay.from, to: j.holder, amount: pay.paid, delay: after + 300 });
      }
      const me = S.user?.id;
      const iWon = (res.winners || []).includes(me) || (res.jackpots || []).some((j) => j.holder === me);
      setTimeout(() => play(iWon && res.how !== 'aborted' ? 'win' : 'money'), after);
    }
  }
  if (nr.me?.isTurn && !pr?.me?.isTurn) play('turn');
}

// Elementin ekrandakı mərkəzi
function center(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
}
function anchor(id) {
  if (id === 'pot') return document.getElementById('potAnchor');
  return document.querySelector(`[data-seat="${id}"] .av`);
}

// Hər render-dən SONRA çağırılır
export function afterRender() {
  const now = performance.now();
  const motion = motionAllowed();

  // 1) paylama: kartlar göyərtədən öz yerinə uçur (yalnız arxa üz / öz kartlarım)
  const dealElapsed = now - st.dealStart;
  if (motion && st.dealStart && dealElapsed < 2500) {
    const deck = document.getElementById('deckAnchor');
    if (deck) {
      const d = center(deck);
      let lastMine = -1;
      document.querySelectorAll('[data-deal]').forEach((el) => {
        if (el.__dealKey === st.dealKey) return; // eyni element artıq animasiyadadır (morph elementi saxlayır)
        el.__dealKey = st.dealKey;
        const i = Number(el.dataset.deal);
        const mine = el.classList.contains('flip3d');
        const dur = mine ? DEAL_MS + FLIP_MS : DEAL_MS;
        const delay = i * DEAL_STEP - dealElapsed;
        if (delay + dur <= 0) return;
        const c = center(el);
        const from = `translate(${d.x - c.x}px, ${d.y - c.y}px) scale(.45) rotate(-25deg)`;
        if (mine) {
          // öz kartım: arxa üzü ilə sürüşüb gəlir, yerində çevrilir (üzü görünür)
          lastMine = Math.max(lastMine, delay + dur);
          el.animate([
            { transform: `${from} rotateY(180deg)`, opacity: 0.2 },
            { opacity: 1, offset: 0.15 },
            { transform: 'translate(0, 0) scale(1) rotate(0) rotateY(180deg)', opacity: 1, offset: DEAL_MS / dur },
            { transform: 'translate(0, 0) scale(1.06) rotate(0) rotateY(90deg)', offset: (DEAL_MS + FLIP_MS / 2) / dur },
            { transform: 'none', opacity: 1 },
          ], { duration: dur, delay, easing: 'ease-out', fill: 'backwards' });
        } else {
          el.animate([
            { transform: from, opacity: 0.2 },
            { opacity: 1, offset: 0.25 },
            { transform: 'none', opacity: 1 },
          ], { duration: DEAL_MS, delay, easing: 'cubic-bezier(.2,.75,.3,1)', fill: 'backwards' });
        }
      });
      // öz kartlarım çevriləndə açılma səsi (bir dəfə)
      if (lastMine > 0 && st.flipSoundKey !== st.dealKey) {
        st.flipSoundKey = st.dealKey;
        setTimeout(() => play('flip'), Math.max(0, lastMine - FLIP_MS / 2));
      }
    }
  }

  // 2) açılma: serverin göstərdiyi kartlar çevrilir
  for (const [key, t] of st.flips) {
    const el0 = now - t;
    if (el0 > 1500) { st.flips.delete(key); continue; }
    if (!motion) continue;
    document.querySelectorAll(`[data-flip="${key}"]`).forEach((el, i) => {
      if (el.__flipKey === key) return;
      el.__flipKey = key;
      const delay = i * 90 - el0;
      if (delay + 380 <= 0) return;
      el.animate([{ transform: 'perspective(400px) rotateY(90deg)' }, { transform: 'none' }], { duration: 380, delay, easing: 'ease-out', fill: 'backwards' });
    });
  }

  // 3) pul uçuşları: oyunçudan banka, bankdan qalibə
  const q = st.queue.splice(0);
  const layer = document.getElementById('fx');
  if (!layer) return;
  for (const f of q) {
    const a = anchor(f.from);
    const b = anchor(f.to);
    if (!a || !b) continue;
    setTimeout(() => play('money'), Math.max(0, f.delay));
    if (!motion) continue;
    const p0 = center(a);
    const p1 = center(b);
    const notes = splitNotes(f.amount, 3);
    notes.forEach((d, k) => {
      const n = document.createElement('div');
      n.className = 'fly-note';
      n.innerHTML = noteSVG(d);
      n.style.left = `${p0.x}px`; n.style.top = `${p0.y}px`;
      layer.appendChild(n);
      const jitter = (k - 1) * 8;
      const anim = n.animate([
        { transform: `translate(-50%, -50%) scale(.7) rotate(${-10 + k * 8}deg)`, opacity: 0 },
        { opacity: 1, offset: 0.15 },
        { transform: `translate(calc(-50% + ${p1.x - p0.x + jitter}px), calc(-50% + ${p1.y - p0.y + jitter / 2}px)) scale(1) rotate(${k * 12 - 6}deg)`, opacity: 1, offset: 0.85 },
        { transform: `translate(calc(-50% + ${p1.x - p0.x + jitter}px), calc(-50% + ${p1.y - p0.y + jitter / 2}px)) scale(.9)`, opacity: 0 },
      ], { duration: 720, delay: f.delay + k * 90, easing: 'cubic-bezier(.3,.6,.3,1)', fill: 'both' });
      anim.onfinish = () => n.remove();
      anim.oncancel = () => n.remove();
    });
  }
}

// Paylama/açılma animasiyasının açarları (render zamanı data-atributlar üçün)
export const flipKey = (handNo, id) => `${handNo}:${id}`;
