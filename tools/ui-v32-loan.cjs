// v3.2 brauzer yoxlaması: masada borc istəyi — borc verənin ekranında kiçik bildiriş (kim/kimdən/nə qədər, Qəbul et / Rədd et),
// basılan kimi itir, 10 saniyədən sonra özü itir və istək ləğv olunur, nəticə istəyənə dərhal. Bildiriş kartları və düymələri örtmür.
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = Number(process.env.PORT || 3546);
const B = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS || '';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-ui32l-'));
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
const IPHONE = { ...devices['iPhone 13'], viewport: { width: 390, height: 664 } };
async function page(browser, user, pass = 'pass1234', dev = IPHONE) {
  const ctx = await browser.newContext(dev);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${user}: ${e.message}`));
  p.on('dialog', (d) => d.accept());
  await p.goto(B);
  await p.fill('input[name=username]', user); await p.fill('input[name=password]', pass);
  await p.click('form[data-form=login] button');
  await p.waitForSelector('form[data-form=create], .topbar');
  return p;
}
const popInfo = (p) => p.evaluate(() => {
  const el = document.querySelector('.item-pop');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { w: Math.round(r.width), pe: getComputedStyle(document.getElementById('fx')).pointerEvents, blocksTouch: !!under?.closest('.item-pop'), inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
});

(async () => {
  await startServer();
  const res = {};
  const adm = (await j('/api/login', { username: 'admin', password: 'admin123' })).cookie;
  for (const [u, d, amt] of [['yaqub', 'Yaqub', 900], ['anar', 'Anar', 900]]) {
    const r = await j('/api/admin/users', { username: u, password: 'pass1234', displayName: d }, adm);
    await j(`/api/admin/users/${r.data.id}/balance`, { op: 'add', amount: amt, key: `seed-${u}-00000001` }, adm);
  }
  const bal = async (u) => (await j('/api/admin/users', null, adm)).data.users.find((x) => x.username === u).balance;
  const browser = await chromium.launch();
  const Y = await page(browser, 'yaqub'); const A = await page(browser, 'anar');
  await Y.fill('form[data-form=create] input[name=name]', 'Borc'); await Y.click('form[data-form=create] button');
  await Y.waitForSelector('.rbar');
  const code = await Y.evaluate(async () => (await import('/core.js')).S.room.code);
  await A.fill('form[data-form=join] input[name=code]', code); await A.click('form[data-form=join] button'); await A.waitForSelector('.rbar');
  await Y.waitForFunction(() => document.querySelectorAll('.seat').length === 2);
  // raund gedir (kartlar ekranda)
  await Y.click('[data-a=start]'); await A.waitForSelector('[data-a=consentYes]'); await A.click('[data-a=consentYes]');
  await Y.waitForSelector('.myhand'); await sleep(800);
  const yid = await Y.evaluate(async () => (await import('/core.js')).S.user.id);
  const askFrom = async (amount) => {
    await A.click(`.seat [data-a=playerMenu][data-id="${yid}"]`);
    await A.click('.modal [data-a=askLoanModal]');
    await A.fill('.modal input[name=amount]', String(amount));
    await A.click('.modal form button.primary');
  };
  // 1) qəbul
  const y0 = await bal('yaqub'); const a0 = await bal('anar');
  await askFrom(200);
  await Y.waitForSelector('.loan-ask');
  res.cardText = (await Y.textContent('.loan-ask .la-text')).replace(/\s+/g, ' ').trim();
  res.overlap = await Y.evaluate(() => {
    const c = document.querySelector('.loan-ask').getBoundingClientRect();
    const hit = (sel) => [...document.querySelectorAll(sel)].some((e) => { const r = e.getBoundingClientRect(); return r.width && !(r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom); });
    return { myCards: hit('.myhand .peek-card, .myhand svg'), controls: hit('.ctl-row, .big2, .bet-row, [data-a=xod], [data-a=pas], [data-a=baxis]') };
  });
  res.inView = await Y.evaluate(() => { const c = document.querySelector('.loan-ask').getBoundingClientRect(); return c.top >= 0 && c.right <= innerWidth && c.left >= 0; });
  await shot(Y, '13-borc-istəyi-bildiriş');
  const t0 = Date.now();
  await Y.click('.loan-ask [data-a=loanAskYes]');
  res.goneImmediately = !(await Y.$('.loan-ask'));
  await A.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /qəbul etdi/.test(t.textContent)), null, { timeout: 4000 });
  res.requesterToldMs = Date.now() - t0;
  await sleep(300);
  res.moved = { yaqub: (await bal('yaqub')) - y0, anar: (await bal('anar')) - a0 };
  await shot(A, '14-borc-qəbul-istəyənə');
  // 2) cavabsız → 10 saniyədən sonra itir, istəyənə "vaxtında cavab vermədi"
  await askFrom(100);
  await Y.waitForSelector('.loan-ask');
  const shownAt = Date.now();
  await Y.waitForSelector('.loan-ask', { state: 'detached', timeout: 13000 });
  res.autoHideSec = Math.round((Date.now() - shownAt) / 100) / 10;
  await A.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /vaxtında cavab vermədi/.test(t.textContent)), null, { timeout: 5000 });
  res.expiredToldRequester = true;
  res.noMoneyOnExpire = (await bal('anar')) - a0 === 200;
  // 3) rədd
  await askFrom(50);
  await Y.waitForSelector('.loan-ask');
  await Y.click('.loan-ask [data-a=loanAskNo]');
  res.rejectGone = !(await Y.$('.loan-ask'));
  await A.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /rədd etdi/.test(t.textContent)), null, { timeout: 4000 });
  res.rejectTold = true;
  res.errors = errors;
  console.log(JSON.stringify(res, null, 1));
  await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  const ok = /Anar.*sizdən.*Yaqub.*200 xal/.test(res.cardText) && !res.overlap.myCards && !res.overlap.controls && res.inView && res.goneImmediately
    && res.requesterToldMs < 3000 && res.moved.yaqub === -200 && res.moved.anar === 200 && res.autoHideSec >= 9 && res.autoHideSec <= 11.5
    && res.expiredToldRequester && res.noMoneyOnExpire && res.rejectGone && res.rejectTold && !errors.length;
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); try { srv?.kill(); } catch { /* */ } process.exit(1); });
