// Səsli danışıq yoxlaması (Chromium, saxta mikrofon, real WebRTC — eyni kompüterdə, TURN olmadan).
// Ssenarilər: 1) iki oyunçu qoşulur — səs paketləri hər iki istiqamətdə axır;
// 2) otağa SONRA girən və İD-si kiçik olan oyunçu qoşulur; 3) icazə verilməyən oyunçu oyuna davam edir;
// 4) səssizə alma; 5) WebSocket qırılıb bərpa olunur; 6) otaqdan çıxan — digərlərində 🎙 itir.
// İşə salma: node tools/ui-voice.cjs   (özü test serveri başladır)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = Number(process.env.PORT || 3541);
const B = `http://localhost:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-voice-'));
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
async function page(browser, user, { mic = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 664 }, permissions: mic ? ['microphone'] : [] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${user}: ${e.message}`));
  p.on('dialog', (d) => { p.__lastDialog = d.message(); d.accept(); });
  if (!mic) await p.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })); });
  await p.goto(B);
  await p.fill('input[name=username]', user); await p.fill('input[name=password]', 'pass1234');
  await p.click('form[data-form=login] button');
  await p.waitForSelector('form[data-form=create]');
  return p;
}
// brauzerdə: bütün RTCPeerConnection-ların vəziyyəti və qəbul/göndərilən səs baytları
const PC_HOOK = () => {
  window.__pcs = [];
  const O = window.RTCPeerConnection;
  window.RTCPeerConnection = function (...a) { const pc = new O(...a); window.__pcs.push(pc); return pc; };
  window.RTCPeerConnection.prototype = O.prototype;
};
async function rtc(p) {
  return p.evaluate(async () => {
    const out = [];
    for (const pc of window.__pcs || []) {
      let inB = 0; let outB = 0;
      if (pc.connectionState !== 'closed') {
        const st = await pc.getStats();
        st.forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'audio') inB += s.bytesReceived || 0; if (s.type === 'outbound-rtp' && s.kind === 'audio') outB += s.bytesSent || 0; });
      }
      out.push({ state: pc.connectionState, inB, outB });
    }
    return out;
  });
}
const live = (list) => list.filter((x) => x.state === 'connected');
async function waitLive(p, n, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const l = live(await rtc(p)); if (l.length >= n && l.every((x) => x.inB > 2000 && x.outB > 2000)) return l; await sleep(400); }
  return live(await rtc(p));
}

(async () => {
  await startServer();
  const res = {};
  const adm = (await j('/api/login', { username: 'admin', password: 'admin123' })).cookie;
  // İD sırası: kiçik İD-li "erkən" oyunçu otağa ən SONDA girir (köhnə kodun zəif yeri)
  for (const [u, d] of [['early', 'Erkən'], ['yaqub', 'Yaqub'], ['anar', 'Anar'], ['nomic', 'Mikrofonsuz']]) await j('/api/admin/users', { username: u, password: 'pass1234', displayName: d }, adm);
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ps = {};
  for (const u of ['early', 'yaqub', 'anar']) { ps[u] = await page(browser, u); await ps[u].addInitScript(PC_HOOK); await ps[u].reload(); await ps[u].waitForSelector('form[data-form=create]'); }
  ps.nomic = await page(browser, 'nomic', { mic: false });
  const Y = ps.yaqub; const A = ps.anar; const E = ps.early; const N = ps.nomic;
  await Y.fill('form[data-form=create] input[name=name]', 'Səs'); await Y.click('form[data-form=create] button');
  await Y.waitForSelector('.rb-code');
  const code = (await Y.textContent('.rb-code')).replace(/[^A-Z0-9]/g, '');
  for (const p of [A, N]) { await p.fill('form[data-form=join] input[name=code]', code); await p.click('form[data-form=join] button'); await p.waitForSelector('.rbar'); }

  // 1) iki oyunçu
  await Y.click('[data-a=voiceToggle]'); await A.click('[data-a=voiceToggle]');
  const l1 = await waitLive(Y, 1);
  res.twoPlayers = { yaqubLive: l1.length, flowing: l1.every((x) => x.inB > 2000 && x.outB > 2000) };
  res.peerBadge = await Y.evaluate(() => document.querySelectorAll('.seat:not(.me) .vbadge').length);

  // 3) mikrofon icazəsi yoxdur — oyun davam edir
  await N.click('[data-a=voiceToggle]');
  await sleep(500);
  res.noMic = { message: await N.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).find((t) => /icazə/.test(t)) || null), stillInRoom: !!(await N.$('.rbar')), button: (await N.textContent('[data-a=voiceToggle]')).trim() };

  // 2) sonradan girən, İD-si kiçik oyunçu
  await E.fill('form[data-form=join] input[name=code]', code); await E.click('form[data-form=join] button'); await E.waitForSelector('.rbar');
  await sleep(500);
  await E.click('[data-a=voiceToggle]');
  const l2 = await waitLive(E, 2);
  res.lateJoinerLowId = { live: l2.length, flowing: l2.length >= 2 && l2.every((x) => x.inB > 2000 && x.outB > 2000) };

  // 4) səssizə alma: digərləri 🔇 nişanı görür, göndərilən trek söndürülür
  await Y.click('[data-a=voiceToggle]');
  await sleep(600);
  res.mute = {
    button: (await Y.textContent('[data-a=voiceToggle]')).trim(),
    othersSeeMuted: await A.evaluate(() => document.querySelectorAll('.seat:not(.me) .vbadge.v-muted').length),
    trackDisabled: await Y.evaluate(() => window.__pcs.filter((pc) => pc.connectionState === 'connected').every((pc) => pc.getSenders().every((s) => !s.track || s.track.enabled === false))),
  };
  await Y.click('[data-a=voiceToggle]');
  await sleep(400);

  // 5) Anarın WebSocket-i qırılır və yenidən qoşulur → səs bağlantıları təzədən qurulur
  const before = (await rtc(A)).length;
  await A.evaluate(async () => { const { S } = await import('/core.js'); S.ws.close(); });
  await A.waitForFunction(async () => { const { S } = await import('/core.js'); return S.ws && S.ws.readyState === 1 && S.conn === 'online'; }, null, { timeout: 15000 });
  const t0 = Date.now();
  let l5 = [];
  while (Date.now() - t0 < 15000) {
    const all = await rtc(A); l5 = all.slice(before).filter((x) => x.state === 'connected');
    if (l5.length >= 2 && l5.every((x) => x.inB > 1500)) break;
    await sleep(400);
  }
  res.afterReconnect = {
    newLiveConnections: l5.length,
    flowing: l5.length >= 2 && l5.every((x) => x.inB > 1500 && x.outB > 1500),
    badgesOnYaqub: await Y.evaluate(() => document.querySelectorAll('.seat:not(.me) .vbadge').length),
  };

  // 6) Erkən otaqdan çıxır — digərlərində nişan itir, Yaqub–Anar səsi davam edir
  await E.click('.rbar [data-a=leave]'); await E.waitForSelector('form[data-form=create]');
  await sleep(1200);
  res.afterLeave = {
    badgesOnYaqub: await Y.evaluate(() => document.querySelectorAll('.seat:not(.me) .vbadge').length),
    yaqubLive: live(await rtc(Y)).length,
    earlyPcsClosed: (await rtc(E)).every((x) => x.state === 'closed'),
  };
  res.errors = errors;
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
  srv.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
})().catch((e) => { console.error(e); try { srv?.kill(); } catch { /* */ } process.exit(1); });
