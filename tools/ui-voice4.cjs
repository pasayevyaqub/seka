// Bütün otağın səsi (4 oyunçu, tam mesh) — Chromium, saxta mikrofon, real WebRTC (eyni kompüterdə, TURN olmadan).
// Yoxlanılır: hər oyunçu digər 3 oyunçu ilə AYRICA bağlıdır və səs hər istiqamətdə axır (otaq sahibindən keçmir);
// paralel/ikiqat bağlantı yoxdur; "yalnız məndə susdur" yalnız mənim cihazımda işləyir; WebSocket qırılıb bərpası;
// otaqdan çıxma; otağa qayıdanda lokal susdurma sıfırlanır.
// İşə salma: node tools/ui-voice4.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = Number(process.env.PORT || 3542);
const B = `http://localhost:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'seka-voice4-'));
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
const PC_HOOK = () => {
  window.__pcs = [];
  const O = window.RTCPeerConnection;
  window.RTCPeerConnection = function (...a) { const pc = new O(...a); window.__pcs.push(pc); return pc; };
  window.RTCPeerConnection.prototype = O.prototype;
};
async function page(browser, user) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 664 }, permissions: ['microphone'] });
  await ctx.addInitScript(PC_HOOK);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${user}: ${e.message}`));
  p.on('dialog', (d) => d.accept());
  await p.goto(B);
  await p.fill('input[name=username]', user); await p.fill('input[name=password]', 'pass1234');
  await p.click('form[data-form=login] button');
  await p.waitForSelector('form[data-form=create]');
  return p;
}
// hər açıq bağlantı: vəziyyət, qəbul/göndərilən səs baytları
async function stats(p) {
  return p.evaluate(async () => {
    const out = [];
    for (const pc of window.__pcs) {
      if (pc.connectionState === 'closed') continue;
      let inB = 0; let outB = 0;
      (await pc.getStats()).forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'audio') inB += s.bytesReceived || 0; if (s.type === 'outbound-rtp' && s.kind === 'audio') outB += s.bytesSent || 0; });
      out.push({ state: pc.connectionState, inB, outB });
    }
    const v = (await import('/voice.js')).voiceDebug();
    return { pcs: out, conn: v.conn, localMute: v.localMute };
  });
}
async function meshOk(p, n, ms = 20000) {
  const t = Date.now(); let s;
  while (Date.now() - t < ms) {
    s = await stats(p);
    const live = s.pcs.filter((x) => x.state === 'connected' && x.inB > 1500 && x.outB > 1500);
    if (live.length === n && s.pcs.length === n && Object.values(s.conn).filter((c) => c === 'connected').length === n) return { ok: true, open: s.pcs.length, live: live.length, conn: s.conn };
    await sleep(400);
  }
  return { ok: false, open: s.pcs.length, live: s.pcs.filter((x) => x.state === 'connected').length, conn: s.conn };
}

(async () => {
  await startServer();
  const res = {};
  const adm = (await j('/api/login', { username: 'admin', password: 'admin123' })).cookie;
  // İD sırası host-dan asılı olmasın: host (yaqub) ortada
  const users = ['dost1', 'dost2', 'yaqub', 'dost3'];
  for (const u of users) await j('/api/admin/users', { username: u, password: 'pass1234', displayName: u[0].toUpperCase() + u.slice(1) }, adm);
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const P = {};
  for (const u of users) P[u] = await page(browser, u);
  await P.yaqub.fill('form[data-form=create] input[name=name]', 'Səs4'); await P.yaqub.click('form[data-form=create] button');
  await P.yaqub.waitForSelector('.rb-code');
  const code = (await P.yaqub.textContent('.rb-code')).replace(/[^A-Z0-9]/g, '');
  for (const u of ['dost1', 'dost2', 'dost3']) { await P[u].fill('form[data-form=join] input[name=code]', code); await P[u].click('form[data-form=join] button'); await P[u].waitForSelector('.rbar'); }
  await P.yaqub.waitForFunction(() => document.querySelectorAll('.seat').length === 4);
  // mikrofonları qarışıq sıra ilə açırlar (host axırıncı deyil, birinci də deyil)
  for (const u of ['dost3', 'yaqub', 'dost1', 'dost2']) { await P[u].click('[data-a=voiceToggle]'); await sleep(300); }

  // 1) tam mesh
  res.mesh = {};
  for (const u of users) res.mesh[u] = await meshOk(P[u], 3);
  res.fullMesh = Object.values(res.mesh).every((x) => x.ok);

  // 2) "yalnız məndə susdur": dost1 öz cihazında dost3-ü susdurur
  const id3 = await P.dost3.evaluate(async () => (await import('/core.js')).S.user.id);
  await P.dost1.click(`.seat [data-a=voicePeerMute][data-id="${id3}"]`);
  await sleep(300);
  res.localMute = {
    dost1MutedDost3: await P.dost1.evaluate((id) => document.querySelector(`audio[data-voice-peer="${id}"]`).muted, id3),
    dost2HearsDost3: await P.dost2.evaluate((id) => !document.querySelector(`audio[data-voice-peer="${id}"]`).muted, id3),
    dost3MicStillOn: await P.dost3.evaluate(() => window.__pcs.filter((pc) => pc.connectionState === 'connected').every((pc) => pc.getSenders().every((s) => !s.track || s.track.enabled))),
    buttonShowsOff: await P.dost1.evaluate((id) => document.querySelector(`[data-a=voicePeerMute][data-id="${id}"]`)?.getAttribute('aria-pressed'), id3),
  };
  // səs dost2-yə dost3-dən hələ də gəlir (baytlar artır)
  const before = (await stats(P.dost2)).pcs.reduce((a, x) => a + x.inB, 0); await sleep(1500);
  res.localMute.othersStillReceive = (await stats(P.dost2)).pcs.reduce((a, x) => a + x.inB, 0) > before + 2000;
  // seçim yenidən çəkilmədə qalır
  await P.dost1.evaluate(async () => { const { S } = await import('/core.js'); S.emojiOpen = !S.emojiOpen; document.querySelector('[data-a=toggleEmoji]')?.click(); });
  await sleep(300);
  res.localMute.keptAfterRender = await P.dost1.evaluate((id) => document.querySelector(`audio[data-voice-peer="${id}"]`).muted, id3);

  // 3) öz mikrofonunu susdurmaq — digərləri 🔇 vəziyyətini görür
  await P.dost2.click('[data-a=voiceToggle]'); await sleep(600);
  const id2 = await P.dost2.evaluate(async () => (await import('/core.js')).S.user.id);
  res.selfMute = { yaqubSees: await P.yaqub.evaluate((id) => document.querySelector(`[data-a=voicePeerMute][data-id="${id}"]`)?.className.includes('v-muted'), id2) };
  await P.dost2.click('[data-a=voiceToggle]'); await sleep(300);

  // 4) dost3-ün interneti qırılır və bərpa olunur → mesh yenidən tam
  await P.dost3.evaluate(async () => { const { S } = await import('/core.js'); S.ws.close(); });
  await P.dost3.waitForFunction(async () => { const { S } = await import('/core.js'); return S.ws?.readyState === 1 && S.conn === 'online'; }, null, { timeout: 15000 });
  res.afterReconnect = {};
  for (const u of users) res.afterReconnect[u] = (await meshOk(P[u], 3)).ok;

  // 5) yaqub (otaq sahibi) mikrofonu bağlayıb səsdən çıxır → qalan 3 nəfər bir-birini eşitməyə davam edir
  await P.yaqub.click('.rbar [data-a=toggleLog]'); await P.yaqub.click('[data-a=voiceLeave]'); await P.yaqub.click('.drawer [data-a=toggleLog]').catch(() => {});
  res.hostLeftVoice = {};
  for (const u of ['dost1', 'dost2', 'dost3']) res.hostLeftVoice[u] = (await meshOk(P[u], 2)).ok;

  // 6) dost2 otaqdan çıxıb qayıdır → lokal seçimlər sıfırlanır, yenidən qoşulur
  await P.dost2.click('.rbar [data-a=leave]'); await P.dost2.waitForSelector('form[data-form=create]');
  res.afterLeave = { dost1: (await meshOk(P.dost1, 1)).ok };
  await P.dost1.click('.rbar [data-a=leave]'); await P.dost1.waitForSelector('form[data-form=create]');
  await P.dost1.fill('form[data-form=join] input[name=code]', code); await P.dost1.click('form[data-form=join] button'); await P.dost1.waitForSelector('.rbar');
  res.rejoinResetsLocalMute = (await stats(P.dost1)).localMute.length === 0;

  res.errors = errors;
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
  srv.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
  const pass = res.fullMesh && Object.values(res.localMute).every((v) => v === true || v === 'true') && res.selfMute.yaqubSees
    && Object.values(res.afterReconnect).every(Boolean) && Object.values(res.hostLeftVoice).every(Boolean) && res.afterLeave.dost1 && res.rejoinResetsLocalMute && !errors.length;
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); try { srv?.kill(); } catch { /* */ } process.exit(1); });
