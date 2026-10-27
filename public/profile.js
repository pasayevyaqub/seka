// "Profilim": balans, kredit, borclar, hədiyyə, şəkil, tarixçə, qarşılıqlı nəticələr, bildirişlər
import { azDative, azAblative } from './core.js';
import { S, esc, fmt, fmtCents, money, api, toast, moneyCall, avatarHTML, txList, fmtDate, bakuInputToMs, msToBakuInput, LOAN_STATUS, azLower } from './core.js';

export const STATS_NOTE = 'Yalnız faktiki oyun nəticələri: hər real raundda oyunçunun banka qoyduğu pul qaliblərə onların bankdan aldığı paya mütənasib bölünür; qalibin öz payı özünə yazılmır. Kredit, borc, hədiyyə, bonus, admin düzəlişləri, demo/botlu raundlar daxil deyil. Qeydlər v2 yeniləməsindən sonrakı raundlardan başlayır.';
const AUTO_CLAUSE = 'Son ödəmə vaxtı çatanda qalan borc borc alanın əsas balansından <b>avtomatik tutulur</b>. Balans çatmasa yalnız mövcud məbləğ tutulur, qalan hissə "Gecikib" statusunda qalır və sonradan balansa daxil olan vəsaitdən avtomatik tutulur. Faiz və cərimə yoxdur. Balans mənfiyə düşmür.';

export async function loadProfile(rerender) {
  try {
    S.profile = await api('/api/profile');
    S.unread = S.profile.unread;
    if (S.profile.user) S.user = { ...S.user, ...S.profile.user };
    rerender();
  } catch (e) { toast(e.message); }
}

// qarşı tərəfə görə cəm: "Anara borcum: 100 xal" / "Yaqubdan alacağım: 100 xal"
function byPerson(list, nameKey, word, from = false) {
  if (!list.length) return '';
  const m = new Map();
  for (const l of list) m.set(l[nameKey], (m.get(l[nameKey]) || 0) + l.remaining);
  return `<div class="by-person">${[...m].map(([n, v]) => `<div><b>${esc(from ? azAblative(n) : azDative(n))}</b> ${word}: <b>${fmt(v)}</b></div>`).join('')}</div>`;
}

function loanRow(l, me, side) {
  const other = side === 'borrower' ? l.lenderName : l.borrowerName;
  const overdue = l.status === 'overdue';
  return `<div class="tx loan ${overdue ? 'overdue' : ''}">
    <div><b>${esc(other)}</b> · <span class="kind k-${l.status}">${LOAN_STATUS[l.status] || l.status}</span>
      <div class="meta">İlkin: ${fmt(l.amount)} · Qalan: <b>${fmt(l.remaining)}</b> · Son tarix: ${fmtDate(l.dueAt)} (Bakı)${l.note ? ` · ${esc(l.note)}` : ''}</div>
      ${side === 'borrower' && ['active', 'overdue'].includes(l.status) ? `<form data-form="loanRepay" data-id="${l.id}" class="row mini-form">
        <input name="amount" type="number" inputmode="numeric" min="1" max="${l.remaining}" placeholder="Məbləğ" value="${l.remaining}" aria-label="Ödəniş məbləği">
        <button class="btn small primary">Borcu ödə</button></form>` : ''}
    </div>
    <div class="d ${side === 'borrower' ? 'minus' : 'plus'}">${fmt(l.remaining)}</div>
  </div>`;
}

export function renderProfile(topbar) {
  const p = S.profile;
  const u = S.user;
  const head = topbar(`<button class="btn small" data-a="backLobby">← Geri</button>`);
  if (!p) return head + '<div class="wrap muted center">Yüklənir...</div>';
  const loans = p.loans || [];
  const iOwe = loans.filter((l) => l.borrowerId === u.id && ['active', 'overdue'].includes(l.status));
  const owedMe = loans.filter((l) => l.lenderId === u.id && ['active', 'overdue'].includes(l.status));
  const incoming = loans.filter((l) => l.borrowerId === u.id && l.status === 'offered');
  const outgoing = loans.filter((l) => l.lenderId === u.id && l.status === 'offered');
  const askedMe = loans.filter((l) => l.lenderId === u.id && l.status === 'requested');   // məndən borc istəyənlər
  const myAsks = loans.filter((l) => l.borrowerId === u.id && l.status === 'requested');  // mənim istəklərim
  const overdue = loans.filter((l) => l.borrowerId === u.id && l.status === 'overdue');
  const closed = loans.filter((l) => ['paid', 'declined', 'cancelled'].includes(l.status)).slice(0, 20);
  const sum = (arr) => arr.reduce((s, l) => s + l.remaining, 0);
  const sel = (t) => S.recipient?.[t];
  return head + `
  <div class="wrap profile">
    <div class="card-panel prof-head">
      <div class="row" style="align-items:center;flex-wrap:wrap">
        <div style="flex:0 0 auto">${avatarHTML({ ...u, displayName: u.displayName }, 'lg')}</div>
        <div><div style="font-size:20px;font-weight:800">${esc(u.displayName)}</div><div class="muted">@${esc(u.username)}</div>
          <form data-form="avatar" class="row mini-form mt" style="flex-wrap:wrap">
            <label class="btn small file-btn">📷 Şəkil seç<input type="file" name="file" accept="image/jpeg,image/png,image/webp" hidden data-a-change="avatarPick"></label>
            ${u.avatarVer ? '<button type="button" class="btn small red" data-a="avatarDelete">Şəkli sil</button>' : ''}
          </form>
          <div class="muted" style="font-size:12px">JPG, PNG və ya WebP, ən çox 2 MB. Serverdə kiçildilir və metadata silinir.</div>
        </div>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat"><small>Əsas balans</small><b>${money(p.balance)}</b></div>
      <div class="stat"><small>Admin kredit borcu</small><b>${fmt(p.creditDebt)}</b></div>
      <div class="stat"><small>Kredit limiti</small><b>${fmt(p.creditLimit)}</b></div>
      <div class="stat"><small>Qalan limit</small><b>${fmt(p.creditLeft)}</b></div>
      <div class="stat"><small>Mənim borclarım</small><b class="neg-t">${fmt(sum(iOwe))}</b></div>
      <div class="stat"><small>Alacaqlarım</small><b class="pos-t">${fmt(sum(owedMe))}</b></div>
    </div>
    <p class="muted" style="font-size:12px">Bütün məbləğlər virtual oyun xalıdır; real pul deyil. Kredit və şəxsi borclar ayrı göstərilir.</p>

    ${overdue.length ? `<div class="card-panel warn"><h2>⚠️ Gecikmiş borclar</h2>${overdue.map((l) => loanRow(l, u, 'borrower')).join('')}
      <p class="muted" style="font-size:12px">Balansınıza daxil olan vəsaitdən avtomatik tutulacaq.</p></div>` : ''}

    <div class="grid2">
      <div class="card-panel">
        <h2>💳 Admin krediti</h2>
        ${p.pendingCredit ? `<div class="notice">Gözləyən müraciət: <b>${fmt(p.pendingCredit.amount)}</b> (${fmtDate(p.pendingCredit.createdAt)})
            <div class="row mt"><button class="btn small red" data-a="creditCancel" data-id="${p.pendingCredit.id}">Müraciəti ləğv et</button></div></div>`
          : `<button class="btn primary block" data-a="creditModal">Kredit istə</button>`}
        ${p.lastCredit && !p.pendingCredit ? `<div class="muted" style="font-size:12.5px;margin-top:6px">Son müraciət: ${fmt(p.lastCredit.amount)} — ${{ approved: 'təsdiqləndi', rejected: 'rədd edildi', cancelled: 'ləğv edildi' }[p.lastCredit.status] || p.lastCredit.status}${p.lastCredit.approvedAmount ? ` (${fmt(p.lastCredit.approvedAmount)})` : ''}</div>` : ''}
        ${p.creditDebt > 0 ? `<form data-form="creditRepay" class="mt">
            <label>Borcu ödə (balansdan, faizsiz)</label>
            <div class="row"><input name="amount" type="number" inputmode="numeric" min="1" max="${Math.min(p.creditDebt, p.balance)}" value="${Math.min(p.creditDebt, Math.max(p.balance, 0))}"><button class="btn primary" style="flex:0 0 auto">Ödə</button></div></form>` : ''}
        <p class="muted" style="font-size:12px">Hər kredit admin təsdiqi ilə verilir. Limit avtomatik kredit hüququ deyil.</p>
      </div>

      <div class="card-panel">
        <h2>🎁 Hədiyyə göndər</h2>
        <form data-form="gift">
          ${recipientPicker('gift', sel('gift'))}
          <label>Məbləğ (xal)</label><input name="amount" type="number" inputmode="numeric" min="1" required>
          <label>Qeyd (istəyə görə)</label><input name="note" maxlength="120">
          <button class="btn primary block mt">Davam et</button>
        </form>
        <p class="muted" style="font-size:12px">Hədiyyə öz balansınızdan çıxılır, borc yaratmır.</p>
      </div>
    </div>

    <div class="card-panel">
      <h2>🙏 Borc istə</h2>
      <form data-form="loanRequest">
        ${recipientPicker('ask', sel('ask'))}
        <div class="row" style="flex-wrap:wrap">
          <div><label>Məbləğ (xal)</label><input name="amount" type="number" inputmode="numeric" min="1" required></div>
          <div><label>Qaytarma vaxtı (Bakı)</label><input name="due" type="datetime-local" value="${msToBakuInput(Date.now() + 7 * 86_400_000)}" required></div>
        </div>
        <label>Qeyd (istəyə görə)</label><input name="note" maxlength="120">
        <p class="muted" style="font-size:12px">Qarşı tərəf təsdiqləyənə qədər heç kimin balansı və borcu dəyişmir. Təsdiqdə xal onun mövcud balansından sizə keçir. ${AUTO_CLAUSE}</p>
        <button class="btn primary block">İstəyə bax</button>
      </form>
    </div>

    ${askedMe.length ? `<div class="card-panel"><h2>📥 Məndən borc istəyənlər</h2>${askedMe.map((l) => `
      <div class="offer-card">
        <div><b>${esc(l.borrowerName)}</b> sizdən <b>${fmt(l.amount)}</b> borc istəyir. Qaytarma: <b>${fmtDate(l.dueAt)}</b> (Bakı)${l.note ? ` · ${esc(l.note)}` : ''}</div>
        <div class="muted" style="font-size:12px">Təsdiqləsəniz ${fmt(l.amount)} sizin balansınızdan çıxılıb ona keçir və borc yaranır. ${AUTO_CLAUSE}</div>
        <div class="row mt"><button class="btn green" data-a="loanApprove" data-id="${l.id}">Təsdiqlə</button><button class="btn red" data-a="loanReject" data-id="${l.id}">Rədd et</button></div>
      </div>`).join('')}</div>` : ''}
    ${myAsks.length ? `<div class="card-panel"><h2>📤 Mənim borc istəklərim</h2>${myAsks.map((l) => `
      <div class="tx"><div><b>${esc(l.lenderName)}</b> · ${fmt(l.amount)} · qaytarma ${fmtDate(l.dueAt)}<div class="meta">Cavab gözlənilir</div></div>
      <button class="btn small red" data-a="loanWithdraw" data-id="${l.id}">Geri götür</button></div>`).join('')}</div>` : ''}

    <div class="card-panel">
      <h2>💸 Borc ver</h2>
      <form data-form="loanOffer">
        ${recipientPicker('loan', sel('loan'))}
        <div class="row" style="flex-wrap:wrap">
          <div><label>Məbləğ (xal)</label><input name="amount" type="number" inputmode="numeric" min="1" required></div>
          <div><label>Qaytarma vaxtı (Bakı)</label><input name="due" type="datetime-local" value="${msToBakuInput(Date.now() + 7 * 86_400_000)}" required></div>
        </div>
        <label>Qeyd (istəyə görə)</label><input name="note" maxlength="120">
        <p class="muted" style="font-size:12px">${AUTO_CLAUSE} Pul yalnız qarşı tərəf qəbul edəndə balansınızdan çıxılır.</p>
        <button class="btn primary block">Təklifə bax</button>
      </form>
    </div>

    ${incoming.length ? `<div class="card-panel"><h2>📩 Mənə gələn borc təklifləri</h2>${incoming.map((l) => `
      <div class="offer-card">
        <div><b>${esc(l.lenderName)}</b> sizə <b>${fmt(l.amount)}</b> borc təklif edir. Son ödəmə: <b>${fmtDate(l.dueAt)}</b> (Bakı)${l.note ? ` · ${esc(l.note)}` : ''}</div>
        <div class="muted" style="font-size:12px">${AUTO_CLAUSE}</div>
        <div class="row mt"><button class="btn green" data-a="loanAccept" data-id="${l.id}">Qəbul et</button><button class="btn red" data-a="loanDecline" data-id="${l.id}">Rədd et</button></div>
      </div>`).join('')}</div>` : ''}
    ${outgoing.length ? `<div class="card-panel"><h2>📤 Göndərdiyim təkliflər</h2>${outgoing.map((l) => `
      <div class="tx"><div><b>${esc(l.borrowerName)}</b> · ${fmt(l.amount)} · son tarix ${fmtDate(l.dueAt)}</div>
      <button class="btn small red" data-a="loanCancel" data-id="${l.id}">Ləğv et</button></div>`).join('')}</div>` : ''}

    <div class="grid2">
      <div class="card-panel"><h2>Kimə borcluyam</h2>${byPerson(iOwe, 'lenderName', 'borcum')}${iOwe.map((l) => loanRow(l, u, 'borrower')).join('') || '<p class="muted">Borcunuz yoxdur.</p>'}</div>
      <div class="card-panel"><h2>Kimdən alacağım var</h2>${byPerson(owedMe, 'borrowerName', 'alacağım', true)}${owedMe.map((l) => loanRow(l, u, 'lender')).join('') || '<p class="muted">Alacağınız yoxdur.</p>'}</div>
    </div>
    ${closed.length ? `<details class="card-panel"><summary>Bağlanmış borclar və təkliflər</summary>${closed.map((l) => `<div class="tx"><div>${esc(l.lenderName)} → ${esc(l.borrowerName)} · ${fmt(l.amount)} · <span class="kind">${LOAN_STATUS[l.status]}</span><div class="meta">${fmtDate(l.closedAt || l.createdAt)}</div></div></div>`).join('')}</details>` : ''}

    <div class="grid2">
      <div class="card-panel"><h2>🎁 Göndərdiyim hədiyyələr</h2>${tgiftList(p.giftsSent, 'sent')}</div>
      <div class="card-panel"><h2>🎉 Aldığım hədiyyələr</h2>${tgiftList(p.giftsReceived, 'received')}</div>
    </div>

    <div class="card-panel"><h2>⚔️ Kimdən udmuşam / kimə uduzmuşam</h2>
      <p class="muted" style="font-size:12px">${STATS_NOTE}</p>
      ${(p.stats || []).map((x) => `<div class="tx"><div><b>${esc(u.displayName)} — ${esc(x.name)}</b>
        <div class="meta">uddunuz: ${fmtCents(x.wonCents)} · uduzdunuz: ${fmtCents(x.lostCents)}</div></div>
        <div class="d ${x.netCents >= 0 ? 'plus' : 'minus'}">${fmtCents(x.netCents, true)}</div></div>`).join('') || '<p class="muted">Hələ real raund nəticəsi yoxdur.</p>'}
    </div>

    <div class="card-panel"><h2>📜 Maliyyə tarixçəsi</h2>
      <p class="muted" style="font-size:12px">Kredit, borc, hədiyyə, bonus və ödənişlər. Oyun əməliyyatları üçün "Əməliyyatlarım"a baxın.</p>
      ${txList(p.history, false)}</div>
  </div>`;
}

// masa hədiyyələri (animasiyalı): qarşı tərəf, hədiyyə, tarix, qiymət, alınan xal
function tgiftList(items, dir) {
  if (!items?.length) return `<p class="muted">${dir === 'sent' ? 'Hələ hədiyyə göndərməmisiniz. Masada oyunçunun şəklinə toxunun.' : 'Hələ hədiyyə almamısınız.'}</p>`;
  return items.map((g) => `<div class="tx">
    <div>${dir === 'sent' ? '→' : '←'} <b>${esc(g.otherName || '?')}</b> · ${esc(g.giftName)}
      <div class="meta">${fmtDate(g.createdAt)} · qiymət ${g.price} xal · alana ${g.sharePct}% = ${g.credited} xal${g.debtPaid ? ` · borca tutuldu ${g.debtPaid} xal` : ''}</div></div>
    <div class="d ${dir === 'sent' ? 'minus' : 'plus'}">${dir === 'sent' ? `−${g.price}` : `+${g.credited}`}</div>
  </div>`).join('');
}

function recipientPicker(target, chosen) {
  return `<label>${target === 'gift' ? 'Alıcı' : target === 'ask' ? 'Kimdən istəyirsiniz' : 'Borc alan'} (ad və ya istifadəçi adı)</label>
    <input id="search-${target}" data-search="${target}" autocomplete="off" placeholder="Axtar..." value="">
    <div class="search-results" id="results-${target}"></div>
    <div class="chosen" id="chosen-${target}">${chosen ? `Seçildi: ${avatarHTML(chosen, 'sm')} <b>${esc(chosen.displayName)}</b> <span class="muted">@${esc(chosen.username)}</span>` : '<span class="muted">Hələ seçilməyib</span>'}</div>`;
}

let searchTimer = null;
export function onSearchInput(el) {
  const target = el.dataset.search;
  clearTimeout(searchTimer);
  const q = el.value.trim();
  searchTimer = setTimeout(async () => {
    const box = document.getElementById(`results-${target}`);
    if (!box) return;
    if (!q) { box.innerHTML = ''; return; }
    try {
      const r = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
      S.search = r.users;
      box.innerHTML = r.users.map((x) => `<button type="button" class="search-item" data-a="pickRecipient" data-target="${target}" data-id="${x.id}">${avatarHTML(x, 'sm')} <b>${esc(x.displayName)}</b> <span class="muted">@${esc(x.username)}</span></button>`).join('') || '<div class="muted">Tapılmadı.</div>';
    } catch (e) { box.innerHTML = `<div class="muted">${esc(e.message)}</div>`; }
  }, 250);
}

export function pickRecipient(el) {
  const target = el.dataset.target;
  const u = S.search.find((x) => x.id === Number(el.dataset.id));
  if (!u) return;
  S.recipient = { ...(S.recipient || {}), [target]: u };
  const c = document.getElementById(`chosen-${target}`);
  if (c) c.innerHTML = `Seçildi: ${avatarHTML(u, 'sm')} <b>${esc(u.displayName)}</b> <span class="muted">@${esc(u.username)}</span>`;
  const box = document.getElementById(`results-${target}`);
  if (box) box.innerHTML = '';
}

// -------- formalar (app.js submit idarəsindən çağırılır) --------
export function profileForms(render, reload) {
  return {
    gift: (data) => {
      const to = S.recipient?.gift;
      const amount = Number(data.amount);
      if (!to) return toast('Alıcını seçin.');
      if (!(amount > 0) || !Number.isInteger(amount)) return toast('Məbləğ müsbət tam ədəd olmalıdır.');
      S.modal = { title: 'Hədiyyəni təsdiqlə', html: `<p>${avatarHTML(to, 'sm')} <b>${esc(to.displayName)}</b> (@${esc(to.username)}) hesabına <b>${fmt(amount)}</b> hədiyyə göndərilsin?</p>
        ${data.note ? `<p class="muted">Qeyd: ${esc(data.note)}</p>` : ''}<p class="muted">Məbləğ balansınızdan çıxılacaq. Bu, borc deyil.</p>
        <button class="btn primary block" data-a="confirmGift">Təsdiqlə və göndər</button>`, payload: { toId: to.id, amount, note: data.note } };
      render();
    },
    loanOffer: (data) => {
      const to = S.recipient?.loan;
      const amount = Number(data.amount);
      const dueAt = bakuInputToMs(data.due);
      if (!to) return toast('Borc alanı seçin.');
      if (!(amount > 0) || !Number.isInteger(amount)) return toast('Məbləğ müsbət tam ədəd olmalıdır.');
      if (!Number.isFinite(dueAt)) return toast('Qaytarma vaxtını seçin.');
      S.modal = { title: 'Borc təklifini təsdiqlə', html: `<p><b>${esc(to.displayName)}</b> (@${esc(to.username)}) üçün <b>${fmt(amount)}</b> borc təklifi.<br>Son ödəmə: <b>${fmtDate(dueAt)}</b> (Bakı vaxtı)</p>
        <p class="muted" style="font-size:12.5px">${AUTO_CLAUSE}</p>
        <button class="btn primary block" data-a="confirmLoanOffer">Təklifi göndər</button>`, payload: { borrowerId: to.id, amount, dueAt, note: data.note } };
      render();
    },
    loanRequest: (data) => {
      const from = S.recipient?.ask;
      if (!from) return toast('Kimdən borc istədiyinizi seçin.');
      const amount = Number(data.amount);
      const dueAt = bakuInputToMs(data.due);
      if (!(amount > 0)) return toast('Məbləğ yazın.');
      if (!Number.isFinite(dueAt)) return toast('Qaytarma vaxtını seçin.');
      S.modal = { title: 'Borc istəyini təsdiqlə', html: `<p><b>${esc(from.displayName)}</b> (@${esc(from.username)})-dən <b>${fmt(amount)}</b> borc istəyirsiniz.<br>Qaytarma: <b>${fmtDate(dueAt)}</b> (Bakı vaxtı)</p>
        <p class="muted" style="font-size:12.5px">${AUTO_CLAUSE} Faiz yoxdur.</p>
        <button class="btn primary block" data-a="confirmLoanRequest">İstəyi göndər</button>`, payload: { lenderId: from.id, amount, dueAt, note: data.note } };
      render();
    },
    creditRepay: async (data) => {
      const r = await moneyCall('creditRepay', '/api/credit/repay', { amount: Number(data.amount) });
      if (r) { toast(`Kredit borcu ödənildi. Qalan: ${fmt(r.creditDebt)}`, true); reload(); }
    },
    loanRepay: async (data, form) => {
      const id = Number(form.dataset.id);
      const r = await moneyCall(`loanRepay${id}`, `/api/loans/${id}/repay`, { amount: Number(data.amount) });
      if (r) { toast(`Ödənildi: ${fmt(r.paid)}. Qalan: ${fmt(r.remaining)}`, true); reload(); }
    },
  };
}

export function profileHandlers(render, reload) {
  return {
    confirmGift: async () => {
      const r = await moneyCall('gift', '/api/gift', S.modal.payload).catch((e) => toast(e.message));
      if (r) { toast(`${fmt(r.amount)} hədiyyə ${r.toName} hesabına göndərildi.`, true); S.modal = null; S.recipient = { ...(S.recipient || {}), gift: null }; reload(); }
    },
    confirmLoanOffer: async () => {
      const r = await moneyCall('loanOffer', '/api/loans/offer', S.modal.payload).catch((e) => toast(e.message));
      if (r) { toast(`Təklif ${r.borrowerName} üçün göndərildi. Qəbul etdikdə pul köçürüləcək.`, true); S.modal = null; S.recipient = { ...(S.recipient || {}), loan: null }; reload(); }
    },
    loanAccept: (el) => {
      const l = S.profile.loans.find((x) => x.id === Number(el.dataset.id));
      S.modal = { title: 'Borcu qəbul et', html: `<p><b>${esc(l.lenderName)}</b>-dən <b>${fmt(l.amount)}</b> borc. Son ödəmə: <b>${fmtDate(l.dueAt)}</b> (Bakı)</p>
        <p class="muted" style="font-size:12.5px">${AUTO_CLAUSE}</p>
        <button class="btn green block" data-a="confirmLoanAccept" data-id="${l.id}">Şərtlərlə razıyam, qəbul edirəm</button>` };
      render();
    },
    confirmLoanAccept: async (el) => {
      const id = Number(el.dataset.id);
      const r = await moneyCall(`loanAccept${id}`, `/api/loans/${id}/accept`, {}).catch((e) => toast(e.message));
      if (r) { toast(`Borc qəbul edildi: +${fmt(r.amount)}`, true); S.modal = null; reload(); }
    },
    confirmLoanRequest: async () => {
      const r = await moneyCall('loanRequest', '/api/loans/request', S.modal.payload).catch((e) => toast(e.message));
      if (r) { toast(`İstək ${r.lenderName} üçün göndərildi. Təsdiqləyəndə xal balansınıza keçəcək.`, true); S.modal = null; S.recipient = { ...(S.recipient || {}), ask: null }; reload(); }
    },
    loanApprove: async (el) => {
      const l = S.profile.loans.find((x) => x.id === Number(el.dataset.id));
      if (!confirm(`${l.borrowerName}-a ${l.amount} xal borc verilsin? Balansınızdan çıxılacaq. Qaytarma: ${fmtDate(l.dueAt)}.`)) return;
      const r = await moneyCall(`loanApprove${l.id}`, `/api/loans/${l.id}/approve`, {}).catch((e) => toast(e.message));
      if (r) { toast(`Borc verildi: ${fmt(r.amount)}`, true); reload(); }
    },
    loanReject: async (el) => {
      const id = Number(el.dataset.id);
      const r = await moneyCall(`loanReject${id}`, `/api/loans/${id}/reject`, {}).catch((e) => toast(e.message));
      if (r) { toast('İstək rədd edildi.', true); reload(); }
    },
    loanWithdraw: async (el) => {
      const id = Number(el.dataset.id);
      const r = await moneyCall(`loanWithdraw${id}`, `/api/loans/${id}/withdraw`, {}).catch((e) => toast(e.message));
      if (r) { toast('İstək geri götürüldü.', true); reload(); }
    },
    loanDecline: async (el) => {
      if (!confirm('Təklifi rədd edirsiniz?')) return;
      const id = Number(el.dataset.id);
      const r = await moneyCall(`loanDecline${id}`, `/api/loans/${id}/decline`, {}).catch((e) => toast(e.message));
      if (r) { toast('Təklif rədd edildi.', true); reload(); }
    },
    loanCancel: async (el) => {
      if (!confirm('Təklifi ləğv edirsiniz?')) return;
      const id = Number(el.dataset.id);
      const r = await moneyCall(`loanCancel${id}`, `/api/loans/${id}/cancel`, {}).catch((e) => toast(e.message));
      if (r) { toast('Təklif ləğv edildi.', true); reload(); }
    },
    creditCancel: async (el) => {
      const r = await moneyCall('creditCancel', '/api/credit/cancel', { requestId: Number(el.dataset.id) }).catch((e) => toast(e.message));
      if (r) { toast('Müraciət ləğv edildi.', true); reload(); }
    },
    avatarDelete: async () => {
      if (!confirm('Profil şəklini silirsiniz?')) return;
      try { const r = await api('/api/me/avatar', null, 'DELETE'); S.user.avatarVer = 0; toast('Şəkil silindi.', true); reload(); return r; } catch (e) { toast(e.message); }
    },
  };
}

export async function uploadAvatar(file, reload) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return toast('Fayl 2 MB-dan böyükdür.');
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast('Yalnız JPG, PNG və ya WebP.');
  try {
    const res = await fetch('/api/me/avatar', { method: 'POST', body: file, headers: { 'Content-Type': file.type }, credentials: 'same-origin' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Yüklənmədi.');
    S.user.avatarVer = d.avatarVer;
    toast('Şəkil yeniləndi.', true);
    reload();
  } catch (e) { toast(e.message); }
}

export function creditModal(render) {
  S.modal = { title: '💳 Kredit istə', kind: 'creditRequest', submitLabel: 'Müraciət göndər',
    text: 'Admin müraciətinizi təsdiq edəndə məbləğ əsas balansınıza və kredit borcunuza yazılacaq (faizsiz). Bir gözləyən müraciətiniz ola bilər.',
    fields: [{ name: 'amount', label: 'Məbləğ (xal)', type: 'number' }, { name: 'note', label: 'Qeyd (istəyə görə)' }] };
  render();
}

export { azLower };
