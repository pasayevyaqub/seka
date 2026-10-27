// Masa hədiyyəsi göndərmə pəncərəsi: oyunçunun şəklinə toxunanda açılır.
// Qiymət və alana keçəcək xal əvvəlcədən göstərilir; təsdiqdən sonra göndərilir.
// Son yoxlama (qiymət, faiz, balans, icazə) HƏMİŞƏ serverdədir — burada göstərilən yalnız məlumat üçündür.
import { S, esc, api, toast, moneyCall, avatarHTML, azAblative } from './core.js';
import { ICON, dative } from './giftfx.js';

let catalog = null; // { gifts, sharePct, at }

async function loadCatalog(force = false) {
  if (!force && catalog && Date.now() - catalog.at < 30_000) return catalog;
  const r = await api('/api/table-gifts');
  catalog = { ...r, at: Date.now() };
  return catalog;
}

function myBalance() {
  return S.user?.balance ?? 0;
}

function pickHTML(target, cat) {
  const bal = myBalance();
  const rows = cat.gifts.map((g) => {
    const credited = Math.floor((g.price * cat.sharePct) / 100);
    const short = g.price > bal;
    return `<button type="button" class="gift-opt ${short ? 'short' : ''}" data-a="giftPick" data-g="${esc(g.id)}" ${short ? 'aria-disabled="true"' : ''}>
      <span class="go-ico">${ICON[g.id] || '🎁'}</span>
      <span class="go-txt"><b>${esc(g.name)}</b><small>Qiymət: ${g.price} xal · ${esc(target.name)} alacaq: <b>${credited} xal</b></small>
        ${short ? `<small class="warn-line">Balansınız çatmır (${bal} xal)</small>` : ''}</span>
    </button>`;
  }).join('') || '<p class="muted">Hazırda aktiv hədiyyə yoxdur.</p>';
  return `<div class="gift-to">${avatarHTML(target, 'md')}<div><b>${esc(target.name)}</b><div class="muted" style="font-size:12px">Virtual oyun xalı ilə · balansınız: ${bal} xal</div></div></div>
    <div class="gift-list">${rows}</div>
    <button type="button" class="btn block mt" data-a="askLoanModal" data-id="${target.id}">💸 ${esc(azAblative(target.name))} borc istə</button>
    <p class="muted" style="font-size:12px">Hədiyyənin qiymətinin ${cat.sharePct}%-i (aşağı yuvarlaqlaşdırılır) alana keçir, qalanı dövriyyədən çıxır. Alanın vaxtı çatmış borcu varsa, gələn xal əvvəlcə borca tutulur.</p>`;
}

function confirmHTML(target, g, cat) {
  const credited = Math.floor((g.price * cat.sharePct) / 100);
  const bal = myBalance();
  return `<div class="gift-confirm">
    <div class="gc-ico">${ICON[g.id] || '🎁'}</div>
    <p><b>${esc(dative(target.name))}</b> <b>«${esc(g.name)}»</b> göndərirsiniz.</p>
    <div class="tx"><div>Balansınızdan çıxılacaq</div><div class="d minus">−${g.price} xal</div></div>
    <div class="tx"><div>${esc(target.name)} alacaq (${cat.sharePct}%)</div><div class="d plus">+${credited} xal</div></div>
    <div class="tx"><div>Dövriyyədən çıxır</div><div class="d">${g.price - credited} xal</div></div>
    <div class="tx"><div>Sizdə qalacaq</div><div class="d">${bal - g.price} xal</div></div>
    <div class="row mt"><button class="btn" data-a="giftBack">Geri</button><button class="btn primary" data-a="giftSend">Təsdiq et və göndər</button></div>
  </div>`;
}

export async function openGiftModal(toId, render) {
  const room = S.room;
  if (!room) return;
  if (room.practice) { toast('Demo və botlu otaqlarda hədiyyə göndərmək olmaz.'); return; }
  if (toId === S.user.id) { toast('Özünüzə hədiyyə göndərə bilməzsiniz.'); return; }
  const m = room.members.find((x) => x.id === toId);
  if (!m || m.isBot || toId < 0) { toast('Botlara hədiyyə göndərmək olmaz.'); return; }
  try {
    const cat = await loadCatalog(true);
    const target = { id: m.id, name: m.name, avatarVer: m.avatarVer, isBot: false };
    S.modal = { title: '🎁 Hədiyyə göndər', kind: 'tgift', target, giftId: null, html: pickHTML(target, cat) };
    render();
  } catch (e) { toast(e.message); }
}

export function giftHandlers(render) {
  return {
    giftModal: (el) => openGiftModal(Number(el.dataset.id), render),
    // 🎁 düyməsi: əvvəl masadakı oyunçulardan birini seçmək
    giftPickTarget: () => {
      const room = S.room;
      if (!room || room.practice) { toast('Demo və botlu otaqlarda hədiyyə göndərmək olmaz.'); return; }
      const others = room.members.filter((m) => m.id !== S.user.id && !m.isBot && m.id > 0);
      if (!others.length) { toast('Masada hədiyyə göndərmək üçün başqa oyunçu yoxdur.'); return; }
      if (others.length === 1) { openGiftModal(others[0].id, render); return; }
      S.modal = { title: '🎁 Kimə hədiyyə?', kind: 'tgiftTarget', html: `<div class="gift-list">${others.map((m) => `<button type="button" class="gift-opt" data-a="giftModal" data-id="${m.id}">${avatarHTML({ ...m, isBot: false }, 'md')}<span class="go-txt"><b>${esc(m.name)}</b><small>${m.balance} xal</small></span></button>`).join('')}</div>` };
      render();
    },
    giftPick: async (el) => {
      const m = S.modal;
      if (m?.kind !== 'tgift') return;
      const cat = await loadCatalog();
      const g = cat.gifts.find((x) => x.id === el.dataset.g);
      if (!g) return;
      if (g.price > myBalance()) { toast(`Balansınız çatmır: «${g.name}» ${g.price} xal, balansınız ${myBalance()} xal.`); return; }
      S.modal = { ...m, giftId: g.id, html: confirmHTML(m.target, g, cat) };
      render();
    },
    giftBack: async () => {
      const m = S.modal;
      if (m?.kind !== 'tgift') return;
      S.modal = { ...m, giftId: null, html: pickHTML(m.target, await loadCatalog()) };
      render();
    },
    giftSend: async (el) => {
      const m = S.modal;
      if (m?.kind !== 'tgift' || !m.giftId) return;
      el.disabled = true;
      try {
        // eyni açar uğurlu cavaba qədər saxlanılır — təkrar klik / itmiş cavab ikiqat xərc yaratmır
        const r = await moneyCall(`tgift:${m.target.id}:${m.giftId}`, '/api/table-gift', { toId: m.target.id, giftId: m.giftId });
        if (!r) return; // artıq göndərilir
        S.modal = null;
        render();
        toast(`«${r.giftName}» göndərildi: −${r.price} xal. ${r.toName} ${r.credited} xal aldı.`, true);
      } catch (e) {
        toast(e.message);
        catalog = null;
        el.disabled = false;
      }
    },
  };
}
