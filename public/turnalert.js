// Növbə xəbərdarlığı: növbə MƏNƏ keçəndə bir dəfə qısa vibrasiya + görünən bildiriş.
//  * Yalnız səhifə açıq və görünən olanda (fon bildirişi / push yoxdur).
//  * Vibrasiya yalnız brauzer dəstəkləyirsə (navigator.vibrate). iPhone Safari dəstəkləmir — orada yalnız görünən
//    bildiriş olur və ayarlarda "dəstəklənmir" yazılır.
//  * Eyni növbə üçün bir dəfə: açar = otaq + raund + əl + növbənin son tarixi. Ekran yenilənməsi təkrar vibrasiya etmir.
//  * Ayarlardan söndürmək olar (bu cihazda yadda qalır).
const KEY = 'seka-vibrate';
let on = true;
try { on = localStorage.getItem(KEY) !== '0'; } catch { /* gizli rejim */ }
const seen = new Set();

export const vibrateSupported = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
export const vibrateOn = () => on;
export function toggleVibrate() {
  on = !on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* */ }
  if (on && vibrateSupported()) { try { navigator.vibrate(60); } catch { /* */ } } // nümunə
  return on;
}

/** Otaq vəziyyəti yeniləndikdə çağırılır: əvvəlki və yeni görünüş */
export function onRoomUpdate(prev, next, showBanner, uid) {
  // yeni raunda razılıq istənəndə: bir dəfə (razılıq id-si üzrə) vibrasiya + bildiriş
  const c = next?.consent;
  if (c?.mine === 'wait') {
    const ck = `consent:${next.code}:${c.id}`;
    if (!seen.has(ck)) {
      seen.add(ck);
      if (typeof document === 'undefined' || !document.hidden) {
        if (on && vibrateSupported()) { try { navigator.vibrate(120); } catch { /* */ } }
        showBanner?.('Yeni raund — razılığınız gözlənilir');
      }
    }
  }
  const r = next?.round; const me = r?.me;
  if (!r || !me?.isTurn || r.phase !== 'betting') return;
  const wasMine = prev?.code === next.code && prev?.round?.me?.isTurn && prev?.round?.phase === 'betting';
  if (wasMine) return; // artıq mənim növbəm idi — sadəcə ekran yeniləndi
  // "Borca oyna" təklifindən sonra eyni növbəyə qayıtmaq yeni növbə deyil
  if (prev?.round?.phase === 'creditOffer' && prev.round.pending?.from === uid && prev.round.turn === r.turn) return;
  const key = `${next.code}:${next.roundSeq ?? ''}:${r.handNo}:${r.turn}:${r.turnDeadline}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (seen.size > 200) seen.delete(seen.values().next().value);
  if (typeof document !== 'undefined' && document.hidden) return; // səhifə görünmür — heç nə
  if (on && vibrateSupported()) { try { navigator.vibrate(120); } catch { /* */ } }
  showBanner?.();
}
