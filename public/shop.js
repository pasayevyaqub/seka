// Oyundaxili market — YALNIZ virtual oyun xalı. Real ödəniş, real məhsul sifarişi, pul çıxarışı YOXDUR.
// Əşyalar dekorativdir: oyunda, qalib gəlmə şansında və nəticələrdə heç bir üstünlük vermir.
// Qiymət və balans HƏMİŞƏ serverdə yoxlanılır; burada göstərilən yalnız məlumat üçündür.
// Alış sabit açarla gedir (moneyCall): təkrar klik və ya itmiş cavabdan sonra təkrar göndərmə xalı ikinci dəfə tutmur.
import { S, esc, api, toast, moneyCall, fmt, isDemo } from './core.js';
import { itemIconHTML } from './items.js';

let data = null; // { items, collection, balance }

async function load() {
  data = await api('/api/shop');
  if (S.user && Number.isFinite(data.balance)) S.user.balance = data.balance;
  return data;
}
const owned = (id) => !!data?.collection.find((c) => c.id === id);
const bal = () => S.user?.balance ?? data?.balance ?? 0;

function tabsHTML(tab) {
  const n = data?.collection.length || 0;
  return `<div class="tabs shop-tabs" role="tablist">
    <button class="btn ${tab === 'items' ? 'active' : ''}" data-a="shopTab" data-v="items" role="tab" aria-selected="${tab === 'items'}">Əşyalar</button>
    <button class="btn ${tab === 'mine' ? 'active' : ''}" data-a="shopTab" data-v="mine" role="tab" aria-selected="${tab === 'mine'}">Kolleksiyam${n ? ` (${n})` : ''}</button>
  </div>`;
}

function itemsHTML() {
  const b = bal();
  const list = data.items.map((it) => {
    const mine = owned(it.id);
    const short = !mine && it.price > b;
    return `<div class="shop-card ${mine ? 'owned' : ''}" data-key="si-${esc(it.id)}">
      <div class="shop-ico">${itemIconHTML(it)}</div>
      <b class="shop-name">${esc(it.name)}</b>
      <span class="shop-price">${fmt(it.price)}</span>
      ${mine ? '<span class="shop-owned">✓ Kolleksiyada</span>'
        : `<button class="btn small primary" data-a="shopBuy" data-id="${esc(it.id)}" ${short ? 'aria-disabled="true"' : ''}>Al</button>`}
      ${short ? '<small class="warn-line">Xal çatmır</small>' : ''}
    </div>`;
  }).join('') || '<p class="muted">Hazırda satışda əşya yoxdur.</p>';
  return `<div class="shop-grid">${list}</div>`;
}

function mineHTML() {
  if (!data.collection.length) return '<p class="muted">Kolleksiyanız boşdur. «Əşyalar» bölməsindən virtual xalla əşya ala bilərsiniz.</p>';
  return `<div class="shop-grid">${data.collection.map((c) => `<div class="shop-card owned" data-key="sc-${esc(c.id)}">
    <div class="shop-ico">${itemIconHTML(c)}</div>
    <b class="shop-name">${esc(c.name)}</b>
    <small class="muted">${c.uses ? `${c.uses} dəfə istifadə` : 'Hələ istifadə olunmayıb'}</small>
    <button class="btn small green" data-a="shopUse" data-id="${esc(c.id)}">İstifadə et</button>
  </div>`).join('')}</div>
  <p class="muted" style="font-size:12px">İstifadə edəndə əşyanın ikonu profil şəklinizin yanında 2–3 saniyə görünür (otaqdasınızsa, masadakılar da görür). Əşya kolleksiyada qalır, istədiyiniz vaxt yenidən istifadə edə bilərsiniz.</p>`;
}

function confirmHTML(it) {
  const b = bal();
  return `<div class="gift-confirm">
    <div class="gc-ico shop-ico big">${itemIconHTML(it)}</div>
    <p><b>«${esc(it.name)}»</b> alırsınız.</p>
    <div class="tx"><div>Balansınızdan çıxılacaq</div><div class="d minus">−${fmt(it.price)}</div></div>
    <div class="tx"><div>Sizdə qalacaq</div><div class="d">${fmt(b - it.price)}</div></div>
    <div class="row mt"><button class="btn" data-a="shopBack">Geri</button><button class="btn primary" data-a="shopConfirm" data-id="${esc(it.id)}">Təsdiq et və al</button></div>
  </div>`;
}

function shopHTML(tab, confirmItem) {
  const head = `<div class="shop-head"><span>Balansınız: <b>${fmt(bal())}</b></span><span class="muted">Yalnız virtual oyun xalı</span></div>`;
  if (confirmItem) return head + confirmHTML(confirmItem);
  return head + tabsHTML(tab) + (tab === 'mine' ? mineHTML() : itemsHTML())
    + '<p class="muted shop-note">Əşyalar dekorativdir: oyunda, qalib gəlmə şansında və nəticələrdə heç bir üstünlük vermir. Real məhsul deyil, real pulla alınmır, pula çevrilmir.</p>';
}

function show(render, tab, confirmItem = null) {
  const prev = S.modal?.kind === 'shop' ? S.modal : null;
  S.modal = { ...(prev || {}), title: '🛒 Market', kind: 'shop', tab, confirmId: confirmItem?.id || null, html: shopHTML(tab, confirmItem) };
  render();
}

export async function openShop(render, tab = 'items') {
  if (!S.user || isDemo()) { toast('Market yalnız aktiv hesablar üçündür.'); return; }
  try { await load(); show(render, tab); } catch (e) { toast(e.message); }
}

/** Balans WebSocket ilə dəyişəndə açıq market pəncərəsi yenilənsin (təsdiq ekranı daxil) */
export function refreshShopModal(render) {
  const m = S.modal;
  if (m?.kind !== 'shop' || !data) return;
  show(render, m.tab, m.confirmId ? data.items.find((x) => x.id === m.confirmId) : null);
}

export async function useItem(id) {
  return api('/api/shop/use', { itemId: id });
}

export function shopHandlers(render, reloadProfile) {
  return {
    openShop: (el) => openShop(render, el?.dataset?.v || 'items'),
    // 🎁 düyməsi (masada): hədiyyə göndər və ya market
    tableGiftMenu: () => {
      const room = S.room;
      const canGift = room && !room.practice;
      S.modal = { title: '🎁 Hədiyyə və market', kind: 'giftMenu', html: `<div class="pm-actions">
        ${canGift ? '<button class="btn block" data-a="giftPickTarget">🎁 Oyunçuya hədiyyə göndər</button>' : ''}
        <button class="btn block" data-a="openShop" data-v="items">🛒 Market — əşyalar</button>
        <button class="btn block" data-a="openShop" data-v="mine">🎒 Kolleksiyam</button>
      </div>
      ${canGift ? '' : '<p class="muted" style="font-size:12px">Demo və botlu otaqlarda hədiyyə göndərmək olmaz; market və kolleksiya işləyir.</p>'}` };
      render();
    },
    shopTab: (el) => { if (S.modal?.kind === 'shop') show(render, el.dataset.v === 'mine' ? 'mine' : 'items'); },
    shopBuy: (el) => {
      const it = data?.items.find((x) => x.id === el.dataset.id);
      if (!it) return;
      if (owned(it.id)) { toast('Bu əşya artıq kolleksiyanızdadır.'); return; }
      if (it.price > bal()) { toast(`Balansınız çatmır: «${it.name}» ${it.price} xal, balansınız ${bal()} xal.`); return; }
      show(render, 'items', it);
    },
    shopBack: () => show(render, S.modal?.tab || 'items'),
    shopConfirm: async (el) => {
      const id = el.dataset.id;
      el.disabled = true;
      try {
        // qiymət GÖNDƏRİLMİR — server bazadakı qiyməti tətbiq edir
        const r = await moneyCall(`shop:${id}`, '/api/shop/buy', { itemId: id });
        if (!r) return; // artıq göndərilir
        if (Number.isFinite(r.balance)) S.user.balance = r.balance;
        data.collection = r.collection || data.collection;
        toast(r.duplicate ? 'Bu alış artıq emal olunub — xal ikinci dəfə çıxılmadı.' : `«${r.name}» kolleksiyanıza əlavə olundu: −${r.price} xal.`, true);
        show(render, 'mine');
        if (S.view === 'profile') reloadProfile();
      } catch (e) {
        toast(e.message);
        try { await load(); } catch { /* */ }
        show(render, 'items');
      }
    },
    shopUse: async (el) => {
      el.disabled = true;
      try {
        await useItem(el.dataset.id);
        // pəncərə bağlanır ki, effekt (şəklin yanında) görünsün
        if (S.modal?.kind === 'shop') { S.modal = null; render(); }
        if (data) { const c = data.collection.find((x) => x.id === el.dataset.id); if (c) c.uses++; }
        if (S.view === 'profile' && S.profile?.collection) {
          const c = S.profile.collection.find((x) => x.id === el.dataset.id); if (c) c.uses++;
        }
      } catch (e) { toast(e.message); } finally { el.disabled = false; }
    },
  };
}
