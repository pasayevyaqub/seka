// Kiçik DOM "morph": yeni HTML-i mövcud DOM-a yerində tətbiq edir.
// Məqsəd (xüsusilə iPhone): WebSocket yenilənməsində aktiv input və onun valideynləri DOM-dan ÇIXARILMIR,
// ona görə yazılan mətn, kursor, seçim, fokus, davam edən yazı kompozisiyası (IME, söz təklifləri) və klaviatura pozulmur.
//
// Qaydalar:
//  * Uşaq elementlər id (və ya data-key) ilə, yoxdursa sıra + teq adı ilə uyğunlaşdırılır.
//  * Atributlar yalnız dəyişəndə yenilənir.
//  * input/textarea/select: dəyər yalnız şablondakı "value" atributu DƏYİŞƏNDƏ yazılır və element fokusda deyilsə.
//    Beləliklə istifadəçinin yazdığı mətn fon yeniləməsində üzərinə yazılmır; fokus heç vaxt proqramla verilmir.
//  * data-morph="skip" olan elementin içinə toxunulmur.
//  * data-keep-dirty olan konteynerin (məs. admin formaları) içində istifadəçinin DƏYİŞDİRDİYİ sahə
//    (dəyəri ilkin dəyərindən fərqli olan) fokusda olmasa belə üzərinə yazılmır — yalnız ilkin dəyər yenilənir.
//    Belə sahə form.reset() ilə və ya form yox olanda sıfırlanır.

const keyOf = (n) => (n.nodeType === 1 ? (n.id ? `#${n.id}` : n.getAttribute('data-key')) : null);
const isField = (el) => el.nodeName === 'INPUT' || el.nodeName === 'TEXTAREA' || el.nodeName === 'SELECT';

export function morph(root, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(root, tpl.content);
}

function patchChildren(parent, next) {
  const oldKids = [...parent.childNodes];
  const newKids = [...next.childNodes];
  const keyed = new Map();
  const newKeys = new Set(newKids.map(keyOf).filter(Boolean));
  for (const o of oldKids) {
    const k = keyOf(o);
    if (!k) continue;
    // yeni siyahıda olmayan açarlı element ƏVVƏLCƏDƏN çıxarılır: beləliklə qalan elementlər yerindən
    // tərpədilmir (insertBefore ilə köçürmə fokuslu input-u blur edir və iPhone-da klaviaturanı bağlayır)
    if (!newKeys.has(k)) { parent.removeChild(o); continue; }
    keyed.set(k, o);
  }
  const used = new Set();
  let ref = parent.firstChild;
  const advance = () => { while (ref && used.has(ref)) ref = ref.nextSibling; };
  for (const n of newKids) {
    advance();
    let match = null;
    const k = keyOf(n);
    if (k) {
      const o = keyed.get(k);
      if (o && !used.has(o) && o.nodeName === n.nodeName) match = o;
    } else if (ref && !keyOf(ref) && ref.nodeType === n.nodeType && ref.nodeName === n.nodeName) {
      match = ref;
    }
    if (match) {
      used.add(match);
      // fokuslu sahəni saxlayan element köçürülmür — əvəzinə aradakı elementlər sona aparılır (sonra öz yerinə düşəcəklər)
      const act = document.activeElement;
      if (match !== ref && act && act !== document.body && match.contains(act)) {
        while (ref && ref !== match) { const nx = ref.nextSibling; parent.appendChild(ref); ref = nx; }
      }
      if (match !== ref) parent.insertBefore(match, ref);
      else ref = ref.nextSibling;
      patchNode(match, n);
    } else {
      parent.insertBefore(n, ref);
      used.add(n);
    }
  }
  for (const o of oldKids) if (!used.has(o) && o.parentNode === parent) parent.removeChild(o);
}

function patchNode(old, nw) {
  if (old.nodeType === 3 || old.nodeType === 8) {
    if (old.nodeValue !== nw.nodeValue) old.nodeValue = nw.nodeValue;
    return;
  }
  if (old.nodeType !== 1) return;
  const focused = old === document.activeElement;
  const field = isField(old);
  // istifadəçinin dəyişdirdiyi sahə (atributlar yenilənməzdən ƏVVƏL yoxlanılır)
  const keep = field && !!old.closest('[data-keep-dirty]');
  const dirtyVal = keep && old.nodeName !== 'SELECT' && old.value !== old.defaultValue;
  const dirtyChk = keep && (old.type === 'checkbox' || old.type === 'radio') && old.checked !== old.defaultChecked;
  // atributlar
  for (const a of [...old.attributes]) {
    if (!nw.hasAttribute(a.name)) {
      if (field && (a.name === 'value' || a.name === 'checked')) continue; // istifadəçi vəziyyəti
      old.removeAttribute(a.name);
    }
  }
  for (const a of [...nw.attributes]) {
    const prev = old.getAttribute(a.name);
    if (prev === a.value) continue;
    old.setAttribute(a.name, a.value);
    if (field && !focused) {
      if (a.name === 'value' && !dirtyVal && old.value !== a.value) old.value = a.value;
      if (a.name === 'checked' && !dirtyChk) old.checked = true;
    }
  }
  if (field && old.type === 'checkbox' && !nw.hasAttribute('checked') && old.hasAttribute('checked') && !focused && !dirtyChk) {
    old.removeAttribute('checked'); old.checked = false;
  }
  if (old.nodeName === 'TEXTAREA') return; // mətn sahəsinin içinə toxunulmur
  if (old.getAttribute('data-morph') === 'skip') return;
  patchChildren(old, nw);
}
