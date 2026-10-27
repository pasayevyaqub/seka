// Ortaq vəziyyət və köməkçilər
export const S = {
  view: 'loading', authTab: 'login', user: null, room: null, ws: null, wsRetry: 0,
  bet: null, tieOffer: false, clockOffset: 0, modal: null, logOpen: false,
  adminTab: 'users', admin: { users: [], tx: [], txUser: null, pairs: [], credit: null, loans: [], gifts: [], settings: null, q: '', filter: 'all', page: 1 },
  handKey: '', rooms: [], pick: null, pickKey: '', pseudoFs: false, busy: false,
  profile: null, unread: 0, bubbles: new Map(), opKeys: {}, recipient: null, search: [], chatOpen: false,
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Math.abs(n).toLocaleString('az-AZ').replace(/,/g, ' ');
export const fmt = (n) => `${n < 0 ? '−' : ''}${num(Number(n) || 0)} oyun xalı`;
export const money = (n) => `<span class="coin ${n < 0 ? 'neg' : ''}">${fmt(n)}</span>`;
export const fmtCents = (c, sign = false) => `${c < 0 ? '−' : sign && c > 0 ? '+' : ''}${(Math.abs(c) / 100).toFixed(2)} oyun xalı`;
export const isStaff = () => S.user && S.user.status === 'approved' && (S.user.role === 'admin' || S.user.role === 'moderator');
export const isAdmin = () => S.user && S.user.status === 'approved' && S.user.role === 'admin';
export const isDemo = () => S.user && S.user.status !== 'approved';
export const azLower = (x) => String(x ?? '').toLocaleLowerCase('az');

// Tarixlər bazada UTC (ms) saxlanılır; ekranda Asia/Baku göstərilir
const TZ = 'Asia/Baku';
export const fmtDate = (ms) => (ms ? new Date(Number(ms)).toLocaleString('az-AZ', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
// <input type="datetime-local"> dəyəri Bakı vaxtı kimi oxunur (UTC+4, yay vaxtı yoxdur)
export const bakuInputToMs = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(v || ''));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 4 * 3_600_000;
};
export const msToBakuInput = (ms) => new Date(ms + 4 * 3_600_000).toISOString().slice(0, 16);

export function toast(msg, ok = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (ok ? ' ok' : '');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

export async function api(path, body, method) {
  const res = await fetch(path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Xəta baş verdi.');
  return data;
}

// Hər maliyyə forması üçün sabit idempotency açarı: forma açılanda yaranır, uğurlu cavabdan sonra yenilənir.
// Təkrar klik və ya itmiş cavabdan sonra təkrar göndərmə eyni açarla gedir → server ikinci dəfə icra etmir.
const rnd = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`);
export const opKey = (name) => (S.opKeys[name] ||= rnd());
export const doneKey = (name) => { delete S.opKeys[name]; };

// pul sorğusu: eyni anda iki dəfə göndərilməsin, uğurda açar yenilənsin
const inflight = new Set();
export async function moneyCall(name, path, body) {
  if (inflight.has(name)) return null;
  inflight.add(name);
  try {
    const r = await api(path, { ...body, key: opKey(name) });
    doneKey(name);
    return r;
  } finally { inflight.delete(name); }
}

export function avatarHTML(u, cls = '') {
  const name = u?.displayName ?? u?.name ?? '?';
  if (u?.isBot) return `<span class="avatar ${cls} bot" aria-hidden="true">🤖</span>`;
  if (u?.avatarVer && u?.id > 0) return `<img class="avatar ${cls}" src="/api/avatar/${u.id}?v=${u.avatarVer}" alt="" loading="lazy">`;
  const ch = esc(String(name).trim().charAt(0).toLocaleUpperCase('az') || '?');
  let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<span class="avatar ${cls} initial" style="background:hsl(${h} 45% 35%)" aria-hidden="true">${ch}</span>`;
}

export const KIND_LABEL = {
  game: 'Oyun', admin: 'Admin', admin_gift: 'Admin hədiyyəsi', reset: 'Sıfırlama', refund: 'Geri qaytarma', bonus: 'Bonus',
  credit: 'Kredit', credit_repay: 'Kredit ödənişi', gift_out: 'Hədiyyə (göndərildi)', gift_in: 'Hədiyyə (alındı)',
  loan_out: 'Borc verildi', loan_in: 'Borc alındı', loan_repay_out: 'Borc ödənişi', loan_repay_in: 'Borc qaytarıldı',
  loan_auto_out: 'Avtomatik tutulma', loan_auto_in: 'Avtomatik ödəniş alındı',
};
export const LOAN_STATUS = { offered: 'Təklif', active: 'Aktiv', overdue: 'Gecikib', paid: 'Ödənilib', declined: 'Rədd edilib', cancelled: 'Ləğv edilib' };

export function txList(items, showUser) {
  if (!items?.length) return '<p class="muted">Əməliyyat yoxdur.</p>';
  return items.map((t) => `<div class="tx">
    <div>${showUser ? `<b>${esc(t.user_name)}</b> · ` : ''}${esc(t.reason)}${t.kind ? ` <span class="kind k-${esc(t.kind)}">${KIND_LABEL[t.kind] || esc(t.kind)}</span>` : ''}${t.room ? ` <span class="muted">[${esc(t.room)}]</span>` : ''}
      ${t.note ? `<div class="meta">Qeyd: ${esc(t.note)}</div>` : ''}
      <div class="meta">${fmtDate(t.created_at)}${t.counterparty_name ? ` · qarşı tərəf: ${esc(t.counterparty_name)}` : ''}${t.by_name ? ` · icra edən: ${esc(t.by_name)}` : ''} · ${t.prev_balance != null ? `${fmt(Number(t.prev_balance))} → ` : 'Qalıq: '}${fmt(Number(t.balance_after))}</div></div>
    <div class="d ${Number(t.delta) >= 0 ? 'plus' : 'minus'}">${Number(t.delta) >= 0 ? '+' : ''}${fmt(Number(t.delta))}</div>
  </div>`).join('');
}

export const deadlineSpan = (deadline) => `<span data-countdown="${deadline}"></span>`;
