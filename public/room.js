// Oyun masası — ayrı-ayrı işlək komponentlər: üst panel, oval masa, oturacaqlar (avatar + vaxt halqası),
// bank (virtual əskinaslar + dəqiq məbləğ), öz kartlarım, idarə düymələri, emoji/çat paneli.
// Bütün ad və məbləğlər serverdən gələn real vəziyyətdən götürülür.
import { cardSVG, cardBackSVG } from './cards.js';
import { score3 } from './score.js';
import { potStackHTML, noteSVG } from './notes.js';
import { isMuted } from './sound.js';
import { animationsOff } from './giftfx.js';
import { flipKey } from './fx.js';
import { decorHTML, FELT_MEDALLION } from './decor.js';
import { peekCardHTML, peekedAll, hintNeeded } from './peek.js';
import { ICON } from './giftfx.js';
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
// Üst panel ikonları — sadə xətti SVG (istinad şəklindəki kimi)
const IC = {
  back: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4l-8 8 8 8"/></svg>',
  sound: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  mute: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  fs: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
  fsx: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></svg>',
  coins: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="#e2bd5a" stroke="#8a6420" stroke-width=".8"><ellipse cx="12" cy="18" rx="8" ry="3"/><path d="M4 18v-2.5c0 1.7 3.6 3 8 3s8-1.3 8-3V18"/><ellipse cx="12" cy="13.5" rx="8" ry="3"/><path d="M4 13.5V11c0 1.7 3.6 3 8 3s8-1.3 8-3v2.5"/><ellipse cx="12" cy="9" rx="8" ry="3"/><path d="M4 9V6.5c0 1.7 3.6 3 8 3s8-1.3 8-3V9"/><ellipse cx="12" cy="5" rx="8" ry="3" fill="#f2d27a"/></g></svg>',
};

function roomBar(room, fs) {
  const me = room.members.find((m) => m.id === S.user.id);
  const practice = room.practice;
  const bal = practice ? (me?.balance ?? 0) : S.user.balance;
  const canCredit = !practice && !isDemo();
  const balInner = `<span class="coin-ico" aria-hidden="true">${IC.coins}</span><b ${practice ? '' : 'id="myBalance"'} class="${bal < 0 ? 'neg' : ''}">${fmt(bal)}</b>`;
  return `<header class="rbar">
    <button class="rb-btn back" data-a="leave" aria-label="Otaqdan çıx" title="Otaqdan çıx">${IC.back}</button>
    <button class="rb-title" data-a="toggleLog" title="Otaq menyusu: oyunçular, bildirişlər, ayarlar, çat" aria-label="${esc(room.name)} — otaq menyusu, ${room.members.length}/${room.settings.maxPlayers} oyunçu"><span class="rb-ppl" aria-hidden="true"><span id="bellCount" class="bell-count ${S.unread > 0 ? '' : 'hidden'}">${S.unread || ''}</span></span><b>${esc(room.name)}</b></button>
    <button class="rb-code" data-a="copyCode" title="Kodu kopyala" aria-label="Otaq kodu ${room.code}, kopyala">${room.hasPassword ? '🔒' : ''}${room.code}</button>
    <span class="rb-gap"></span>
    <button class="rb-btn" data-a="toggleSound" aria-label="${isMuted() ? 'Səsi aç' : 'Səsi söndür'}" title="${isMuted() ? 'Səsi aç' : 'Səsi söndür'}">${isMuted() ? IC.mute : IC.sound}</button>
    <button class="rb-btn" data-a="${fs ? 'fsExit' : 'fsEnter'}" aria-label="${fs ? 'Tam ekrandan çıx' : 'Tam ekran'}" title="${fs ? 'Tam ekrandan çıx' : 'Tam ekran'}">${fs ? IC.fsx : IC.fs}</button>
    ${canCredit
      ? `<button class="rb-bal" data-a="creditModal" title="Virtual oyun balansı — kredit istəmək üçün toxunun" aria-label="Balans ${fmt(bal)}, kredit istə">${balInner}</button>`
      : `<div class="rb-bal practice" title="Məşq balansı">${balInner}</div>`}
  </header>`;
}

// ---------------- oturacaq ----------------
function ring(deadline, totalSec) {
  return `<svg class="ring" viewBox="0 0 60 60" data-ring="${deadline}" data-total="${totalSec}" aria-hidden="true">
    <circle class="trk" cx="30" cy="30" r="27.5"/><circle class="prog" cx="30" cy="30" r="27.5" pathLength="100" stroke-dasharray="100" stroke-dashoffset="0"/></svg>
    <span class="cd" data-secs="${deadline}" data-unit=" san"></span>`;
}

function seatTimer(p, r, room) {
  if (!r) return '';
  if (r.phase === 'betting' && r.turn === p.id) return ring(r.turnDeadline, room.settings.turnSeconds);
  if (r.phase === 'discard' && p.inHand && p.status === 'active' && !p.discarded) return ring(r.discardDeadline, 30);
  return '';
}

const tagSvg = (svg, attr) => svg.replace('<svg ', `<svg ${attr} `);

// Oturacaqlar masanın içində, kənara yaxın. Mənim yerim aşağıda ortadadır, kartlarım masanın aşağı kənarının üstündə.
// İstinad şəklindəki kimi: oturacaqlar masanın içində, kənarlara yaxın. Sıra saat əqrəbi istiqamətində:
// mən (aşağı orta) → sol aşağı → sol yuxarı → yuxarı → sağ yuxarı → sağ aşağı.
const LAYOUT = {
  2: [[50, 7]],
  3: [[19, 28], [81, 28]],
  4: [[18, 42], [50, 6], [82, 42]],
  5: [[18, 47], [18, 19], [82, 19], [82, 47]],
  6: [[18, 47], [18, 19], [50, 6], [82, 19], [82, 47]],
  7: [[16, 54], [16, 29], [33, 7], [67, 7], [84, 29], [84, 54]],
  8: [[15, 57], [15, 34], [27, 11], [50, 3], [73, 11], [85, 34], [85, 57]],
};
function seatPos(i, n, myIdx) {
  const rel = (i - myIdx + n) % n;
  // geniş (üfüqi) masa üçün ayrıca yerlər: ellips boyunca; mən aşağı solda (kartlarımın yanında)
  const ang = ((90 + (rel * 360) / n) * Math.PI) / 180;
  const wide = rel === 0 ? { wx: 11, wy: 85 } : { wx: 50 + 38 * Math.cos(ang) - 6, wy: 47 + 37 * Math.sin(ang) };
  if (rel === 0) return { x: 50, y: 64, ...wide };
  const [x, y] = (LAYOUT[n] || LAYOUT[8])[rel - 1] || [50, 7];
  return { x, y, ...wide };
}

function renderSeat(p, i, n, myIdx, room, ord) {
  const r = room.round;
  const pos = seatPos(i, n, myIdx);
  const isMe = p.id === S.user.id;
  const isTurn = r && r.phase === 'betting' && r.turn === p.id;
  const out = ['folded', 'lost', 'out'].includes(p.status);
  const won = r?.phase === 'finished' && r.result && r.result.how !== 'aborted' && r.result.winners.includes(p.id);
  let cards = '';
  if (p.inHand && !isMe) {
    if (p.cards) cards = p.cards.map((c) => tagSvg(cardSVG(c), `data-flip="${flipKey(r.handNo, p.id)}"`)).join('');
    else cards = Array.from({ length: p.cardCount }, (_, j) => tagSvg(cardBackSVG(), `data-deal="${j * ord.n + ord.idx}"`)).join('');
  }
  const giftable = !room.practice && !isMe && !p.isBot && p.id > 0 && p.inRoom;
  return `<div class="seat ${isMe ? 'me' : ''} ${isTurn ? 'turn' : ''} ${out ? 'out' : ''} ${won ? 'won' : ''} ${p.connected ? '' : 'offline'}"
      style="--x:${pos.x.toFixed(2)}%;--y:${pos.y.toFixed(2)}%;--wx:${pos.wx.toFixed(2)}%;--wy:${pos.wy.toFixed(2)}%" data-seat="${p.id}">
    <div class="av" ${giftable ? `data-a="giftModal" data-id="${p.id}" role="button" tabindex="0" aria-label="${esc(p.name)} — hədiyyə göndər" title="Hədiyyə göndər"` : ''}>
      ${seatTimer(p, r, room)}
      ${avatarHTML(p, 'seat-av')}
      ${room.hostId === p.id ? '<span class="host" title="Otaq sahibi">👑</span>' : ''}
      ${p.isBot ? '<span class="botmark" title="Bot">BOT</span>' : ''}
      <div class="bubble-slot">${bubbleHTML(p.id)}</div>
    </div>
    <div class="nm-pill">${esc(p.name)}</div>
    <div class="bal-pill ${p.balance < 0 ? 'neg' : ''}">${fmt(p.balance)}</div>
    ${statusTag(p, r)}
    ${cards ? `<div class="sc-row">${cards}</div>` : ''}
    ${p.score != null && !isMe ? `<span class="sc-score">${p.score} xal</span>` : ''}
    ${p.creditPut ? `<span class="credit-chip" title="Borca (şərti) qoyuluş">🧾 borca ${fmt(p.creditPut)}</span>` : ''}
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
    <div class="bankbox"><small>BANK</small><b>${fmt(r.pot)}</b>${r.creditPot ? `<span class="credit-pot" title="Borca (şərti) qoyuluş — real xal deyil, raund sonunda ayrıca hesablanır">🧾 +${fmt(r.creditPot)} borca</span>` : ''}${r.phase === 'betting' ? `<i>Cari xod: ${fmt(Math.max(r.currentBet, r.minXod))}</i>` : ''}</div>
    <div class="pot-row">
      <div class="deck" id="deckAnchor">${cardBackSVG()}${cardBackSVG()}</div>
      <div class="pot-notes" id="potAnchor">${potStackHTML(r.pot)}</div>
    </div>
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
      const low = !me.canAffordMin && !me.canCreditOffer ? (real ? lowBalanceHTML(min) : `<div class="notice">Məşq balansınız ${fmt(min)} üçün çatmır.</div>`) : '';
      const d = r.creditDeal;
      const dealLine = d && d.debtor === uid ? `<div class="credit-line">🧾 Borca oyun: limit <b>${fmt(d.limit)}</b>, istifadə <b>${fmt(d.used)}</b>, qalıq <b>${fmt(d.limit - d.used)}</b> (${nameOf(d.creditor)} ilə razılaşma)</div>` : '';
      const creditBtn = me.canCreditOffer ? `<button class="ob credit" data-a="creditOfferModal">🤝 ${d ? 'Borca limiti artır' : 'Borca oyna'}${me.creditShortfall ? ` · çatışmır ${fmt(me.creditShortfall)}` : ''}</button>` : '';
      const pasBtn = me.canPas
        ? '<button class="bb pas" data-a="pas">Pas</button>'
        : '<button class="bb pas locked" disabled title="Cəkpot sahibi pas edə bilməz" aria-label="Pas kilidlidir">🔒</button>';
      const baxisTip = me.canBaxis ? `${nameOf(me.baxisTarget)} ilə baxış · ${fmt(min)}` : (me.baxisHint || 'Baxış hələ mümkün deyil.');
      return `${secret}${low}${dealLine}${creditBtn}
        <div class="ctl-row">
          <div class="stepper">
            <button class="st-b" data-a="betStep" data-v="-1" aria-label="Xodu azalt">−</button>
            <label class="st-v"><input id="bet" type="number" inputmode="numeric" value="${S.bet}" min="${min}" ${Number.isFinite(max) ? `max="${max}"` : ''} aria-label="Xod məbləği (xal)"><span>xal</span></label>
            <button class="st-b" data-a="betStep" data-v="1" aria-label="Xodu artır">+</button>
          </div>
          ${pasBtn}
          <button class="bb baxis" data-a="baxis" title="${baxisTip}" ${me.canBaxis && me.canAffordMin ? '' : 'disabled'}>Baxış</button>
          <button class="bb xod" data-a="xod" ${me.canAffordMin ? '' : 'disabled'}>Xod et</button>
        </div>
        <div class="hint">${me.canBaxis ? `Baxış: ${nameOf(me.baxisTarget)} · ${fmt(min)}` : esc(me.baxisHint || 'Baxış hələ mümkün deyil.')}</div>
        ${me.canBaxis && r.activeCount > 2 ? `<label class="check"><input type="checkbox" id="tieOffer" ${S.tieOffer ? 'checked' : ''}> Baxışda "eyni xala baxaq" təklif et</label>` : ''}
        ${r.activeCount === 2 ? `<div class="offer2">
          <button class="ob" data-a="offerSeka" ${me.canOffer ? '' : 'disabled'} title="2 oyunçu qalanda, raundda bir dəfə">🤝 Seka təklif et</button>
          <button class="ob" data-a="offerSplit" ${me.canOffer ? '' : 'disabled'} title="2 oyunçu qalanda, raundda bir dəfə">½ Bankı bölək</button></div>` : ''}`;
    }
    if (me?.status === 'active') {
      const d2 = r.creditDeal;
      const credInfo = d2 ? `<div class="credit-line">🧾 ${d2.debtor === uid ? `Borca oyun limitiniz: ${fmt(d2.limit)} (istifadə ${fmt(d2.used)})` : `${nameOf(d2.debtor)} sizin razılığınızla ${fmt(d2.limit)}-dək borca oynayır (istifadə ${fmt(d2.used)})`}</div>` : '';
      return `${secret}${credInfo}<div class="ctl-row wait">
          <div class="turn-chip">Növbə: <b>${nameOf(r.turn)}</b> <span data-secs="${r.turnDeadline}" data-unit=" san"></span></div>
          ${me.canVote ? `<button class="bb pas" data-a="votePas" title="${nameOf(r.turn)} vaxtı keçirdi">Pas səsi ${r.votes}/${r.votesNeeded}</button>` : ''}
        </div>`;
    }
    if (me?.status === 'attached') return `<div class="notice">Şəriksiniz: <b>${nameOf(me.attachedTo)}</b> qalib gəlsə bank bölünəcək.</div>`;
    if (me) return `<div class="notice">${me.status === 'folded' ? 'Pas dediniz.' : 'Bu raunddan çıxdınız.'} Növbə: <b>${nameOf(r.turn)}</b></div>`;
    return `<div class="notice">Raund gedir. Növbəti raundu gözləyin.</div>`;
  }

  if (r.phase === 'creditOffer') {
    const p = r.pending;
    const terms = `Çatışmayan məbləğ: <b>${fmt(p.shortfall)}</b> · Ümumi əlavə risk limiti: <b>${fmt(p.limit)}</b>${p.prevLimit ? ` (əvvəl ${fmt(p.prevLimit)}, istifadə olunub ${fmt(p.used)})` : ''} · Qaytarma müddəti: <b>${p.dueDays} gün</b>`;
    if (p.to === uid) {
      return `<div class="credit-offer">
        <div><b>${nameOf(p.from)}</b>: "<b>${fmt(p.limit)}</b>-dək borca oynamağı qəbul edirsən?" <span data-secs="${p.deadline}" data-unit=" san"></span></div>
        <div class="co-terms">${terms}</div>
        <div class="muted" style="font-size:12px">Qəbul etsəniz, ${nameOf(p.from)} balansı bitəndə bu limit daxilində oynaya bilər. Uduzsa, yalnız faktiki istifadə etdiyi təminatsız məbləğ sizə borc yazılır (adi oyunçu borcu kimi, müddət çatanda avtomatik tutulur). Udsa, borc yaranmır. Rədd etsəniz və ya 30 saniyədə cavab verməsəniz, balansı çatmayan oyunçu avtomatik pas olur.</div>
        <div class="big2"><button class="bb xod" data-a="creditAccept" data-limit="${p.limit}">Qəbul et</button><button class="bb pas" data-a="creditDecline">Rədd et</button></div></div>`;
    }
    if (p.from === uid) return `<div class="credit-offer"><div>Borca oyun təklifiniz göndərildi — ${nameOf(p.to)} cavab verir… <span data-secs="${p.deadline}" data-unit=" san"></span></div><div class="co-terms">${terms}</div><div class="muted" style="font-size:12px">Növbə vaxtınız gözləmə müddətində dayanıb.</div></div>`;
    return `<div class="notice">${nameOf(p.from)} ${nameOf(p.to)}-a borca oyun təklif edib… ${deadlineSpan(p.deadline)}</div>`;
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
    const waiting = sjn.waiting || [];
    const canDecide = sjn.eligible.includes(uid) && !sjn.joined.includes(uid) && !(sjn.skipped || []).includes(uid);
    let html = `<div class="seka-join">
      <div class="sj-head"><b>SEKA!</b> Bank növbəti əlinə keçir. Qoşulmaq: <b>${fmt(sjn.cost)}</b></div>
      <div class="sj-timer">Qalan vaxt: <b data-secs="${sjn.deadline}" data-unit=" san"></b></div>
      <div class="sj-meta">Qoşulanlar: ${joined}${waiting.length ? ` · Gözlənilir: ${waiting.map(nameOf).join(', ')}` : ''}</div></div>`;
    if (canDecide) html += `<div class="big2"><button class="bb xod" data-a="sekaJoin">Sekaya qoşul (${fmt(sjn.cost)})</button><button class="bb pas" data-a="sekaSkip">Qoşulmuram</button></div>`;
    if (sjn.base.includes(uid)) {
      html += `<button class="bb baxis wide" data-a="sekaStart" ${waiting.length ? 'disabled' : ''}>Sekanı başlat</button>`;
      if (waiting.length) html += `<div class="hint">Qoşulmaq hüququ olan oyunçular qərar verənə və ya vaxt bitənə qədər başlatmaq olmaz. Vaxt bitəndə seka qoşulanlarla avtomatik başlayır.</div>`;
    }
    return html;
  }
  return '';
}

// ---------------- öz kartlarım ----------------
function myHandHTML(r, ord, room) {
  const me = r?.me;
  if (!me) return '';
  const pickPhase = r.phase === 'discard' && me.mustDiscard;
  const cards = pickPhase ? me.hand : (me.cards || me.hand);
  // əl açarı: raund + kart sayı (4 kartdan biri atılanda yeni əl sayılır)
  const hand = `${room.code}-${r.handNo}-${cards.length}`;
  if (pickPhase) {
    const key = `${r.handNo}`;
    if (S.pickKey !== key) { S.pick = null; S.pickKey = key; }
  }
  const finished = r.phase === 'finished';
  // "Öz kartlarımı göstər" yalnız bu cihazda açır; raund bitəndə öz kartlarım açıq görünür
  const open = S.showHand === hand || finished;
  const dealAttr = (j) => `data-deal="${j * ord.n + ord.idx}"`;
  const faceUp = (c, j) => `<span class="flip3d" ${dealAttr(j)}>${cardBackSVG('bf')}${cardSVG(c)}</span>`;
  const slots = cards.map((c, j) => `<div class="mh-slot ${pickPhase && S.pick === j ? 'selected' : ''}">
      ${open ? faceUp(c, j) : peekCardHTML(c, j, hand, dealAttr(j))}
      ${pickPhase ? `<button class="pick-btn ${S.pick === j ? 'on' : ''}" data-a="pickCard" data-i="${j}" aria-pressed="${S.pick === j}" aria-label="${j + 1}-ci kartı atmaq üçün seç">${S.pick === j ? '✓ Atılır' : 'At'}</button>` : ''}
    </div>`).join('');
  const seenAll = open || peekedAll(hand, cards.length);
  let badge = '';
  if (pickPhase) {
    const keep = S.pick != null ? me.hand.filter((_, i) => i !== S.pick) : null;
    badge = `<div class="xal-badge ${keep && seenAll ? '' : 'dim'}">${keep ? (seenAll ? `${score3(keep)} xal` : 'Seçildi — təsdiqləyin') : 'Atılacaq kartı seçin'}</div>`;
  } else if (me.score != null && seenAll) badge = `<div class="xal-badge">${me.score} xal</div>`;
  const eye = finished ? '' : `<button class="eye-btn ${open ? 'on' : ''}" data-a="toggleShowHand" data-hand="${hand}" aria-pressed="${open}" aria-label="${open ? 'Kartlarımı ört' : 'Öz kartlarımı göstər'}" title="${open ? 'Kartlarımı ört' : 'Öz kartlarımı göstər (yalnız sizə)'}">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${open
        ? '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.3 7.4A17 17 0 0 0 2 12s4 6 10 6a9.6 9.6 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'
        : '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'}</svg>
      <span>${open ? 'Ört' : 'Göstər'}</span></button>`;
  const hint = !open && hintNeeded() ? `<div class="peek-hint" aria-live="polite"><b>Küncü sürüşdür, karta bax</b><small>Buraxanda yenə örtülür</small></div>` : '';
  return `${hint}<div class="my-hand ${pickPhase ? 'pick' : ''} ${open ? 'open' : 'covered'}">${slots}</div>${eye}
    ${badge}
    ${me.discarded ? `<div class="disc" title="Atdığınız kart">${cardSVG(me.discarded)}</div>` : ''}`;
}

// ---------------- son hədiyyə sətri (istinad şəklindəki kimi: "👑 Yaqub → Anar · Masa kralı") ----------------
export function giftTickerHTML() {
  const g = S.lastGift && S.lastGift.code === S.room?.code ? S.lastGift : null;
  return `<div class="gift-ticker" id="giftTicker" role="status">${g
    ? `<span class="gt-ico">${ICON[g.giftId] || '🎁'}</span><b>${esc(g.fromName)}</b> → <b>${esc(g.toName)}</b> <span class="gt-dot">·</span> <span class="gt-name">${esc(g.giftName)}</span>`
    : '<span class="gt-ico">🎁</span><span class="muted">Hədiyyə: oyunçunun şəklinə və ya 🎁 düyməsinə toxunun</span>'}</div>`;
}

// ---------------- emoji / çat paneli ----------------
function socialHTML(room) {
  const msgs = (room.chatMsgs || []).slice(-30);
  const log = (room.round ? room.round.log : room.chat) || [];
  const emojiBtns = EMOJIS.map((e) => `<button class="emoji-btn" data-a="emoji" data-e="${e}" aria-label="emoji ${e}">${e}</button>`).join('');
  return `<div class="sbar">
      <button class="sb-btn emoji-toggle ${S.emojiOpen ? 'on' : ''}" data-a="toggleEmoji" aria-label="Emojilər">😊</button>
      <div class="emoji-inline">${emojiBtns}</div>
      <form data-form="chat" id="chatForm" class="chat-form" autocomplete="off">
        <input id="chatInput" name="text" maxlength="120" placeholder="Mesaj yaz…" enterkeyhint="send" aria-label="Çat mesajı">
      </form>
      ${room.practice ? '' : '<button class="sb-btn gift" data-a="giftPickTarget" aria-label="Hədiyyə göndər" title="Hədiyyə göndər">🎁</button>'}
      <button class="sb-btn send" type="submit" form="chatForm" aria-label="Mesajı göndər">➤</button>
    </div>
    ${S.emojiOpen ? `<div class="emoji-tray">${emojiBtns}</div>` : ''}
    <div class="drawer ${S.logOpen ? '' : 'hidden'}">
      <div class="dr-head"><b>${esc(room.name)} · ${room.members.length}/${room.settings.maxPlayers} oyunçu</b><button class="sb-btn" data-a="toggleLog" aria-label="Bağla">✕</button></div>
      <div class="dr-toggles">
        <button class="tgl on" data-a="openNotifications">🔔 Bildirişlər${S.unread > 0 ? ` <b>(${S.unread})</b>` : ''}</button>
        <button class="tgl on" data-a="openProfile">👤 Profilim</button>
        <button class="tgl ${isMuted() ? '' : 'on'}" data-a="toggleSound" aria-pressed="${!isMuted()}">${isMuted() ? '🔇' : '🔊'} Səs: <b>${isMuted() ? 'söndürülüb' : 'açıq'}</b></button>
        <button class="tgl ${animationsOff() ? '' : 'on'}" data-a="toggleAnim" aria-pressed="${!animationsOff()}">✨ Animasiyalar: <b>${animationsOff() ? 'söndürülüb' : 'açıq'}</b></button>
      </div>
      ${room.practice ? '' : '<div class="muted" style="font-size:12px">🎁 Hədiyyə: oyunçunun şəklinə və ya 🎁 düyməsinə toxunun.</div>'}
      <div class="dr-head"><b>Çat</b></div>
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
  const handHTML = myHandHTML(r, ordOf(S.user.id), room);
  return `<div class="room n${seats.length}">
    ${roomBar(room, isFs())}
    ${room.dbWaiting ? '<div class="strip db-wait-banner">⏳ Baza bağlantısı gözlənilir — göstərilən vəziyyət son təsdiqlənmiş vəziyyətdir.</div>' : ''}
    ${room.practice ? '<div class="strip practice">🎓 Məşq rejimi · əsas balansa təsir etmir</div>' : ''}
    <div class="arena">
      ${decorHTML()}
      <div class="tbl">
        <div class="rim"><i class="brass l"></i><i class="brass r"></i><i class="brass c tl"></i><i class="brass c tr"></i><div class="felt">${FELT_MEDALLION}<div class="wm">SEKA</div>${centerHTML(room)}</div></div>
        ${seats.map((p, i) => renderSeat(p, i, seats.length, myIdx, room, ordOf(p.id))).join('')}
        ${handHTML ? `<div class="myhand">${handHTML}</div>` : ''}
      </div>
    </div>
    <div class="side">
      <div class="ctrl">${actionsHTML(room)}</div>
      ${room.practice ? '' : giftTickerHTML()}
      <div class="social">${socialHTML(room)}</div>
    </div>
  </div>`;
}
