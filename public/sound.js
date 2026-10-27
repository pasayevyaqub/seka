// Səslər — WebAudio ilə brauzerdə sintez olunur (heç bir səs faylı və xarici mənbə yoxdur).
// Brauzer qaydası: səs yalnız istifadəçinin ilk toxunuşundan / klikindən sonra açılır.
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('seka-mute') === '1'; } catch { /* gizli rejim və s. */ }

function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch { /* dəstəklənmir */ }
}
for (const ev of ['pointerdown', 'keydown', 'touchend']) document.addEventListener(ev, unlock, { capture: true, passive: true });

export const isMuted = () => muted;
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('seka-mute', muted ? '1' : '0'); } catch { /* yox */ }
  if (!muted) unlock();
  return muted;
}

const ready = () => !muted && ctx && ctx.state === 'running';

function noise(dur) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// kartın masaya sürüşmə səsi
function swish(t, gain = 0.35) {
  const src = ctx.createBufferSource();
  src.buffer = noise(0.12);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(3800, t + 0.1); f.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t); src.stop(t + 0.13);
}

// kağız pulun xışıltısı + yüngül "cing"
function rustle(t) {
  const src = ctx.createBufferSource();
  src.buffer = noise(0.22);
  const f = ctx.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = 2500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.14, t + 0.11);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.21);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t); src.stop(t + 0.23);
  tone(t + 0.02, 1568, 0.12, 0.05, 'sine');
}

function tone(t, freq, dur, gain, type = 'triangle') {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export function play(name, n = 1) {
  if (!ready()) return;
  try {
    const t = ctx.currentTime + 0.01;
    if (name === 'deal') for (let i = 0; i < Math.min(n, 12); i++) swish(t + i * 0.07, 0.3);
    else if (name === 'money') rustle(t);
    else if (name === 'flip') swish(t, 0.25);
    else if (name === 'win') [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(t + i * 0.11, f, 0.35, 0.12));
    else if (name === 'turn') { tone(t, 880, 0.15, 0.07, 'sine'); tone(t + 0.13, 1175, 0.2, 0.06, 'sine'); }
  } catch { /* səs olmasa da oyun davam edir */ }
}
