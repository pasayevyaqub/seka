// v2.8 brauzer yoxlaması (Playwright/Chromium, real server, iki real oyunçu):
// xal məxfiliyi, balans məxfiliyi (DOM), onlayn status və bərpası, çat tarixçəsi + oxunmamış sayı + yazı fokusu,
// masadan borc təklifi → qəbul, "Şir" hədiyyəsi (tam ekran, oyunu bloklamır, yüngül rejim), səs yoxlama düyməsi,
// server yenidən başlayanda "yenidən qoşulur" statusu və bərpa.
// İşə salma: node tools/ui-v28.cjs  (özü test serveri başladır; SHOTS=qovluq — ekran görüntüləri)
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = Number(process.env.PORT || 3531);
const B = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS || '';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-ui28-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let srv = null;
function startServer() {
  srv = spawn(process.execPath, [path.join(__dirname, 'devserver.mjs')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((res) => { srv.stdout.on('data', (d) => { if (String(d).includes('Test serveri')) res(); }); });
}
async function j(p, body, cookie) {
  const r = await fetch(B + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { data: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie')?.split(';')[0], status: r.status };
}
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.png` }); };
const errors = [];
async function page(browser, user, opts = {}) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 664 }, ...opts });
  // v3.1: yeni raunda razılıq — bu skriptdə digər oyunçu avtomatik "Razıyam" basır (razılıq UI-si ui-v31.cjs-də ayrıca yoxlanılır)
  await ctx.addInitScript(() => setInterval(() => document.querySelector('[data-a=consentYes]:not([disabled])')?.click(), 250));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${user}: ${e.message}`));
  p.on('dialog', (d) => d.accept());
  await p.goto(B);
  await p.fill('input[name=username]', user); await p.fill('input[name=password]', 'pass1234');
  await p.click('form[data-form=login] button');
  await p.waitForSelector('form[data-form=create]');
  return p;
}
const text = (p, sel) => p.textContent(sel).then((t) => (t || '').trim()).catch(() => '');

(async () => {
  await startServer();
  const res = {};
  const adm = (await j('/api/login', { username: 'admin', password: 'admin123' })).cookie;
  for (const [u, d] of [['yaqub', 'Yaqub'], ['anar', 'Anar']]) {
    const r = await j('/api/admin/users', { username: u, password: 'pass1234', displayName: d }, adm);
    await j(`/api/admin/users/${r.data.id}/balance`, { op: 'add', amount: 1877, key: `seed-${u}-000001` }, adm); // 100 bonus + 1877 = 1977
  }
  const browser = await chromium.launch();
  const A = await page(browser, 'yaqub');
  const Bp = await page(browser, 'anar');
  await A.fill('form[data-form=create] input[name=name]', 'Dostlar');
  await A.click('form[data-form=create] button');
  await A.waitForSelector('.rb-code');
  const code = (await text(A, '.rb-code')).replace(/[^A-Z0-9]/g, '');
  await Bp.fill('form[data-form=join] input[name=code]', code);
  await Bp.click('form[data-form=join] button');
  await A.waitForFunction(() => document.querySelectorAll('.seat').length === 2);
  await sleep(400);

  // ---- 6) onlayn status ----
  res.onlineBoth = await A.evaluate(() => [...document.querySelectorAll('.seat .ol-dot')].map((d) => d.className.includes(' on')));

  // ---- start ----
  await A.click('[data-a=start]');
  await A.waitForSelector('.myhand .peek-card');
  await Bp.waitForSelector('.myhand .peek-card');
  await sleep(1500);

  // ---- 8) balans məxfiliyi: B-nin ekranında A-nın balansı (1967) yoxdur, özününkü var ----
  res.balancePrivacy = await Bp.evaluate(() => {
    const t = document.body.innerText.replace(/\s/g, '');
    return { ownShown: t.includes('1967xal'), othersHidden: (t.match(/1967/g) || []).length === 1 };
  });

  // ---- 1) xal yalnız baxandan sonra ----
  res.scoreBefore = await text(A, '.myhand .xal-badge');
  await shot(A, '01-xal-gizli');
  await A.click('.eye-btn');
  await A.waitForFunction(() => /\d+ xal/.test(document.querySelector('.myhand .xal-badge')?.textContent || ''), null, { timeout: 4000 });
  res.scoreAfter = await text(A, '.myhand .xal-badge');
  await A.click('.eye-btn'); // yenidən ört — xal artıq bilinir (baxılıb)
  await sleep(300);
  res.scoreAfterCover = await text(A, '.myhand .xal-badge');
  res.opponentSeesScore = await Bp.evaluate(() => [...document.querySelectorAll('.seat:not(.me) .sc-score')].length);
  await shot(A, '02-xal-baxandan-sonra');

  // ---- 4) çat: bağlı ikən gələn mesaj → sayğac; açanda tarixçə; yazarkən yeni mesaj fokusu pozmur ----
  await A.fill('#chatInput', 'Salam, Anar!'); await A.press('#chatInput', 'Enter');
  await Bp.waitForFunction(() => document.querySelector('.chat-count') && !document.querySelector('.chat-count').classList.contains('hidden'));
  res.unreadBadge = await text(Bp, '.chat-count');
  await Bp.click('[data-a=toggleChat]');
  await Bp.waitForSelector('.chat-panel .chat-log');
  res.historyAfterOpen = await Bp.evaluate(() => [...document.querySelectorAll('.chat-panel .cm')].map((d) => d.textContent.replace(/^\d\d:\d\d\s*/, '').trim()));
  res.badgeAfterOpen = await Bp.evaluate(() => document.querySelector('.chat-count').classList.contains('hidden'));
  await Bp.click('#chatInput'); await Bp.keyboard.type('Yazıram', { delay: 40 });
  await Bp.evaluate(() => { window.__ci = document.getElementById('chatInput'); });
  await sleep(1600);
  await A.fill('#chatInput', 'İkinci mesaj'); await A.press('#chatInput', 'Enter');
  await Bp.waitForFunction(() => [...document.querySelectorAll('.chat-panel .cm')].some((d) => d.textContent.includes('İkinci mesaj')));
  res.typingKept = await Bp.evaluate(() => ({ same: window.__ci === document.getElementById('chatInput'), focus: document.activeElement === window.__ci, value: window.__ci.value }));
  await shot(Bp, '03-cat-tarixcesi');
  await Bp.fill('#chatInput', '');
  await Bp.click('[data-a=toggleChat]');

  // ---- 2) masadan borc: B avatarına toxunur → "Borc təklif et" → A masada qəbul edir ----
  await Bp.click('.seat:not(.me) .av[data-a=playerMenu]');
  await Bp.waitForSelector('.modal [data-a=offerLoanModal]');
  res.menuButtons = await Bp.evaluate(() => [...document.querySelectorAll('.modal .pm-actions button')].map((b) => b.textContent.trim()));
  await shot(Bp, '04-oyuncu-menyusu');
  await Bp.click('.modal [data-a=offerLoanModal]');
  await Bp.fill('.modal input[name=amount]', '50');
  await Bp.click('.modal button.primary');
  await A.waitForSelector('.loan-strip', { timeout: 5000 });
  res.balanceBeforeAccept = await text(A, '#myBalance');
  await A.click('.loan-strip');
  await A.waitForSelector('.modal [data-op=accept]');
  await shot(A, '05-borc-teklifi-masada');
  await A.click('.modal [data-op=accept]');
  await A.waitForFunction(() => !document.querySelector('.modal [data-op=accept]'), null, { timeout: 5000 });
  await sleep(500);
  res.balanceAfterAccept = await text(A, '#myBalance');
  res.stillInRound = await A.evaluate(() => !!document.querySelector('.myhand .peek-card') && !!document.querySelector('.rbar'));
  await A.click('[data-a=closeModal]').catch(() => {});

  // ---- 9) Şir: A → B, qiymət təsdiqdən əvvəl görünür; tam ekran animasiya hər iki ekranda; klikləri bloklamır ----
  await A.click('.seat:not(.me) .av[data-a=playerMenu]');
  await A.click('.modal [data-a=giftModal]');
  await A.waitForSelector('.modal [data-g=lion]');
  await A.click('.modal [data-g=lion]');
  await A.waitForSelector('.gift-confirm');
  res.lionConfirm = (await text(A, '.gift-confirm')).replace(/\s+/g, ' ');
  await A.click('[data-a=giftSend]');
  await Bp.waitForSelector('.lion-fx', { timeout: 5000 });
  await A.waitForSelector('.lion-fx', { timeout: 5000 });
  await sleep(1300);
  await shot(Bp, '06-sir-tam-ekran');
  res.lionNotBlocking = await Bp.evaluate(() => {
    const el = document.getElementById('chatInput'); const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const mid = document.elementFromPoint(innerWidth / 2, innerHeight * 0.46);
    return { inputClickable: hit === el, centerNotLion: !mid.closest('.lion-fx') };
  });
  await Bp.waitForFunction(() => !document.querySelector('.lion-fx'), null, { timeout: 6000 });
  res.lionGone = true;
  // yüngül rejim: "hərəkəti azalt"
  const L = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 664 }, reducedMotion: 'reduce' });
  const Lp = await L.newPage();
  await Lp.goto(B);
  await Lp.fill('input[name=username]', 'anar'); await Lp.fill('input[name=password]', 'pass1234');
  await Lp.click('form[data-form=login] button');
  await Lp.waitForSelector('.rbar');
  await sleep(500);
  await A.click('.seat:not(.me) .av[data-a=playerMenu]');
  await A.click('.modal [data-a=giftModal]');
  await A.waitForSelector('.modal [data-g=lion]');
  await A.click('.modal [data-g=lion]');
  await A.waitForSelector('.gift-confirm');
  await A.click('[data-a=giftSend]');
  await Lp.waitForSelector('.lion-fx', { timeout: 5000 });
  res.lionLightMode = await Lp.evaluate(() => document.querySelector('.lion-fx').classList.contains('light'));
  await shot(Lp, '07-sir-yungul');
  await L.close();
  const bal = await j('/api/admin/users', null, adm);
  res.balancesDb = Object.fromEntries(bal.data.users.filter((u) => ['yaqub', 'anar'].includes(u.username)).map((u) => [u.username, u.balance]));

  // ---- 7) səs yoxla ----
  await A.click('.rbar [data-a=toggleLog]');
  await A.click('[data-a=soundTest]');
  await sleep(300);
  res.soundToast = await A.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).find((t) => /səs/i.test(t)) || '');
  await A.click('.drawer [data-a=toggleLog]').catch(() => {});

  // ---- 6) B-nin bağlantısı kəsilir → A qırmızı görür; B qayıdır → yaşıl ----
  const bctx = Bp.context();
  await bctx.close();
  await A.waitForFunction(() => document.querySelector('.seat:not(.me) .ol-dot')?.classList.contains('off'), null, { timeout: 8000 });
  res.offlineSeen = true;
  await shot(A, '08-oflayn-qirmizi');
  const B2 = await page(browser, 'anar').catch(() => null);
  if (B2) await B2.waitForSelector('.rbar', { timeout: 6000 }).catch(() => {});
  await A.waitForFunction(() => document.querySelector('.seat:not(.me) .ol-dot')?.classList.contains('on'), null, { timeout: 8000 });
  res.onlineAgain = true;

  // ---- 10) server yenidən başlayır → "yenidən qoşulur" → bərpa ----
  srv.kill('SIGTERM');
  await new Promise((r) => srv.on('exit', r));
  await A.waitForSelector('.conn-banner', { timeout: 8000 });
  res.reconnectBanner = await text(A, '.conn-banner');
  await shot(A, '09-yeniden-qosulur');
  await startServer();
  await A.waitForFunction(() => !document.querySelector('.conn-banner'), null, { timeout: 20000 });
  res.reconnected = await A.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('bərpa')));
  const h = await (await fetch(B + '/health')).json();
  res.health = { ok: h.ok, db: h.db };

  res.errors = errors;
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
  srv.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
})().catch((e) => { console.error(e); try { srv?.kill(); } catch {} process.exit(1); });
