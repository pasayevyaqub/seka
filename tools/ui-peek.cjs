const { chromium, devices } = require('playwright');
const B = process.env.SEKA_URL || 'http://localhost:3505'; const errors = []; const out = (n) => `${process.env.SHOTS || '/tmp'}/${n}.png`;

let __admc = null;
async function adminCreate(body) {
  if (!__admc) __admc = (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) })).headers.get('set-cookie').split(';')[0];
  const r = await fetch(B + '/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: __admc }, body: JSON.stringify(body) });
  return r.json();
}
async function j(path, body) {
  const r = await fetch(B + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
async function page(browser, user, dev) {
  const ctx = await browser.newContext(dev); const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(user + ': ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(user + ' console: ' + m.text()); });
  p.on('dialog', (d) => d.accept());
  await p.goto(B); await p.fill('input[name=username]', user); await p.fill('input[name=password]', '123456');
  await p.click('form[data-form=login] button'); await p.waitForTimeout(800);
  return p;
}
const backClip = (p, i = 0) => p.evaluate((i) => document.querySelectorAll('.peek-card .pk-back')[i]?.style.clipPath || '', i);
(async () => {
  for (const u of ['peker', 'masa', 'dizayn']) await adminCreate({ username: u, password: '123456', displayName: u[0].toUpperCase() + u.slice(1) });
  const browser = await chromium.launch();
  const res = {};
  // ---------- 1) iPhone 13 (toxunma) ----------
  const p = await page(browser, 'peker', { ...devices['iPhone 13'], viewport: { width: 390, height: 693 } });
  await p.selectOption('#demoBots', '4'); await p.click('[data-a=playBot]'); await p.waitForTimeout(600);
  await p.click('[data-a=start]'); await p.waitForTimeout(1600);
  res.coveredCount = await p.evaluate(() => document.querySelectorAll('.myhand .peek-card').length);
  res.faceVisibleBefore = await p.evaluate(() => getComputedStyle(document.querySelector('.peek-card .pk-face')).visibility);
  res.hint = await p.evaluate(() => document.querySelector('.peek-hint')?.textContent.replace(/\s+/g, ' ').trim());
  await p.screenshot({ path: out('01-covered-hint') });
  // toxunma ilə sürüşdürmə (CDP — real touch hadisələri)
  const cdp = await p.context().newCDPSession(p);
  const box = await (await p.$('.peek-card[data-peek="0"]')).boundingBox();
  const sx = box.x + box.width - 6; const sy = box.y + 6;
  const scroll0 = await p.evaluate(() => [window.scrollY, document.scrollingElement.scrollTop]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
  for (let k = 1; k <= 10; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx - k * 4.5, y: sy + k * 5.5 }] });
    await p.waitForTimeout(16);
    if (k === 4) res.partialClip = (await backClip(p)).slice(0, 40);
  }
  await p.waitForTimeout(100);
  res.fullClip = (await backClip(p)).slice(0, 40);
  res.flapShown = await p.evaluate(() => getComputedStyle(document.querySelector('.peek-card .pk-flapwrap')).display !== 'none');
  await p.screenshot({ path: out('02-touch-peek-card1') });
  // barmaq tutulub qalarkən masa yenilənsin (botlar oynayır) — baxış davam etməlidir
  await p.waitForTimeout(2500);
  res.foldSurvivesRerender = (await backClip(p)).startsWith('polygon');
  res.scrollUnchanged = JSON.stringify(scroll0) === JSON.stringify(await p.evaluate(() => [window.scrollY, document.scrollingElement.scrollTop]));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(80);
  res.midClose = (await backClip(p)).startsWith('polygon');
  await p.waitForTimeout(400);
  res.closedAfterRelease = (await backClip(p)) === '';
  res.hintGone = await p.evaluate(() => !document.querySelector('.peek-hint') || document.querySelector('.peek-hint').classList.contains('gone'));
  // yarımçıq: touchCancel
  const box2 = await (await p.$('.peek-card[data-peek="1"]')).boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box2.x + 6, y: box2.y + 6 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box2.x + 40, y: box2.y + 50 }] });
  await p.waitForTimeout(50);
  res.card2OpenTL = (await backClip(p, 1)).startsWith('polygon');
  await p.screenshot({ path: out('03-touch-peek-card2-left') });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await p.waitForTimeout(450);
  res.closedAfterCancel = (await backClip(p, 1)) === '';
  // "Göstər" düyməsi
  await p.click('.eye-btn'); await p.waitForTimeout(300);
  res.shownFaces = await p.evaluate(() => document.querySelectorAll('.myhand .flip3d').length);
  await p.screenshot({ path: out('04-shown') });
  await p.click('.eye-btn'); await p.waitForTimeout(300);
  res.coveredAgain = await p.evaluate(() => document.querySelectorAll('.myhand .peek-card').length);
  // üst-üstə düşmə yoxlaması: kartlar, göz düyməsi, idarə düymələri
  res.overlap = await p.evaluate(() => {
    const R = (e) => e.getBoundingClientRect();
    const hit = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const cards = [...document.querySelectorAll('.myhand .peek-card')].map(R);
    const eye = R(document.querySelector('.eye-btn'));
    const ctrl = R(document.querySelector('.side'));
    const bad = [];
    cards.forEach((c, i) => { if (hit(c, eye)) bad.push(`card${i}-eye`); if (c.bottom > ctrl.top + 1) bad.push(`card${i}-controls(${Math.round(c.bottom)}>${Math.round(ctrl.top)})`); });
    for (let i = 0; i < cards.length; i++) for (let k = i + 1; k < cards.length; k++) if (hit(cards[i], cards[k])) bad.push(`card${i}-card${k}`);
    if (eye.right > innerWidth || cards.some((c) => c.left < 0 || c.right > innerWidth)) bad.push('offscreen');
    return bad;
  });
  // ---------- 2) atma mərhələsi (4 kart) — sınaq vəziyyəti ilə render ----------
  res.discard = await p.evaluate(async () => {
    const core = await import('/core.js');
    const r = core.S.room.round;
    const fake = JSON.parse(JSON.stringify(core.S.room));
    fake.round.phase = 'discard'; fake.round.discardDeadline = Date.now() + 30000;
    fake.round.me = { ...r.me, mustDiscard: true, cards: null, hand: [...r.me.hand.slice(0, 3), { r: 'T', s: 'S' }], score: null };
    core.S.room = fake; window.__fakeRoom = fake;
    document.querySelector('[data-a=toggleEmoji]').click(); // istənilən yenidən çəkilmə
    await new Promise((x) => setTimeout(x, 200));
    return { cards: document.querySelectorAll('.myhand .peek-card').length, pickBtns: document.querySelectorAll('.pick-btn').length };
  });
  await p.waitForTimeout(100);
  // baxmaq seçmir
  const b3 = await (await p.$('.peek-card[data-peek="3"]')).boundingBox();
  await p.mouse.move(b3.x + b3.width - 5, b3.y + 5); await p.mouse.down();
  await p.mouse.move(b3.x + b3.width - 40, b3.y + 45, { steps: 6 });
  await p.screenshot({ path: out('05-discard-peek') });
  await p.mouse.up(); await p.waitForTimeout(400);
  res.peekDidNotPick = await p.evaluate(() => !document.querySelector('.pick-btn.on'));
  await p.click('.pick-btn[data-i="3"]'); await p.waitForTimeout(200);
  res.picked = await p.evaluate(() => document.querySelector('.pick-btn.on')?.dataset.i);
  res.discardBtn = await p.evaluate(() => !document.querySelector('[data-a=discard]').disabled);
  await p.screenshot({ path: out('06-discard-picked') });
  res.discardOverlap = await p.evaluate(() => {
    const R = (e) => e.getBoundingClientRect();
    const hit = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const cards = [...document.querySelectorAll('.myhand .peek-card')].map(R);
    const bad = [];
    for (let i = 0; i < cards.length; i++) for (let k = i + 1; k < cards.length; k++) if (hit(cards[i], cards[k])) bad.push(`card${i}-card${k}`);
    if (cards.some((c) => c.left < 0 || c.right > innerWidth)) bad.push('offscreen');
    if (hit(R(document.querySelector('.eye-btn')), cards[3])) bad.push('eye');
    return bad;
  });
  await p.close();
  // ---------- 3) kompüter (siçan) ----------
  const d = await page(browser, 'masa', { viewport: { width: 1366, height: 768 } });
  await d.selectOption('#demoBots', '3'); await d.click('[data-a=playBot]'); await d.waitForTimeout(600);
  await d.click('[data-a=start]'); await d.waitForTimeout(1600);
  const db = await (await d.$('.peek-card[data-peek="2"]')).boundingBox();
  await d.mouse.move(db.x + db.width - 5, db.y + 5); await d.mouse.down();
  await d.mouse.move(db.x + db.width * 0.45, db.y + db.height * 0.42, { steps: 10 });
  res.mouseClip = (await backClip(d, 2)).startsWith('polygon');
  await d.screenshot({ path: out('07-desktop-mouse-peek') });
  // siçanı kartdan kənarda buraxmaq (capture) — yenə də örtülür
  await d.mouse.move(10, 10, { steps: 4 }); await d.mouse.up(); await d.waitForTimeout(450);
  res.mouseClosedOutside = (await backClip(d, 2)) === '';
  await d.close();
  // ---------- 4) azaldılmış hərəkət — sadə rejim ----------
  const rmCtx = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  const r = await rmCtx.newPage(); r.on('pageerror', (e) => errors.push('rm: ' + e.message));
  await r.goto(B); await r.fill('input[name=username]', 'dizayn'); await r.fill('input[name=password]', '123456'); await r.click('form[data-form=login] button'); await r.waitForTimeout(900);
  await r.selectOption('#demoBots', '2'); await r.click('[data-a=playBot]'); await r.waitForTimeout(600);
  await r.click('[data-a=start]'); await r.waitForTimeout(1500);
  res.simpleClass = await r.evaluate(() => document.querySelector('.peek-card')?.classList.contains('simple'));
  const rb = await (await r.$('.peek-card[data-peek="0"]')).boundingBox();
  await r.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2); await r.mouse.down(); await r.waitForTimeout(100);
  res.simpleReveal = await r.evaluate(() => getComputedStyle(document.querySelector('.peek-card .pk-face')).visibility);
  await r.screenshot({ path: out('08-reduced-motion-hold') });
  await r.mouse.up(); await r.waitForTimeout(100);
  res.simpleHidden = await r.evaluate(() => getComputedStyle(document.querySelector('.peek-card .pk-face')).visibility);
  // ---------- 5) iPhone SE və üfüqi: üst-üstə düşmə ----------
  for (const [name, dev] of [['se', devices['iPhone SE']], ['land', devices['iPhone 13 landscape']], ['pixel', devices['Pixel 7']]]) {
    const q = await page(browser, 'dizayn', dev);
    if (!(await q.$('.myhand'))) { if (await q.$('[data-a=start]')) { await q.click('[data-a=start]'); await q.waitForTimeout(1500); } }
    res[`overlap_${name}`] = await q.evaluate(() => {
      const R = (e) => e.getBoundingClientRect();
      const hit = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
      const cards = [...document.querySelectorAll('.myhand .peek-card, .myhand .flip3d')].map(R);
      const eye = document.querySelector('.eye-btn'); const side = document.querySelector('.side');
      const bad = [];
      if (!cards.length) return ['no-cards'];
      for (let i = 0; i < cards.length; i++) for (let k = i + 1; k < cards.length; k++) if (hit(cards[i], cards[k])) bad.push(`card${i}-card${k}`);
      if (eye && cards.some((c) => hit(c, R(eye)))) bad.push('eye');
      if (side && innerHeight > innerWidth && cards.some((c) => c.bottom > R(side).top + 1)) bad.push('controls');
      if (side && innerHeight < innerWidth && cards.some((c) => c.right > R(side).left + 1)) bad.push('side');
      if (cards.some((c) => c.left < 0 || c.right > innerWidth || c.bottom > innerHeight)) bad.push('offscreen');
      return bad;
    });
    await q.screenshot({ path: out(`09-${name}`) });
    await q.close();
  }
  console.log(JSON.stringify({ ...res, errors }, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
