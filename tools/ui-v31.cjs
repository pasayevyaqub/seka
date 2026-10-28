// v3.1 brauzer yoxlaması (Chromium, real server): market (🎁 → Market, profil, ayarlar), alış, kolleksiya,
// istifadə effekti (başqa oyunçu da görür, toxunuşa mane olmur), admin market idarəsi, yenidən girişdə kolleksiya qalır.
// İşə salma: node tools/ui-v31.cjs   (özü test serveri başladır; SHOTS=qovluq — ekran görüntüləri)
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = Number(process.env.PORT || 3544);
const B = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS || '';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-ui31-'));
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
  for (const [u, d] of [['yaqub', 'Yaqub'], ['anar', 'Anar']]) {
    const r = await j('/api/admin/users', { username: u, password: 'pass1234', displayName: d }, adm);
    await j(`/api/admin/users/${r.data.id}/balance`, { op: 'add', amount: 900, key: `seed-${u}-00000001` }, adm);
  }
  const myBal = async (u) => (await j('/api/admin/users', null, adm)).data.users.find((x) => x.username === u).balance;
  const browser = await chromium.launch();
  const Y = await page(browser, 'yaqub'); const A = await page(browser, 'anar');
  await Y.fill('form[data-form=create] input[name=name]', 'Market'); await Y.click('form[data-form=create] button');
  await Y.waitForSelector('.rbar');
  const code = await Y.evaluate(async () => (await import('/core.js')).S.room.code);
  await A.fill('form[data-form=join] input[name=code]', code); await A.click('form[data-form=join] button'); await A.waitForSelector('.rbar');
  await Y.waitForFunction(() => document.querySelectorAll('.seat').length === 2);

  // 1) 🎁 → menyu → Market
  await Y.click('[data-a=tableGiftMenu]');
  await Y.waitForSelector('.modal [data-a=openShop][data-v=items]');
  res.menuHasGift = !!(await Y.$('.modal [data-a=giftPickTarget]'));
  await Y.click('.modal [data-a=openShop][data-v=items]');
  await Y.waitForSelector('.shop-grid .shop-card');
  res.items = await Y.$$eval('.shop-card .shop-name', (els) => els.map((e) => e.textContent.trim()));
  res.iconsSvg = await Y.$$eval('.shop-card .item-svg svg', (els) => els.length);
  res.modalNoHScroll = await Y.evaluate(() => { const m = document.querySelector('.modal'); return m.scrollWidth <= m.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth; });
  await shot(Y, '01-market-esyalar');
  // 2) alış (təsdiq ekranı ilə)
  const b0 = await myBal('yaqub');
  await Y.click('.shop-card [data-a=shopBuy][data-id=whisky]');
  await Y.waitForSelector('[data-a=shopConfirm]');
  await shot(Y, '02-market-tesdiq');
  await Y.click('[data-a=shopConfirm]');
  await Y.waitForSelector('.shop-card [data-a=shopUse][data-id=whisky]');
  const b1 = await myBal('yaqub');
  res.charged = b0 - b1;
  res.topbarBalance = (await Y.textContent('#myBalance')).replace(/\D/g, '') === String(b1);
  await shot(Y, '03-kolleksiyam');
  // 3) istifadə: hər iki oyunçu ikonu Yaqubun şəklinin yanında görür; toxunuşa mane olmur
  await Y.click('[data-a=shopUse][data-id=whisky]');
  await Y.waitForSelector('.item-pop'); await A.waitForSelector('.item-pop');
  await sleep(500);
  res.popY = await popInfo(Y); res.popA = await popInfo(A);
  res.popNearSeat = await A.evaluate(async () => {
    const { S } = await import('/core.js');
    const yid = S.room.members.find((m) => m.name === 'Yaqub').id;
    const a = document.querySelector(`[data-seat="${yid}"] .av`).getBoundingClientRect(); const p = document.querySelector('.item-pop').getBoundingClientRect();
    return Math.hypot((a.left + a.width / 2) - (p.left + p.width / 2), (a.top + a.height / 2) - (p.top + p.height / 2)) < 90;
  });
  await shot(A, '04-istifade-diger-oyuncu');
  // effekt zamanı oyun düyməsi işləyir
  await Y.click('[data-a=start]');
  res.startWorkedDuringFx = true;
  // yeni raunda razılıq: Anarda "Razıyam / Bu raundu burax", Yaqubda gözləmə statusu; raund hələ başlamayıb
  await A.waitForSelector('.consent-box.ask [data-a=consentYes]');
  await Y.waitForSelector('.consent-box .cs-chip');
  res.consent = {
    askShown: true,
    hostWaits: await Y.evaluate(() => /razılığı gözlənilir/.test(document.querySelector('.consent-box').textContent)),
    noRoundYet: await Y.evaluate(async () => (await import('/core.js')).S.room.round === null),
    timer: (await A.textContent('.consent-box [data-secs]')).trim(),
    banner: await A.evaluate(() => !!document.querySelector('.turn-banner')),
    noHScroll: await A.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  };
  await shot(A, '04b-razilik-sorgusu');
  await shot(Y, '04c-razilik-gozlenilir');
  await A.click('[data-a=consentYes]');
  await Y.waitForSelector('.myhand'); await A.waitForSelector('.myhand');
  res.consent.startedAfterYes = true;
  await sleep(2800);
  res.popGoneY = !(await Y.$('.item-pop')); res.popGoneA = !(await A.$('.item-pop'));
  // raundu bitir
  const who = async () => (await Y.$('[data-a=pas]')) ? Y : A;
  await (await who()).click('[data-a=pas]'); await sleep(600);
  await Y.click('.rbar [data-a=leave]'); await Y.waitForSelector('form[data-form=create]');
  await A.click('.rbar [data-a=leave]'); await A.waitForSelector('form[data-form=create]');

  // 4) profil: Kolleksiyam + ayarlardan market
  await Y.click('[data-a=openProfile]'); await Y.waitForSelector('.coll-card .coll-item');
  await Y.evaluate(() => document.querySelector('.coll-card').scrollIntoView({ block: 'center' }));
  await Y.click('.coll-card .coll-item[data-id=whisky]');
  await Y.waitForSelector('.item-pop');
  await Y.evaluate(() => document.querySelector('.prof-head').scrollIntoView());
  res.profilePop = await popInfo(Y);
  await shot(Y, '05-profil-kolleksiya');
  await sleep(2900);
  await Y.evaluate(() => document.querySelector('.set-shop').scrollIntoView({ block: 'center' }));
  await Y.click('.set-shop [data-a=openShop]');
  await Y.waitForSelector('.modal .shop-tabs');
  res.settingsOpensMine = await Y.evaluate(() => document.querySelector('.shop-tabs .btn.active').textContent.includes('Kolleksiyam'));
  await Y.click('[data-a=closeModal]');

  // 5) admin: qiymət, ad, şəkil
  const AD = await page(browser, 'admin', 'admin123');
  await AD.click('[data-a=openAdmin]'); await AD.click('[data-a=adminTab][data-v=shop]');
  await AD.waitForSelector('form[data-form=shopItem][data-id=doner]');
  await AD.fill('form[data-form=shopItem][data-id=doner] input[name=price]', '99');
  await AD.fill('form[data-form=shopItem][data-id=doner] input[name=name]', 'Dönər (böyük)');
  await AD.click('form[data-form=shopItem][data-id=doner] button.primary');
  await sleep(500);
  const sharp = require('sharp');
  const png = await sharp({ create: { width: 120, height: 80, channels: 4, background: { r: 30, g: 160, b: 90, alpha: 1 } } }).png().toBuffer();
  const pngFile = path.join(DATA, 'item.png'); fs.writeFileSync(pngFile, png);
  await AD.setInputFiles('form[data-form=shopItem][data-id=energy] input[type=file]', pngFile);
  await AD.waitForSelector('form[data-form=shopItem][data-id=energy] img.item-img');
  await AD.evaluate(() => document.querySelector('form[data-form=shopItem][data-id=energy]').scrollIntoView({ block: 'center' }));
  await shot(AD, '06-admin-market');
  const shop = (await j('/api/shop', null, (await j('/api/login', { username: 'anar', password: 'pass1234' })).cookie)).data;
  const d = shop.items.find((i) => i.id === 'doner');
  res.adminEdit = d.price === 99 && d.name === 'Dönər (böyük)' && shop.items.find((i) => i.id === 'energy').hasImage;

  // 6) çıxış → yenidən giriş: kolleksiya qalır
  const Y2 = await page(browser, 'yaqub');
  await Y2.click('#myBalance'); await Y2.waitForSelector('.coll-card');
  res.collectionAfterRelogin = await Y2.$$eval('.coll-card .coll-item', (els) => els.map((e) => e.dataset.id));

  // 7) kiçik ekran (320 px): market pəncərəsində üfüqi sürüşmə yoxdur
  const S320 = await page(browser, 'anar', 'pass1234', { ...devices['iPhone SE'], viewport: { width: 320, height: 568 } });
  await S320.click('#myBalance'); await S320.waitForSelector('.set-shop');
  await S320.evaluate(() => document.querySelector('.coll-card [data-a=openShop]').click());
  await S320.waitForSelector('.shop-grid .shop-card');
  res.noHScroll320 = await S320.evaluate(() => { const m = document.querySelector('.modal'); return m.scrollWidth <= m.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth; });
  await shot(S320, '07-market-320px');

  res.errors = errors;
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
  srv.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
  const okPop = (x) => x && x.pe === 'none' && !x.blocksTouch && x.inView;
  const ok = res.items.length === 5 && res.iconsSvg === 5 && res.modalNoHScroll && res.menuHasGift && res.charged === 150 && res.topbarBalance
    && okPop(res.popY) && okPop(res.popA) && res.popNearSeat && res.popGoneY && res.popGoneA && okPop(res.profilePop) && res.settingsOpensMine
    && res.consent?.hostWaits && res.consent.noRoundYet && /san/.test(res.consent.timer) && res.consent.noHScroll && res.consent.startedAfterYes && res.adminEdit && res.collectionAfterRelogin.join() === 'whisky' && res.noHScroll320 && !errors.length;
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); try { srv?.kill(); } catch { /* */ } process.exit(1); });
