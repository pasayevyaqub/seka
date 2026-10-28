// v3.0 brauzer yoxlaması (Chromium, real server): kart xalı dərhal görünür, yeni raundda xod minimumdan başlayır,
// profil ayarları (şifrə ilə), dərəcə kartı, admin toplu balans (ön baxış + ikinci təsdiq), iPhone eni.
// İşə salma: node tools/ui-v30.cjs   (özü test serveri başladır; SHOTS=qovluq — ekran görüntüləri)
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = Number(process.env.PORT || 3543);
const B = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS || '';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-ui30-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let srv;
function startServer() {
  srv = spawn(process.execPath, [path.join(__dirname, 'devserver.mjs')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((res) => srv.stdout.on('data', (d) => { if (String(d).includes('Test serveri')) res(); }));
}
async function j(p, body, cookie) {
  const r = await fetch(B + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { data: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
const errors = [];
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false }); };
async function page(browser, user, pass = 'pass1234', dev = { ...devices['iPhone 13'], viewport: { width: 390, height: 664 } }) {
  const ctx = await browser.newContext(dev);
  // v3.1: yeni raunda razılıq — bu skriptdə digər oyunçu avtomatik "Razıyam" basır (razılıq UI-si ui-v31.cjs-də ayrıca yoxlanılır)
  await ctx.addInitScript(() => setInterval(() => document.querySelector('[data-a=consentYes]:not([disabled])')?.click(), 250));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${user}: ${e.message}`));
  p.on('dialog', (d) => d.accept());
  await p.goto(B);
  await p.fill('input[name=username]', user); await p.fill('input[name=password]', pass);
  await p.click('form[data-form=login] button');
  await p.waitForSelector('form[data-form=create], .topbar');
  return p;
}

(async () => {
  await startServer();
  const res = {};
  const adm = (await j('/api/login', { username: 'admin', password: 'admin123' })).cookie;
  for (const [u, d] of [['yaqub', 'Yaqub'], ['anar', 'Anar']]) {
    const r = await j('/api/admin/users', { username: u, password: 'pass1234', displayName: d }, adm);
    await j(`/api/admin/users/${r.data.id}/balance`, { op: 'add', amount: 9900, key: `seed-${u}-00000001` }, adm);
  }
  const browser = await chromium.launch();
  const Y = await page(browser, 'yaqub'); const A = await page(browser, 'anar');
  await Y.fill('form[data-form=create] input[name=name]', 'Dostlar'); await Y.click('form[data-form=create] button');
  await Y.waitForSelector('.rb-code');
  const code = (await Y.textContent('.rb-code')).replace(/[^A-Z0-9]/g, '');
  await A.fill('form[data-form=join] input[name=code]', code); await A.click('form[data-form=join] button'); await A.waitForSelector('.rbar');
  await Y.waitForFunction(() => document.querySelectorAll('.seat').length === 2);

  // ---- 3) kart xalı: "Göstər" → xal dərhal (server cavabını gözləmədən) ----
  await Y.click('[data-a=start]');
  await Y.waitForSelector('.myhand .peek-card'); await A.waitForSelector('.myhand .peek-card');
  await sleep(1200);
  res.scoreBefore = (await Y.textContent('.myhand .xal-badge')).trim();
  // bağlantını qəsdən kəsirik: xal yenə də dərhal görünməlidir (yerli hesab, server qaydası ilə eyni)
  await Y.evaluate(async () => { const { S } = await import('/core.js'); S.ws.onmessage = null; });
  await Y.click('.eye-btn');
  res.scoreImmediate = (await Y.textContent('.myhand .xal-badge')).trim();
  await Y.reload(); await Y.waitForSelector('.myhand');
  await sleep(800);

  // ---- 4) xod 5000 → yeni raundda stepper otağın minimumundan (10) başlayır ----
  const who = async () => (await Y.$('[data-a=xod]')) ? Y : A;
  let P = await who(); const Q = P === Y ? A : Y;
  await P.fill('#bet', '5000'); await P.click('[data-a=xod]');
  await Q.waitForSelector('[data-a=pas]'); await Q.click('[data-a=pas]');
  await Y.waitForSelector('[data-a=start]');
  await Y.click('[data-a=start]');
  await sleep(1200);
  P = await who();
  res.nextRoundBet = await P.inputValue('#bet');
  await shot(P, '01-yeni-raund-minimum');
  // raundu bitir
  await P.click('[data-a=pas]'); await sleep(800);
  await Y.click('.rbar [data-a=leave]'); await A.click('.rbar [data-a=leave]');
  await Y.waitForSelector('form[data-form=create]');

  // ---- 5) profil ayarları ----
  await Y.click('[data-a=openProfile]'); await Y.waitForSelector('form[data-form=account]');
  res.rankCard = (await Y.textContent('.rank-card h2')).trim();
  await Y.fill('form[data-form=account] input[name=displayName]', 'Yaqub Paşayev');
  await Y.fill('form[data-form=account] input[name=phone]', '+994501112233');
  await Y.fill('form[data-form=account] input[name=currentPassword]', 'yanlis');
  await Y.click('form[data-form=account] button');
  await sleep(500);
  res.wrongPassToast = await Y.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).find((t) => /şifrə/i.test(t)) || '');
  await Y.fill('form[data-form=account] input[name=currentPassword]', 'pass1234');
  await Y.click('form[data-form=account] button');
  await sleep(800);
  res.profileSaved = await Y.evaluate(() => document.querySelector('.prof-head').textContent.includes('Yaqub Paşayev'));
  res.phoneUnverifiedShown = await Y.evaluate(() => /təsdiqlənməyib/.test(document.querySelector('form[data-form=account]').textContent));
  res.passwordFieldsCleared = await Y.evaluate(() => ['currentPassword', 'newPassword', 'newPassword2'].every((n) => document.querySelector(`form[data-form=account] input[name=${n}]`).value === ''));
  await Y.evaluate(() => document.querySelector('.rank-card').scrollIntoView());
  await shot(Y, '02-profil-derece');
  await Y.evaluate(() => document.querySelector('form[data-form=account]').scrollIntoView());
  await shot(Y, '03-profil-ayarlar');

  // ---- 6) admin toplu balans: ön baxış → təsdiq düyməsi → ikinci təsdiq ----
  const AD = await page(browser, 'admin', 'admin123');
  await AD.click('[data-a=openAdmin]'); await AD.click('[data-a=adminTab][data-v=settings]');
  await AD.waitForSelector('form[data-form=bulkGrant]');
  await AD.fill('form[data-form=bulkGrant] input[name=amount]', '500');
  await AD.click('form[data-form=bulkGrant] button');
  await AD.waitForSelector('[data-a=bulkConfirm]');
  res.bulkPreview = (await AD.textContent('.modal')).replace(/\s+/g, ' ').slice(0, 160);
  await shot(AD, '04-admin-toplu-onbaxis');
  await AD.click('[data-a=bulkConfirm]');
  await sleep(1000);
  const users = (await j('/api/admin/users', null, adm)).data.users;
  res.balancesAfterGrant = Object.fromEntries(users.filter((u) => ['yaqub', 'anar'].includes(u.username)).map((u) => [u.username, u.balance]));
  res.adminLogShown = await AD.evaluate(() => /Hamısına/.test(document.querySelector('.danger-zone').textContent));
  await AD.evaluate(() => document.querySelector('.danger-zone').scrollIntoView());
  await shot(AD, '05-admin-qeydiyyat');

  // ---- 2) iPhone eni: heç bir səhifədə üfüqi sürüşmə yoxdur ----
  res.noHScroll = {};
  for (const [n, p] of [['profil', Y], ['admin', AD]]) res.noHScroll[n] = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  res.errors = errors;
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
  srv.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
  const ok = /^\? xal$/.test(res.scoreBefore) && /^\d+ xal$/.test(res.scoreImmediate) && res.nextRoundBet === '10' && /Mövcud şifrə/.test(res.wrongPassToast)
    && res.profileSaved && res.phoneUnverifiedShown && res.passwordFieldsCleared && res.balancesAfterGrant.yaqub > 0 && res.adminLogShown && Object.values(res.noHScroll).every(Boolean) && !errors.length;
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); try { srv?.kill(); } catch { /* */ } process.exit(1); });
