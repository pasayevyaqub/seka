// Admin paneli: canlı "staff" bildirişi gələndə doldurulan formalar (oyunçu yaratma, kredit qərarı, ayarlar)
// pozulmamalıdır. İşə salma: server işləyərkən  SEKA_URL=http://localhost:3000 node tools/ui-admin-morph.cjs
// (admin/admin123 standart admin hesabı ilə). Nəticə JSON; "ok": false olarsa çıxış kodu 1.
const { chromium } = require('playwright');
const B = process.env.SEKA_URL || 'http://localhost:3000';
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36).slice(-5);

async function req(path, body, cookie) {
  const r = await fetch(B + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${r.status} ${data.error || ''}`);
  return { data, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
const login = async (u, p) => (await req('/api/login', { username: u, password: p })).cookie;
const creditRequest = (cookie, amount) => req('/api/credit/request', { amount, note: 'test', key: `cr-${uniq}-${Math.random().toString(36).slice(2, 10)}` }, cookie);

(async () => {
  const adm = await login('admin', 'admin123');
  const players = [];
  for (let i = 1; i <= 4; i++) {
    const username = `mrf${uniq}${i}`;
    await req('/api/admin/users', { username, password: 'pass1234', displayName: `Test${i}` }, adm);
    players.push(await login(username, 'pass1234'));
  }
  const browser = await chromium.launch();
  const p = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto(B);
  await p.fill('input[name=username]', 'admin'); await p.fill('input[name=password]', 'admin123');
  await p.click('form[data-form=login] button'); await sleep(900);
  await p.click('[data-a=openAdmin]'); await sleep(500);
  const res = {};

  // ---- 1) Ayarlar: oyunçu yaratma formu yarımçıq + fokus parolda, bu vaxt staff bildirişi gəlir ----
  await p.click('[data-a=adminTab][data-v=settings]'); await sleep(600);
  const F = 'form[data-form=adminCreateUser]';
  await p.fill(`${F} input[name=displayName]`, 'Yarımçıq Ad');
  await p.fill(`${F} input[name=username]`, 'yarimciq_user');
  await p.click(`${F} input[name=password]`); await p.keyboard.type('abc12', { delay: 40 });
  await p.fill('form[data-form=adminSettings] input[name=signupBonus]', '250'); // dəyişdirilib, fokusda deyil
  await p.click(`${F} input[name=password]`); await p.keyboard.press('End');
  await p.evaluate(() => { window.__pw = document.querySelector('form[data-form=adminCreateUser] input[name=password]'); window.__form = window.__pw.form; });
  await creditRequest(players[0], 30); // → toStaff → loadAdmin(refreshAdminList)
  await sleep(1500);
  await p.keyboard.type('3', { delay: 40 }); // yazmağa davam edir
  res.createForm = await p.evaluate(() => {
    const f = document.querySelector('form[data-form=adminCreateUser]');
    return {
      sameForm: f === window.__form, samePasswordNode: f.password === window.__pw,
      focused: document.activeElement === window.__pw,
      displayName: f.displayName.value, username: f.username.value, password: f.password.value,
      caret: f.password.selectionStart === f.password.value.length,
      bonus: document.querySelector('form[data-form=adminSettings] input[name=signupBonus]').value,
    };
  });
  res.toastSeen = await p.evaluate(() => /kredit istəyir/.test(document.body.textContent));

  // ---- 2) Kredit tabı: iki gözləyən müraciət; ikincinin formasını doldururuq ----
  await creditRequest(players[1], 40);
  await p.click('[data-a=adminTab][data-v=credit]'); await sleep(800);
  const ids = await p.$$eval('form[data-form=creditDecide]', (fs) => fs.map((f) => Number(f.dataset.id)));
  const target = ids[ids.length - 1]; // ən köhnə (Test1, 30 xal)
  const T = `form[data-form=creditDecide][data-id="${target}"]`;
  await p.fill(`${T} input[name=amount]`, '25');
  await p.fill(`${T} input[name=newLimit]`, '777');
  await p.click(`${T} input[name=note]`); await p.keyboard.type('yoxlanır', { delay: 40 });
  await p.evaluate((sel) => { window.__note = document.querySelector(sel + ' input[name=note]'); }, T);
  const tabBefore = await p.textContent('[data-a=adminTab][data-v=credit]');
  // yeni müraciət siyahının YUXARISINA düşür (sıralama dəyişir) + staff bildirişi
  await creditRequest(players[2], 50); await sleep(1500);
  // başqa müraciət başqa yerdən təsdiqlənir (kart siyahıdan çıxır), sonra yenə staff bildirişi
  await req(`/api/admin/credit/${ids[0]}/approve`, { amount: 40, newLimit: 100, key: `ap-${uniq}-xxxxxxxx` }, adm);
  await creditRequest(players[3], 60); await sleep(1500);
  await p.keyboard.type('!', { delay: 40 });
  res.creditForm = await p.evaluate(([sel, approved]) => {
    const f = document.querySelector(sel);
    return {
      exists: !!f, sameNoteNode: f?.note === window.__note, focused: document.activeElement === window.__note,
      amount: f?.amount.value, newLimit: f?.newLimit.value, note: f?.note.value,
      cards: document.querySelectorAll('form[data-form=creditDecide]').length,
      approvedGone: !document.querySelector(`form[data-form=creditDecide][data-id="${approved}"]`),
      untouchedOthers: [...document.querySelectorAll('form[data-form=creditDecide]')].filter((x) => x !== f).every((x) => x.note.value === ''),
    };
  }, [T, ids[0]]);
  res.tabCount = [tabBefore.trim(), (await p.textContent('[data-a=adminTab][data-v=credit]')).trim()];
  await p.screenshot({ path: `${process.env.SHOTS || '/tmp'}/admin-morph.png`, fullPage: true });

  // ---- 3) morph birbaşa: sıra dəyişəndə/silinəndə fokuslu, dəyişdirilmiş sahə yerində qalır ----
  res.morphUnit = await p.evaluate(async () => {
    const { morph } = await import('/morph.js');
    const box = document.createElement('div'); document.body.appendChild(box);
    const item = (id, v) => `<div data-key="k${id}"><form data-keep-dirty><input name="a" value="${v}"><input name="b" value="${v}"><input name="c" value="${v}"></form></div>`;
    morph(box, [1, 2, 3, 4].map((i) => item(i, i)).join(''));
    const a3 = box.querySelector('[data-key=k3] input[name=a]'); const b3 = box.querySelector('[data-key=k3] input[name=b]');
    b3.value = 'dəyişdi'; a3.focus(); a3.value = 'yazıram'; a3.setSelectionRange(2, 4);
    let blurs = 0; a3.addEventListener('blur', () => blurs++);
    const out = [];
    const check = (name) => out.push([name, box.querySelector('[data-key=k3] input[name=a]') === a3 && document.activeElement === a3 && a3.value === 'yazıram'
      && a3.selectionStart === 2 && a3.selectionEnd === 4 && b3.value === 'dəyişdi' && blurs === 0]);
    morph(box, [3, 1, 2, 4].map((i) => item(i, i)).join('')); check('k3 başa');           // fokuslu element irəli
    morph(box, [4, 2, 1, 3].map((i) => item(i, i)).join('')); check('k3 sona');           // tərs sıra
    morph(box, [5, 3].map((i) => item(i, i * 10)).join('')); check('silinmə + yeni dəyər'); // dəyər atributu dəyişir, sahələr dəyişdirilib
    const order = [...box.children].map((d) => d.dataset.key).join(',');
    const untouched = box.querySelector('[data-key=k3] input[name=c]').value === '30';   // istifadəçinin toxunmadığı sahə yeni dəyəri alır
    box.remove();
    return { checks: out, order, untouched };
  });

  const c = res.createForm; const k = res.creditForm; const u = res.morphUnit;
  res.ok = !errors.length && c.sameForm && c.samePasswordNode && c.focused && c.caret && c.displayName === 'Yarımçıq Ad'
    && c.username === 'yarimciq_user' && c.password === 'abc123' && c.bonus === '250'
    && k.exists && k.sameNoteNode && k.focused && k.amount === '25' && k.newLimit === '777' && k.note === 'yoxlanır!'
    && k.cards === 3 && k.approvedGone && k.untouchedOthers && res.tabCount[1] === 'Kredit (3)'
    && u.checks.every(([, ok]) => ok) && u.order === 'k5,k3' && u.untouched;
  console.log(JSON.stringify({ ...res, errors }, null, 1));
  await browser.close();
  process.exit(res.ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
