// Masa düzülüşünün avtomatik yoxlaması (Playwright/Chromium): müxtəlif ekran ölçüləri, portret/landşaft, 2–8 oyunçu.
// Ölçülür: oturacaqlar (avatar, ad, pay), öz kartlarım, "Göstər/Ört", xal, bank, idarə düymələri, növbə halqası, çat sətri.
// Xəta sayılır: elementlərin bir-birinin üstünə düşməsi, ekrandan kənara çıxması, üfüqi sürüşmə, çox kiçik toxunma sahəsi.
// İşə salma: SEKA_URL=http://localhost:3000 SHOTS=/tmp/shots node tools/ui-layout.cjs   (admin/admin123 hesabı ilə)
const { chromium } = require('playwright');
const B = process.env.SEKA_URL || 'http://localhost:3000';
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.ONLY || '';
const VIEWPORTS = [
  ['iPhone SE 1', 320, 568], ['Android kiçik', 360, 740], ['iPhone SE 2/3', 375, 667], ['iPhone 13 (Safari panelləri ilə)', 390, 664],
  ['iPhone 13', 390, 844], ['iPhone Pro Max', 430, 932], ['Planşet portret', 768, 1024],
  ['iPhone SE landşaft', 568, 320], ['iPhone SE 2 landşaft', 667, 375], ['iPhone 13 landşaft', 844, 390], ['Pro Max landşaft', 932, 430],
  ['Planşet landşaft', 1024, 768], ['Noutbuk', 1366, 768],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function j(path, body, cookie) {
  const r = await fetch(B + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { data: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie')?.split(';')[0] };
}

// brauzerdə: ölçmə
function measure() {
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.width > 1 && r.height > 1; };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const items = [];
  const add = (group, name, el) => { if (el && vis(el)) items.push({ group, name, ...rect(el) }); };
  document.querySelectorAll('.seat').forEach((s) => {
    const id = s.dataset.seat; const me = s.classList.contains('me');
    const g = me ? 'me' : `seat${id}`;
    add(g, 'avatar', s.querySelector('.av'));
    add(g, 'ad', s.querySelector('.nm-pill'));
    add(g, 'pay/balans', s.querySelector('.bal-pill'));
    add(g, 'status', s.querySelector('.tag'));
    add(g + 'c', 'kartlar', s.querySelector('.sc-row'));
  });
  document.querySelectorAll('.myhand .mh-slot').forEach((el, i) => add('hand', `kart${i + 1}`, el));
  add('handctl', 'Göstər/Ört', document.querySelector('.eye-btn'));
  add('handctl2', 'xal', document.querySelector('.myhand .xal-badge'));
  add('center', 'bank', document.querySelector('.bankbox'));
  add('center2', 'əskinaslar', document.querySelector('.pot-notes'));
  add('ctrl', 'idarə paneli', document.querySelector('.side'));
  add('top', 'üst panel', document.querySelector('.rbar'));
  const ctrlButtons = [...document.querySelectorAll('.side button, .side input:not(#bet), .side .st-v, .rbar button, .eye-btn')].filter(vis).map((b) => ({ name: (b.getAttribute('aria-label') || b.textContent || b.id || '').trim().slice(0, 24), ...rect(b) }));
  return { items, ctrlButtons, vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, arena: rect(document.querySelector('.arena')) };
}

function analyse(m) {
  const issues = [];
  const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const it = m.items;
  // qrup cütləri arasında üst-üstə düşmə (eyni oturacağın öz hissələri bir-birinə toxuna bilər)
  const sameSeat = (a, b) => a.group.replace(/c$/, '') === b.group.replace(/c$/, '') && a.group !== 'hand';
  for (let i = 0; i < it.length; i++) {
    for (let k = i + 1; k < it.length; k++) {
      const a = it[i]; const b = it[k];
      if (a.group === b.group || sameSeat(a, b)) continue;
      if (a.group === 'hand' && b.group === 'hand') continue;
      // panel ilə masa: panel masanın altında ayrıca blokdur
      const ar = inter(a, b);
      const small = Math.min(a.w * a.h, b.w * b.h);
      if (ar > 16 && ar / small > 0.06) issues.push(`üst-üstə: ${a.group}/${a.name} ↔ ${b.group}/${b.name} (${Math.round((ar / small) * 100)}%)`);
    }
  }
  for (const a of it) {
    if (a.x < -2 || a.y < -2 || a.x + a.w > m.vw + 2 || a.y + a.h > m.vh + 2) issues.push(`ekrandan kənar: ${a.group}/${a.name} (${Math.round(a.x)},${Math.round(a.y)},${Math.round(a.w)}×${Math.round(a.h)})`);
  }
  if (m.sw > m.vw + 1) issues.push(`üfüqi sürüşmə: ${m.sw} > ${m.vw}`);
  for (const b of m.ctrlButtons) {
    if (b.w < 30 || b.h < 30) issues.push(`kiçik toxunma sahəsi: "${b.name}" ${Math.round(b.w)}×${Math.round(b.h)}`);
    if (b.x + b.w > m.vw + 1 || b.x < -1 || b.y + b.h > m.vh + 1) issues.push(`düymə ekrandan kənar: "${b.name}"`);
  }
  return issues;
}

(async () => {
  const adm = (await j('/api/login', { username: 'admin', password: 'admin123' })).cookie;
  const uname = `lay${Date.now().toString(36).slice(-5)}`;
  await j('/api/admin/users', { username: uname, password: 'pass1234', displayName: `Yaqub ${uname.slice(-3)}` }, adm);
  // bir dəfə daxil oluruq, sessiya kukisini bütün kontekstlərdə istifadə edirik (giriş sürət limitinə düşməmək üçün)
  const sid = (await j('/api/login', { username: uname, password: 'pass1234' })).cookie.split('=');
  const host = new URL(B).hostname;
  const browser = await chromium.launch();
  const report = [];
  const counts = (process.env.N || '2,3,4,5,6,7,8').split(',').map(Number);
  for (const n of counts) {
    for (const [label, w, h] of VIEWPORTS) {
      if (ONLY && !label.includes(ONLY)) continue;
      const touch = w < 1000;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch });
      await ctx.addCookies([{ name: sid[0], value: sid.slice(1).join('='), domain: host, path: '/' }]);
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      p.on('dialog', (d) => d.accept());
      await p.goto(B);
      await p.waitForSelector('#demoBots, .rbar [data-a=leave]', { timeout: 8000 });
      if (await p.$('.rbar [data-a=leave]')) { await p.click('.rbar [data-a=leave]'); await p.waitForSelector('#demoBots', { timeout: 8000 }); }
      await p.selectOption('#demoBots', String(n - 1));
      await p.click('[data-a=playBot]');
      await p.waitForSelector('[data-a=start]', { timeout: 8000 });
      await p.click('[data-a=start]');
      let ok = false;
      for (let t = 0; t < 80; t++) { if (await p.$('[data-a=xod]')) { ok = true; break; } await sleep(150); }
      await sleep(1400); // paylama animasiyası
      // ipucu ilk dəfədən sonra yox olur — real istifadə vəziyyəti
      await p.evaluate(() => { try { localStorage.setItem('seka-peek-hint', '1'); } catch {} document.querySelectorAll('.peek-hint').forEach((e) => e.remove()); });
      const m = await p.evaluate(measure);
      const issues = ok ? analyse(m) : ['mənim növbəm gəlmədi'];
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/n${n}-${w}x${h}.png` });
      report.push({ n, label, w, h, issues, errors });
      await p.click('.rbar [data-a=leave]').catch(() => {});
      await p.waitForSelector('#demoBots', { timeout: 5000 }).catch(() => {});
      await ctx.close();
    }
  }
  await browser.close();
  const bad = report.filter((r) => r.issues.length || r.errors.length);
  console.log(JSON.stringify({ total: report.length, withIssues: bad.length, bad }, null, 1));
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
