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
export const fmt = (n) => `${n < 0 ? '−' : ''}${num(Number(n) || 0)} xal`;
export const money = (n) => `<span class="coin ${n < 0 ? 'neg' : ''}">${fmt(n)}</span>`;
export const fmtCents = (c, sign = false) => `${c < 0 ? '−' : sign && c > 0 ? '+' : ''}${(Math.abs(c) / 100).toFixed(2)} xal`;
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

// Bot avatarı — orijinal SVG robot (ağ dəbilqə, tünd üz paneli, mavi gözlər)
const ROBOT = `<svg viewBox="0 0 64 64" class="robot" aria-hidden="true">
  <defs><radialGradient id="rbBg" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="#2c3e52"/><stop offset="1" stop-color="#0d1621"/></radialGradient>
  <linearGradient id="rbShell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b9c3cf"/></linearGradient></defs>
  <rect width="64" height="64" fill="url(#rbBg)"/>
  <path d="M12 64 Q14 46 32 45 Q50 46 52 64 Z" fill="url(#rbShell)"/>
  <rect x="24" y="52" width="16" height="7" rx="2" fill="#1b2633"/><text x="32" y="57.6" text-anchor="middle" font-size="5" font-weight="700" fill="#cfe3ff" font-family="system-ui,sans-serif">BOT</text>
  <ellipse cx="32" cy="28" rx="17" ry="16" fill="url(#rbShell)"/>
  <rect x="11" y="24" width="5" height="10" rx="2.5" fill="#9aa6b4"/><rect x="48" y="24" width="5" height="10" rx="2.5" fill="#9aa6b4"/>
  <rect x="19" y="20" width="26" height="15" rx="7.5" fill="#0b121b"/>
  <circle cx="26" cy="27.5" r="3.4" fill="#4fb3ff"/><circle cx="38" cy="27.5" r="3.4" fill="#4fb3ff"/>
  <circle cx="26" cy="27.5" r="6" fill="#4fb3ff" opacity=".22"/><circle cx="38" cy="27.5" r="6" fill="#4fb3ff" opacity=".22"/>
  <path d="M20 16 Q32 9 44 16" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1.5"/>
</svg>`;

export function avatarHTML(u, cls = '') {
  const name = u?.displayName ?? u?.name ?? '?';
  if (u?.isBot) return `<span class="avatar ${cls} bot" aria-hidden="true">${ROBOT}</span>`;
  if (u?.avatarVer && u?.id > 0) return `<img class="avatar ${cls}" src="/api/avatar/${u.id}?v=${u.avatarVer}" alt="" loading="lazy">`;
  const ch = esc(String(name).trim().charAt(0).toLocaleUpperCase('az') || '?');
  let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<span class="avatar ${cls} initial" style="background:radial-gradient(circle at 35% 30%, hsl(${h} 40% 46%), hsl(${h} 45% 22%))" aria-hidden="true">${ch}</span>`;
}

export const KIND_LABEL = {
  game: 'Oyun', admin: 'Admin', admin_gift: 'Admin hədiyyəsi', reset: 'Sıfırlama', refund: 'Geri qaytarma', bonus: 'Bonus',
  credit: 'Kredit', credit_repay: 'Kredit ödənişi', gift_out: 'Hədiyyə (göndərildi)', gift_in: 'Hədiyyə (alındı)',
  loan_out: 'Borc verildi', loan_in: 'Borc alındı', loan_repay_out: 'Borc ödənişi', loan_repay_in: 'Borc qaytarıldı',
  loan_auto_out: 'Avtomatik tutulma', loan_auto_in: 'Avtomatik ödəniş alındı',
  tgift_out: 'Masa hədiyyəsi (göndərildi)', tgift_in: 'Masa hədiyyəsi (alındı)', shop: 'Market (virtual əşya)',
};
export const LOAN_STATUS = { requested: 'Borc istəyi', offered: 'Təklif', active: 'Aktiv', overdue: 'Gecikib', paid: 'Ödənilib', declined: 'Rədd edilib', cancelled: 'Ləğv edilib' };

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

// Azərbaycan dilində hal şəkilçiləri (adlar üçün): yönlük "Anara/Leylaya", çıxışlıq "Yaqubdan/Elvindən"
const BACKV = 'aıou'; const FRONTV = 'eəiöü';
function lastVowel(n) { let v = ''; for (const ch of n.toLocaleLowerCase('az')) if (BACKV.includes(ch) || FRONTV.includes(ch)) v = ch; return v; }
export function azDative(name) {
  const n = String(name || '').trim(); const last = n.slice(-1).toLocaleLowerCase('az');
  if (!/\p{L}/u.test(last)) return `${n}-a`;
  const back = !lastVowel(n) || BACKV.includes(lastVowel(n));
  const vEnd = BACKV.includes(last) || FRONTV.includes(last);
  return n + (vEnd ? (back ? 'ya' : 'yə') : (back ? 'a' : 'ə'));
}
export function azAblative(name) {
  const n = String(name || '').trim(); const last = n.slice(-1);
  if (!/\p{L}/u.test(last)) return `${n}-dan`;
  const back = !lastVowel(n) || BACKV.includes(lastVowel(n));
  return n + (back ? 'dan' : 'dən');
}
