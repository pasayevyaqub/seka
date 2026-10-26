import { cardSVG, cardBackSVG } from './cards.js';
import { score3 } from './score.js';

// ---------------- vəziyyət ----------------
const S = {
  view: 'loading', authTab: 'login', user: null, room: null, ws: null, wsRetry: 0,
  bet: null, tieOffer: false, clockOffset: 0, modal: null, logOpen: false,
  adminTab: 'users', adminUsers: [], adminTx: [], adminTxUser: null, adminPairs: [],
  handKey: '', rooms: [], pick: null, pickKey: '', pseudoFs: false, busy: false,
};
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Math.abs(n).toLocaleString('az-AZ').replace(/,/g, ' ');
const fmt = (n) => `${n < 0 ? '−' : ''}${num(n)} AZN`;
const money = (n) => `<span class="coin ${n < 0 ? 'neg' : ''}">${fmt(n)}</span>`;
const fmtCents = (c, sign = false) => `${c < 0 ? '−' : sign && c > 0 ? '+' : ''}${(Math.abs(c) / 100).toFixed(2)} AZN`;
const isStaff = () => S.user && S.user.status === 'approved' && (S.user.role === 'admin' || S.user.role === 'moderator');
const isAdmin = () => S.user && S.user.status === 'approved' && S.user.role === 'admin';
const isDemo = () => S.user && S.user.status !== 'approved';
const SETTINGS_FIELDS = [
  ['ante', 'Oyun haqqı (AZN)'], ['minBet', 'Minimum xod (AZN)'], ['maxBet', 'Maksimum xod (AZN, 0 = limitsiz)'],
  ['jackpotAmount', 'Cəkpot (hər oyunçudan, AZN)'], ['turnSeconds', 'Xod vaxtı (saniyə)'],
  ['debtLimit', 'Mənfi balans limiti (AZN, 0 = limitsiz)'], ['maxPlayers', 'Maks. oyunçu (2–8)'],
];
const DEFAULTS = { ante: 10, minBet: 10, maxBet: 0, jackpotAmount: 100, turnSeconds: 60, debtLimit: 0, maxPlayers: 8 };
const KIND_LABEL = { game: 'Oyun', admin: 'Admin', reset: 'Sıfırlama', refund: 'Geri qaytarma' };

function toast(msg, ok = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (ok ? ' ok' : '');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

async function api(path, body, method) {
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

// ---------------- WebSocket ----------------
function connect() {
  if (S.ws && S.ws.readyState <= 1) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  S.ws = ws;
  ws.onopen = () => { S.wsRetry = 0; };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'hello') {
      S.user = m.user;
      if (!m.roomCode && S.view === 'room') { S.room = null; S.view = 'lobby'; }
      render();
      if (S.view === 'lobby') loadRooms();
    } else if (m.t === 'user') {
      const wasDemo = isDemo();
      S.user = { ...S.user, ...m.user };
      if (wasDemo && !isDemo()) toast('Hesabınız təsdiqləndi! Real oyun açıldı.', true);
      render();
      if (S.view === 'lobby') loadRooms();
    } else if (m.t === 'room') {
      S.room = m.room;
      S.busy = false;
      S.clockOffset = m.room.serverNow - Date.now();
      if (S.view !== 'admin') S.view = 'room';
      render();
    } else if (m.t === 'left') {
      S.room = null; S.bet = null; S.pick = null;
      if (S.view === 'room') S.view = 'lobby';
      exitFullscreen();
      render();
      loadRooms();
    } else if (m.t === 'balance') {
      if (S.user) S.user.balance = m.balance;
      if (S.view !== 'room') render();
      else { const el = document.getElementById('myBalance'); if (el) el.innerHTML = money(m.balance); }
    } else if (m.t === 'error') {
      S.busy = false;
      if (m.code === 'PASSWORD' && m.roomCode) openPasswordModal(m.roomCode, m.msg);
      else toast(m.msg);
    }
  };
  ws.onclose = (ev) => {
    if (ws !== S.ws) return;
    S.ws = null;
    if (ev.code === 4001 || ev.code === 1008) { S.user = null; S.view = 'auth'; render(); return; }
    if (!S.user) return;
    const delay = Math.min(10000, 800 * 2 ** S.wsRetry++);
    setTimeout(async () => {
      try { const r = await api('/api/me'); if (!r.user) { S.user = null; S.view = 'auth'; render(); return; } } catch { /* şəbəkə */ }
      connect();
    }, delay);
  };
}
const send = (msg) => {
  if (S.ws?.readyState === 1) { S.ws.send(JSON.stringify(msg)); return true; }
  toast('Serverlə əlaqə yoxdur, yenidən qoşulur...');
  return false;
};
// hər hərəkət gördüyümüz vəziyyətin versiyası ilə göndərilir (təkrar/köhnə klik server tərəfindən rədd olunur)
const act = (action) => {
  if (S.busy) return;
  const v = S.room?.round?.version;
  if (send({ t: 'act', action: { ...action, v } })) { S.busy = true; setTimeout(() => { S.busy = false; }, 1500); }
};

async function loadRooms() {
  if (!S.user || isDemo() || S.view !== 'lobby') return;
  try {
  S.rooms = (await api('/api/rooms')).rooms;
  if (S.view === 'lobby' && !S.modal) {
    const list = document.getElementById('roomList');
    if (list) list.innerHTML = renderRoomsList();
  }
} catch { /* sonra */ }
}
setInterval(loadRooms, 5000);

// ---------------- tam ekran ----------------
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
const isFs = () => !!fsElement() || S.pseudoFs;
async function enterFullscreen() {
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) { await el.requestFullscreen({ navigationUI: 'hide' }); return; }
    if (el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); return; }
  } catch { /* dəstəklənmir — alternativ görünüş */ }
  S.pseudoFs = true; // iPhone Safari kimi brauzerlər: interfeysi sıxlaşdırılmış "tam ekran" görünüşü
  document.body.classList.add('pseudo-fs');
  window.scrollTo(0, 0);
  render();
}
function exitFullscreen() {
  try {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch { /* yoxdur */ }
  if (S.pseudoFs) { S.pseudoFs = false; document.body.classList.remove('pseudo-fs'); }
}
document.addEventListener('fullscreenchange', () => render());
document.addEventListener('webkitfullscreenchange', () => render());

// ---------------- render ----------------
function render() {
  const active = document.activeElement;
  const keep = active?.id ? { id: active.id, s: active.selectionStart, e: active.selectionEnd } : null;
  let html = '';
  if (S.view === 'loading') html = `<div class="wrap center muted" style="margin-top:30vh">Yüklənir...</div>`;
  else if (S.view === 'auth') html = renderAuth();
  else if (S.view === 'lobby') html = isDemo() ? renderDemoLobby() : renderLobby();
  else if (S.view === 'room') html = renderRoom();
  else if (S.view === 'admin') html = renderAdmin();
  if (S.modal) html += renderModal();
  document.body.classList.toggle('in-room', S.view === 'room');
  $app.innerHTML = html;
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch { /* number input */ } }
  }
  const log = document.querySelector('.log');
  if (log) log.scrollTop = log.scrollHeight;
  updateTimers();
}

function topbar(extra = '', title = '') {
  return `<div class="topbar">
    <div class="logo">SEKA</div>${title}
    <div class="spacer"></div>
    ${extra}
    ${S.user && !isDemo() ? `<span class="chip" id="myBalance">${money(S.user.balance)}</span>` : ''}
  </div>`;
}

function renderAuth() {
  const login = S.authTab === 'login';
  return `<div class="wrap auth">
    <div class="hero">
      <div class="hero-cards">${cardSVG({ r: 'T', s: 'S' })}${cardSVG({ r: 'K', s: 'H' })}${cardSVG({ r: 'D', s: 'S' })}</div>
      <div class="logo">SEKA</div>
      <div class="muted">Dostlar üçün özəl kart oyunu</div>
    </div>
    <div class="card-panel">
      <div class="tabs">
        <button class="btn ${login ? 'active' : ''}" data-a="authTab" data-v="login">Giriş</button>
        <button class="btn ${!login ? 'active' : ''}" data-a="authTab" data-v="register">Qeydiyyat</button>
      </div>
      ${login ? `
      <form data-form="login">
        <label>İstifadəçi adı</label><input name="username" autocomplete="username" autocapitalize="none" required>
        <label>Şifrə</label><input name="password" type="password" autocomplete="current-password" required>
        <button class="btn primary block mt">Daxil ol</button>
      </form>` : `
      <form data-form="register">
        <label>İstifadəçi adı (girişdə istifadə olunur)</label><input name="username" autocapitalize="none" placeholder="məs. anar_m" required>
        <label>Oyunda görünən ad</label><input name="displayName" placeholder="məs. Anar" required>
        <label>Telefon (admin sizi tanısın deyə)</label><input name="phone" type="tel" placeholder="+994...">
        <label>Şifrə (ən azı 6 simvol)</label><input name="password" type="password" autocomplete="new-password" required>
        <button class="btn primary block mt">Qeydiyyatdan keç</button>
        <p class="muted center" style="font-size:13px">Qeydiyyatdan dərhal sonra botlarla demo oynaya bilərsiniz. Real oyun admin təsdiqindən sonra açılır.</p>
      </form>`}
    </div>
  </div>`;
}

function settingsInputs(s) {
  return `<div class="settings-grid">${SETTINGS_FIELDS.map(([k, l]) =>
    `<div><label>${l}</label><input name="${k}" type="number" inputmode="numeric" value="${esc(s[k])}"></div>`).join('')}</div>`;
}

function renderDemoLobby() {
  return topbar(`<button class="btn small ghost" data-a="logout">Çıxış</button>`) + `
  <div class="wrap">
    <div class="card-panel banner-demo">
      <div style="font-size:20px;font-weight:800">Salam, ${esc(S.user.displayName)}!</div>
      <p>Hesabınız <b>admin təsdiqini gözləyir</b>. Hələlik <b>demo rejimində</b> botlarla məşq edə bilərsiniz — real balans istifadə olunmur və heç bir nəticə yazılmır.</p>
      <p class="muted" style="margin-bottom:0">Admin təsdiq edən kimi bu səhifədə real oyun avtomatik açılacaq.</p>
    </div>
    <button class="btn primary block big" data-a="playBot">🤖 Demo oyuna başla</button>
    <div class="row mt"><button class="btn" data-a="pwModal">Şifrəni dəyiş</button></div>
  </div>`;
}

function renderRoomsList() {
  if (!S.rooms.length) return '<p class="muted">Hazırda açıq otaq yoxdur. Yenisini yaradın və ya kodla qoşulun.</p>';
  return S.rooms.map((r) => `
    <div class="room-row">
      <div class="rr-main">
        <div class="rr-name">${r.locked ? '🔒 ' : ''}${esc(r.name)}</div>
        <div class="muted rr-meta">${r.players}/${r.capacity} oyunçu${r.bots ? ` · 🤖 ${r.bots} bot` : ''} · Oyun haqqı ${fmt(r.ante)} · ${r.playing ? '<span class="st-play">Raund gedir</span>' : '<span class="st-wait">Gözləyir</span>'}</div>
      </div>
      <button class="btn small primary" data-a="joinListed" data-code="${esc(r.code)}" data-locked="${r.locked ? 1 : 0}" ${r.players >= r.capacity ? 'disabled' : ''}>${r.players >= r.capacity ? 'Dolu' : 'Qoşul'}</button>
    </div>`).join('');
}

function renderLobby() {
  const u = S.user;
  return topbar(`
      ${isStaff() ? `<button class="btn small" data-a="openAdmin">Admin</button>` : ''}
      <button class="btn small ghost" data-a="logout">Çıxış</button>`) + `
  <div class="wrap">
    <div class="card-panel">
      <div class="row" style="flex-wrap:wrap">
        <div><div style="font-size:20px;font-weight:800">Salam, ${esc(u.displayName)}!</div>
        <div class="muted">Balans: ${money(u.balance)} <span style="font-size:12px">(virtual oyun balansı)</span></div></div>
        <div style="flex:0 0 auto;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn small" data-a="myStats">Nəticələrim</button>
          <button class="btn small" data-a="myTx">Əməliyyatlarım</button>
          <button class="btn small" data-a="pwModal">Şifrə</button>
        </div>
      </div>
      ${u.balance <= 0 ? `<p class="muted" style="margin-bottom:0">Balansınızı artırmaq üçün adminə müraciət edin.</p>` : ''}
    </div>
    <button class="btn blue block big stack" data-a="playBot">🤖 Kompüterlə oyna<small>məşq rejimi — real balans dəyişmir</small></button>
    <div class="grid2 mt">
      <div>
        <div class="card-panel">
          <h2>Açıq otaqlar</h2>
          <div id="roomList">${renderRoomsList()}</div>
        </div>
        <div class="card-panel">
          <h2>Kodla qoşul</h2>
          <form data-form="join">
            <input name="code" placeholder="məs. K7P2Q" maxlength="5" autocapitalize="characters" style="text-transform:uppercase;font-size:22px;text-align:center;letter-spacing:6px" required>
            <button class="btn primary block mt">Qoşul</button>
          </form>
        </div>
      </div>
      <div class="card-panel">
        <h2>Yeni otaq yarat</h2>
        <form data-form="create">
          <label>Otaq adı</label><input name="name" maxlength="30" placeholder="məs. Cümə axşamı" required>
          <label>Görünmə</label>
          <div class="seg">
            <label><input type="radio" name="visibility" value="public" checked> 🌐 Açıq <small>(siyahıda görünür)</small></label>
            <label><input type="radio" name="visibility" value="private"> 🙈 Gizli <small>(yalnız kodla)</small></label>
          </div>
          <label>Şifrə (istəyə görə)</label><input name="password" type="password" autocomplete="new-password" placeholder="boş — şifrəsiz">
          <label class="check mt"><input type="checkbox" name="withBot"> 🤖 Bot əlavə et (otaq məşq rejiminə keçir)</label>
          <details class="mt"><summary>Oyun ayarları</summary>${settingsInputs(DEFAULTS)}</details>
          <button class="btn green block mt">Otaq yarat</button>
        </form>
      </div>
    </div>
  </div>`;
}

// --------- masa ---------
function seatList(room) {
  const r = room.round;
  const byId = new Map(room.members.map((m) => [m.id, m]));
  const list = [];
  if (r) {
    for (const p of r.players) {
      const m = byId.get(p.id);
      list.push({ ...p, isBot: m?.isBot ?? p.id < 0, connected: m ? m.connected : false, inRoom: !!m, balance: m ? m.balance : p.balance });
    }
    for (const m of room.members) if (!r.players.some((p) => p.id === m.id)) list.push({ ...m, inHand: false, status: 'wait', inRoom: true });
  } else {
    for (const m of room.members) list.push({ ...m, inHand: false, status: 'wait', inRoom: true });
  }
  return list;
}

function statusTag(p, r) {
  if (r?.result && r.phase === 'finished' && r.result.winners.includes(p.id)) return `<span class="tag win">Qalib +${fmt(r.result.payouts[p.id] || 0)}</span>`;
  if (!p.inRoom) return `<span class="tag folded">Çıxıb</span>`;
  if (r?.phase === 'discard' && p.inHand && p.status === 'active') return p.discarded ? `<span class="tag var">Seçdi</span>` : `<span class="tag yox">Seçir...</span>`;
  switch (p.status) {
    case 'active': return '';
    case 'folded': return `<span class="tag folded">Pas</span>`;
    case 'lost': return `<span class="tag lost">Uduzdu</span>`;
    case 'attached': return `<span class="tag attached">Şərik</span>`;
    default: return `<span class="tag wait">Gözləyir</span>`;
  }
}

function renderSeat(p, i, n, myIdx, room, dealCls) {
  const r = room.round;
  const ang = ((90 + ((i - myIdx) * 360) / n) * Math.PI) / 180;
  const x = 50 + 43 * Math.cos(ang);
  const y = 50 + 41 * Math.sin(ang);
  const isTurn = r && r.phase === 'betting' && r.turn === p.id;
  const out = ['folded', 'lost', 'out'].includes(p.status);
  const isMe = p.id === S.user.id;
  let mini = '';
  if (p.inHand && !isMe) {
    mini = p.cards ? p.cards.map((c) => cardSVG(c, 'flip')).join('') : Array.from({ length: p.cardCount }, () => cardBackSVG(dealCls)).join('');
  }
  return `<div class="seat ${isTurn ? 'turn' : ''} ${out ? 'out' : ''} ${p.connected ? '' : 'offline'}" style="left:${x}%;top:${y}%">
    ${isMe ? '' : `<div class="mini">${mini}</div>`}
    <div class="plate">
      ${room.hostId === p.id ? '<span class="host" title="Otaq sahibi">👑</span>' : ''}
      <div class="nm">${esc(p.name)}${isMe ? ' (siz)' : ''}</div>
      ${p.isBot ? '<span class="tag bot">🤖 Bot</span>' : ''}
      <div class="bal">${money(p.balance)}</div>
      ${statusTag(p, r)} ${p.score != null && !isMe ? `<span class="score">${p.score} xal</span>` : ''}
      ${isTurn ? `<div class="timer-bar" data-deadline="${r.turnDeadline}" data-total="${room.settings.turnSeconds}"><i></i></div>` : ''}
    </div>
  </div>`;
}

function centerHTML(room) {
  const r = room.round;
  const s = room.settings;
  if (!r) {
    return `<div class="muted">Oyunçular: ${room.members.length}/${s.maxPlayers}</div>
      <div style="font-size:13px" class="muted">Oyun haqqı ${fmt(s.ante)} · Min xod ${fmt(s.minBet)}${s.maxBet ? ` · Maks ${fmt(s.maxBet)}` : ''}${s.jackpotAmount ? ` · Cəkpot ${fmt(s.jackpotAmount)}` : ''}</div>`;
  }
  let html = '';
  if (r.isSeka || r.phase === 'sekaJoin') html += `<div class="seka-badge">SEKA</div>`;
  html += `<div class="pot"><small>BANK</small>${fmt(r.pot)}</div>`;
  if (r.phase === 'betting') html += `<div class="chip">Cari xod: ${fmt(Math.max(r.currentBet, r.minXod))}</div>`;
  if (r.phase === 'finished' && r.result) {
    const names = r.result.winners.map((id) => esc(r.players.find((p) => p.id === id)?.name)).join(' və ');
    const how = { jackpot: '🎉 CƏKPOT! ', split: 'Bank bölündü: ', aborted: 'Raund ləğv edildi' }[r.result.how] ?? 'Qalib: ';
    html += `<div class="result-banner">${how}${r.result.how === 'aborted' ? '' : names}</div>`;
  }
  return html;
}

const deadlineSpan = (deadline) => `<span data-countdown="${deadline}"></span>`;

function resultHTML(r) {
  if (!r?.result || r.phase !== 'finished') return '';
  const res = r.result;
  const nameOf = (id) => esc(r.players.find((p) => p.id === id)?.name ?? '?');
  let html = '<div class="result-box">';
  if (res.how === 'aborted') html += '<b>Raund ləğv edildi</b> — qoyulan məbləğlər geri qaytarıldı.';
  else {
    html += `<div><b>${{ jackpot: '🎉 Cəkpot', split: 'Bank bölündü', compare: 'Baxışma ilə qalib', last: 'Qalib (digərləri pas dedi)' }[res.how] || 'Qalib'}:</b> `
      + res.winners.map((id) => `${nameOf(id)} <span class="plus">+${fmt(res.payouts[id] || 0)}</span>`).join(', ') + '</div>';
    if (res.shown?.length) {
      html += '<div class="shown">' + res.shown.map((s) => `
        <div class="shown-one ${res.winners.includes(s.id) ? 'w' : 'l'}">
          <div class="mini-hand">${s.cards.map((c) => cardSVG(c)).join('')}</div>
          <div><b>${esc(s.name)}</b> — ${s.score} xal ${res.winners.includes(s.id) ? '🏆' : ''}</div>
        </div>`).join('') + '</div>';
    } else if (res.how === 'last' || res.how === 'split') {
      html += '<div class="muted" style="font-size:13px">Kartlar açılmadı.</div>';
    }
  }
  return html + '</div>';
}

function actionsHTML(room) {
  if (room.dbWaiting) {
    return `<div class="notice db-wait">⏳ <b>Baza bağlantısı gözlənilir.</b> Son hərəkət hələ yadda saxlanılmayıb, ona görə oyun müvəqqəti dayandırılıb. Bağlantı bərpa olunan kimi avtomatik davam edəcək — heç nə etməyin.
      <div class="muted" style="font-size:12px;margin-top:4px">Cəhd: ${room.dbWaiting.attempts}. Gözləmə vaxtı növbə vaxtınızdan çıxılmır.</div></div>`;
  }
  const r = room.round;
  const me = r?.me;
  const uid = S.user.id;
  const nameOf = (id) => esc(r?.players.find((p) => p.id === id)?.name ?? '?');

  const hostControls = () => room.isHost
    ? `<div class="row"><button class="btn primary" data-a="start" ${room.members.length < 2 ? 'disabled' : ''}>${r ? 'Növbəti raund' : 'Raundu başlat'}</button>
       <button class="btn" data-a="settingsModal" style="flex:0 0 auto">⚙️ Ayarlar</button></div>
       ${room.members.length < 2 ? `<div class="notice">Ən azı 2 oyunçu lazımdır. Kodu dostlarınıza göndərin (<b>${room.code}</b>) və ya ⚙️ Ayarlardan 🤖 bot əlavə edin.</div>` : ''}`
    : `<div class="notice">Otaq sahibinin raundu başlatmasını gözləyin...</div>`;

  if (!r || r.phase === 'finished') return resultHTML(r) + hostControls();

  if (r.phase === 'discard') {
    if (me?.mustDiscard) {
      const sel = S.pick;
      return `<div class="notice">Atmaq istədiyiniz <b>1 kartı</b> seçin, qalan 3 kartla oynayacaqsınız. ${deadlineSpan(r.discardDeadline)}<br>
        <span class="muted" style="font-size:12px">Vaxt bitsə 4-cü kart avtomatik atılır.</span></div>
        <button class="btn primary block" data-a="discard" ${sel == null ? 'disabled' : ''}>${sel == null ? 'Kart seçin' : 'Seçilmiş kartı at'}</button>`;
    }
    return `<div class="notice">Digər oyunçular kartlarını seçir... ${deadlineSpan(r.discardDeadline)}</div>`;
  }

  if (r.phase === 'betting') {
    if (me?.isTurn) {
      const min = r.minXod;
      const max = r.maxBet > 0 ? Math.max(r.maxBet, min) : null;
      if (S.bet == null || S.bet < min || (max && S.bet > max)) S.bet = min;
      return `
        <div class="bet-row">
          <button class="btn" data-a="betStep" data-v="-1" aria-label="azalt">−</button>
          <input id="bet" type="number" inputmode="numeric" value="${S.bet}" min="${min}" ${max ? `max="${max}"` : ''} aria-label="Xod məbləği (AZN)">
          <button class="btn" data-a="betStep" data-v="1" aria-label="artır">+</button>
          <button class="btn" data-a="betSet" data-v="${min}">Min</button>
          <button class="btn" data-a="betSet" data-v="${max ? Math.min(max, min * 2) : min * 2}">×2</button>
        </div>
        <button class="btn green block" data-a="xod">Xod et: ${fmt(S.bet)}</button>
        <div class="row">
          <button class="btn blue" data-a="baxis" ${me.canBaxis ? '' : 'disabled'}>Baxış${me.canBaxis ? `: ${nameOf(me.baxisTarget)} (${fmt(min)})` : ''}</button>
          <button class="btn red" data-a="pas">Pas</button>
        </div>
        ${me.canBaxis ? '' : `<div class="hint">ℹ️ ${esc(me.baxisHint || 'Baxış hələ mümkün deyil.')}</div>`}
        ${me.canBaxis && r.activeCount > 2 ? `<label class="check"><input type="checkbox" id="tieOffer" ${S.tieOffer ? 'checked' : ''}> Baxışda "eyni xala baxaq" təklif et</label>` : ''}
        ${me.canOffer ? `<div class="row offers">
          <button class="btn" data-a="offerSeka">🤝 Seka təklif et</button>
          <button class="btn" data-a="offerSplit">½ Bankı bölməyi təklif et</button></div>` : ''}`;
    }
    if (me?.status === 'active') {
      return `<div class="notice">Növbə: <b>${nameOf(r.turn)}</b> ${deadlineSpan(r.turnDeadline)}</div>
        ${me.canVote ? `<button class="btn red block" data-a="votePas">${nameOf(r.turn)} üçün "Pas" səsi ver (${r.votes}/${r.votesNeeded})</button>` : ''}`;
    }
    if (me?.status === 'attached') {
      return `<div class="notice">Şəriksiniz: <b>${nameOf(me.attachedTo)}</b> qalib gəlsə bank bölünəcək.</div>`;
    }
    if (me) return `<div class="notice">${me.status === 'folded' ? 'Pas dediniz.' : 'Bu raunddan çıxdınız.'} Növbə: <b>${nameOf(r.turn)}</b></div>`;
    return `<div class="notice">Raund gedir. Növbəti raundu gözləyin.</div>`;
  }

  if (r.phase === 'offer') {
    const p = r.pending;
    const what = p.kind === 'seka' ? 'Seka' : 'bankı yarı bölməyi';
    if (p.to === uid) {
      return `<div class="notice"><b>${nameOf(p.from)}</b> ${what} təklif edir. ${deadlineSpan(p.deadline)}</div>
        <div class="row"><button class="btn green" data-a="offerAccept">Qəbul et</button><button class="btn red" data-a="offerDecline">Rədd et</button></div>`;
    }
    if (p.from === uid) return `<div class="notice">Təklifiniz (${what}) göndərildi, cavab gözlənilir... ${deadlineSpan(p.deadline)}</div>`;
    return `<div class="notice">${nameOf(p.from)} ${what} təklif edib, ${nameOf(p.to)} cavab verir... ${deadlineSpan(p.deadline)}</div>`;
  }

  if (r.phase === 'tieOffer') {
    const p = r.pending;
    if (p.o === uid) {
      return `<div class="notice"><b>${nameOf(p.c)}</b> sizinlə baxışır və "eyni xala baxaq" təklif edir. ${deadlineSpan(p.deadline)}</div>
        <div class="row"><button class="btn green" data-a="tieAccept">Qəbul et</button><button class="btn red" data-a="tieDecline">Rədd et</button></div>`;
    }
    return `<div class="notice">${nameOf(p.o)} bərabərlik təklifinə cavab verir... ${deadlineSpan(p.deadline)}</div>`;
  }

  if (r.phase === 'tieDecision') {
    const p = r.pending;
    const mine = p.a === uid || p.b === uid;
    if (mine && !(p.voted || []).includes(uid)) {
      return `<div class="notice">Xallar bərabərdir (<b>${p.score} xal</b>)! Hər ikiniz "Seka" seçsəniz seka oynanılır, əks halda bank bölünür. ${deadlineSpan(p.deadline)}</div>
        <div class="row"><button class="btn primary" data-a="tieVote" data-v="seka">Seka</button><button class="btn" data-a="tieVote" data-v="bol">Bankı bölək</button></div>`;
    }
    return `<div class="notice">${nameOf(p.a)} və ${nameOf(p.b)} bərabərdir — qərar gözlənilir... ${deadlineSpan(p.deadline)}</div>`;
  }

  if (r.phase === 'sekaJoin') {
    const sj = r.sekaJoin;
    const joined = sj.joined.map(nameOf).join(', ') || 'hələ heç kim';
    let html = `<div class="notice"><b>SEKA!</b> Bank növbəti raunda keçir. Qoşulanlar: ${joined}. ${deadlineSpan(sj.deadline)}</div>`;
    if (sj.eligible.includes(uid) && !sj.joined.includes(uid)) html += `<button class="btn primary block" data-a="sekaJoin">Sekaya qoşul (${fmt(sj.cost)})</button>`;
    if (sj.base.includes(uid)) html += `<button class="btn green block" data-a="sekaStart">Sekanı başlat</button>`;
    return html;
  }
  return '';
}

function myHandHTML(r, dealCls) {
  const me = r?.me;
  if (!me) return '';
  if (r.phase === 'discard' && me.mustDiscard) {
    const key = `${r.handNo}`;
    if (S.pickKey !== key) { S.pick = null; S.pickKey = key; }
    const keep = S.pick != null ? me.hand.filter((_, i) => i !== S.pick) : null;
    return `<div class="my-hand pick">${me.hand.map((c, i) => `<button class="card-btn ${S.pick === i ? 'selected' : ''}" data-a="pickCard" data-i="${i}" aria-label="kartı seç">${cardSVG(c, dealCls)}${S.pick === i ? '<span class="x">ATILIR</span>' : ''}</button>`).join('')}</div>
      <div class="my-info">${keep ? `Qalan 3 kartın xalı: <span class="score-big">${score3(keep)}</span>` : 'Atılacaq kartı toxunaraq seçin'}</div>`;
  }
  const cards = me.cards || me.hand;
  return `<div class="my-hand">${cards.map((c) => cardSVG(c, dealCls)).join('')}</div>
    <div class="my-info">${me.score != null ? `Xalınız: <span class="score-big">${me.score}</span>` : ''}${me.discarded ? ` <span class="muted">· atdığınız kart:</span> <span class="disc">${cardSVG(me.discarded)}</span>` : ''}</div>`;
}

function renderRoom() {
  const room = S.room;
  if (!room) return '';
  const r = room.round;
  const seats = seatList(room);
  let myIdx = seats.findIndex((p) => p.id === S.user.id);
  if (myIdx < 0) myIdx = 0;
  const handKey = r ? `${room.code}-${r.handNo}-${r.players.length}` : '';
  const dealCls = handKey !== S.handKey ? 'deal' : '';
  S.handKey = handKey;
  const log = (r ? r.log : room.chat) || [];
  const fs = isFs();
  return topbar(`
      <button class="chip gold" data-a="copyCode" title="Kodu kopyala">${room.hasPassword ? '🔒 ' : ''}${room.code} ⧉</button>
      <button class="btn small" data-a="${fs ? 'fsExit' : 'fsEnter'}" title="${fs ? 'Tam ekrandan çıx' : 'Tam ekran'}" aria-label="${fs ? 'Tam ekrandan çıx' : 'Tam ekran'}">${fs ? '⤡' : '⤢'}<span class="lbl"> ${fs ? 'Tam ekrandan çıx' : 'Tam ekran'}</span></button>
      <button class="btn small ghost" data-a="leave">Çıx</button>`, `<div class="room-title">${esc(room.name)}${room.visibility === 'private' ? ' <span title="Gizli otaq">🙈</span>' : ''}</div>`) + `
  <div class="room">
    ${room.dbWaiting ? '<div class="practice-banner db-wait-banner">⏳ Baza bağlantısı gözlənilir — göstərilən vəziyyət son təsdiqlənmiş vəziyyətdir.</div>' : ''}
    ${room.practice ? `<div class="practice-banner">${room.demo ? '🎓 Demo rejimi' : '🤖 Məşq rejimi'}: bu otaqda virtual məşq balansı istifadə olunur — real balans və nəticələr dəyişmir.</div>` : ''}
    <div class="table-wrap"><div class="table">
      <div class="felt"><div class="felt-center">${centerHTML(room)}</div></div>
      ${seats.map((p, i) => renderSeat(p, i, seats.length, myIdx, room, dealCls)).join('')}
    </div></div>
    <div class="hand-area">
      ${myHandHTML(r, dealCls)}
      <div class="actions">${actionsHTML(room)}
        <details ${S.logOpen ? 'open' : ''} id="logDetails"><summary>Oyun jurnalı</summary>
          <div class="log">${log.map((l) => `<div>${esc(l.msg)}</div>`).join('')}</div>
        </details>
      </div>
    </div>
  </div>`;
}

// --------- admin ---------
function renderAdmin() {
  const admin = isAdmin();
  const pending = S.adminUsers.filter((u) => u.status === 'pending').length;
  let body = '';
  if (S.adminTab === 'users') {
    body = S.adminUsers.map((u) => `
      <div class="user-card ${u.status}">
        <div class="top">
          <div><b>${esc(u.displayName)}</b> <span class="muted">@${esc(u.username)}</span>
          ${u.role !== 'player' ? `<span class="chip" style="font-size:11px;padding:1px 8px">${u.role === 'admin' ? 'Admin' : 'Moderator'}</span>` : ''}</div>
          <span class="status ${u.status}">${{ pending: 'Təsdiq gözləyir (demo)', approved: 'Aktiv', blocked: 'Bloklanıb', rejected: 'Rədd edilib' }[u.status]}</span>
        </div>
        <div class="muted" style="font-size:13px">Balans: ${money(u.balance)} ${u.phone ? ` · 📞 ${esc(u.phone)}` : ''} · ${new Date(u.createdAt).toLocaleDateString('az-AZ')}</div>
        <div class="btns">
          ${u.status === 'pending' ? `
            <button class="btn small green" data-a="uStatus" data-id="${u.id}" data-v="approved">Təsdiq et</button>
            <button class="btn small red" data-a="uStatus" data-id="${u.id}" data-v="rejected">Rədd et</button>` : ''}
          ${u.status === 'approved' ? `
            <button class="btn small primary" data-a="uBalance" data-id="${u.id}">± Balans</button>
            ${admin && u.balance < 0 ? `<button class="btn small red" data-a="uReset" data-id="${u.id}">Mənfi balansı sıfırla</button>` : ''}
            <button class="btn small" data-a="uTx" data-id="${u.id}">Əməliyyatlar</button>
            <button class="btn small" data-a="uName" data-id="${u.id}">Ad</button>
            <button class="btn small" data-a="uPass" data-id="${u.id}">Şifrə</button>
            ${admin && u.id !== S.user.id ? `<button class="btn small" data-a="uRole" data-id="${u.id}">Rol</button>` : ''}
            ${u.id !== S.user.id ? `<button class="btn small red" data-a="uStatus" data-id="${u.id}" data-v="blocked">Blokla</button>` : ''}` : ''}
          ${u.status === 'blocked' || u.status === 'rejected' ? `<button class="btn small green" data-a="uStatus" data-id="${u.id}" data-v="approved">Aktivləşdir</button>` : ''}
        </div>
      </div>`).join('') || '<p class="muted">İstifadəçi yoxdur.</p>';
  } else if (S.adminTab === 'tx') {
    const who = S.adminTxUser ? S.adminUsers.find((u) => u.id === S.adminTxUser) : null;
    body = `${who ? `<div class="row" style="margin-bottom:8px"><b>${esc(who.displayName)}</b><button class="btn small" style="flex:0 0 auto" data-a="txAll">Hamısı</button></div>` : ''}
      ${txList(S.adminTx, true)}`;
  } else {
    body = `<p class="muted" style="font-size:13px">${STATS_NOTE}</p>` + (S.adminPairs.length ? S.adminPairs.map((p) => `
      <div class="tx">
        <div><b>${esc(p.aName)}</b> — <b>${esc(p.bName)}</b>
          <div class="meta">${esc(p.aName)} uddu: ${fmtCents(p.aWonCents)} · ${esc(p.bName)} uddu: ${fmtCents(p.bWonCents)}</div></div>
        <div class="d ${p.aNetCents >= 0 ? 'plus' : 'minus'}">${esc(p.aName)}: ${fmtCents(p.aNetCents, true)}</div>
      </div>`).join('') : '<p class="muted">Hələ qeyd yoxdur.</p>');
  }
  return topbar(`<button class="btn small" data-a="closeAdmin">← Geri</button>`) + `
  <div class="wrap">
    <div class="tabs">
      <button class="btn ${S.adminTab === 'users' ? 'active' : ''}" data-a="adminTab" data-v="users">İstifadəçilər${pending ? ` (${pending})` : ''}</button>
      <button class="btn ${S.adminTab === 'tx' ? 'active' : ''}" data-a="adminTab" data-v="tx">Əməliyyatlar</button>
      <button class="btn ${S.adminTab === 'stats' ? 'active' : ''}" data-a="adminTab" data-v="stats">Nəticələr</button>
    </div>
    <div class="card-panel">${body}</div>
  </div>`;
}

const STATS_NOTE = 'Hesablama: hər real raundda oyunçunun banka qoyduğu pul qaliblərə onların bankdan aldığı paya mütənasib bölünür; qalibin öz payı özünə yazılmır. Admin balans dəyişiklikləri, sıfırlamalar, botlu/demo raundlar daxil deyil. Qeydlər v2 yeniləməsindən sonrakı raundlardan başlayır.';

function txList(items, showUser) {
  if (!items.length) return '<p class="muted">Əməliyyat yoxdur.</p>';
  return items.map((t) => `<div class="tx">
    <div>${showUser ? `<b>${esc(t.user_name)}</b> · ` : ''}${esc(t.reason)}${t.kind ? ` <span class="kind k-${esc(t.kind)}">${KIND_LABEL[t.kind] || esc(t.kind)}</span>` : ''}${t.room ? ` <span class="muted">[${esc(t.room)}]</span>` : ''}
      <div class="meta">${new Date(Number(t.created_at)).toLocaleString('az-AZ')}${t.by_name ? ` · icra edən: ${esc(t.by_name)}` : ''} · ${t.prev_balance != null ? `${fmt(Number(t.prev_balance))} → ` : 'Qalıq: '}${fmt(Number(t.balance_after))}</div></div>
    <div class="d ${t.delta >= 0 ? 'plus' : 'minus'}">${t.delta >= 0 ? '+' : ''}${fmt(Number(t.delta))}</div>
  </div>`).join('');
}

async function loadAdmin() {
  try {
    const [u, t, s] = await Promise.all([
      api('/api/admin/users'),
      api('/api/admin/transactions' + (S.adminTxUser ? `?userId=${S.adminTxUser}` : '')),
      api('/api/admin/stats'),
    ]);
    S.adminUsers = u.users; S.adminTx = t.items; S.adminPairs = s.pairs;
    render();
  } catch (e) { toast(e.message); }
}

// --------- modal ---------
function renderModal() {
  const m = S.modal;
  return `<div class="modal-bg" data-a="closeModalBg"><div class="modal">
    <h3>${esc(m.title)}</h3>
    ${m.html ?? `<form data-form="modal">
      ${m.text ? `<p class="muted">${m.text}</p>` : ''}
      ${m.fieldsHTML ?? m.fields.map((f) => f.type === 'select'
        ? `<label>${f.label}</label><select name="${f.name}">${f.options.map(([v, l]) => `<option value="${v}" ${v === f.value ? 'selected' : ''}>${l}</option>`).join('')}</select>`
        : `<label>${f.label}</label><input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.type === 'number' ? 'inputmode="numeric"' : ''} ${f.autofocus ? 'autofocus' : ''}>`).join('')}
      <div class="row mt"><button type="button" class="btn" data-a="closeModal">Bağla</button><button class="btn primary">${m.submitLabel || 'Yadda saxla'}</button></div>
    </form>`}
    ${m.html ? `<div class="row mt"><button class="btn" data-a="closeModal">Bağla</button></div>` : ''}
  </div></div>`;
}

function openPasswordModal(code, msg) {
  S.modal = { title: '🔒 Şifrəli otaq', kind: 'roomPassword', code, submitLabel: 'Qoşul', text: esc(msg || 'Bu otaq şifrəlidir.'),
    fields: [{ name: 'password', label: 'Otaq şifrəsi', type: 'password', autofocus: true }] };
  render();
  document.querySelector('.modal input')?.focus();
}

function roomSettingsModal() {
  const room = S.room;
  const bots = room.members.filter((m) => m.isBot);
  S.modal = { title: 'Otaq ayarları', kind: 'settings', submitLabel: 'Yadda saxla', fieldsHTML: `
    <label>Otaq adı</label><input name="name" maxlength="30" value="${esc(room.name)}">
    ${room.demo ? '' : `<label>Görünmə</label>
    <div class="seg">
      <label><input type="radio" name="visibility" value="public" ${room.visibility === 'public' ? 'checked' : ''}> 🌐 Açıq</label>
      <label><input type="radio" name="visibility" value="private" ${room.visibility === 'private' ? 'checked' : ''}> 🙈 Gizli</label>
    </div>
    <label>Şifrə ${room.hasPassword ? '(hazırda şifrəlidir — dəyişmək üçün yeni şifrə yazın)' : '(istəyə görə)'}</label>
    <input name="password" type="password" autocomplete="new-password" placeholder="${room.hasPassword ? 'dəyişməmək üçün boş saxlayın' : 'boş — şifrəsiz'}">
    ${room.hasPassword ? '<label class="check"><input type="checkbox" name="removePassword"> Şifrəni sil</label>' : ''}`}
    <h4>🤖 Botlar</h4>
    ${bots.map((b) => `<div class="row bot-row"><span>🤖 ${esc(b.name)}</span><button type="button" class="btn small red" style="flex:0 0 auto" data-a="removeBot" data-id="${b.id}">Çıxar</button></div>`).join('') || '<p class="muted" style="margin:4px 0">Bot yoxdur.</p>'}
    <button type="button" class="btn small" data-a="addBot" ${room.members.length >= room.settings.maxPlayers ? 'disabled' : ''}>+ Bot əlavə et</button>
    <p class="muted" style="font-size:12px">Bot olan otaqda bütün oyunçular virtual məşq balansı ilə oynayır; real balans dəyişmir.</p>
    <h4>Oyun ayarları</h4>
    ${settingsInputs(room.settings)}` };
  render();
}

// ---------------- timerlər ----------------
function updateTimers() {
  const now = Date.now() + S.clockOffset;
  document.querySelectorAll('[data-deadline]').forEach((el) => {
    const dl = Number(el.dataset.deadline);
    const total = Number(el.dataset.total) * 1000;
    const left = Math.max(0, dl - now);
    el.querySelector('i').style.width = `${(left / total) * 100}%`;
    el.classList.toggle('late', left < 10_000);
  });
  document.querySelectorAll('[data-countdown]').forEach((el) => {
    const left = Math.max(0, Math.ceil((Number(el.dataset.countdown) - now) / 1000));
    el.textContent = left > 0 ? `(${left} san)` : '(vaxt bitdi)';
  });
}
setInterval(updateTimers, 250);

// ---------------- hadisələr ----------------
const byId = (el) => Number(el.dataset.id);
const H = {
  authTab: (el) => { S.authTab = el.dataset.v; render(); },
  logout: async () => { await api('/api/logout', {}).catch(() => {}); S.user = null; S.view = 'auth'; S.ws?.close(); render(); },
  openAdmin: () => { S.view = 'admin'; render(); loadAdmin(); },
  closeAdmin: () => { S.view = S.room ? 'room' : 'lobby'; render(); loadRooms(); },
  adminTab: (el) => { S.adminTab = el.dataset.v; render(); loadAdmin(); },
  txAll: () => { S.adminTxUser = null; loadAdmin(); },
  playBot: () => send({ t: 'createRoom', name: isDemo() ? 'Demo oyun' : 'Kompüterlə oyun', visibility: 'private', withBot: true }),
  joinListed: (el) => {
    if (el.dataset.locked === '1') openPasswordModal(el.dataset.code, 'Bu otaq şifrəlidir.');
    else send({ t: 'joinRoom', code: el.dataset.code });
  },
  copyCode: async () => {
    const code = S.room.code;
    try { await navigator.clipboard.writeText(code); toast(`Kod kopyalandı: ${code}`, true); } catch { toast(`Otaq kodu: ${code}`, true); }
  },
  fsEnter: () => enterFullscreen(),
  fsExit: () => { exitFullscreen(); render(); },
  leave: () => { if (confirm('Otaqdan çıxmaq istəyirsiniz? Raund gedirsə pas sayılacaq.')) send({ t: 'leaveRoom' }); },
  start: () => send({ t: 'startRound' }),
  settingsModal: () => roomSettingsModal(),
  addBot: () => { send({ t: 'addBot' }); setTimeout(() => S.modal?.kind === 'settings' && roomSettingsModal(), 300); },
  removeBot: (el) => { send({ t: 'removeBot', botId: byId(el) }); setTimeout(() => S.modal?.kind === 'settings' && roomSettingsModal(), 300); },
  betStep: (el) => {
    const r = S.room.round; const step = Math.max(1, S.room.settings.minBet);
    let v = (Number(S.bet) || r.minXod) + step * Number(el.dataset.v);
    v = Math.max(r.minXod, v); if (r.maxBet > 0) v = Math.min(Math.max(r.maxBet, r.minXod), v);
    S.bet = v; render();
  },
  betSet: (el) => { S.bet = Number(el.dataset.v); render(); },
  xod: () => act({ type: 'xod', amount: S.bet }),
  pas: () => { if (confirm('Pas deyirsiniz?')) act({ type: 'pas' }); },
  baxis: () => act({ type: 'baxis', tieOffer: !!S.tieOffer }),
  offerSeka: () => act({ type: 'offerSeka' }),
  offerSplit: () => act({ type: 'offerSplit' }),
  offerAccept: () => act({ type: 'offerAccept' }),
  offerDecline: () => act({ type: 'offerDecline' }),
  votePas: () => act({ type: 'votePas' }),
  tieAccept: () => act({ type: 'tieAccept' }),
  tieDecline: () => act({ type: 'tieDecline' }),
  tieVote: (el) => act({ type: 'tieVote', choice: el.dataset.v }),
  sekaJoin: () => act({ type: 'sekaJoin' }),
  sekaStart: () => act({ type: 'sekaStart' }),
  pickCard: (el) => { const i = Number(el.dataset.i); S.pick = S.pick === i ? null : i; render(); },
  discard: () => { if (S.pick != null) act({ type: 'discard', index: S.pick }); },
  closeModal: () => { S.modal = null; render(); },
  closeModalBg: (el, ev) => { if (ev.target === el) { S.modal = null; render(); } },
  pwModal: () => {
    S.modal = { title: 'Şifrəni dəyiş', kind: 'password', fields: [
      { name: 'oldPassword', label: 'Köhnə şifrə', type: 'password' },
      { name: 'newPassword', label: 'Yeni şifrə (ən azı 6 simvol)', type: 'password' }] };
    render();
  },
  myTx: async () => {
    try { const d = await api('/api/my-transactions'); S.modal = { title: 'Əməliyyatlarım', html: txList(d.items, false) }; render(); } catch (e) { toast(e.message); }
  },
  myStats: async () => {
    try {
      const d = await api('/api/my-stats');
      const rows = d.items.map((x) => `<div class="tx"><div><b>${esc(S.user.displayName)} — ${esc(x.name)}</b>
        <div class="meta">uddunuz: ${fmtCents(x.wonCents)} · uduzdunuz: ${fmtCents(x.lostCents)}</div></div>
        <div class="d ${x.netCents >= 0 ? 'plus' : 'minus'}">${fmtCents(x.netCents, true)}</div></div>`).join('') || '<p class="muted">Hələ real raund nəticəsi yoxdur.</p>';
      S.modal = { title: 'Rəqiblər üzrə nəticələrim', html: `<p class="muted" style="font-size:12.5px">${STATS_NOTE}</p>${rows}` };
      render();
    } catch (e) { toast(e.message); }
  },
  uStatus: async (el) => {
    const v = el.dataset.v;
    if (v === 'blocked' && !confirm('Bu istifadəçini bloklamaq istəyirsiniz?')) return;
    try { await api(`/api/admin/users/${el.dataset.id}/status`, { status: v }); toast('Yadda saxlanıldı.', true); loadAdmin(); } catch (e) { toast(e.message); }
  },
  uReset: async (el) => {
    const u = S.adminUsers.find((x) => x.id === byId(el));
    if (!confirm(`${u.displayName}: balans ${fmt(u.balance)} → 0 AZN.\nDüzəliş: +${fmt(-u.balance)}. Əvvəlki udma/uduzma tarixçəsi qalır.\n\nTəsdiq edirsiniz?`)) return;
    try { await api(`/api/admin/users/${u.id}/reset-negative`, { confirm: true }); toast('Mənfi balans sıfırlandı.', true); loadAdmin(); } catch (e) { toast(e.message); loadAdmin(); }
  },
  uBalance: (el) => {
    const u = S.adminUsers.find((x) => x.id === byId(el));
    S.modal = { title: `Balans: ${u.displayName}`, kind: 'balance', id: u.id, submitLabel: 'Təsdiqlə',
      text: `Hazırkı balans: ${fmt(u.balance)}. Çıxmaq üçün mənfi rəqəm yazın (məs. −50). Bu, virtual oyun balansıdır.`,
      fields: [{ name: 'amount', label: 'Məbləğ (AZN)', type: 'number' }, { name: 'note', label: 'Qeyd (istəyə görə)' }] };
    render();
  },
  uName: (el) => {
    const u = S.adminUsers.find((x) => x.id === byId(el));
    S.modal = { title: 'Adı dəyiş', kind: 'name', id: u.id, fields: [{ name: 'displayName', label: 'Oyunda görünən ad', value: u.displayName }] };
    render();
  },
  uPass: (el) => {
    S.modal = { title: 'Yeni şifrə təyin et', kind: 'upass', id: byId(el), fields: [{ name: 'password', label: 'Yeni şifrə', type: 'text' }] };
    render();
  },
  uRole: (el) => {
    const u = S.adminUsers.find((x) => x.id === byId(el));
    S.modal = { title: `Rol: ${u.displayName}`, kind: 'role', id: u.id, text: 'Moderator istifadəçiləri təsdiq edə və balans artıra bilər.',
      fields: [{ name: 'role', label: 'Rol', type: 'select', value: u.role, options: [['player', 'Oyunçu'], ['moderator', 'Moderator'], ['admin', 'Admin']] }] };
    render();
  },
  uTx: (el) => { S.adminTxUser = byId(el); S.adminTab = 'tx'; render(); loadAdmin(); },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = H[el.dataset.a];
  if (fn) { if (el.dataset.a !== 'closeModalBg') ev.preventDefault(); fn(el, ev); }
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'bet') {
    S.bet = Number(ev.target.value) || 0;
    const b = document.querySelector('[data-a="xod"]');
    if (b) b.textContent = `Xod et: ${fmt(S.bet)}`;
  }
  if (ev.target.id === 'tieOffer') S.tieOffer = ev.target.checked;
});
document.addEventListener('change', (ev) => { if (ev.target.id === 'tieOffer') S.tieOffer = ev.target.checked; });
document.addEventListener('toggle', (ev) => { if (ev.target.id === 'logDetails') S.logOpen = ev.target.open; }, true);

document.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('form[data-form]');
  if (!form) return;
  ev.preventDefault();
  const fd = new FormData(form);
  const data = Object.fromEntries(fd);
  const kind = form.dataset.form;
  try {
    if (kind === 'login') {
      const r = await api('/api/login', data);
      S.user = r.user; S.view = 'lobby'; render(); connect();
    } else if (kind === 'register') {
      const r = await api('/api/register', data);
      toast(r.msg, true); S.authTab = 'login'; render();
    } else if (kind === 'join') {
      send({ t: 'joinRoom', code: data.code.trim().toUpperCase() });
    } else if (kind === 'create') {
      const settings = {};
      for (const [k] of SETTINGS_FIELDS) settings[k] = data[k];
      send({ t: 'createRoom', name: data.name, visibility: data.visibility, password: data.password, withBot: !!data.withBot, settings });
    } else if (kind === 'modal') {
      const m = S.modal;
      if (m.kind === 'settings') {
        const settings = {};
        for (const [k] of SETTINGS_FIELDS) settings[k] = data[k];
        send({ t: 'roomMeta', meta: { name: data.name, visibility: data.visibility, password: data.password || '', removePassword: !!data.removePassword } });
        send({ t: 'settings', settings });
      } else if (m.kind === 'roomPassword') {
        send({ t: 'joinRoom', code: m.code, password: data.password });
      } else if (m.kind === 'password') { await api('/api/password', data); toast('Şifrə dəyişdirildi.', true); }
      else if (m.kind === 'balance') { await api(`/api/admin/users/${m.id}/balance`, data); toast('Balans yeniləndi.', true); loadAdmin(); }
      else if (m.kind === 'name') { await api(`/api/admin/users/${m.id}/name`, data); toast('Ad dəyişdirildi.', true); loadAdmin(); }
      else if (m.kind === 'upass') { await api(`/api/admin/users/${m.id}/password`, data); toast('Şifrə təyin edildi.', true); }
      else if (m.kind === 'role') { await api(`/api/admin/users/${m.id}/role`, data); toast('Rol dəyişdirildi.', true); loadAdmin(); }
      S.modal = null; render();
    }
  } catch (e) { toast(e.message); }
});

// ---------------- başlanğıc ----------------
(async () => {
  try {
    const r = await api('/api/me');
    if (r.user) { S.user = r.user; S.view = 'lobby'; connect(); } else S.view = 'auth';
  } catch { S.view = 'auth'; }
  render();
  loadRooms();
})();
