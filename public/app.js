import { cardSVG } from './cards.js';
import { S, esc, fmt, money, toast, api, isStaff, isAdmin, isDemo, txList, fmtCents, fmtDate, avatarHTML, moneyCall, azLower, azAblative, azDative } from './core.js';
const dativeName = (n) => azDative(n);
import { renderRoom, showBubble, markChatSeen, updateChatBadge } from './room.js';
import { onRoom as fxOnRoom, afterRender as fxAfterRender } from './fx.js';
import { toggleMute, soundTest } from './sound.js';
import { onGiftEvent, toggleAnimations, clearGiftQueue, preloadLion } from './giftfx.js';
import { giftHandlers } from './gifts.js';
import { shopHandlers, refreshShopModal } from './shop.js';
import { onItemUse } from './items.js';
import { onLoanAsk, onLoanAskDone, loanAskHandlers, initLoanAsk } from './loanask.js';
import { installPeek, afterRenderPeek } from './peek.js';
import { morph } from './morph.js';
import { renderProfile, loadProfile, profileForms, profileHandlers, onSearchInput, pickRecipient, uploadAvatar, creditModal, STATS_NOTE } from './profile.js';
import { renderAdmin, loadAdmin, refreshAdminList, adminForms, adminHandlers, adminModalSubmit, uploadShopImage } from './admin.js';
import { onRoomUpdate as turnAlert, toggleVibrate } from './turnalert.js';
import { initVoice, toggleVoice, onVoiceSignal, onVoiceState, stopVoice, toggleLocalMute, onReconnect as voiceReconnect } from './voice.js';

const $app = document.getElementById('app');
const SETTINGS_FIELDS = [
  ['ante', 'Oyun haqqı (xal)'], ['minBet', 'Minimum xod (xal)'], ['maxBet', 'Maksimum xod (xal, 0 = limitsiz)'],
  ['jackpotSix', 'Cəkpot 3×6 — hər rəqibdən (xal)'], ['jackpotAce', 'Cəkpot 3 Tuz — hər rəqibdən (xal)'],
  ['turnSeconds', 'Xod vaxtı (saniyə)'], ['maxPlayers', 'Maks. oyunçu (2–8)'],
];
const DEFAULTS = { ante: 10, minBet: 10, maxBet: 0, jackpotSix: 100, jackpotAce: 100, turnSeconds: 60, maxPlayers: 8 };

// ---------------- WebSocket ----------------
function connect() {
  if (S.ws && S.ws.readyState <= 1) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  S.ws = ws;
  S.lastMsgAt = Date.now();
  ws.onopen = () => {
    S.wsRetry = 0;
    S.lastMsgAt = Date.now();
    const was = S.conn;
    S.conn = 'online';
    if (was && was !== 'online') { toast('Bağlantı bərpa olundu.', true); render(); }
    if (was) voiceReconnect();
    loadPendingLoans();
  };
  ws.onmessage = (ev) => {
    S.lastMsgAt = Date.now();
    const m = JSON.parse(ev.data);
    if (m.t === 'pong') return;
    if (m.t === 'hello') {
      S.user = m.user;
      if (!m.roomCode && S.view === 'room') { S.room = null; S.view = 'lobby'; }
      render();
      if (S.view === 'lobby') loadRooms();
      loadUnread();
    } else if (m.t === 'user') {
      S.user = { ...S.user, ...m.user };
      render();
    } else if (m.t === 'room') {
      try { fxOnRoom(S.room, m.room); } catch { /* animasiya oyunu dayandırmamalıdır */ }
      try { turnAlert(S.room, m.room, showTurnBanner, S.user?.id); } catch { /* */ }
      S.room = m.room;
      if (!m.room.practice) preloadLion(); // "Şir" şəkli əvvəlcədən yüklənsin (bir dəfə)
      S.busy = false;
      S.clockOffset = m.room.serverNow - Date.now();
      if (S.view !== 'admin' && S.view !== 'profile') S.view = 'room';
      if (S.view === 'room') render();
    } else if (m.t === 'left') {
      stopVoice(true, true); // otaqdan çıxdı: səs bağlanır, serverə bildirilir
      S.room = null; S.bet = null; S.pick = null;
      if (S.view === 'room') S.view = 'lobby';
      exitFullscreen();
      render();
      loadRooms();
    } else if (m.t === 'balance') {
      if (S.user) S.user.balance = m.balance;
      const el = document.getElementById('myBalance');
      if (el) el.innerHTML = el.closest('.rb-bal') ? fmt(m.balance) : money(m.balance);
      if (S.view === 'profile') loadProfile(render);
      refreshShopModal(render);
    } else if (m.t === 'tgift') {
      onGiftEvent(m);
    } else if (m.t === 'itemUse') {
      try { onItemUse(m); } catch { /* effekt oyunu dayandırmamalıdır */ }
    } else if (m.t === 'voiceSignal') {
      onVoiceSignal(m);
    } else if (m.t === 'voiceState') {
      onVoiceState(m);
    } else if (m.t === 'bubble') {
      showBubble(m);
    } else if (m.t === 'loanAsk') {
      try { onLoanAsk(m); } catch { /* */ }
      loadPendingLoans();
    } else if (m.t === 'loanAskDone') {
      onLoanAskDone(m);
      loadPendingLoans();
    } else if (m.t === 'notify') {
      if (m.kind !== 'loan_ask') toast(m.text, true); // masa bildiriş kartı ayrıca göstərilir
      S.unread++;
      updateBell();
      if (m.kind === 'loan') loadPendingLoans();
      if (S.view === 'profile') loadProfile(render);
    } else if (m.t === 'staff') {
      toast(m.text, true);
      if (S.view === 'admin') loadAdmin(refreshAdminList);
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
    // aydın status: "yenidən qoşulur…" (oyun vəziyyəti yenilənmir) — qoşulanda server son vəziyyəti özü göndərir
    if (S.conn !== 'reconnecting') { S.conn = 'reconnecting'; render(); }
    const delay = Math.min(10000, 800 * 2 ** S.wsRetry++);
    setTimeout(async () => {
      try { const r = await api('/api/me'); if (!r.user) { S.user = null; S.view = 'auth'; render(); return; } } catch { /* şəbəkə */ }
      connect();
    }, delay);
  };
}
// Ürək döyüntüsü: 20 saniyədən bir ping. 45 saniyə heç bir mesaj gəlməsə bağlantı "ölü" sayılır və yenidən qurulur
// (telefon yuxudan oyananda, şəbəkə dəyişəndə və ya server yenidən başlayanda yarımçıq açıq qalan bağlantılar).
setInterval(() => {
  const ws = S.ws;
  if (!ws || ws.readyState !== 1) return;
  if (Date.now() - (S.lastMsgAt || 0) > 45_000) { try { ws.close(); } catch { /* */ } return; }
  try { ws.send('{"t":"ping"}'); } catch { /* */ }
}, 20_000);
function reconnectNow() {
  if (!S.user) return;
  if (S.ws && S.ws.readyState === 1 && Date.now() - (S.lastMsgAt || 0) < 45_000) return;
  if (S.ws && S.ws.readyState <= 1) { try { S.ws.close(); } catch { /* */ } }
  S.wsRetry = 0;
  connect();
}
window.addEventListener('online', reconnectNow);
document.addEventListener('visibilitychange', () => { if (!document.hidden) reconnectNow(); });

async function loadPendingLoans() {
  if (!S.user || isDemo()) return;
  try {
    const r = await api('/api/loans/pending');
    S.pendingLoans = r.loans;
    if (S.view === 'room') render();
    if (S.modal?.kind === 'loans') { S.modal = loansModalState(); render(); }
  } catch { /* sonra */ }
}

function loansModalState() {
  const list = S.pendingLoans || [];
  const mine = list.filter((l) => l.mine);
  const out = list.filter((l) => !l.mine);
  const row = (l) => {
    const offered = l.status === 'offered';
    const iAmLender = l.lenderId === S.user.id;
    const who = iAmLender ? l.borrowerName : l.lenderName;
    const what = offered
      ? (iAmLender ? `Siz ${esc(who)}-a ${fmt(l.amount)} borc təklif etmisiniz` : `${esc(who)} sizə ${fmt(l.amount)} borc təklif edir`)
      : (iAmLender ? `${esc(who)} sizdən ${fmt(l.amount)} borc istəyir` : `Siz ${esc(who)}-dan ${fmt(l.amount)} borc istəmisiniz`);
    let btns = '';
    if (l.mine && offered) btns = `<button class="btn small green" data-a="loanDo" data-op="accept" data-id="${l.id}">Qəbul et</button><button class="btn small red" data-a="loanDo" data-op="decline" data-id="${l.id}">Rədd et</button>`;
    else if (l.mine) btns = `<button class="btn small green" data-a="loanDo" data-op="approve" data-id="${l.id}">Təsdiqlə və ver</button><button class="btn small red" data-a="loanDo" data-op="reject" data-id="${l.id}">Rədd et</button>`;
    else if (offered) btns = `<button class="btn small" data-a="loanDo" data-op="cancel" data-id="${l.id}">Ləğv et</button>`;
    else btns = `<button class="btn small" data-a="loanDo" data-op="withdraw" data-id="${l.id}">Geri götür</button>`;
    return `<div class="tx loan-row" data-key="loan${l.id}"><div>${what}<div class="meta">Qaytarma: ${fmtDate(l.dueAt)} · faiz yoxdur${l.note ? ` · ${esc(l.note)}` : ''}</div></div><div class="row" style="flex:0 0 auto;gap:6px">${btns}</div></div>`;
  };
  return { title: '🤝 Borc təklifləri və istəkləri', kind: 'loans',
    html: `<p class="muted" style="font-size:12.5px">Qəbul/təsdiq edilənə qədər heç kimin balansı və borcu dəyişmir. Təsdiq anında hər iki balans serverdə bir tranzaksiyada yoxlanılır. Masadan və raunddan çıxmırsınız.</p>
      <h4>Cavabınızı gözləyir</h4>${mine.map(row).join('') || '<p class="muted">Yoxdur.</p>'}
      <h4>Göndərdikləriniz</h4>${out.map(row).join('') || '<p class="muted">Yoxdur.</p>'}` };
}

// görünən növbə bildirişi (2,5 san, toxunuşları bloklamır)
function showTurnBanner(text) {
  const el = document.createElement('div');
  el.className = 'turn-banner'; el.setAttribute('role', 'alert');
  el.textContent = `🔔 ${typeof text === 'string' ? text : 'Növbə sizdədir!'}`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 2200);
  setTimeout(() => el.remove(), 2700);
}

const send = (msg) => {
  if (S.ws?.readyState === 1) { S.ws.send(JSON.stringify(msg)); return true; }
  toast('Serverlə əlaqə yoxdur, yenidən qoşulur...');
  return false;
};
initVoice({ send, getUser: () => S.user, getRoom: () => S.room, notify: (t) => toast(t), repaint: () => { if (S.view === 'room') render(); } });
initLoanAsk({ render: () => { if (S.view === 'room') render(); } });
// hər hərəkət gördüyümüz vəziyyətin versiyası ilə göndərilir (təkrar/köhnə klik server tərəfindən rədd olunur)
const act = (action) => {
  if (S.busy) return;
  const v = S.room?.round?.version;
  if (send({ t: 'act', action: { ...action, v } })) { S.busy = true; setTimeout(() => { S.busy = false; }, 1500); }
};

// açıq otaqlar siyahısı: yalnız siyahı hissəsi yenilənir (formalar və yazılan şifrələr silinmir)
async function loadRooms() {
  if (!S.user || isDemo() || S.view !== 'lobby' || document.hidden) return; // gizli vərəqdə sorğu göndərilmir
  try {
    S.rooms = (await api('/api/rooms')).rooms;
    const el = document.getElementById('roomList');
    if (el) el.innerHTML = renderRoomsList();
  } catch { /* sonra */ }
}
setInterval(loadRooms, 5000);

async function loadUnread() {
  try { const r = await api('/api/notifications'); S.unread = r.items.filter((x) => !x.read_at).length; updateBell(); } catch { /* yox */ }
}
function updateBell() {
  const el = document.getElementById('bellCount');
  if (el) { el.textContent = S.unread > 0 ? String(S.unread) : ''; el.classList.toggle('hidden', !(S.unread > 0)); }
}

// ---------------- tam ekran ----------------
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
const isFs = () => !!fsElement() || S.pseudoFs;
async function enterFullscreen() {
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) { await el.requestFullscreen({ navigationUI: 'hide' }); return; }
    if (el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); return; }
  } catch { /* dəstəklənmir — alternativ görünüş */ }
  S.pseudoFs = true; // iPhone Safari kimi brauzerlər: sıxlaşdırılmış "tam ekran" görünüşü
  document.body.classList.add('pseudo-fs');
  window.scrollTo(0, 0);
  render();
}
function exitFullscreen() {
  try {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch { /* yox */ }
  if (S.pseudoFs) { S.pseudoFs = false; document.body.classList.remove('pseudo-fs'); }
}
document.addEventListener('fullscreenchange', () => render());
document.addEventListener('webkitfullscreenchange', () => render());

// ---------------- render ----------------
// Render: bütün tətbiq innerHTML ilə yenidən yaradılmır — morph yalnız dəyişən hissələri yerində yeniləyir.
// Aktiv input DOM-dan çıxarılmır, ona fokus proqramla verilmir (klaviatura öz-özünə açılmır / sıçramır).
let lastView = null;
function render() {
  const scroll = window.scrollY;
  let html = '';
  if (S.view === 'loading') html = `<div class="wrap center muted" style="margin-top:30vh">Yüklənir...</div>`;
  else if (S.view === 'auth') html = renderAuth();
  else if (S.view === 'lobby') html = renderLobby();
  else if (S.view === 'room') html = renderRoom(topbar, isFs);
  else if (S.view === 'admin') html = renderAdmin(topbar);
  else if (S.view === 'profile') html = renderProfile(topbar);
  if (S.modal) html += renderModal();
  document.body.classList.toggle('in-room', S.view === 'room');
  const viewChanged = lastView !== S.view;
  lastView = S.view;
  morph($app, html);
  if (viewChanged && S.view !== 'room') window.scrollTo(0, 0);
  else if (S.view !== 'room' && window.scrollY !== scroll && !isTyping()) window.scrollTo(0, scroll);
  document.querySelectorAll('.log').forEach((l) => {
    // jurnal yalnız istifadəçi aşağıda idisə aşağı sürüşür
    if (l.scrollHeight - l.scrollTop - l.clientHeight < 60) l.scrollTop = l.scrollHeight;
  });
  updateTimers();
  if (S.view === 'room') {
    const side = document.querySelector('.room .side');
    if (side) document.documentElement.style.setProperty('--side-h', `${side.offsetHeight}px`);
    try { fxAfterRender(); } catch { /* yox */ }
    try { afterRenderPeek(); } catch { /* yox */ }
    // kartlara baxıldı → serverə bir dəfə bildir (xal yalnız bundan sonra gəlir)
    if (S.lookWanted && S.lookSent !== S.lookWanted && S.ws?.readyState === 1) { S.lookSent = S.lookWanted; send({ t: 'look' }); }
    if (S.chatOpen) markChatSeen(); else updateChatBadge();
  }
}

function topbar(extra = '', title = '') {
  const showBal = S.user && !isDemo();
  return `<div class="topbar">
    <div class="logo brand">Dairə</div>${title}
    <div class="spacer"></div>
    ${extra}
    ${S.user ? `<button class="btn small ghost bell" data-a="openNotifications" aria-label="Bildirişlər">🔔<span id="bellCount" class="bell-count ${S.unread > 0 ? '' : 'hidden'}">${S.unread || ''}</span></button>` : ''}
    ${showBal ? `<button class="chip" id="myBalance" data-a="openProfile" title="Profilim">${money(S.user.balance)}</button>` : ''}
  </div>`;
}

// Giriş ekranı: yalnız ad, istifadəçi adı və şifrə. Qeydiyyat yoxdur (hesabları admin yaradır).
// Masa, otaqlar və oyunçu siyahısı yalnız daxil olduqdan sonra yüklənir.
function renderAuth() {
  return `<div class="wrap auth">
    <div class="hero"><div class="brand-mark" aria-hidden="true"></div><h1 class="logo brand">Dairə</h1></div>
    <form data-form="login" class="card-panel auth-form">
      <label for="loginUser">İstifadəçi adı</label><input id="loginUser" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
      <label for="loginPass">Şifrə</label><input id="loginPass" name="password" type="password" autocomplete="current-password" required>
      <button class="btn primary block mt">Daxil ol</button>
    </form>
  </div>`;
}

function settingsInputs(s) {
  return `<div class="settings-grid">${SETTINGS_FIELDS.map(([k, l]) =>
    `<div><label>${l}</label><input name="${k}" type="number" inputmode="numeric" min="0" value="${esc(s[k] ?? DEFAULTS[k])}"></div>`).join('')}</div>`;
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

function botCountSelect(id) {
  return `<select id="${id}" aria-label="Bot sayı">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${n} bot</option>`).join('')}</select>`;
}

function renderLobby() {
  const u = S.user;
  return topbar(`
      ${isStaff() ? `<button class="btn small" data-a="openAdmin">Admin</button>` : ''}
      <button class="btn small ghost" data-a="logout">Çıxış</button>`) + `
  <div class="wrap">
    <div class="card-panel">
      <div class="row" style="flex-wrap:wrap;align-items:center">
        <div style="flex:0 0 auto">${avatarHTML(u, 'md')}</div>
        <div><div style="font-size:20px;font-weight:800">Salam, ${esc(u.displayName)}!</div>
        <div class="muted">Balans: ${money(u.balance)} <span style="font-size:12px">(virtual oyun balansı)</span>${u.creditDebt ? ` · Kredit borcu: ${fmt(u.creditDebt)}` : ''}</div></div>
        <div style="flex:0 0 auto;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn small primary" data-a="openProfile">👤 Profilim</button>
          <button class="btn small" data-a="myTx">Əməliyyatlarım</button>
          <button class="btn small" data-a="pwModal">Şifrə</button>
        </div>
      </div>
      ${u.balance <= 0 ? `<div class="notice mt">Balansınız bitib. <button class="btn small primary" data-a="creditModal">💳 Kredit istə</button> və ya botlarla demo oynayın.</div>` : ''}
    </div>
    <div class="card-panel demo-panel">
      <h2>🤖 Demo — kompüterlə oyna</h2>
      <p class="muted" style="margin-top:0">Hər girişdə 10 000 demo xal. Əsas balans, borclar və statistika dəyişmir.</p>
      <div class="row">${botCountSelect('demoBots')}<button class="btn blue" data-a="playBot">Demoya başla</button></div>
    </div>
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
          <details class="mt"><summary>Oyun ayarları</summary>${settingsInputs(DEFAULTS)}
            <p class="muted" style="font-size:12px">Cəkpot məbləği hər rəqibdən tutulur, rəqibin balansı çatmasa yalnız balansı qədər.</p></details>
          <button class="btn green block mt">Otaq yarat</button>
        </form>
      </div>
    </div>
  </div>`;
}

// --------- modal ---------
let modalSeq = 0;
function renderModal() {
  const m = S.modal;
  if (!m._k) m._k = ++modalSeq; // hər yeni pəncərə yeni DOM alır (köhnə pəncərənin yazıları qarışmasın)
  return `<div class="modal-bg" data-key="modal-${m._k}" data-a="closeModalBg"><div class="modal" role="dialog" aria-modal="true">
    <h3>${esc(m.title)}</h3>
    ${m.html ?? `<form data-form="modal">
      ${m.text ? `<p class="muted">${m.text}</p>` : ''}
      ${m.fieldsHTML ?? m.fields.map((f) => f.type === 'select'
        ? `<label>${f.label}</label><select name="${f.name}">${f.options.map(([v, l]) => `<option value="${v}" ${v === f.value ? 'selected' : ''}>${l}</option>`).join('')}</select>`
        : `<label>${f.label}</label><input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.type === 'number' ? 'inputmode="numeric" min="0"' : ''}>`).join('')}
      <div class="row mt"><button type="button" class="btn" data-a="closeModal">Bağla</button><button class="btn primary">${m.submitLabel || 'Yadda saxla'}</button></div>
    </form>`}
    ${m.html ? `<div class="row mt"><button class="btn" data-a="closeModal">Bağla</button></div>` : ''}
  </div></div>`;
}

function openPasswordModal(code, msg) {
  S.modal = { title: '🔒 Şifrəli otaq', kind: 'roomPassword', code, submitLabel: 'Qoşul', text: esc(msg || 'Bu otaq şifrəlidir.'),
    fields: [{ name: 'password', label: 'Otaq şifrəsi', type: 'password' }] };
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
    <h4>🤖 Botlar (${bots.length}) — otaqda ən çox 8 yer</h4>
    ${bots.map((b) => `<div class="row bot-row"><span>🤖 ${esc(b.name)}</span><button type="button" class="btn small red" style="flex:0 0 auto" data-a="removeBot" data-id="${b.id}">Çıxar</button></div>`).join('') || '<p class="muted" style="margin:4px 0">Bot yoxdur.</p>'}
    <button type="button" class="btn small" data-a="addBot" ${room.members.length >= Math.min(8, room.settings.maxPlayers) ? 'disabled' : ''}>+ Bot əlavə et</button>
    <p class="muted" style="font-size:12px">Bot olan otaqda hamı virtual məşq balansı ilə oynayır; əsas balans və statistika dəyişmir.</p>
    <h4>Oyun ayarları</h4>
    ${settingsInputs(room.settings)}` };
  render();
}

async function openNotifications() {
  try {
    const r = await api('/api/notifications');
    S.modal = { title: '🔔 Bildirişlər', html: r.items.map((n) => `<div class="tx ${n.read_at ? '' : 'unread'}"><div>${esc(n.text)}<div class="meta">${fmtDate(n.created_at)}</div></div></div>`).join('') || '<p class="muted">Bildiriş yoxdur.</p>' };
    render();
    await api('/api/notifications/read', {});
    S.unread = 0; updateBell();
  } catch (e) { toast(e.message); }
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
  // avatar ətrafındakı vaxt halqası
  document.querySelectorAll('[data-ring]').forEach((el) => {
    const total = Number(el.dataset.total) * 1000;
    const left = Math.max(0, Number(el.dataset.ring) - now);
    const c = el.querySelector('.prog');
    if (c) c.setAttribute('stroke-dashoffset', String(100 - Math.min(100, (left / total) * 100)));
    el.classList.toggle('late', left < 10_000);
  });
  document.querySelectorAll('[data-secs]').forEach((el) => {
    const left = Math.max(0, Math.ceil((Number(el.dataset.secs) - now) / 1000));
    el.textContent = `${left}${el.dataset.unit || ''}`;
    el.classList.toggle('late', left <= 10);
  });
  document.querySelectorAll('[data-countdown]').forEach((el) => {
    const left = Math.max(0, Math.ceil((Number(el.dataset.countdown) - now) / 1000));
    el.textContent = left > 0 ? `(${left} san)` : '(vaxt bitdi)';
  });
}
setInterval(updateTimers, 250);

// ---------------- hadisələr ----------------
const reloadProfile = () => loadProfile(render);
const reloadAdmin = () => loadAdmin(() => (S.modal ? render() : (document.getElementById('adminList') ? refreshAdminList() : render())));
const byId = (el) => Number(el.dataset.id);

const H = {
  authTab: (el) => { S.authTab = el.dataset.v; render(); },
  logout: async () => { stopVoice(true, true); await api('/api/logout', {}).catch(() => {}); S.user = null; S.view = 'auth'; S.ws?.close(); render(); },
  openAdmin: () => { S.view = 'admin'; render(); reloadAdmin(); },
  closeAdmin: () => { S.view = S.room ? 'room' : 'lobby'; render(); loadRooms(); },
  openProfile: () => { S.view = 'profile'; S.profile = null; render(); reloadProfile(); },
  backLobby: () => { S.view = S.room ? 'room' : 'lobby'; render(); loadRooms(); },
  openNotifications: () => openNotifications(),
  adminTab: (el) => { S.adminTab = el.dataset.v; S.admin.page = 1; S.admin.filter = 'all'; S.admin.q = ''; const s = document.getElementById('adminSearch'); if (s) s.value = ''; render(); reloadAdmin(); },
  txAll: () => { S.admin.txUser = null; reloadAdmin(); },
  playBot: () => {
    const n = Number(document.getElementById('demoBots')?.value || 3);
    if (S.room && !confirm('Hazırkı otaqdan çıxıb demoya keçirsiniz? Raund gedirsə pas sayılacaq.')) return;
    send({ t: 'createRoom', demo: true, bots: n, name: 'Demo' });
  },
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
  voiceToggle: () => toggleVoice(),
  toggleVibrate: () => { const on = toggleVibrate(); toast(on ? 'Növbə vibrasiyası açıldı.' : 'Növbə vibrasiyası söndürüldü.', true); render(); },
  voiceLeave: () => stopVoice(true),
  voicePeerMute: (el) => toggleLocalMute(el.dataset.id),
  start: () => send({ t: 'startRound' }),
  consentYes: (el) => { el.disabled = true; send({ t: 'consent', yes: true }); },
  consentNo: (el) => { el.disabled = true; send({ t: 'consent', yes: false }); },
  settingsModal: () => roomSettingsModal(),
  addBot: () => { send({ t: 'addBot' }); setTimeout(() => S.modal?.kind === 'settings' && roomSettingsModal(), 300); },
  removeBot: (el) => { send({ t: 'removeBot', botId: byId(el) }); setTimeout(() => S.modal?.kind === 'settings' && roomSettingsModal(), 300); },
  betStep: (el) => {
    const r = S.room.round; const step = Math.max(1, S.room.settings.minBet);
    const myBal = r.players.find((p) => p.id === S.user.id)?.balance ?? 0;
    let v = (Number(S.bet) || r.minXod) + step * Number(el.dataset.v);
    v = Math.max(r.minXod, v);
    v = Math.min(v, myBal, r.maxBet > 0 ? Math.max(r.maxBet, r.minXod) : Infinity);
    S.bet = v; render();
  },
  betSet: (el) => { S.bet = Number(el.dataset.v); render(); },
  xod: () => act({ type: 'xod', amount: S.bet }),
  pas: () => { if (confirm('Pas deyirsiniz?')) act({ type: 'pas' }); },
  baxis: () => act({ type: 'baxis', tieOffer: !!S.tieOffer }),
  offerSeka: () => act({ type: 'offerSeka' }),
  offerSplit: () => act({ type: 'offerSplit' }),
  offerAny: () => act({ type: 'offerAny' }),
  offerReply: (el) => act({ type: 'offerReply', choice: el.dataset.v }),
  sekaChoice: (el) => act({ type: 'sekaChoice', choice: el.dataset.v }),
  offerAccept: () => act({ type: 'offerAccept' }),
  offerDecline: () => act({ type: 'offerDecline' }),
  votePas: () => act({ type: 'votePas' }),
  tieAccept: () => act({ type: 'tieAccept' }),
  tieDecline: () => act({ type: 'tieDecline' }),
  tieVote: (el) => act({ type: 'tieVote', choice: el.dataset.v }),
  sekaJoin: () => act({ type: 'sekaJoin' }),
  sekaStart: () => act({ type: 'sekaStart' }),
  sekaSkip: () => act({ type: 'sekaSkip' }),
  creditAccept: (el) => act({ type: 'creditAccept', limit: Number(el.dataset.limit) }),
  creditDecline: () => act({ type: 'creditDecline' }),
  creditOfferModal: () => {
    const r = S.room?.round; const me = r?.me; if (!me) return;
    const d = r.creditDeal;
    const opp = r.players.find((p) => p.id !== S.user.id && p.status === 'active');
    const need = (d ? d.used : 0) + Math.max(me.creditShortfall, r.minXod);
    S.modal = { title: '🤝 Borca oyna', kind: 'creditOffer', submitLabel: 'Təklifi göndər',
      text: `Balansınız: ${fmt(r.players.find((p) => p.id === S.user.id)?.balance ?? 0)}. Xod üçün çatışmayan: <b>${fmt(me.creditShortfall)}</b>.${d ? ` Hazırkı limit: ${fmt(d.limit)} (istifadə ${fmt(d.used)}) — artırmaq üçün ${esc(opp?.name || '')} yenidən təsdiqləməlidir.` : ''}<br>
        ${esc(opp?.name || 'Qarşı tərəf')} qəbul etsə, balansınız bitəndə bu limit daxilində oynayırsınız. Uduzsanız yalnız faktiki istifadə etdiyiniz məbləğ ona borc yazılır; udsanız borc yaranmır. Faiz yoxdur. Cavab 30 saniyədir; rədd və ya cavabsızlıqda balans çatmırsa avtomatik pas olursunuz.`,
      fields: [{ name: 'limit', label: 'Ümumi əlavə risk limiti (xal)', type: 'number', value: Math.ceil(need / 10) * 10 },
        { name: 'dueDays', label: 'Qaytarma müddəti', type: 'select', value: '7', options: [['1', '1 gün'], ['3', '3 gün'], ['7', '7 gün'], ['14', '14 gün'], ['30', '30 gün']] }] };
    render();
  },
  askLoanModal: (el) => {
    const id = Number(el.dataset.id);
    const m = S.room?.members.find((x) => x.id === id);
    S.modal = { title: `💸 ${esc(azAblative(m?.name || ''))} borc istə`, kind: 'askLoan', lenderId: id, submitLabel: 'İstəyi göndər',
      text: `Təsdiqlənənə qədər heç kimin balansı dəyişmir. Təsdiqdə xal onun mövcud balansından sizə keçir. Müddət çatanda qalan borc balansınızdan avtomatik tutulur (çatmasa qismən, qalanı sonra). Faiz yoxdur.`,
      fields: [{ name: 'amount', label: 'Məbləğ (xal)', type: 'number' },
        { name: 'days', label: 'Qaytarma müddəti', type: 'select', value: '7', options: [['1', '1 gün'], ['3', '3 gün'], ['7', '7 gün'], ['14', '14 gün'], ['30', '30 gün']] }] };
    render();
  },
  jackpotOpen: () => { if (confirm('Cəkpotu açırsınız? Raund dərhal bitəcək.')) act({ type: 'jackpotOpen' }); },
  jackpotHide: () => act({ type: 'jackpotHide' }),
  pickCard: (el) => { const i = Number(el.dataset.i); S.pick = S.pick === i ? null : i; render(); },
  discard: () => { if (S.pick != null) act({ type: 'discard', index: S.pick }); },
  emoji: (el) => { send({ t: 'emoji', e: el.dataset.e }); if (S.emojiOpen) { S.emojiOpen = false; render(); } },
  toggleEmoji: () => { S.emojiOpen = !S.emojiOpen; render(); },
  toggleLog: () => { S.logOpen = !S.logOpen; render(); },
  toggleChat: () => {
    S.chatOpen = !S.chatOpen;
    if (S.chatOpen) markChatSeen();
    render();
    if (S.chatOpen) { const l = document.querySelector('.chat-panel .chat-log'); if (l) l.scrollTop = l.scrollHeight; }
  },
  soundTest: () => {
    const r = soundTest();
    toast(r.ok ? `Test səsi çalındı.${r.muted ? ' Oyun səsləri hazırda SÖNDÜRÜLÜB — 🔊 düyməsi ilə açın.' : ''} Eşitmirsinizsə: telefonun səsini və iPhone-da səssiz rejim açarını yoxlayın.` : `Səs işə düşmədi: ${r.reason}`, r.ok);
  },
  playerMenu: (el) => {
    const id = Number(el.dataset.id);
    const m = S.room?.members.find((x) => x.id === id);
    if (!m || m.isBot || S.room.practice) return;
    const online = m.connected === true;
    S.modal = { title: esc(m.name), kind: 'playerMenu', html: `<div class="gift-to">${avatarHTML(m, 'md')}<div><b>${esc(m.name)}</b><div class="muted" style="font-size:12px"><span class="ol-dot inline ${online ? 'on' : 'off'}"></span> ${online ? 'Onlayn' : 'Bağlantı kəsilib'}</div></div></div>
      <div class="pm-actions">
        <button class="btn block" data-a="giftModal" data-id="${id}">🎁 Hədiyyə göndər</button>
        <button class="btn block" data-a="askLoanModal" data-id="${id}">💸 Borc istə</button>
        <button class="btn block" data-a="offerLoanModal" data-id="${id}">🤝 Borc təklif et</button>
      </div>
      <p class="muted" style="font-size:12px">Masadan çıxmırsınız, raund davam edir. Borc yalnız qarşı tərəf qəbul/təsdiq edəndə yaranır. Virtual oyun xalı — real pul deyil, faiz yoxdur.</p>` };
    render();
  },
  offerLoanModal: (el) => {
    const id = Number(el.dataset.id);
    const m = S.room?.members.find((x) => x.id === id);
    S.modal = { title: `🤝 ${esc(dativeName(m?.name || ''))} borc təklif et`, kind: 'offerLoan', borrowerId: id, submitLabel: 'Təklifi göndər',
      text: `${esc(m?.name || '')} qəbul edənə qədər heç nə dəyişmir. Qəbul anında məbləğ balansınızdan çıxır və ona keçir (balansınız o an çatmalıdır). Müddət çatanda qalan borc onun balansından avtomatik tutulur. Faiz yoxdur.`,
      fields: [{ name: 'amount', label: 'Məbləğ (xal)', type: 'number' },
        { name: 'days', label: 'Qaytarma müddəti', type: 'select', value: '7', options: [['1', '1 gün'], ['3', '3 gün'], ['7', '7 gün'], ['14', '14 gün'], ['30', '30 gün']] }] };
    render();
  },
  loansModal: () => { S.modal = loansModalState(); render(); loadPendingLoans(); },
  loanDo: async (el) => {
    const id = Number(el.dataset.id); const op = el.dataset.op;
    const l = (S.pendingLoans || []).find((x) => x.id === id);
    if (op === 'approve' && l && !confirm(`${l.borrowerName}-a ${fmt(l.amount)} verilsin? Məbləğ indi balansınızdan çıxacaq.`)) return;
    if (op === 'accept' && l && !confirm(`${l.lenderName}-dan ${fmt(l.amount)} borcu qəbul edirsiniz? Qaytarma: ${fmtDate(l.dueAt)}.`)) return;
    el.disabled = true;
    try {
      const r = await moneyCall(`loan${op}${id}`, `/api/loans/${id}/${op}`, {});
      if (!r) return;
      toast({ accept: 'Borc qəbul edildi.', decline: 'Rədd edildi.', approve: 'Borc verildi.', reject: 'Rədd edildi.', cancel: 'Təklif ləğv edildi.', withdraw: 'İstək geri götürüldü.' }[op], true);
    } catch (e) { toast(e.message); } finally { await loadPendingLoans(); }
  },
  toggleShowHand: (el) => { S.showHand = S.showHand === el.dataset.hand ? null : el.dataset.hand; render(); },
  toggleAnim: () => { const off = toggleAnimations(); if (off) clearGiftQueue(); toast(off ? 'Animasiyalar söndürüldü.' : 'Animasiyalar açıldı.', true); render(); },
  toggleSound: () => { const m = toggleMute(); toast(m ? 'Səs söndürüldü.' : 'Səs açıldı.', true); render(); },
  closeModal: () => { S.modal = null; render(); },
  closeModalBg: (el, ev) => { if (ev.target === el) { S.modal = null; render(); } },
  creditModal: () => creditModal(render),
  pickRecipient: (el) => pickRecipient(el),
  pwModal: () => {
    S.modal = { title: 'Şifrəni dəyiş', kind: 'password', fields: [
      { name: 'oldPassword', label: 'Mövcud şifrə', type: 'password' },
      { name: 'newPassword', label: 'Yeni şifrə (ən azı 6 simvol)', type: 'password' },
      { name: 'newPassword2', label: 'Yeni şifrə — təkrar', type: 'password' }] };
    render();
  },
  myTx: async () => {
    try { const d = await api('/api/my-transactions'); S.modal = { title: 'Əməliyyatlarım', html: txList(d.items, false) }; render(); } catch (e) { toast(e.message); }
  },
  uStatus: async (el) => {
    const v = el.dataset.v;
    if (v === 'blocked' && !confirm('Bu istifadəçini bloklamaq istəyirsiniz?')) return;
    try { await api(`/api/admin/users/${el.dataset.id}/status`, { status: v }); toast('Yadda saxlanıldı.', true); reloadAdmin(); } catch (e) { toast(e.message); }
  },
  uReset: async (el) => {
    const u = S.admin.users.find((x) => x.id === byId(el));
    if (!confirm(`${u.displayName}: köhnə mənfi balans ${fmt(u.balance)} → 0 xal.\nDüzəliş: +${fmt(-u.balance)}. Tarixçəyə yazılacaq; əvvəlki udma/uduzma tarixçəsi silinmir.\n\nTəsdiq edirsiniz?`)) return;
    try { await api(`/api/admin/users/${u.id}/reset-negative`, { confirm: true }); toast('Mənfi balans sıfırlandı.', true); reloadAdmin(); } catch (e) { toast(e.message); reloadAdmin(); }
  },
  uName: (el) => {
    const u = S.admin.users.find((x) => x.id === byId(el));
    S.modal = { title: 'Adı dəyiş', kind: 'name', id: u.id, fields: [{ name: 'displayName', label: 'Oyunda görünən ad', value: u.displayName }] };
    render();
  },
  uPass: (el) => {
    S.modal = { title: 'Yeni şifrə təyin et', kind: 'upass', id: byId(el), fields: [{ name: 'password', label: 'Yeni şifrə', type: 'text' }] };
    render();
  },
  uRole: (el) => {
    const u = S.admin.users.find((x) => x.id === byId(el));
    S.modal = { title: `Rol: ${u.displayName}`, kind: 'role', id: u.id, text: 'Moderator kredit müraciətlərinə baxa, balans və hədiyyə verə bilər; ayarları və mənfi balans sıfırlamasını yalnız admin edir.',
      fields: [{ name: 'role', label: 'Rol', type: 'select', value: u.role, options: [['player', 'Oyunçu'], ['moderator', 'Moderator'], ['admin', 'Admin']] }] };
    render();
  },
  uTx: (el) => { S.admin.txUser = byId(el); S.adminTab = 'tx'; render(); reloadAdmin(); },
  ...profileHandlers(render, reloadProfile),
  ...giftHandlers(render),
  ...shopHandlers(render, reloadProfile),
  ...loanAskHandlers(() => loadPendingLoans()),
  ...adminHandlers(render, reloadAdmin),
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = H[el.dataset.a];
  if (fn) { if (el.dataset.a !== 'closeModalBg') ev.preventDefault(); Promise.resolve(fn(el, ev)).catch((e) => toast(e.message)); }
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'bet') {
    S.bet = Number(t.value) || 0;
    const b = document.getElementById('xodAmt');
    if (b) b.textContent = fmt(S.bet);
  }
  if (t.id === 'tieOffer') S.tieOffer = t.checked;
  if (t.dataset.search) onSearchInput(t);
  const tgs = t.closest?.('#tgSettings');
  if (tgs) tgs.dataset.dirty = '1';
  if (t.id === 'adminSearch') { S.admin.q = t.value; S.admin.page = 1; refreshAdminList(); }
});
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.id === 'tieOffer') S.tieOffer = t.checked;
  { const tgs = t.closest?.('#tgSettings'); if (tgs) tgs.dataset.dirty = '1'; }
  if (t.id === 'adminFilter') { S.admin.filter = t.value; S.admin.page = 1; refreshAdminList(); }
  if (t.type === 'file' && t.closest('form[data-form="avatar"]')) uploadAvatar(t.files[0], reloadProfile);
  if (t.type === 'file' && t.closest('form[data-form="shopItem"]')) { uploadShopImage(t.closest('form').dataset.id, t.files[0], reloadAdmin); t.value = ''; }
});
document.addEventListener('toggle', (ev) => {
  if (ev.target.id === 'logDetails') S.logOpen = ev.target.open;
  if (ev.target.id === 'chatDetails') S.chatOpen = ev.target.open;
}, true);

const PF = profileForms(render, reloadProfile);
const AF = adminForms(render, reloadAdmin);

document.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('form[data-form]');
  if (!form) return;
  ev.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const kind = form.dataset.form;
  try {
    if (kind === 'login') {
      const r = await api('/api/login', data);
      S.user = r.user; S.view = 'lobby'; render(); connect();
    } else if (kind === 'join') {
      send({ t: 'joinRoom', code: data.code.trim().toUpperCase() });
    } else if (kind === 'create') {
      const settings = {};
      for (const [k] of SETTINGS_FIELDS) settings[k] = data[k];
      send({ t: 'createRoom', name: data.name, visibility: data.visibility, password: data.password, settings });
    } else if (kind === 'chat') {
      const text = String(data.text || '').trim();
      if (!text) return;
      if (send({ t: 'chat', text })) { const i = form.querySelector('input'); i.value = ''; } // fokus onsuz da inputdadır — təkrar focus() çağırılmır
    } else if (PF[kind]) {
      await PF[kind](data, form, ev.submitter);
    } else if (AF[kind]) {
      await AF[kind](data, form, ev.submitter);
    } else if (kind === 'modal') {
      const m = S.modal;
      if (m.kind === 'creditOffer') {
        act({ type: 'creditOffer', limit: Number(data.limit), dueDays: Number(data.dueDays) });
      } else if (m.kind === 'offerLoan') {
        const r = await moneyCall(`offerLoan${m.borrowerId}`, '/api/loans/offer', { borrowerId: m.borrowerId, amount: Number(data.amount), dueAt: Date.now() + Number(data.days) * 86_400_000 });
        if (!r) return;
        toast(`Təklif ${r.borrowerName} üçün göndərildi. Qəbul edəndə xal balansınızdan keçəcək.`, true);
        loadPendingLoans();
      } else if (m.kind === 'askLoan') {
        const r = await moneyCall(`askLoan${m.lenderId}`, '/api/loans/request', { lenderId: m.lenderId, amount: Number(data.amount), dueAt: Date.now() + Number(data.days) * 86_400_000 });
        if (!r) return;
        toast(r.respondBy ? `İstək ${r.lenderName} üçün göndərildi — 10 saniyə ərzində cavab verməlidir.` : `İstək ${r.lenderName} üçün göndərildi. Təsdiqləyəndə xal balansınıza keçəcək.`, true);
        loadPendingLoans();
      } else if (m.kind === 'settings') {
        const settings = {};
        for (const [k] of SETTINGS_FIELDS) settings[k] = data[k];
        send({ t: 'roomMeta', meta: { name: data.name, visibility: data.visibility, password: data.password || '', removePassword: !!data.removePassword } });
        send({ t: 'settings', settings });
      } else if (m.kind === 'roomPassword') {
        send({ t: 'joinRoom', code: m.code, password: data.password });
      } else if (m.kind === 'password') {
        if (data.newPassword !== data.newPassword2) { toast('Yeni şifrələr eyni deyil.'); return; }
        await api('/api/me/account', { currentPassword: data.oldPassword, newPassword: data.newPassword, newPassword2: data.newPassword2 });
        toast('Şifrə dəyişdirildi. Digər cihazlardakı sessiyalar bağlandı.', true);
      }
      else if (m.kind === 'creditRequest') {
        const r = await moneyCall('creditRequest', '/api/credit/request', { amount: Number(data.amount), note: data.note });
        if (!r) return;
        toast('Kredit müraciəti göndərildi. Admin cavab verəndə bildiriş gələcək.', true);
        if (S.view === 'profile') reloadProfile();
      } else if (m.kind === 'name') { await api(`/api/admin/users/${m.id}/name`, data); toast('Ad dəyişdirildi.', true); reloadAdmin(); }
      else if (m.kind === 'upass') { await api(`/api/admin/users/${m.id}/password`, data); toast('Şifrə təyin edildi.', true); }
      else if (m.kind === 'role') { await api(`/api/admin/users/${m.id}/role`, data); toast('Rol dəyişdirildi.', true); reloadAdmin(); }
      else {
        const ok = await adminModalSubmit(m, data);
        if (ok === false) return;
        if (ok) reloadAdmin();
      }
      S.modal = null; render();
    }
  } catch (e) { toast(e.message); }
});

// iPhone klaviaturası açılanda görünən sahənin hündürlüyü (çat sətri klaviaturanın üstündə qalsın)
// Məcburi scrollTo yoxdur (iPhone-da klaviatura açılanda təkrarlanan sürüşmə yaradırdı); dəyər yalnız dəyişəndə yazılır.
let vvhRaf = 0; let lastVvh = 0;
function syncViewport() {
  if (vvhRaf) return;
  vvhRaf = requestAnimationFrame(() => {
    vvhRaf = 0;
    const vv = window.visualViewport;
    const h = Math.round(vv ? vv.height : window.innerHeight);
    if (Math.abs(h - lastVvh) < 2) return;
    lastVvh = h;
    document.documentElement.style.setProperty('--vvh', `${h}px`);
  });
}
function isTyping() {
  const a = document.activeElement;
  return !!a && (a.nodeName === 'INPUT' || a.nodeName === 'TEXTAREA') && a.type !== 'checkbox' && a.type !== 'radio';
}
window.visualViewport?.addEventListener('resize', syncViewport);
window.visualViewport?.addEventListener('scroll', syncViewport);
window.addEventListener('resize', syncViewport);
window.addEventListener('orientationchange', () => setTimeout(() => { syncViewport(); if (S.view === 'room') render(); }, 250));
syncViewport();
installPeek({ onPeekedAll: () => { if (S.view === 'room') render(); } });

// ---------------- başlanğıc ----------------
(async () => {
  try {
    const r = await api('/api/me');
    if (r.user) { S.user = r.user; S.view = 'lobby'; connect(); } else S.view = 'auth';
  } catch { S.view = 'auth'; }
  render();
  loadRooms();
})();

export { STATS_NOTE, fmtCents, isAdmin, azLower };
