import { cardSVG, cardBackSVG } from './cards.js';

// ---------------- vəziyyət ----------------
const S = {
  view: 'loading', authTab: 'login', user: null, room: null, ws: null, wsRetry: 0,
  bet: null, tieOffer: false, clockOffset: 0, modal: null, logOpen: false,
  adminTab: 'users', adminUsers: [], adminTx: [], adminTxUser: null, handKey: '', revealKey: '',
};
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('az-AZ').replace(/,/g, ' ');
const money = (n) => `<span class="coin ${n < 0 ? 'neg' : ''}">${fmt(n)}</span>`;
const isStaff = () => S.user && (S.user.role === 'admin' || S.user.role === 'moderator');
const SETTINGS_FIELDS = [
  ['ante', 'Oyun haqqı'], ['minBet', 'Minimum xod'], ['maxBet', 'Maksimum xod (0 = limitsiz)'],
  ['jackpotAmount', 'Cəkpot (hər oyunçudan)'], ['turnSeconds', 'Xod vaxtı (saniyə)'],
  ['debtLimit', 'Mənfi balans limiti (0 = limitsiz)'], ['maxPlayers', 'Maks. oyunçu (2–8)'],
];
const DEFAULTS = { ante: 10, minBet: 10, maxBet: 0, jackpotAmount: 100, turnSeconds: 60, debtLimit: 0, maxPlayers: 8 };

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
    } else if (m.t === 'room') {
      S.room = m.room;
      S.clockOffset = m.room.serverNow - Date.now();
      if (S.view !== 'admin') S.view = 'room';
      const me = m.room.members.find((x) => x.id === S.user?.id);
      if (me && S.user) S.user.balance = me.balance;
      render();
    } else if (m.t === 'left') {
      S.room = null; S.bet = null;
      if (S.view === 'room') S.view = 'lobby';
      render();
    } else if (m.t === 'balance') {
      if (S.user) S.user.balance = m.balance;
      if (S.view !== 'room') render();
    } else if (m.t === 'error') {
      toast(m.msg);
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
  if (S.ws?.readyState === 1) S.ws.send(JSON.stringify(msg));
  else toast('Serverlə əlaqə yoxdur, yenidən qoşulur...');
};
const act = (action) => send({ t: 'act', action });

// ---------------- render ----------------
function render() {
  const active = document.activeElement;
  const keep = active?.id ? { id: active.id, s: active.selectionStart, e: active.selectionEnd } : null;
  let html = '';
  if (S.view === 'loading') html = `<div class="wrap center muted" style="margin-top:30vh">Yüklənir...</div>`;
  else if (S.view === 'auth') html = renderAuth();
  else if (S.view === 'lobby') html = renderLobby();
  else if (S.view === 'room') html = renderRoom();
  else if (S.view === 'admin') html = renderAdmin();
  if (S.modal) html += renderModal();
  $app.innerHTML = html;
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch { /* number input */ } }
  }
  const log = document.querySelector('.log');
  if (log) log.scrollTop = log.scrollHeight;
  updateTimers();
}

function topbar(extra = '') {
  return `<div class="topbar">
    <div class="logo">SEKA</div>
    <div class="spacer"></div>
    ${extra}
    ${S.user ? `<span class="chip">${money(S.user.balance)}</span>` : ''}
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
        <p class="muted center" style="font-size:13px">Qeydiyyatdan sonra hesabınızı admin təsdiq etməlidir.</p>
      </form>`}
    </div>
  </div>`;
}

function settingsInputs(s) {
  return `<div class="settings-grid">${SETTINGS_FIELDS.map(([k, l]) =>
    `<div><label>${l}</label><input name="${k}" type="number" inputmode="numeric" value="${esc(s[k])}"></div>`).join('')}</div>`;
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
        <div class="muted">Balans: ${money(u.balance)}</div></div>
        <div style="flex:0 0 auto;display:flex;gap:6px">
          <button class="btn small" data-a="myTx">Əməliyyatlarım</button>
          <button class="btn small" data-a="pwModal">Şifrə</button>
        </div>
      </div>
      ${u.balance <= 0 ? `<p class="muted" style="margin-bottom:0">Balansınızı artırmaq üçün adminə müraciət edin.</p>` : ''}
    </div>
    <div class="grid2">
      <div class="card-panel">
        <h2>Otağa qoşul</h2>
        <form data-form="join">
          <label>Otaq kodu</label>
          <input name="code" placeholder="məs. K7P2Q" maxlength="5" autocapitalize="characters" style="text-transform:uppercase;font-size:22px;text-align:center;letter-spacing:6px" required>
          <button class="btn primary block mt">Qoşul</button>
        </form>
      </div>
      <div class="card-panel">
        <h2>Yeni otaq yarat</h2>
        <form data-form="create">
          ${settingsInputs(DEFAULTS)}
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
      list.push({ ...p, connected: m ? m.connected : false, inRoom: !!m, balance: m ? m.balance : p.balance });
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
  switch (p.status) {
    case 'active': return p.declared === 'var' ? `<span class="tag var">Oyunu var</span>` : p.declared === 'yox' ? `<span class="tag yox">Oyunu yox</span>` : '';
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
      <div class="bal">${money(p.balance)}</div>
      ${statusTag(p, r)} ${p.score != null && !isMe ? `<span class="score">${p.score}</span>` : ''}
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

function deadlineSpan(deadline) { return `<span data-countdown="${deadline}"></span>`; }

function actionsHTML(room) {
  const r = room.round;
  const me = r?.me;
  const s = room.settings;
  const nameOf = (id) => esc(r?.players.find((p) => p.id === id)?.name ?? '?');

  const hostControls = () => room.isHost
    ? `<div class="row"><button class="btn primary" data-a="start" ${room.members.length < 2 ? 'disabled' : ''}>${r ? 'Növbəti raund' : 'Raundu başlat'}</button>
       <button class="btn" data-a="settingsModal" style="flex:0 0 auto">⚙️ Ayarlar</button></div>
       ${room.members.length < 2 ? `<div class="notice">Ən azı 2 oyunçu lazımdır. Otaq kodunu dostlarınıza göndərin: <b>${room.code}</b></div>` : ''}`
    : `<div class="notice">Otaq sahibinin raundu başlatmasını gözləyin...</div>`;

  if (!r || r.phase === 'finished') return hostControls();

  if (r.phase === 'betting') {
    if (me?.isTurn) {
      const min = r.minXod;
      const max = r.maxBet > 0 ? Math.max(r.maxBet, min) : null;
      if (S.bet == null || S.bet < min || (max && S.bet > max)) S.bet = min;
      const activeCount = r.players.filter((p) => p.status === 'active').length;
      return `
        <div class="bet-row">
          <button class="btn" data-a="betStep" data-v="-1">−</button>
          <input id="bet" type="number" inputmode="numeric" value="${S.bet}" min="${min}" ${max ? `max="${max}"` : ''}>
          <button class="btn" data-a="betStep" data-v="1">+</button>
        </div>
        <div class="quick">
          <button class="btn small" data-a="betSet" data-v="${min}">Min</button>
          <button class="btn small" data-a="betSet" data-v="${max ? Math.min(max, min * 2) : min * 2}">×2</button>
          ${max ? `<button class="btn small" data-a="betSet" data-v="${max}">Maks</button>` : `<button class="btn small" data-a="betSet" data-v="${min * 5}">×5</button>`}
        </div>
        <button class="btn green block" data-a="xod">Xod et: ${fmt(S.bet)}</button>
        <div class="row">
          ${me.canYox ? `<button class="btn" data-a="yox">Oyunum yoxdur (${fmt(min)})</button>` : ''}
          ${me.canBaxis ? `<button class="btn blue" data-a="baxis">Baxış: ${nameOf(me.baxisTarget)} (${fmt(min)})</button>` : ''}
          <button class="btn red" data-a="pas">Pas</button>
        </div>
        ${me.canBaxis && activeCount > 2 ? `<label class="check"><input type="checkbox" id="tieOffer" ${S.tieOffer ? 'checked' : ''}> Baxışda "eyni xala baxaq" təklif et</label>` : ''}`;
    }
    if (me?.status === 'active') {
      return `<div class="notice">Növbə: <b>${nameOf(r.turn)}</b> ${deadlineSpan(r.turnDeadline)}</div>
        ${me.canVote ? `<button class="btn red block" data-a="votePas">${nameOf(r.turn)} üçün "Pas" səsi ver (${r.votes}/${r.votesNeeded})</button>` : ''}`;
    }
    if (me?.status === 'attached') {
      const myAttach = r.players.find((x) => x.id === S.user.id)?.attachedTo;
      const partner = r.players.find((p) => p.id === myAttach);
      return `<div class="notice">Şəriksiniz: <b>${esc(partner?.name ?? '')}</b> qalib gəlsə bank bölünəcək.</div>`;
    }
    if (me) return `<div class="notice">${me.status === 'folded' ? 'Pas dediniz.' : 'Bu raunddan çıxdınız.'} Növbə: <b>${nameOf(r.turn)}</b></div>`;
    return `<div class="notice">Raund gedir. Növbəti raundu gözləyin.</div>`;
  }

  if (r.phase === 'tieOffer') {
    const p = r.pending;
    if (p.o === S.user.id) {
      return `<div class="notice"><b>${nameOf(p.c)}</b> sizinlə baxışır və "eyni xala baxaq" təklif edir. ${deadlineSpan(p.deadline)}</div>
        <div class="row"><button class="btn green" data-a="tieAccept">Qəbul et</button><button class="btn red" data-a="tieDecline">Rədd et</button></div>`;
    }
    return `<div class="notice">${nameOf(p.o)} bərabərlik təklifinə cavab verir... ${deadlineSpan(p.deadline)}</div>`;
  }

  if (r.phase === 'tieDecision') {
    const p = r.pending;
    const mine = p.a === S.user.id || p.b === S.user.id;
    if (mine && !p.votes.map(String).includes(String(S.user.id))) {
      return `<div class="notice">Xallar bərabərdir (<b>${p.score}</b>)! Hər ikiniz "Seka" seçsəniz seka oynanılır, əks halda bank bölünür. ${deadlineSpan(p.deadline)}</div>
        <div class="row"><button class="btn primary" data-a="tieVote" data-v="seka">Seka</button><button class="btn" data-a="tieVote" data-v="bol">Bankı bölək</button></div>`;
    }
    return `<div class="notice">${nameOf(p.a)} və ${nameOf(p.b)} bərabərdir — qərar gözlənilir... ${deadlineSpan(p.deadline)}</div>`;
  }

  if (r.phase === 'sekaJoin') {
    const sj = r.sekaJoin;
    const uid = S.user.id;
    const joined = sj.joined.map(nameOf).join(', ') || 'hələ heç kim';
    let html = `<div class="notice"><b>SEKA!</b> Bank növbəti raunda keçir. Qoşulanlar: ${joined}. ${deadlineSpan(sj.deadline)}</div>`;
    if (sj.eligible.includes(uid) && !sj.joined.includes(uid)) html += `<button class="btn primary block" data-a="sekaJoin">Sekaya qoşul (${fmt(sj.cost)})</button>`;
    if (sj.base.includes(uid)) html += `<button class="btn green block" data-a="sekaStart">Sekanı başlat</button>`;
    return html;
  }
  return '';
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
  const me = r?.me;
  const myCards = me?.cards
    ? `<div class="my-hand">${me.cards.map((c, i) => cardSVG(c, dealCls)).join('')}</div>
       <div class="my-info">Xalınız: <span class="score-big">${me.score}</span>${me.cards.length === 4 ? ' <span class="muted">(ən yaxşı 3 kart)</span>' : ''}</div>`
    : '';
  const log = (r ? r.log : room.chat) || [];
  return topbar(`
      <button class="chip gold" data-a="copyCode" title="Kodu kopyala">Otaq: ${room.code} ⧉</button>
      <button class="btn small ghost" data-a="leave">Çıx</button>`) + `
  <div class="room">
    <div class="table-wrap"><div class="table">
      <div class="felt"><div class="felt-center">${centerHTML(room)}</div></div>
      ${seats.map((p, i) => renderSeat(p, i, seats.length, myIdx, room, dealCls)).join('')}
    </div></div>
    <div class="hand-area">
      ${myCards}
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
  const isAdmin = S.user.role === 'admin';
  const pending = S.adminUsers.filter((u) => u.status === 'pending').length;
  let body = '';
  if (S.adminTab === 'users') {
    body = S.adminUsers.map((u) => `
      <div class="user-card ${u.status}">
        <div class="top">
          <div><b>${esc(u.displayName)}</b> <span class="muted">@${esc(u.username)}</span>
          ${u.role !== 'player' ? `<span class="chip" style="font-size:11px;padding:1px 8px">${u.role === 'admin' ? 'Admin' : 'Moderator'}</span>` : ''}</div>
          <span class="status ${u.status}">${{ pending: 'Təsdiq gözləyir', approved: 'Aktiv', blocked: 'Bloklanıb', rejected: 'Rədd edilib' }[u.status]}</span>
        </div>
        <div class="muted" style="font-size:13px">Balans: ${money(u.balance)} ${u.phone ? ` · 📞 ${esc(u.phone)}` : ''} · ${new Date(u.createdAt).toLocaleDateString('az-AZ')}</div>
        <div class="btns">
          ${u.status === 'pending' ? `
            <button class="btn small green" data-a="uStatus" data-id="${u.id}" data-v="approved">Təsdiq et</button>
            <button class="btn small red" data-a="uStatus" data-id="${u.id}" data-v="rejected">Rədd et</button>` : ''}
          ${u.status === 'approved' ? `
            <button class="btn small primary" data-a="uBalance" data-id="${u.id}">± Balans</button>
            <button class="btn small" data-a="uTx" data-id="${u.id}">Əməliyyatlar</button>
            <button class="btn small" data-a="uName" data-id="${u.id}">Ad</button>
            <button class="btn small" data-a="uPass" data-id="${u.id}">Şifrə</button>
            ${isAdmin && u.id !== S.user.id ? `<button class="btn small" data-a="uRole" data-id="${u.id}">Rol</button>` : ''}
            ${u.id !== S.user.id ? `<button class="btn small red" data-a="uStatus" data-id="${u.id}" data-v="blocked">Blokla</button>` : ''}` : ''}
          ${u.status === 'blocked' || u.status === 'rejected' ? `<button class="btn small green" data-a="uStatus" data-id="${u.id}" data-v="approved">Aktivləşdir</button>` : ''}
        </div>
      </div>`).join('') || '<p class="muted">İstifadəçi yoxdur.</p>';
  } else {
    const who = S.adminTxUser ? S.adminUsers.find((u) => u.id === S.adminTxUser) : null;
    body = `${who ? `<div class="row" style="margin-bottom:8px"><b>${esc(who.displayName)}</b><button class="btn small" style="flex:0 0 auto" data-a="txAll">Hamısı</button></div>` : ''}
      ${txList(S.adminTx, true)}`;
  }
  return topbar(`<button class="btn small" data-a="closeAdmin">← Geri</button>`) + `
  <div class="wrap">
    <div class="tabs">
      <button class="btn ${S.adminTab === 'users' ? 'active' : ''}" data-a="adminTab" data-v="users">İstifadəçilər${pending ? ` (${pending} yeni)` : ''}</button>
      <button class="btn ${S.adminTab === 'tx' ? 'active' : ''}" data-a="adminTab" data-v="tx">Əməliyyatlar</button>
    </div>
    <div class="card-panel">${body}</div>
  </div>`;
}

function txList(items, showUser) {
  if (!items.length) return '<p class="muted">Əməliyyat yoxdur.</p>';
  return items.map((t) => `<div class="tx">
    <div>${showUser ? `<b>${esc(t.user_name)}</b> · ` : ''}${esc(t.reason)}${t.room ? ` <span class="muted">[${esc(t.room)}]</span>` : ''}
      <div class="meta">${new Date(Number(t.created_at)).toLocaleString('az-AZ')}${t.by_name ? ` · ${esc(t.by_name)}` : ''} · Qalıq: ${fmt(t.balance_after)}</div></div>
    <div class="d ${t.delta >= 0 ? 'plus' : 'minus'}">${t.delta >= 0 ? '+' : ''}${fmt(t.delta)}</div>
  </div>`).join('');
}

async function loadAdmin() {
  try {
    const [u, t] = await Promise.all([api('/api/admin/users'), api('/api/admin/transactions' + (S.adminTxUser ? `?userId=${S.adminTxUser}` : ''))]);
    S.adminUsers = u.users; S.adminTx = t.items;
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
        : `<label>${f.label}</label><input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.type === 'number' ? 'inputmode="numeric"' : ''}>`).join('')}
      <div class="row mt"><button type="button" class="btn" data-a="closeModal">Bağla</button><button class="btn primary">${m.submitLabel || 'Yadda saxla'}</button></div>
    </form>`}
    ${m.html ? `<div class="row mt"><button class="btn" data-a="closeModal">Bağla</button></div>` : ''}
  </div></div>`;
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
const H = {
  authTab: (el) => { S.authTab = el.dataset.v; render(); },
  logout: async () => { await api('/api/logout', {}).catch(() => {}); S.user = null; S.view = 'auth'; S.ws?.close(); render(); },
  openAdmin: () => { S.view = 'admin'; render(); loadAdmin(); },
  closeAdmin: () => { S.view = S.room ? 'room' : 'lobby'; render(); },
  adminTab: (el) => { S.adminTab = el.dataset.v; render(); loadAdmin(); },
  txAll: () => { S.adminTxUser = null; loadAdmin(); },
  copyCode: async () => {
    const code = S.room.code;
    try { await navigator.clipboard.writeText(code); toast(`Kod kopyalandı: ${code}`, true); } catch { toast(`Otaq kodu: ${code}`, true); }
  },
  leave: () => { if (confirm('Otaqdan çıxmaq istəyirsiniz? Raund gedirsə pas sayılacaq.')) send({ t: 'leaveRoom' }); },
  start: () => send({ t: 'startRound' }),
  settingsModal: () => {
    S.modal = { title: 'Otaq ayarları', kind: 'settings', fieldsHTML: settingsInputs(S.room.settings) };
    render();
  },
  betStep: (el) => {
    const r = S.room.round; const step = Math.max(1, S.room.settings.minBet);
    let v = (Number(S.bet) || r.minXod) + step * Number(el.dataset.v);
    v = Math.max(r.minXod, v); if (r.maxBet > 0) v = Math.min(Math.max(r.maxBet, r.minXod), v);
    S.bet = v; render();
  },
  betSet: (el) => { S.bet = Number(el.dataset.v); render(); },
  xod: () => act({ type: 'xod', amount: S.bet }),
  yox: () => act({ type: 'yox' }),
  pas: () => { if (confirm('Pas deyirsiniz?')) act({ type: 'pas' }); },
  baxis: () => act({ type: 'baxis', tieOffer: !!S.tieOffer }),
  votePas: () => act({ type: 'votePas' }),
  tieAccept: () => act({ type: 'tieAccept' }),
  tieDecline: () => act({ type: 'tieDecline' }),
  tieVote: (el) => act({ type: 'tieVote', choice: el.dataset.v }),
  sekaJoin: () => act({ type: 'sekaJoin' }),
  sekaStart: () => act({ type: 'sekaStart' }),
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
  uStatus: async (el) => {
    const v = el.dataset.v;
    if (v === 'blocked' && !confirm('Bu istifadəçini bloklamaq istəyirsiniz?')) return;
    try { await api(`/api/admin/users/${el.dataset.id}/status`, { status: v }); toast('Yadda saxlanıldı.', true); loadAdmin(); } catch (e) { toast(e.message); }
  },
  uBalance: (el) => {
    const u = S.adminUsers.find((x) => x.id === Number(el.dataset.id));
    S.modal = { title: `Balans: ${u.displayName}`, kind: 'balance', id: u.id, submitLabel: 'Təsdiqlə',
      text: `Hazırkı balans: ${fmt(u.balance)}. Çıxmaq üçün mənfi rəqəm yazın (məs. −500).`,
      fields: [{ name: 'amount', label: 'Məbləğ', type: 'number' }, { name: 'note', label: 'Qeyd (istəyə görə)' }] };
    render();
  },
  uName: (el) => {
    const u = S.adminUsers.find((x) => x.id === Number(el.dataset.id));
    S.modal = { title: 'Adı dəyiş', kind: 'name', id: u.id, fields: [{ name: 'displayName', label: 'Oyunda görünən ad', value: u.displayName }] };
    render();
  },
  uPass: (el) => {
    S.modal = { title: 'Yeni şifrə təyin et', kind: 'upass', id: Number(el.dataset.id), fields: [{ name: 'password', label: 'Yeni şifrə', type: 'text' }] };
    render();
  },
  uRole: (el) => {
    const u = S.adminUsers.find((x) => x.id === Number(el.dataset.id));
    S.modal = { title: `Rol: ${u.displayName}`, kind: 'role', id: u.id, text: 'Moderator istifadəçiləri təsdiq edə və balans artıra bilər.',
      fields: [{ name: 'role', label: 'Rol', type: 'select', value: u.role, options: [['player', 'Oyunçu'], ['moderator', 'Moderator'], ['admin', 'Admin']] }] };
    render();
  },
  uTx: (el) => { S.adminTxUser = Number(el.dataset.id); S.adminTab = 'tx'; render(); loadAdmin(); },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-a]');
  if (!el) return;
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
  const data = Object.fromEntries(new FormData(form));
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
      send({ t: 'createRoom', settings: data });
    } else if (kind === 'modal') {
      const m = S.modal;
      if (m.kind === 'settings') send({ t: 'settings', settings: data });
      else if (m.kind === 'password') { await api('/api/password', data); toast('Şifrə dəyişdirildi.', true); }
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
})();
