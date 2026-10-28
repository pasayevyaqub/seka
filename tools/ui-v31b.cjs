// v3.1/v3.2 (b) brauzer yoxlaması: razılıqdan imtina edən raunda düşmür; baxış xalı raund gedərkən gizli, raund sonunda nəticədə;
// "Nəyəsə gəlir?" (3 seçim) və Seka seçimi (Bankı saxla / Pulu böl və 2× Seka).
// əvvəlki: v3.1 brauzer yoxlaması (Chromium, real server): market (🎁 → Market, profil, ayarlar), alış, kolleksiya,
// istifadə effekti (başqa oyunçu da görür, toxunuşa mane olmur), admin market idarəsi, yenidən girişdə kolleksiya qalır.
// İşə salma: node tools/ui-v31.cjs   (özü test serveri başladır; SHOTS=qovluq — ekran görüntüləri)
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = Number(process.env.PORT || 3545);
const B = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS || '';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-ui31b-'));
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
  const ids = {};
  for (const [u, d] of [['yaqub', 'Yaqub'], ['anar', 'Anar'], ['elvin', 'Elvin']]) {
    const r = await j('/api/admin/users', { username: u, password: 'pass1234', displayName: d }, adm); ids[u] = r.data.id;
    await j(`/api/admin/users/${r.data.id}/balance`, { op: 'add', amount: 900, key: `seed-${u}-00000001` }, adm);
  }
  const bal = async (u) => (await j('/api/admin/users', null, adm)).data.users.find((x) => x.username === u).balance;
  const browser = await chromium.launch();
  const P = { yaqub: await page(browser, 'yaqub'), anar: await page(browser, 'anar'), elvin: await page(browser, 'elvin') };
  await P.yaqub.fill('form[data-form=create] input[name=name]', 'Üçlük'); await P.yaqub.click('form[data-form=create] button');
  await P.yaqub.waitForSelector('.rbar');
  const code = await P.yaqub.evaluate(async () => (await import('/core.js')).S.room.code);
  for (const u of ['anar', 'elvin']) { await P[u].fill('form[data-form=join] input[name=code]', code); await P[u].click('form[data-form=join] button'); await P[u].waitForSelector('.rbar'); }
  await P.yaqub.waitForFunction(() => document.querySelectorAll('.seat').length === 3);
  // 1) Elvin imtina edir → raund Yaqub və Anar ilə; Elvindən xal tutulmur
  const e0 = await bal('elvin');
  await P.yaqub.click('[data-a=start]');
  await P.anar.waitForSelector('[data-a=consentYes]'); await P.elvin.waitForSelector('[data-a=consentNo]');
  await P.elvin.click('[data-a=consentNo]');
  await P.yaqub.waitForSelector('.consent-box .cs-chip.no');
  await shot(P.yaqub, '08-razilik-imtina');
  await P.anar.click('[data-a=consentYes]');
  await P.yaqub.waitForSelector('.myhand');
  res.elvinNotInRound = await P.elvin.evaluate(async () => { const { S } = await import('/core.js'); return !S.room.round.players.some((p) => p.id === S.user.id); });
  res.elvinNotCharged = (await bal('elvin')) === e0;
  // raundu bitir
  for (let i = 0; i < 4; i++) { for (const u of ['yaqub', 'anar']) { const b = await P[u].$('[data-a=pas]'); if (b) { await b.click(); await sleep(400); } } if (await P.yaqub.$('[data-a=start]')) break; }
  await P.yaqub.waitForSelector('[data-a=start]');
  // 2) hamı razı → 3 nəfər; hamı xod edir; sonra baxış: xal Elvinə də görünür (kartlar yox)
  await P.yaqub.click('[data-a=start]');
  for (const u of ['anar', 'elvin']) { await P[u].waitForSelector('[data-a=consentYes]'); await P[u].click('[data-a=consentYes]'); }
  await P.yaqub.waitForSelector('.myhand');
  await sleep(600);
  const turnOf = async () => P.yaqub.evaluate(async () => (await import('/core.js')).S.room.round.turn);
  const byId = Object.fromEntries(Object.entries(ids).map(([u, id]) => [id, u]));
  for (let i = 0; i < 3; i++) { const t = byId[await turnOf()]; await P[t].click('[data-a=xod]'); await sleep(500); }
  const caller = byId[await turnOf()];
  await P[caller].waitForSelector('[data-a=baxis]:not([disabled])');
  const tgtId = await P[caller].evaluate(async () => (await import('/core.js')).S.room.round.me.baxisTarget);
  await P[caller].click('[data-a=baxis]');
  await sleep(1200);
  await P.yaqub.waitForFunction(async () => (await import('/core.js')).S.room.round.players.some((p) => p.status === 'lost'));
  const out = Object.keys(P).find((u) => u !== caller && ids[u] !== tgtId);
  res.outsider = out;
  res.duringRound = await P[out].evaluate(async () => {
    const r = (await import('/core.js')).S.room.round;
    return { otherScores: r.players.filter((p) => p.id !== r.me?.id && p.score != null).length, cmpLines: document.querySelectorAll('.cmp-line').length, logHasScore: r.log.some((l) => /xalı \d+/.test(l.msg)) };
  });
  // raundu bitir
  for (let i = 0; i < 6; i++) {
    const done = await P.yaqub.evaluate(async () => (await import('/core.js')).S.room.round.phase === 'finished');
    if (done) break;
    const t = byId[await turnOf()]; if (t) { const b = await P[t].$('[data-a=pas]'); if (b) await b.click(); } await sleep(500);
  }
  await P[out].waitForSelector('.cmp-line');
  res.afterRound = await P[out].$$eval('.cmp-line', (els) => els.map((e) => e.textContent.trim()));
  await shot(P[out], '09-baxis-neticesi-raund-sonu');
  // "Nəyəsə gəlir?" + Seka seçimi (2 oyunçu): Elvin çıxır
  await P.elvin.click('.rbar [data-a=leave]'); await P.elvin.waitForSelector('form[data-form=create]');
  await P.yaqub.waitForSelector('[data-a=start]'); await P.yaqub.click('[data-a=start]');
  await P.anar.waitForSelector('[data-a=consentYes]'); await P.anar.click('[data-a=consentYes]');
  await P.yaqub.waitForSelector('.myhand'); await sleep(500);
  const tw = byId[await turnOf()]; const ot = tw === 'yaqub' ? 'anar' : 'yaqub';
  await P[tw].waitForSelector('[data-a=offerAny]:not([disabled])');
  await P[tw].click('[data-a=offerAny]');
  await P[ot].waitForSelector('.any-reply [data-v=seka]');
  res.anyButtons = await P[ot].$$eval('.any-reply button', (els) => els.map((e) => e.textContent.trim()));
  res.chatSeen = await P[ot].evaluate(async () => (await import('/core.js')).S.room.chatMsgs.some((m) => /nəyəsə gəlir/i.test(m.text)) || !!document.querySelector('.bubble-slot'));
  await shot(P[ot], '10-neyese-gelir');
  await P[ot].click('.any-reply [data-v=seka]');
  await P[tw].waitForSelector('[data-a=sekaChoice][data-v=split]');
  await shot(P[tw], '11-seka-secimi');
  for (const u of [tw, ot]) { await P[u].waitForSelector('[data-a=sekaChoice][data-v=split]'); await P[u].click('[data-a=sekaChoice][data-v=split]'); }
  await P.yaqub.waitForSelector('.seka-join .sj-head');
  res.sekaHead = (await P.yaqub.textContent('.seka-join .sj-head')).trim();
  await shot(P.yaqub, '12-seka-2x');
  res.noHScroll = await P.yaqub.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  res.errors = errors;
  console.log(JSON.stringify(res, null, 1));
  await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  const ok = res.elvinNotInRound && res.elvinNotCharged && res.duringRound.otherScores === 0 && res.duringRound.cmpLines === 0 && !res.duringRound.logHasScore
    && res.afterRound.length === 1 && /baxış vaxtı xalı \d+ idi/.test(res.afterRound[0]) && res.anyButtons.length === 3 && res.chatSeen
    && /2×/.test(res.sekaHead) && res.noHScroll && !errors.length;
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); try { srv?.kill(); } catch { /* */ } process.exit(1); });
