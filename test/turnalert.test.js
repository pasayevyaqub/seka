// Növbə vibrasiyası/bildirişi: bir növbə üçün bir dəfə; ekran yenilənməsi təkrarlamır; söndürmək olur; dəstək yoxdursa vibrasiya yoxdur.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
try { Object.defineProperty(globalThis, 'navigator', { value: { vibrate: (ms) => { calls.push(ms); return true; } }, configurable: true }); } catch { globalThis.navigator.vibrate = (ms) => { calls.push(ms); return true; }; }
const { onRoomUpdate, toggleVibrate, vibrateSupported, vibrateOn } = await import('../public/turnalert.js');

const room = (isTurn, { code = 'AB123', seq = 1, hand = 1, turn = 5, dl = 1000, phase = 'betting' } = {}) => ({ code, roundSeq: seq, round: { phase, handNo: hand, turn, turnDeadline: dl, me: { isTurn } } });

test('növbə mənə keçəndə bir dəfə; təkrar yeniləmədə yox; növbəti növbədə yenidən', () => {
  let banners = 0; const show = () => banners++;
  assert.equal(vibrateSupported(), true); assert.equal(vibrateOn(), true);
  onRoomUpdate(room(false), room(true), show, 5);
  onRoomUpdate(room(true), room(true), show, 5);            // ekran yeniləndi
  onRoomUpdate(room(false), room(true), show, 5);           // eyni növbə (eyni açar) yenidən gəldi
  assert.equal(calls.length, 1); assert.equal(banners, 1);
  onRoomUpdate(room(false, { dl: 2000 }), room(true, { dl: 5000 }), show, 5); // yeni növbə
  assert.equal(calls.length, 2); assert.equal(banners, 2);
  // "Borca oyna" təklifindən öz növbəmə qayıtmaq yeni növbə sayılmır
  const prev = room(false, { dl: 5000, phase: 'creditOffer' }); prev.round.pending = { from: 5 };
  onRoomUpdate(prev, room(true, { dl: 9000 }), show, 5);
  assert.equal(calls.length, 2);
});

test('söndürüləndə vibrasiya yox, bildiriş qalır', () => {
  let banners = 0;
  toggleVibrate(); assert.equal(vibrateOn(), false);
  const before = calls.length;
  onRoomUpdate(room(false), room(true, { seq: 7 }), () => banners++, 5);
  assert.equal(calls.length, before); assert.equal(banners, 1);
  toggleVibrate();
});

test('brauzer vibrasiyanı dəstəkləmirsə çağırılmır', () => {
  const v = globalThis.navigator.vibrate; delete globalThis.navigator.vibrate;
  assert.equal(vibrateSupported(), false);
  const before = calls.length; let banners = 0;
  onRoomUpdate(room(false), room(true, { seq: 9 }), () => banners++, 5);
  assert.equal(calls.length, before); assert.equal(banners, 1);
  globalThis.navigator.vibrate = v;
});

test('razılıq istəyi: bir dəfə vibrasiya + bildiriş; cavabdan/yenilənmədən sonra təkrar yox; yeni razılıqda yenidən', () => {
  if (!vibrateOn()) toggleVibrate();
  const texts = []; const show = (t) => texts.push(t);
  const before = calls.length;
  const v = (id, mine) => ({ code: 'CN1', roundSeq: 3, round: null, consent: { id, mine } });
  onRoomUpdate(null, v(1, 'wait'), show, 5);
  onRoomUpdate(v(1, 'wait'), v(1, 'wait'), show, 5);
  onRoomUpdate(v(1, 'wait'), v(1, 'yes'), show, 5);
  assert.equal(calls.length - before, 1); assert.equal(texts.length, 1); assert.match(texts[0], /razılığınız/);
  onRoomUpdate(v(1, 'yes'), v(2, 'wait'), show, 5);
  assert.equal(texts.length, 2);
  onRoomUpdate(null, { code: 'CN1', consent: { id: 3, mine: 'yes' } }, show, 5); // sahib — soruşulmur
  assert.equal(texts.length, 2);
});
