// Masada borc istəyi — borc verənin ekranında kiçik, nəzərə çarpan bildiriş.
//  * Masada: idarə düymələrinin ÜSTÜNDƏ, masa ilə düymələr arasındakı zolaqda göstərilir (layout-un bir hissəsi) —
//    kartları, bankı və oyun düymələrini örtmür. Başqa ekranda (profil, admin) yuxarıda kiçik kart kimi.
//  * 10 saniyə görünür (server vaxtı ilə: respondBy), "Qəbul et" / "Rədd et" basılan kimi dərhal itir.
//  * Cavab verilməsə server istəyi avtomatik ləğv edir və hər iki tərəfə bildirir (burada da kart itir).
//  * Məbləğ, limit və balans HƏMİŞƏ serverdə yoxlanılır; buradakı mətn yalnız məlumat üçündür.
import { S, esc, fmt, toast, moneyCall } from './core.js';

const asks = new Map(); // loanId → {m, total, timer}
let repaintFn = () => {};

export function initLoanAsk({ render }) { repaintFn = render; }
export const loanAskIds = () => new Set(asks.keys());

function cardHTML(x) {
  const m = x.m;
  return `<div class="loan-ask" role="alertdialog" data-key="la-${m.id}" data-loan-ask="${m.id}">
    <div class="la-text">💸 <b>${esc(m.borrowerName)}</b> sizdən (<b>${esc(m.lenderName)}</b>) <b>${fmt(m.amount)}</b> borc istəyir</div>
    <div class="la-bar"><i style="animation-duration:${x.total}ms"></i></div>
    <div class="la-btns"><button class="btn small green" data-a="loanAskYes" data-id="${m.id}">Qəbul et</button><button class="btn small red" data-a="loanAskNo" data-id="${m.id}">Rədd et</button></div>
  </div>`;
}

/** room.js idarə düymələrinin üstündə çəkir */
export function loanAsksHTML() {
  if (!asks.size) return '';
  return `<div class="loan-asks">${[...asks.values()].map(cardHTML).join('')}</div>`;
}

function paint() {
  if (S.view === 'room') { document.getElementById('loanAsks')?.remove(); repaintFn(); return; }
  let h = document.getElementById('loanAsks');
  if (!asks.size) { h?.remove(); return; }
  if (!h) { h = document.createElement('div'); h.id = 'loanAsks'; h.setAttribute('aria-live', 'assertive'); document.body.appendChild(h); }
  h.innerHTML = [...asks.values()].map(cardHTML).join('');
}

export function closeLoanAsk(id) {
  const x = asks.get(Number(id));
  if (!x) return;
  clearTimeout(x.timer);
  asks.delete(Number(id));
  // dərhal DOM-dan da (render gözləmədən)
  document.querySelectorAll(`[data-loan-ask="${Number(id)}"]`).forEach((e) => e.remove());
  paint();
}

export function onLoanAsk(m) {
  if (!m?.id || asks.has(m.id)) return;
  const left = Math.max(0, Number(m.respondBy) - (Date.now() + (S.clockOffset || 0)));
  if (left <= 0) return;
  const timer = setTimeout(() => closeLoanAsk(m.id), left);
  asks.set(m.id, { m, total: Math.round(left), timer });
  try { if (navigator.vibrate) navigator.vibrate(80); } catch { /* */ }
  paint();
}

export function onLoanAskDone(m) { closeLoanAsk(m?.id); }

export function loanAskHandlers(after) {
  const answer = async (el, op) => {
    const id = Number(el.dataset.id);
    const x = asks.get(id);
    closeLoanAsk(id); // dərhal itir
    try {
      const r = await moneyCall(`loan${op}${id}`, `/api/loans/${id}/${op}`, {});
      if (r) toast(op === 'approve' ? `Borc verildi: ${fmt(x?.m.amount ?? r.amount)}${x ? ` → ${x.m.borrowerName}` : ''}` : 'Borc istəyi rədd edildi.', true);
    } catch (e) { toast(e.message); } finally { after?.(); }
  };
  return {
    loanAskYes: (el) => answer(el, 'approve'),
    loanAskNo: (el) => answer(el, 'reject'),
  };
}
