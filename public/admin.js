// Admin paneli: istifadəçilər, kredit, oyunçu borcları, hədiyyələr, əməliyyatlar, nəticələr, ayarlar
import { S, esc, fmt, fmtCents, money, api, toast, moneyCall, avatarHTML, txList, fmtDate, azLower, isAdmin, LOAN_STATUS } from './core.js';
import { STATS_NOTE } from './profile.js';
import { morph } from './morph.js';

const PAGE = 50;
const A = () => S.admin;

export async function loadAdmin(rerenderList) {
  try {
    const tab = S.adminTab;
    const jobs = [api('/api/admin/users').then((r) => { A().users = r.users; })];
    if (tab === 'tx') jobs.push(api('/api/admin/transactions' + (A().txUser ? `?userId=${A().txUser}` : '')).then((r) => { A().tx = r.items; }));
    if (tab === 'stats') jobs.push(api('/api/admin/stats').then((r) => { A().pairs = r.pairs; }));
    if (tab === 'credit') jobs.push(api('/api/admin/credit').then((r) => { A().credit = r; }));
    if (tab === 'loans') jobs.push(api('/api/admin/loans').then((r) => { A().loans = r.loans; }));
    if (tab === 'gifts') jobs.push(api('/api/admin/gifts').then((r) => { A().gifts = r.items; }));
    if (tab === 'tgifts') jobs.push(api('/api/admin/table-gifts').then((r) => { A().tgifts = r; }));
    if (tab === 'settings') jobs.push(api('/api/admin/settings').then((r) => { A().settings = r; }));
    await Promise.all(jobs);
    rerenderList();
  } catch (e) { toast(e.message); }
}

const match = (q, ...xs) => !q || xs.some((x) => azLower(x).includes(q));

function usersList() {
  const q = azLower(A().q).trim();
  const f = A().filter;
  let list = A().users.filter((u) => match(q, u.displayName, u.username));
  if (f === 'negative') list = list.filter((u) => u.balance < 0);
  if (f === 'debt') list = list.filter((u) => u.creditDebt > 0);
  if (f === 'blocked') list = list.filter((u) => u.status === 'blocked' || u.status === 'rejected');
  const total = list.length;
  list = list.slice(0, PAGE * A().page);
  const admin = isAdmin();
  return `<div class="muted" style="font-size:12.5px;margin-bottom:6px">${total} istifadəçi</div>` + list.map((u) => `
    <div class="user-card ${u.status} ${u.balance < 0 ? 'negative' : ''}" data-key="u${u.id}">
      <div class="top">
        <div class="who">${avatarHTML(u, 'sm')}<div><b>${esc(u.displayName)}</b> <span class="muted">@${esc(u.username)}</span>
        ${u.role !== 'player' ? `<span class="chip" style="font-size:11px;padding:1px 8px">${u.role === 'admin' ? 'Admin' : 'Moderator'}</span>` : ''}</div></div>
        <span class="status ${u.status}">${{ pending: 'Gözləyir', approved: 'Aktiv', blocked: 'Bloklanıb', rejected: 'Rədd edilib' }[u.status]}</span>
      </div>
      <div class="muted" style="font-size:13px">Balans: ${money(u.balance)} · Kredit borcu: ${fmt(u.creditDebt)} / limit ${fmt(u.creditLimit)}${u.phone ? ` · 📞 ${esc(u.phone)}` : ''} · ${fmtDate(u.createdAt)}</div>
      ${u.balance < 0 ? '<div class="warn-line">⚠️ Köhnə versiyadan qalmış mənfi balans — avtomatik silinmir, açıq təsdiqlə düzəldilə bilər.</div>' : ''}
      <div class="btns">
        ${u.status === 'pending' ? `<button class="btn small green" data-a="uStatus" data-id="${u.id}" data-v="approved">Aktivləşdir</button>` : ''}
        ${u.status === 'approved' ? `
          <button class="btn small primary" data-a="uBalance" data-id="${u.id}">± Balans</button>
          <button class="btn small" data-a="uGift" data-id="${u.id}">🎁 Hədiyyə</button>
          <button class="btn small" data-a="uLimit" data-id="${u.id}">Kredit limiti</button>
          ${admin && u.balance < 0 ? `<button class="btn small red" data-a="uReset" data-id="${u.id}">Mənfi balansı sıfırla</button>` : ''}
          <button class="btn small" data-a="uTx" data-id="${u.id}">Əməliyyatlar</button>
          <button class="btn small" data-a="uName" data-id="${u.id}">Ad</button>
          <button class="btn small" data-a="uPass" data-id="${u.id}">Şifrə</button>
          ${admin && u.id !== S.user.id ? `<button class="btn small" data-a="uRole" data-id="${u.id}">Rol</button>` : ''}
          ${u.id !== S.user.id ? `<button class="btn small red" data-a="uStatus" data-id="${u.id}" data-v="blocked">Blokla</button>` : ''}` : ''}
        ${u.status === 'blocked' || u.status === 'rejected' ? `<button class="btn small green" data-a="uStatus" data-id="${u.id}" data-v="approved">Aktivləşdir</button>` : ''}
      </div>
    </div>`).join('') + (total > list.length ? `<button class="btn block" data-a="adminMore">Daha çox göstər (${total - list.length})</button>` : '');
}

function creditList() {
  const c = A().credit;
  if (!c) return '<p class="muted">Yüklənir...</p>';
  const q = azLower(A().q).trim();
  const pending = c.requests.filter((r) => r.status === 'pending' && match(q, r.displayName, r.username));
  const done = c.requests.filter((r) => r.status !== 'pending' && match(q, r.displayName, r.username)).slice(0, 50);
  const users = c.users.filter((u) => match(q, u.displayName, u.username));
  return `<div class="stat-grid"><div class="stat"><small>Ümumi admin kredit borcu</small><b>${fmt(c.totalDebt)}</b></div>
      <div class="stat"><small>Gözləyən müraciət</small><b>${c.requests.filter((r) => r.status === 'pending').length}</b></div></div>
    <h3>Gözləyən müraciətlər</h3>
    ${pending.map((r) => {
      const suggested = Math.max(r.creditLimit, r.creditDebt + r.amount);
      return `<div class="user-card pending" data-key="cr${r.id}">
        <div class="top"><b>${esc(r.displayName)}</b> <span class="muted">@${esc(r.username)}</span><span class="status pending">${fmt(r.amount)} istəyir</span></div>
        <div class="muted" style="font-size:13px">Balans: ${fmt(r.balance)} · Borc: ${fmt(r.creditDebt)} · Limit: ${fmt(r.creditLimit)} · ${fmtDate(r.createdAt)}${r.note ? ` · “${esc(r.note)}”` : ''}</div>
        <form data-form="creditDecide" data-id="${r.id}" data-key="crf${r.id}" data-keep-dirty class="row mini-form" style="flex-wrap:wrap">
          <div><label>Veriləcək məbləğ</label><input name="amount" type="number" inputmode="numeric" min="1" value="${r.amount}"></div>
          <div><label>Yeni limit (istəyə görə)</label><input name="newLimit" type="number" inputmode="numeric" min="0" value="${suggested}"></div>
          <div><label>Qeyd</label><input name="note" maxlength="120"></div>
          <div class="row" style="align-self:flex-end"><button class="btn small green" name="decision" value="approve">Qəbul et</button><button class="btn small red" name="decision" value="reject" formnovalidate>Rədd et</button></div>
        </form>
      </div>`;
    }).join('') || '<p class="muted">Gözləyən müraciət yoxdur.</p>'}
    <h3>Oyunçular üzrə kredit</h3>
    ${users.map((u) => `<div class="tx"><div class="who">${avatarHTML(u, 'sm')}<b>${esc(u.displayName)}</b> <span class="muted">@${esc(u.username)}</span></div>
      <div class="meta">Borc ${fmt(u.creditDebt)} / limit ${fmt(u.creditLimit)} · qalan ${fmt(Math.max(0, u.creditLimit - u.creditDebt))}</div></div>`).join('') || '<p class="muted">Kredit borcu və ya limiti olan oyunçu yoxdur.</p>'}
    <h3>Baxılmış müraciətlər</h3>
    ${done.map((r) => `<div class="tx"><div><b>${esc(r.displayName)}</b> · ${fmt(r.amount)} → <span class="kind k-${r.status}">${{ approved: 'Təsdiq', rejected: 'Rədd', cancelled: 'Ləğv' }[r.status]}</span>${r.approvedAmount ? ` ${fmt(r.approvedAmount)}` : ''}
      <div class="meta">${fmtDate(r.decidedAt)}${r.decidedName ? ` · ${esc(r.decidedName)}` : ''}${r.adminNote ? ` · ${esc(r.adminNote)}` : ''}</div></div></div>`).join('') || '<p class="muted">Yoxdur.</p>'}`;
}

function loansList() {
  const q = azLower(A().q).trim();
  const f = A().filter;
  let list = A().loans.filter((l) => match(q, l.lenderName, l.borrowerName, l.lenderUsername, l.borrowerUsername));
  if (f === 'open') list = list.filter((l) => ['active', 'overdue'].includes(l.status));
  if (f === 'overdue') list = list.filter((l) => l.status === 'overdue');
  if (f === 'offered') list = list.filter((l) => l.status === 'offered');
  const total = list.length;
  list = list.slice(0, PAGE * A().page);
  return `<p class="muted" style="font-size:12.5px">Oyunçular arası borclar admin kreditindən ayrıdır. ${total} qeyd.</p>` + list.map((l) => `
    <div class="tx loan ${l.status === 'overdue' ? 'overdue' : ''}"><div>
      <b>${esc(l.borrowerName)}</b> <span class="muted">borcludur</span> → <b>${esc(l.lenderName)}</b> · <span class="kind k-${l.status}">${LOAN_STATUS[l.status]}</span>
      <div class="meta">#${l.id} · İlkin ${fmt(l.amount)} · Qalan <b>${fmt(l.remaining)}</b> · Son tarix ${fmtDate(l.dueAt)}${l.note ? ` · ${esc(l.note)}` : ''}</div></div>
      <div class="d minus">${fmt(l.remaining)}</div></div>`).join('') + (total > list.length ? `<button class="btn block" data-a="adminMore">Daha çox göstər</button>` : '');
}

function giftsList() {
  const q = azLower(A().q).trim();
  const list = A().gifts.filter((t) => match(q, t.user_name, t.counterparty_name, t.by_name));
  return '<p class="muted" style="font-size:12.5px">Oyunçu hədiyyələri (göndərəndən çıxılır) və admin hədiyyələri (sistemdən).</p>' + list.map((t) => `<div class="tx"><div>
      ${t.kind === 'admin_gift' ? `🎁 <b>Admin (${esc(t.by_name || '?')})</b>` : `🎁 <b>${esc(t.counterparty_name || '?')}</b>`} → <b>${esc(t.user_name)}</b>
      <div class="meta">${fmtDate(t.created_at)}${t.note ? ` · ${esc(t.note)}` : ''}</div></div><div class="d plus">+${fmt(Number(t.delta))}</div></div>`).join('') || '<p class="muted">Yoxdur.</p>';
}

// masa hədiyyələri: göndərən/alan adına görə axtarış
function tgiftsList() {
  const d = A().tgifts;
  if (!d) return '<p class="muted">Yüklənir...</p>';
  const q = azLower(A().q).trim();
  let list = d.items.filter((g) => match(q, g.fromName, g.fromUsername, g.toName, g.toUsername, g.giftName));
  const total = list.length;
  const sum = list.reduce((a, g) => ({ price: a.price + g.price, credited: a.credited + g.credited }), { price: 0, credited: 0 });
  list = list.slice(0, PAGE * A().page);
  return `<p class="muted" style="font-size:12.5px">${total} əməliyyat · xərclənən ${sum.price} xal · alanlara keçən ${sum.credited} xal · dövriyyədən çıxan ${sum.price - sum.credited} xal. Bu xallar oyun udma/uduzma statistikasına daxil deyil.</p>`
    + list.map((g) => `<div class="tx"><div>🎁 <b>${esc(g.fromName || '?')}</b> → <b>${esc(g.toName || '?')}</b> · ${esc(g.giftName)}
      <div class="meta">#${g.id} · ${fmtDate(g.createdAt)} · qiymət ${g.price} xal · ${g.sharePct}% → alana ${g.credited} xal${g.debtPaid ? ` (borca tutuldu ${g.debtPaid})` : ''}${g.room ? ` · otaq ${esc(g.room)}` : ''}</div></div>
      <div class="d minus">−${g.price}</div></div>`).join('') + (total > list.length ? `<button class="btn block" data-a="adminMore">Daha çox göstər (${total - list.length})</button>` : '');
}

export function tgiftSettingsHTML() {
  const d = A().tgifts;
  if (!d) return '';
  const admin = isAdmin();
  return `<form data-form="tgiftSettings" class="tg-settings" data-keep-dirty>
    <h2>🎁 Masa hədiyyələri — ayarlar</h2>
    <label>Alana keçən faiz (0–100)</label>
    <input name="sharePct" type="number" inputmode="numeric" min="0" max="100" step="1" value="${d.sharePct}" ${admin ? '' : 'disabled'}>
    ${d.gifts.map((g) => `<div class="row tg-row">
      <div><label>${esc(g.name)} — qiymət (xal)</label><input name="price_${esc(g.id)}" type="number" inputmode="numeric" min="1" step="1" value="${g.price}" ${admin ? '' : 'disabled'}></div>
      <div><label>Alana % (boş = ümumi ${d.sharePct}%)</label><input name="pct_${esc(g.id)}" type="number" inputmode="numeric" min="0" max="100" step="1" value="${g.ownPct ?? ''}" placeholder="${d.sharePct}" ${admin ? '' : 'disabled'}></div>
      <label class="check" style="flex:0 0 auto;margin-top:26px"><input type="checkbox" name="active_${esc(g.id)}" ${g.active ? 'checked' : ''} ${admin ? '' : 'disabled'}> Aktiv</label>
    </div>`).join('')}
    <p class="muted" style="font-size:12px">Dəyişiklik yalnız bundan sonrakı hədiyyələrə aiddir; keçmiş əməliyyatlarda o anki qiymət və faiz saxlanılıb (tarixçə: "Masa hədiyyələri" siyahısı). Hədiyyəyə ayrıca faiz yazılmasa ümumi faiz tətbiq olunur. Nəticə aşağı yuvarlaqlaşdırılır. Hədiyyələr yalnız virtual xaldır, real pula çevrilmir.</p>
    ${admin ? '<button class="btn primary">Yadda saxla</button>' : '<p class="muted">Ayarları yalnız admin dəyişə bilər.</p>'}
  </form>`;
}

export function adminListHTML() {
  switch (S.adminTab) {
    case 'users': return usersList();
    case 'credit': return creditList();
    case 'loans': return loansList();
    case 'gifts': return giftsList();
    case 'tgifts': return tgiftsList();
    case 'tx': {
      const who = A().txUser ? A().users.find((u) => u.id === A().txUser) : null;
      return `${who ? `<div class="row" style="margin-bottom:8px"><b>${esc(who.displayName)}</b><button class="btn small" style="flex:0 0 auto" data-a="txAll">Hamısı</button></div>` : ''}${txList(A().tx.filter((t) => match(azLower(A().q).trim(), t.user_name, t.reason)), true)}`;
    }
    case 'stats': return `<p class="muted" style="font-size:13px">${STATS_NOTE}</p>` + (A().pairs.filter((p) => match(azLower(A().q).trim(), p.aName, p.bName)).map((p) => `
      <div class="tx"><div><b>${esc(p.aName)}</b> — <b>${esc(p.bName)}</b>
        <div class="meta">${esc(p.aName)} uddu: ${fmtCents(p.aWonCents)} · ${esc(p.bName)} uddu: ${fmtCents(p.bWonCents)}</div></div>
      <div class="d ${p.aNetCents >= 0 ? 'plus' : 'minus'}">${esc(p.aName)}: ${fmtCents(p.aNetCents, true)}</div></div>`).join('') || '<p class="muted">Hələ qeyd yoxdur.</p>');
    case 'settings': return isAdmin() ? `
      <div class="card-sub">
        <h3>👤 Oyunçu əlavə et</h3>
        <form data-form="adminCreateUser" data-key="adminCreateUser" data-keep-dirty autocomplete="off">
          <label>Görünən ad</label><input name="displayName" maxlength="20" required placeholder="məs. Anar">
          <label>İstifadəçi adı (unikal, girişdə istifadə olunur)</label><input name="username" autocapitalize="none" autocorrect="off" spellcheck="false" required placeholder="məs. anar_m">
          <label>İlkin şifrə (ən azı 6 simvol)</label><input name="password" type="text" autocomplete="new-password" required>
          <p class="muted" style="font-size:12px">Başlanğıc bonusu (${A().settings?.signupBonus ?? 100} xal) hesaba yalnız bir dəfə yazılır. Oyunçu daxil olduqdan sonra şifrəsini "Profilim → Şifrəni dəyiş" ilə dəyişə bilər. Açıq qeydiyyat bağlıdır.</p>
          <button class="btn primary">Oyunçunu yarat</button>
        </form>
      </div>
      <div class="card-sub">
        <h3>🔑 Oyunçu girişi</h3>
        <p>Hazırda: <b class="${A().settings?.playerLoginOpen === false ? 'neg-t' : 'pos-t'}">${A().settings?.playerLoginOpen === false ? 'BAĞLI' : 'AÇIQ'}</b></p>
        <button class="btn ${A().settings?.playerLoginOpen === false ? 'green' : 'red'}" data-a="loginSwitch" data-v="${A().settings?.playerLoginOpen === false ? '1' : '0'}">${A().settings?.playerLoginOpen === false ? 'Oyunçu girişini aç' : 'Oyunçu girişini bağla'}</button>
        <p class="muted" style="font-size:12px">Açıq: aktiv hesablar istifadəçi adı və şifrə ilə daxil olur. Bağlı: adi oyunçuların YENİ girişləri dayanır. Admin girişi həmişə işləyir, açıq qeydiyyat hər iki rejimdə bağlıdır. Bağlamaq artıq daxil olmuş oyunçuları çıxarmır — kimisə dərhal çıxarmaq üçün həmin hesabı bloklayın (bloklananda onun sessiyaları və bağlantıları dərhal kəsilir). Ayar bazada saxlanılır, server yenidən başlayanda da qalır.</p>
      </div>
      <form data-form="adminSettings" data-key="adminSettings" data-keep-dirty>
        <label>Yeni qeydiyyat bonusu (virtual xal)</label>
        <input name="signupBonus" type="number" inputmode="numeric" min="0" value="${A().settings?.signupBonus ?? 100}">
        <p class="muted" style="font-size:12px">Yeni məbləğ yalnız bundan sonrakı qeydiyyatlara tətbiq olunur. Mövcud hesablara yenidən bonus verilmir.</p>
        <button class="btn primary">Yadda saxla</button></form>` : '<p class="muted">Ayarları yalnız admin dəyişə bilər.</p>';
    default: return '';
  }
}

const FILTERS = {
  users: [['all', 'Hamısı'], ['negative', 'Mənfi balans'], ['debt', 'Kredit borcu'], ['blocked', 'Bloklanmış']],
  loans: [['all', 'Hamısı'], ['open', 'Aktiv + gecikmiş'], ['overdue', 'Gecikmiş'], ['offered', 'Təkliflər']],
};

function adminTabsHTML() {
  const pendingCredit = A().credit ? A().credit.requests.filter((r) => r.status === 'pending').length : 0;
  const tabs = [['users', 'İstifadəçilər'], ['credit', `Kredit${pendingCredit ? ` (${pendingCredit})` : ''}`], ['loans', 'Borclar'], ['gifts', 'Hədiyyələr'], ['tgifts', 'Masa hədiyyələri'], ['tx', 'Əməliyyatlar'], ['stats', 'Nəticələr'], ['settings', 'Ayarlar']];
  return tabs.map(([k, l]) => `<button class="btn ${S.adminTab === k ? 'active' : ''}" data-a="adminTab" data-v="${k}">${l}</button>`).join('');
}

export function renderAdmin(topbar) {
  const f = FILTERS[S.adminTab];
  return topbar(`<button class="btn small" data-a="closeAdmin">← Geri</button>`) + `
  <div class="wrap">
    <div class="tabs scroll" id="adminTabs">${adminTabsHTML()}</div>
    ${S.adminTab === 'tgifts' ? `<div class="card-panel" id="tgSettings">${tgiftSettingsHTML()}</div>` : ''}
    <div class="card-panel">
      ${S.adminTab !== 'settings' ? `<div class="row admin-tools">
        <input id="adminSearch" type="search" placeholder="Ad və ya istifadəçi adı ilə axtar..." value="${esc(A().q)}" autocomplete="off">
        ${f ? `<select id="adminFilter">${f.map(([v, l]) => `<option value="${v}" ${A().filter === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
      </div>` : ''}
      <div id="adminList">${adminListHTML()}</div>
    </div>
  </div>`;
}

// Canlı yenilənmə ("staff" bildirişi, axtarış, filtr): innerHTML YOX, morph — yalnız dəyişən hissələr yerində yenilənir.
// Doldurulan formalar (oyunçu yaratma, kredit qərarı, ayarlar) DOM-da qalır: yazılan mətn, kursor və fokus itmir.
// Kredit kartları müraciət id-si ilə (data-key) uyğunlaşdırılır — yeni müraciət yuxarıya düşəndə bir formanın
// yazıları başqa müraciətin formasına keçmir. data-keep-dirty: dəyişdirilmiş sahələrin üzərinə yazılmır.
export function refreshAdminList() {
  const tabs = document.getElementById('adminTabs');
  if (tabs) morph(tabs, adminTabsHTML());
  const el = document.getElementById('adminList');
  if (el) morph(el, adminListHTML());
  const st = document.getElementById('tgSettings');
  if (st) morph(st, tgiftSettingsHTML());
}

export function adminForms(render, reload) {
  return {
    creditDecide: async (data, form, submitter) => {
      const id = Number(form.dataset.id);
      const decision = submitter?.value || 'approve';
      if (decision === 'reject') {
        if (!confirm('Müraciəti rədd edirsiniz?')) return;
        const r = await moneyCall(`creditReject${id}`, `/api/admin/credit/${id}/reject`, { note: data.note });
        if (r) { toast(r.duplicate ? 'Artıq işlənib.' : 'Rədd edildi.', true); reload(); }
        return;
      }
      if (!confirm(`${data.amount} xal kredit verilsin?${data.newLimit !== '' ? ` Limit: ${data.newLimit} xal.` : ''}`)) return;
      const r = await moneyCall(`creditApprove${id}`, `/api/admin/credit/${id}/approve`, { amount: Number(data.amount), newLimit: data.newLimit === '' ? null : Number(data.newLimit), note: data.note });
      if (r) { toast(r.duplicate ? 'Artıq təsdiqlənib.' : 'Kredit verildi.', true); reload(); }
    },
    tgiftSettings: async (data, form) => {
      const gifts = (A().tgifts?.gifts || []).map((g) => ({ id: g.id, price: Number(data[`price_${g.id}`]), active: data[`active_${g.id}`] === 'on', sharePct: data[`pct_${g.id}`] === '' ? null : Number(data[`pct_${g.id}`]) }));
      const r = await api('/api/admin/table-gifts/settings', { sharePct: Number(data.sharePct), gifts });
      A().tgifts = { ...A().tgifts, ...r };
      const st = document.getElementById('tgSettings');
      if (st) { delete st.dataset.dirty; morph(st, tgiftSettingsHTML()); st.querySelector('form')?.reset(); } // saxlanmış dəyərləri göstər
      toast(`Yadda saxlanıldı: alana ${r.sharePct}%.`, true);
    },
    adminCreateUser: async (data, form) => {
      const r = await api('/api/admin/users', { displayName: data.displayName, username: data.username, password: data.password });
      toast(`Yaradıldı: ${r.user.displayName} (@${r.user.username})${r.bonus ? ` · bonus ${r.bonus} xal` : ''}. Şifrəni oyunçuya şəxsən göndərin.`, true);
      form.reset();
      reload();
    },
    adminSettings: async (data) => {
      const r = await api('/api/admin/settings', { signupBonus: Number(data.signupBonus) });
      A().settings = { ...(A().settings || {}), ...r };
      toast(`Bonus: ${fmt(r.signupBonus)} (yalnız yeni qeydiyyatlar)`, true);
    },
  };
}

export function adminHandlers(render, reload) {
  const user = (el) => A().users.find((x) => x.id === Number(el.dataset.id));
  return {
    adminMore: () => { A().page++; refreshAdminList(); },
    loginSwitch: async (el) => {
      const open = el.dataset.v === '1';
      if (!open && !confirm('Oyunçuların yeni girişləri bağlansın? Artıq daxil olmuş oyunçular çıxarılmayacaq.')) return;
      const r = await api('/api/admin/login-switch', { open });
      A().settings = { ...(A().settings || {}), playerLoginOpen: r.playerLoginOpen };
      toast(r.playerLoginOpen ? 'Oyunçu girişi açıldı.' : 'Oyunçu girişi bağlandı.', true);
      refreshAdminList();
    },
    uBalance: (el) => {
      const u = user(el);
      S.modal = { title: `Balans: ${u.displayName}`, kind: 'adminBalance', id: u.id, submitLabel: 'Təsdiqlə',
        text: `Hazırkı balans: ${fmt(u.balance)}. Məbləği müsbət yazın, əməliyyatı seçin. Çıxma balansı 0-dan aşağı salmır.`,
        fieldsHTML: `<div class="seg"><label><input type="radio" name="op" value="add" checked> ➕ Əlavə et</label><label><input type="radio" name="op" value="sub"> ➖ Çıx</label></div>
          <label>Məbləğ (xal)</label><input name="amount" type="number" inputmode="numeric" min="1" required>
          <label>Qeyd (istəyə görə)</label><input name="note" maxlength="100">` };
      render();
    },
    uGift: (el) => {
      const u = user(el);
      S.modal = { title: `🎁 Hədiyyə: ${u.displayName}`, kind: 'adminGift', id: u.id, submitLabel: 'Göndər',
        text: 'Sistemdən verilir — sizin balansınızdan çıxılmır. Borc və ya oyun qazancı sayılmır.',
        fields: [{ name: 'amount', label: 'Məbləğ (xal)', type: 'number' }, { name: 'note', label: 'Qeyd (istəyə görə)' }] };
      render();
    },
    uLimit: (el) => {
      const u = user(el);
      S.modal = { title: `Kredit limiti: ${u.displayName}`, kind: 'adminLimit', id: u.id, submitLabel: 'Təyin et',
        text: `Hazırkı borc: ${fmt(u.creditDebt)}. Limit borcdan az ola bilməz. Limit avtomatik kredit vermir — hər kredit ayrıca təsdiq tələb edir.`,
        fields: [{ name: 'limit', label: 'Limit (xal)', type: 'number', value: u.creditLimit }] };
      render();
    },
  };
}

export async function adminModalSubmit(m, data) {
  if (m.kind === 'adminBalance') {
    if (!confirm(`${data.op === 'sub' ? 'Çıx' : 'Əlavə et'}: ${data.amount} xal?`)) return false;
    const r = await moneyCall(`adminBalance${m.id}`, `/api/admin/users/${m.id}/balance`, { op: data.op, amount: Number(data.amount), note: data.note });
    if (r) toast('Balans yeniləndi.', true);
    return !!r;
  }
  if (m.kind === 'adminGift') {
    const r = await moneyCall(`adminGift${m.id}`, `/api/admin/users/${m.id}/gift`, { amount: Number(data.amount), note: data.note });
    if (r) toast('Hədiyyə göndərildi.', true);
    return !!r;
  }
  if (m.kind === 'adminLimit') {
    const r = await moneyCall(`adminLimit${m.id}`, `/api/admin/users/${m.id}/credit-limit`, { limit: Number(data.limit) });
    if (r) toast('Limit təyin edildi.', true);
    return !!r;
  }
  return null;
}
