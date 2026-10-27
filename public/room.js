// Oyun masası — ayrı-ayrı işlək komponentlər: üst panel, oval masa, oturacaqlar (avatar + vaxt halqası),
// bank (virtual əskinaslar + dəqiq məbləğ), öz kartlarım, idarə düymələri, emoji/çat paneli.
// Bütün ad və məbləğlər serverdən gələn real vəziyyətdən götürülür.
import { cardSVG, cardBackSVG } from './cards.js';
import { score3 } from './score.js';
import { potStackHTML, noteSVG } from './notes.js';
import { isMuted } from './sound.js';
import { flipKey } from './fx.js';
import { S, esc, fmt, avatarHTML, deadlineSpan, isDemo } from './core.js';

export const EMOJIS = ['😂', '😎', '😡', '👏', '🤝', '🔥', '😭'];
const BUBBLE_MS = 3000;

function seatList(room) {
  const r = room.round;
  const byId = new Map(room.members.map((m) => [m.id, m]));
  const list = [];
  if (r) {
    for (const p of r.players) {
      const m = byId.get(p.id);
      list.push({ ...p, isBot: m?.isBot ?? p.id < 0, connected: m ? m.connected : false, inRoom: !!m, balance: m ? m.balance : p.balance, avatarVer: m?.avatarVer || 0 });
    }
    for (const m of room.members) if (!r.players.some((p) => p.id === m.id)) list.push({ ...m, inHand: false, status: 'wait', inRoom: true, put: 0 });
  } else {
    for (const m of room.members) list.push({ ...m, inHand: false, status: 'wait', inRoom: true, put: 0 });
  }
  return list;
}

function statusTag(p, r) {
  if (r?.result && r.phase === 'finished' && r.result.winners.includes(p.id)) return `<span class="tag win">+${fmt(r.result.payouts[p.id] || 0)}</span>`;
  if (!p.inRoom) return `<span class="tag folded">Çıxıb</span>`;
  if (r?.phase === 'discard' && p.inHand && p.status === 'active') return p.discarded ? `<span class="tag var">Seçdi</span>` : `<span class="tag yox">Seçir…</span>`;
  switch (p.status) {
    case 'active': return '';
    case 'folded': return `<span class="tag folded">Pas</span>`;
    case 'lost': return `<span class="tag lost">Uduzdu</span>`;
    case 'attached': return `<span class="tag attached">Şərik</span>`;
    default: return r ? `<span class="tag wait">Gözləyir</span>` : '';
  }
}

// ---------------- emoji / çat balonu (avatarın üzərində 3 saniyə) ----------------
export function bubbleHTML(userId) {
  const b = S.bubbles.get(userId);
  if (!b || Date.now() - b.at > BUBBLE_MS) return '';
  const el = Date.now() - b.at;
  return `<div class="bubble ${b.kind}" style="animation-delay:-${el}ms">${esc(b.value)}</div>`;
}

export function showBubble(msg) {
  S.bubbles.set(msg.userId, { kind: msg.kind, value: msg.value, at: Date.now() });
  if (msg.kind === 'text' && S.room) {
    S.room.chatMsgs = [...(S.room.chatMsgs || []), { userId: msg.userId, name: msg.name, text: msg.value }].slice(-30);
  }
  // masanı yenidən çəkmirik (formalar, seçimlər, yazılan mətn sıfırlanmasın) — yalnız balonu yerinə qoyuruq
  const holder = document.querySelector(`[data-seat="${msg.userId}"] .bubble-slot`);
  if (holder) holder.innerHTML = bubbleHTML(msg.userId);
  if (msg.kind === 'text') {
    const log = document.getElementById('chatLog');
    if (log) {
      log.querySelector('.muted')?.remove();
      const d = document.createElement('div');
      d.innerHTML = `<b>${esc(msg.name || '')}:</b> ${esc(msg.value)}`;
      log.appendChild(d); log.scrollTop = log.scrollHeight;
    }
  }
  setTimeout(() => {
    const cur = S.bubbles.get(msg.userId);
    if (cur && Date.now() - cur.at >= BUBBLE_MS - 50) {
      S.bubbles.delete(msg.userId);
      const h = document.querySelector(`[data-seat="${msg.userId}"] .bubble-slot`);
      if (h) h.innerHTML = '';
    }
  }, BUBBLE_MS);
}

// ---------------- üst panel ----------------
function roomBar(room, fs) {
  const me = room.members.find((m) => m.id === S.user.id);
  const practice = room.practice;
  const bal = practice ? (me?.balance ?? 0) : S.user.balance;
  const canCredit = !practice && !isDemo();
  return `<header class="rbar">
    <button class="rb-btn" data-a="leave" aria-label="Otaqdan çıx" title="Otaqdan çıx">‹</button>
    <div class="rb-title"><b>${esc(room.name)}${room.visibility === 'private' ? ' <span title="Gizli otaq">🙈</span>' : ''}</b>
      <small>${room.members.length}/${room.settings.maxPlayers} oyunçu · Seka${room.demo ? ' · Demo' : practice ? ' · Məşq' : ''}</small></div>
    <button class="rb-code" data-a="copyCode" title="Kodu kopyala" aria-label="Otaq kodu ${room.code}, kopyala">${room.hasPassword ? '🔒' : ''}${room.code}<span aria-hidden="true">⧉</span></button>
    <div class="rb-bal ${practice ? 'practice' : ''}">
      <div class="rb-bal-txt"><small>${practice ? 'Məşq balansı' : 'Virtual oyun balansı'}</small>
        <b ${practice ? '' : 'id="myBalance"'} class="${bal < 0 ? 'neg' : ''}">${fmt(bal)}</b></div>
      ${canCredit ? '<button class="rb-plus" data-a="creditModal" aria-label="Kredit istə" title="Kredit istə">+</button>' : ''}
    </div>
    <button class="rb-btn" data-a="toggleSound" aria-label="${isMuted() ? 'Səsi aç' : 'Səsi söndür'}" title="${isMuted() ? 'Səsi aç' : 'Səsi söndür'}">${isMuted() ? '🔇' : '🔊'}</button>
    <button class="rb-btn" data-a="${fs ? 'fsExit' : 'fsEnter'}" aria-label="${fs ? 'Tam ekrandan çıx' : 'Tam ekran'}" title="${fs ? 'Tam ekrandan çıx' : 'Tam ekran'}">${fs ? '⤡' : '⤢'}</button>
    <button class="rb-btn bell" data-a="openNotifications" aria-label="Bildirişlər">🔔<span id="bellCount" class="bell-count ${S.unread > 0 ? '' : 'hidden'}">${S.unread || ''}</span></button>
  </header>`;
}

// ---------------- oturacaq ----------------
function ring(deadline, totalSec) {
  return `<svg class="ring" viewBox="0 0 60 60" data-ring="${deadline}" data-total="${totalSec}" aria-hidden="true">
    <circle class="trk" cx="30" cy="30" r="27.5"/><circle class="prog" cx="30" cy="30" r="27.5" pathLength="100" stroke-dasharray="100" stroke-dashoffset="0"/></svg>
    <span class="cd" data-secs="${deadline}"></span>`;
}

function seatTimer(p, r, room) {
  if (!r) return '';
  if (r.phase === 'betting' && r.turn === p.id) return ring(r.turnDeadline, room.settings.turnSeconds);
  if (r.phase === 'discard' && p.inHand && p.status === 'active' && !p.discarded) return ring(r.discardDeadline, 30);
  return '';
}

// Öz yerim: avatar (vaxt halqası, emoji/çat balonu) + kartlarım + xal
function meZone(room, seats, handHTML) {
  const p = seats.find((x) => x.id === S.user.id);
  if (!p) return handHTML ? `<div class="mezone">${handHTML}</div>` : '';
  const r = room.round;
  const isTurn = r && r.phase === 'betting' && r.turn === p.id;
  const won = r?.phase === 'finished' && r.result && r.result.how !== 'aborted' && r.result.winners.includes(p.id);
  return `<div class="mezone">
    <div class="me-seat ${isTurn ? 'turn' : ''} ${won ? 'won' : ''}" data-seat="${p.id}">
      <div class="av">${seatTimer(p, r, room)}${avatarHTML(p, 'seat-av')}
        ${room.hostId === p.id ? '<span class="host" title="Otaq sahibi">👑</span>' : ''}
        <div class="bubble-slot">${bubbleHTML(p.id)}</div></div>
      <div class="nm-pill">${esc(p.name)}</div>
      ${statusTag(p, r)}
    </div>
    ${handHTML}
  </div>`;
}

const tagSvg = (svg, attr) => svg.replace('<svg ', `<svg ${attr} `);

function renderSeat(p, i, n, myIdx, room, ord) {
  const r = room.round;
  const ang = ((90 + ((i - myIdx) * 360) / n) * Math.PI) / 180;
  const cx = Math.cos(ang);
  const cy = Math.sin(ang);
  const x = 50 + 50 * cx;
  const y = 50 + 50 * cy;
  const isMe = p.id === S.user.id;
  if (isMe) return ''; // öz yerim masanın altındakı "mezone"-dadır
  const isTurn = r && r.phase === 'betting' && r.turn === p.id;
  const choosing = r && r.phase === 'discard' && p.inHand && p.status === 'active' && !p.discarded;
  const out = ['folded', 'lost', 'out'].includes(p.status);
  const won = r?.phase === 'finished' && r.result && r.result.how !== 'aborted' && r.result.winners.includes(p.id);
  // kartlar masanın mərkəzinə doğru (yuxarı oturacaqlarda ad lövhəsi altda olduğu üçün bir az uzaq)
  const dist = cy < -0.3 ? 92 : n >= 6 ? 46 : 56;
  const dx = Math.round(-cx * dist);
  const dy = Math.round(-cy * dist);
  let cards = '';
  if (p.inHand && !isMe) {
    if (p.cards) cards = p.cards.map((c) => tagSvg(cardSVG(c), `data-flip="${flipKey(r.handNo, p.id)}"`)).join('');
    else cards = Array.from({ length: p.cardCount }, (_, j) => tagSvg(cardBackSVG(), `data-deal="${j * ord.n + ord.idx}"`)).join('');
  }
  const stakeNote = p.put >= 100 ? 100 : p.put >= 50 ? 50 : p.put >= 20 ? 20 : p.put >= 10 ? 10 : p.put >= 5 ? 5 : 1;
  const stake = r && p.put > 0 && r.phase !== 'finished' && !isMe ? `<div class="stake">${noteSVG(stakeNote)}<b>${fmt(p.put)}</b></div>` : '';
  const timer = seatTimer(p, r, room);
  return `<div class="seat ${isMe ? 'me' : ''} ${isTurn ? 'turn' : ''} ${out ? 'out' : ''} ${won ? 'won' : ''} ${p.connected ? '' : 'offline'}"
      style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%" data-seat="${p.id}">
    ${cards || stake ? `<div class="seat-cards ${cy < -0.3 ? 'top' : ''}" style="--dx:${dx}px;--dy:${dy}px">${cards ? `<div class="sc-row">${cards}</div>` : ''}
      ${p.score != null && !isMe ? `<span class="sc-score">${p.score} xal</span>` : ''}${stake}</div>` : ''}
    <div class="av">
      ${timer}
      ${avatarHTML(p, 'seat-av')}
      ${room.hostId === p.id ? '<span class="host" title="Otaq sahibi">👑</span>' : ''}
      ${p.isBot ? '<span class="botmark" title="Bot">BOT</span>' : ''}
      <div class="bubble-slot">${bubbleHTML(p.id)}</div>
    </div>
    <div class="nm-pill">${esc(p.name)}${isMe ? ' <small>(siz)</small>' : ''}</div>
    <div class="bal-pill ${p.balance < 0 ? 'neg' : ''}">${fmt(p.balance)}</div>
    ${statusTag(p, r)}
  </div>`;
}

// ---------------- masanın mərkəzi ----------------
function centerHTML(room) {
  const r = room.round;
  const s = room.settings;
  if (!r) {
    return `<div class="ctr idle">
      <div class="deck" id="deckAnchor">${cardBackSVG()}${cardBackSVG()}</div>
      <div class="idle-info"><b>Oyunçular: ${room.members.length}/${s.maxPlayers}</b>
      <span>Oyun haqqı ${fmt(s.ante)} · Min xod ${fmt(s.minBet)}${s.maxBet ? ` · Maks ${fmt(s.maxBet)}` : ''}</span>
      ${s.jackpotSix || s.jackpotAce ? `<span>Cəkpot (hər rəqibdən): 3×6 — ${fmt(s.jackpotSix)} · 3 Tuz — ${fmt(s.jackpotAce)}</span>` : ''}</div>
      <div id="potAnchor" class="pot-anchor"></div></div>`;
  }
  let banner = '';
  if (r.phase === 'finished' && r.result) {
    const names = r.result.winners.map((id) => esc(r.players.find((p) => p.id === id)?.name)).join(' və ');
    const how = { jackpot: '🎉 CƏKPOT · ', split: 'Bank bölündü · ', aborted: 'Raund ləğv edildi' }[r.result.how] ?? '🏆 ';
    banner = `<div class="result-banner">${how}${r.result.how === 'aborted' ? '' : names}</div>`;
  }
  return `<div class="ctr">
    ${r.isSeka || r.phase === 'sekaJoin' ? '<div class="seka-badge">SEKA</div>' : ''}
    <div class="pot-row">
      <div class="deck" id="deckAnchor">${cardBackSVG()}${cardBackSVG()}</div>
      <div class="pot-notes" id="potAnchor">${potStackHTML(r.pot)}</div>
    </div>
    <div class="bankbox"><small>BANK</small><b>${fmt(r.pot)}</b><i>Virtual oyun balansı</i></div>
    ${r.phase === 'betting' ? `<div class="cur-bet">Cari xod: <b>${fmt(Math.max(r.currentBet, r.minXod))}</b></div>` : ''}
    ${banner}
  </div>`;
}

// ---------------- nəticə ----------------
function resultHTML(r) {
  if (!r?.result || r.phase !== 'finished') return '';
  const res = r.result;
  const nameOf = (id) => esc(r.players.find((p) => p.id === id)?.name ?? '?');
  let html = '<div class="result-box">';
  if (res.how === 'aborted') html += '<b>Raund ləğv edildi</b> — qoyulan məbləğlər geri qaytarıldı.';
  else {
    html += `<div><b>${{ jackpot: '🎉 Cəkpot', split: 'Bank bölündü', compare: 'Baxışma ilə qalib', last: 'Qalib (digərləri pas dedi)' }[res.how] || 'Qalib'}:</b> `
      + res.winners.map((id) => `${nameOf(id)} <span class="plus">+${fmt(res.payouts[id] || 0)}</span> bank`).join(', ') + '</div>';
    for (const j of res.jackpots || []) {
      html += `<div class="jp-box"><b>${j.kind === 'ace' ? '3 Tuz' : '3 dənə 6'} cəkpotu — ${esc(j.name)}</b>: rəqiblərdən faktiki ödənilən cəmi <b class="plus">${fmt(j.total)}</b>
        <div class="meta">${j.payments.map((p) => `${esc(p.name)}: ${fmt(p.paid)}${p.paid < p.declared ? ` (elan: ${fmt(p.declared)}, balans çatmadı)` : ''}`).join(' · ') || 'rəqib yoxdur'}</div></div>`;
    }
    // açılan kartlar masada oyunçunun yanında görünür; burada yalnız qısa xülasə
    if (res.shown?.length) {
      html += '<div class="shown-line">' + res.shown.map((x) => `<span class="${res.winners.includes(x.id) ? 'w' : ''}">${esc(x.name)} — ${x.score} xal${res.winners.includes(x.id) ? ' 🏆' : ''}</span>`).join(' · ') + '</div>';
    } else if (res.how === 'last' || res.how === 'split') {
      html += '<div class="muted" style="font-size:13px">Kartlar açılmadı.</div>';
    }
  }
  return html + '</div>';
}

// balans çatmayanda: masadan çıxmadan kredit istəmək və ya demoya keçmək
function lowBalanceHTML(need) {
  return `<div class="notice low-bal">Virtual balansınız (${fmt(S.user.balance)}) ${fmt(need)} üçün çatmır.
    <div class="row mt"><button class="btn primary" data-a="creditModal">💳 Kredit istə</button><button class="btn" data-a="playBot">🤖 Demo oyna</button></div></div>`;
}

// ---------------- idarə düymələri ----------------
function actionsHTML(room) {
  if (room.dbWaiting) {
    return `<div class="notice db-wait">⏳ <b>Baza bağlantısı gözlənilir.</b> Son hərəkət hələ yadda saxlanılmayıb, ona görə oyun müvəqqəti dayandırılıb. Bağlantı bərpa olunan kimi avtomatik davam edəcək — heç nə etməyin.
      <div class="muted" style="font-size:12px;margin-top:4px">Cəhd: ${room.dbWaiting.attempts}. Gözləmə vaxtı növbə vaxtınızdan çıxılmır.</div></div>`;
  }
  const r = room.round;
  const me = r?.me;
  const uid = S.user.id;
  const nameOf = (id) => esc(r?.players.find((p) => p.id === id)?.name ?? '?');
  const real = !room.practice;

  const hostControls = () => {
    const low = real && S.user.balance < room.settings.ante ? lowBalanceHTML(room.settings.ante) : '';
    return low + (room.isHost
      ? `<div class="big2"><button class="bb start" data-a="start" ${room.members.length < 2 ? 'disabled' : ''}>${r ? 'Növbəti raund' : 'Raundu başlat'}</button>
         <button class="bb gear" data-a="settingsModal" aria-label="Otaq ayarları">⚙️<span class="lbl"> Ayarlar</span></button></div>
         ${room.members.length < 2 ? `<div class="notice">Ən azı 2 oyunçu lazımdır. Kodu dostlarınıza göndərin (<b>${room.code}</b>) və ya ⚙️ Ayarlardan 🤖 bot əlavə edin.</div>` : ''}`
      : `<div class="notice">Otaq sahibinin raundu başlatmasını gözləyin…</div>`);
  };

  // gizli 3 Tuz — yalnız sahibinə görünür
  const sj = me?.secretJackpot;
  const secret = sj ? `<div class="secret-jp">🎉 <b>Sizdə 3 Tuz var!</b> Cəkpot: hər rəqibdən ${fmt(sj.amount)} (balansı qədər). ${sj.decided ? 'Gizli saxlayırsınız — istədiyiniz an aça bilərsiniz; raundun sonunda avtomatik açılacaq.' : 'Seçin:'}
    <div class="row mt"><button class="btn primary" data-a="jackpotOpen">Cəkpotu aç</button>${sj.decided ? '' : '<button class="btn" data-a="jackpotHide">Gizli saxla, davam et</button>'}</div>
    <div class="muted" style="font-size:12px">Cəkpot sahibi pas edə bilməz. Vaxt bitsə və ya xoda balans çatmasa cəkpot avtomatik açılır.</div></div>` : '';

  if (!r || r.phase === 'finished') return resultHTML(r) + hostControls();

  if (r.phase === 'discard') {
    if (me?.mustDiscard) {
      const sel = S.pick;
      return `<div class="notice">Atmaq istədiyiniz <b>1 kartı</b> seçin, qalan 3 kartla oynayacaqsınız. ${deadlineSpan(r.discardDeadline)}<br>
        <span class="muted" style="font-size:12px">Vaxt bitsə 4-cü kart avtomatik atılır.</span></div>
        <button class="bb xod wide" data-a="discard" ${sel == null ? 'disabled' : ''}>${sel == null ? 'Kart seçin' : 'Seçilmiş kartı at'}</button>`;
    }
    return `<div class="notice">Digər oyunçular kartlarını seçir… ${deadlineSpan(r.discardDeadline)}</div>`;
  }

  if (r.phase === 'betting') {
    if (me?.isTurn) {
      const min = r.minXod;
      const myBal = r.players.find((p) => p.id === uid)?.balance ?? 0;
      const max = Math.min(myBal, r.maxBet > 0 ? Math.max(r.maxBet, min) : Infinity);
      if (S.bet == null || S.bet < min || S.bet > max) S.bet = Math.min(min, max);
      const low = !me.canAffordMin ? (real ? lowBalanceHTML(min) : `<div class="notice">Məşq balansınız ${fmt(min)} üçün çatmır.</div>`) : '';
      const pasBtn = me.canPas
        ? '<button class="bb pas" data-a="pas">Pas</button>'
        : '<button class="bb pas locked" disabled title="Cəkpot sahibi pas edə bilməz">🔒 Pas</button>';
      return `${secret}${low}
        <div class="betline">
          <button class="bl-step" data-a="betStep" data-v="-1" aria-label="Xodu azalt">−</button>
          <label class="bl-val"><small>Xod (oyun xalı)</small>
            <input id="bet" type="number" inputmode="numeric" value="${S.bet}" min="${min}" ${Number.isFinite(max) ? `max="${max}"` : ''} aria-label="Xod məbləği (oyun xalı)"></label>
          <button class="bl-step" data-a="betStep" data-v="1" aria-label="Xodu artır">+</button>
          <button class="bl-q" data-a="betSet" data-v="${min}">Min</button>
          <button class="bl-q" data-a="betSet" data-v="${Number.isFinite(max) ? Math.min(max, min * 2) : min * 2}">×2</button>
        </div>
        <div class="big3">
          ${pasBtn}
          <button class="bb baxis" data-a="baxis" ${me.canBaxis && me.canAffordMin ? '' : 'disabled'}>Baxış<small>${me.canBaxis ? `${nameOf(me.baxisTarget)} · ${fmt(min)}` : 'hələ yox'}</small></button>
          <button class="bb xod" data-a="xod" ${me.canAffordMin ? '' : 'disabled'}>Xod<small id="xodAmt">${fmt(S.bet)}</small></button>
        </div>
        ${me.canBaxis ? '' : `<div class="hint">ℹ️ ${esc(me.baxisHint || 'Baxış hələ mümkün deyil.')}</div>`}
        ${me.canBaxis && r.activeCount > 2 ? `<label class="check"><input type="checkbox" id="tieOffer" ${S.tieOffer ? 'checked' : ''}> Baxışda "eyni xala baxaq" təklif et</label>` : ''}
        ${r.activeCount === 2 ? `<div class="offer2">
          <button class="ob" data-a="offerSeka" ${me.canOffer ? '' : 'disabled'}>🤝 Seka təklif et</button>
          <button class="ob" data-a="offerSplit" ${me.canOffer ? '' : 'disabled'}>½ Bankı bölək</button></div>
          ${me.canOffer ? '' : '<div class="hint">Təklif raundda bir dəfə, 2 oyunçu qalanda və növbə vaxtı bitməmiş edilə bilər.</div>'}` : ''}`;
    }
    if (me?.status === 'active') {
      return `${secret}<div class="notice turn-info">Növbə: <b>${nameOf(r.turn)}</b> ${deadlineSpan(r.turnDeadline)}</div>
        ${me.canVote ? `<button class="bb pas wide" data-a="votePas">${nameOf(r.turn)} üçün "Pas" səsi ver (${r.votes}/${r.votesNeeded})</button>` : ''}`;
    }
    if (me?.status === 'attached') return `<div class="notice">Şəriksiniz: <b>${nameOf(me.attachedTo)}</b> qalib gəlsə bank bölünəcək.</div>`;
    if (me) return `<div class="notice">${me.status === 'folded' ? 'Pas dediniz.' : 'Bu raunddan çıxdınız.'} Növbə: <b>${nameOf(r.turn)}</b></div>`;
    return `<div class="notice">Raund gedir. Növbəti raundu gözləyin.</div>`;
  }

  if (r.phase === 'offer') {
    const p = r.pending;
    const what = p.kind === 'seka' ? 'Seka' : 'bankı yarı bölməyi';
    if (p.to === uid) {
      return `${secret}<div class="notice"><b>${nameOf(p.from)}</b> ${what} təklif edir. ${deadlineSpan(p.deadline)}</div>
        <div class="big2"><button class="bb xod" data-a="offerAccept">Qəbul et</button><button class="bb pas" data-a="offerDecline">Rədd et</button></div>`;
    }
    if (p.from === uid) return `${secret}<div class="notice">Təklifiniz (${what}) göndərildi, cavab gözlənilir… ${deadlineSpan(p.deadline)}</div>`;
    return `<div class="notice">${nameOf(p.from)} ${what} təklif edib, ${nameOf(p.to)} cavab verir… ${deadlineSpan(p.deadline)}</div>`;
  }

  if (r.phase === 'tieOffer') {
    const p = r.pending;
    if (p.o === uid) {
      return `<div class="notice"><b>${nameOf(p.c)}</b> sizinlə baxışır və "eyni xala baxaq" təklif edir. ${deadlineSpan(p.deadline)}</div>
        <div class="big2"><button class="bb xod" data-a="tieAccept">Qəbul et</button><button class="bb pas" data-a="tieDecline">Rədd et</button></div>`;
    }
    return `${secret}<div class="notice">${nameOf(p.o)} bərabərlik təklifinə cavab verir… ${deadlineSpan(p.deadline)}</div>`;
  }

  if (r.phase === 'tieDecision') {
    const p = r.pending;
    const mine = p.a === uid || p.b === uid;
    if (mine && !(p.voted || []).includes(uid)) {
      return `<div class="notice">Xallar bərabərdir (<b>${p.score} xal</b>)! Hər ikiniz "Seka" seçsəniz seka oynanılır, əks halda bank bölünür. ${deadlineSpan(p.deadline)}</div>
        <div class="big2"><button class="bb xod" data-a="tieVote" data-v="seka">Seka</button><button class="bb baxis" data-a="tieVote" data-v="bol">Bankı bölək</button></div>`;
    }
    return `<div class="notice">${nameOf(p.a)} və ${nameOf(p.b)} bərabərdir — qərar gözlənilir… ${deadlineSpan(p.deadline)}</div>`;
  }

  if (r.phase === 'sekaJoin') {
    const sjn = r.sekaJoin;
    const joined = sjn.joined.map(nameOf).join(', ') || 'hələ heç kim';
    let html = `<div class="notice"><b>SEKA!</b> Bank növbəti raunda keçir. Qoşulanlar: ${joined}. ${deadlineSpan(sjn.deadline)}</div>`;
    if (sjn.eligible.includes(uid) && !sjn.joined.includes(uid)) html += `<button class="bb xod wide" data-a="sekaJoin">Sekaya qoşul (${fmt(sjn.cost)})</button>`;
    if (sjn.base.includes(uid)) html += `<button class="bb baxis wide" data-a="sekaStart">Sekanı başlat</button>`;
    return html;
  }
  return '';
}

// ---------------- öz kartlarım ----------------
function myHandHTML(r, ord) {
  const me = r?.me;
  if (!me) return '';
  const deal = (svg, j) => tagSvg(svg, `data-deal="${j * ord.n + ord.idx}"`);
  if (r.phase === 'discard' && me.mustDiscard) {
    const key = `${r.handNo}`;
    if (S.pickKey !== key) { S.pick = null; S.pickKey = key; }
    const keep = S.pick != null ? me.hand.filter((_, i) => i !== S.pick) : null;
    return `<div class="my-hand pick">${me.hand.map((c, i) => `<button class="card-btn ${S.pick === i ? 'selected' : ''}" data-a="pickCard" data-i="${i}" aria-label="kartı seç">${deal(cardSVG(c), i)}${S.pick === i ? '<span class="x">ATILIR</span>' : ''}</button>`).join('')}</div>
      <div class="xal-badge ${keep ? '' : 'dim'}">${keep ? `${score3(keep)} xal` : 'Atılacaq kartı seçin'}</div>`;
  }
  const cards = me.cards || me.hand;
  return `<div class="my-hand">${cards.map((c, j) => `<span class="mh-slot">${deal(cardSVG(c), j)}</span>`).join('')}</div>
    ${me.score != null ? `<div class="xal-badge">${me.score} xal</div>` : ''}
    ${me.discarded ? `<div class="disc" title="Atdığınız kart">${cardSVG(me.discarded)}</div>` : ''}`;
}

// ---------------- emoji / çat paneli ----------------
function socialHTML(room) {
  const msgs = (room.chatMsgs || []).slice(-30);
  const log = (room.round ? room.round.log : room.chat) || [];
  const emojiBtns = EMOJIS.map((e) => `<button class="emoji-btn" data-a="emoji" data-e="${e}" aria-label="emoji ${e}">${e}</button>`).join('');
  return `<div class="sbar">
      <button class="sb-btn emoji-toggle ${S.emojiOpen ? 'on' : ''}" data-a="toggleEmoji" aria-label="Emojilər">😊</button>
      <div class="emoji-inline">${emojiBtns}</div>
      <form data-form="chat" class="chat-form" autocomplete="off">
        <input id="chatInput" name="text" maxlength="120" placeholder="Mesaj yazın…" enterkeyhint="send" aria-label="Çat mesajı">
        <button class="sb-send" aria-label="Göndər">➤</button>
      </form>
      <button class="sb-btn ${S.logOpen ? 'on' : ''}" data-a="toggleLog" aria-label="Çat tarixçəsi və oyun jurnalı">☰</button>
    </div>
    ${S.emojiOpen ? `<div class="emoji-tray">${emojiBtns}</div>` : ''}
    <div class="drawer ${S.logOpen ? '' : 'hidden'}">
      <div class="dr-head"><b>Çat</b><button class="sb-btn" data-a="toggleLog" aria-label="Bağla">✕</button></div>
      <div class="log" id="chatLog">${msgs.map((m) => `<div><b>${esc(m.name)}:</b> ${esc(m.text)}</div>`).join('') || '<div class="muted">Hələ mesaj yoxdur.</div>'}</div>
      <div class="dr-head"><b>Oyun jurnalı</b></div>
      <div class="log">${log.map((l) => `<div>${esc(l.msg)}</div>`).join('')}</div>
    </div>`;
}

export function renderRoom(_topbar, isFs) {
  const room = S.room;
  if (!room) return '';
  const r = room.round;
  const seats = seatList(room);
  let myIdx = seats.findIndex((p) => p.id === S.user.id);
  if (myIdx < 0) myIdx = 0;
  // paylama sırası: kart alan oyunçular arasında ardıcıllıq (animasiya gecikməsi üçün)
  const dealers = seats.filter((p) => p.inHand);
  const ordOf = (id) => ({ n: Math.max(1, dealers.length), idx: Math.max(0, dealers.findIndex((p) => p.id === id)) });
  const handHTML = myHandHTML(r, ordOf(S.user.id));
  return `<div class="room n${seats.length}">
    ${roomBar(room, isFs())}
    ${room.dbWaiting ? '<div class="strip db-wait-banner">⏳ Baza bağlantısı gözlənilir — göstərilən vəziyyət son təsdiqlənmiş vəziyyətdir.</div>' : ''}
    ${room.practice ? `<div class="strip practice">${room.demo ? '🎓 Demo' : '🤖 Məşq'} · məşq balansı — əsas balansa, borclara və statistikaya təsir etmir</div>` : ''}
    <div class="arena">
      <div class="tbl">
        <div class="rim"><div class="felt"><div class="wm">SEKA</div>${centerHTML(room)}</div></div>
        ${seats.map((p, i) => renderSeat(p, i, seats.length, myIdx, room, ordOf(p.id))).join('')}
      </div>
    </div>
    <div class="side">
      ${meZone(room, seats, handHTML)}
      <div class="ctrl">${actionsHTML(room)}</div>
      <div class="social">${socialHTML(room)}</div>
    </div>
  </div>`;
}
