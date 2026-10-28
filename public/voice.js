// Otaqdaxili səsli danışıq (WebRTC). Media oyunçular arasında birbaşa (və ya TURN vasitəsilə) gedir,
// mövcud WebSocket yalnız siqnal (offer/answer/ICE) və status (qoşulub / səssiz) üçündür.
//
// Topologiya: TAM MESH — mikrofonu açmış hər oyunçu digər hər oyunçu ilə AYRICA bağlantı qurur
// (səs heç vaxt otaq sahibindən və ya serverdən keçmir). 4–5 nəfər üçün nəzərdə tutulub.
//
// Qaydalar:
//  * Mikrofon icazəsi YALNIZ 🎤 düyməsinə basanda soruşulur; icazə olmasa oyun adi davam edir.
//  * Hər cüt üçün TƏK bağlantı: təklifi (offer) yalnız İD-si kiçik olan göndərir; qarşı tərəf ona cavab verir.
//    Gözlənilməz təklif gəlsə (məs. yenidən qoşulma), köhnə bağlantı bağlanır və yenisi qəbul olunur — paralel bağlantı qalmır.
//  * Hər qarşı tərəf üçün siqnallar növbə ilə emal olunur; ICE namizədi təsvirdən əvvəl gəlsə gözlədilir.
//  * WebSocket qırılıb bərpa olunanda bütün bağlantılar təzədən qurulur (restart).
//  * Oyunçunu "yalnız məndə" susdurmaq: həmin oyunçunun səs elementi bu cihazda səssizə alınır; onun mikrofonu
//    və başqalarına gedən səs dəyişmir. Seçim otaqda qaldığım müddətdə yadda qalır (otaqdan çıxanda sıfırlanır).
let send = () => false; let getUser = () => null; let getRoom = () => null; let repaint = () => {}; let notify = () => {};
let stream = null; let enabled = false; let muted = false;
let iceServers = [{ urls: 'stun:stun.cloudflare.com:3478' }]; let haveTurn = false;
const peers = new Map();       // id → { pc, queue, pending: [], retried }
const voicePeers = new Map();  // id → { muted }   (səsə qoşulmuş digər oyunçular — server statusu)
const audios = new Map();      // id → <audio>
const conn = new Map();        // id → 'connecting' | 'connected' | 'failed'
const localMute = new Set();   // bu cihazda susdurulmuş oyunçular
let localMuteRoom = null;
const speaking = new Set();    // hazırda danışanlar ('me' daxil)
const meters = new Map();      // id → { analyser, data, src }
let meterCtx = null; let meterTimer = 0; let repaintTimer = 0;

export function initVoice(opts) {
  send = opts.send; getUser = opts.getUser; repaint = opts.repaint;
  getRoom = opts.getRoom || (() => null); notify = opts.notify || (() => {});
}
export const voiceEnabled = () => enabled;
export const peerVoiceActive = (id) => voicePeers.has(String(id));
export const peerVoiceMuted = (id) => !!voicePeers.get(String(id))?.muted;
export const peerLocallyMuted = (id) => localMute.has(String(id));
export const peerConn = (id) => conn.get(String(id)) || null;
export const isSpeaking = (id) => speaking.has(String(id));
const myId = () => Number(getUser()?.id);
const lazyRepaint = () => { if (repaintTimer) return; repaintTimer = setTimeout(() => { repaintTimer = 0; repaint(); }, 120); };

export function voiceButtonHTML() {
  const label = !enabled ? 'Səsli danışığa qoşul (mikrofon)' : muted ? 'Mikrofonu aç' : 'Mikrofonu səssizə al';
  return `<button class="rb-btn voice-btn ${enabled && !muted ? 'voice-on' : ''} ${enabled && muted ? 'voice-muted' : ''} ${enabled && !muted && speaking.has('me') ? 'speaking' : ''}" data-a="voiceToggle" aria-pressed="${enabled && !muted}" aria-label="${label}" title="${label}">${!enabled ? '🎤' : muted ? '🔇' : '🎙️'}</button>`;
}
// səsdən tam çıxmaq üçün düymə (menyuda)
export function voiceLeaveHTML() {
  if (!enabled) return '';
  return `<button class="tgl" data-a="voiceLeave">🎤 Səsli danışıqdan çıx${haveTurn ? '' : ' <small>(TURN qurulmayıb — mobil internetdə bəzi oyunçular qoşulmaya bilər)</small>'}</button>`;
}

/** Oturacaqda səs vəziyyəti: nişan + (başqası üçün) "yalnız məndə susdur" düyməsi */
export function seatVoiceHTML(id, isMe) {
  id = String(id);
  if (isMe) {
    if (!enabled) return '';
    return `<span class="vbadge ${muted ? 'v-muted' : (speaking.has('me') ? 'v-speak' : 'v-on')}" title="${muted ? 'Mikrofonunuz səssizdədir' : 'Mikrofonunuz açıqdır'}" aria-label="${muted ? 'mikrofonum səssiz' : 'mikrofonum açıq'}">${muted ? '🔇' : '🎙'}</span>`;
  }
  if (!voicePeers.has(id)) return '';
  const vp = voicePeers.get(id);
  const c = enabled ? conn.get(id) : null;
  // rəng = onun vəziyyəti; ikon = mənim cihazımda onu eşidirəm (🔊) / susdurmuşam (🔇)
  let cls = 'v-on'; let title = 'Mikrofonu açıqdır';
  if (vp.muted) { cls = 'v-muted'; title = 'Mikrofonunu özü bağlayıb'; }
  else if (enabled && c !== 'connected') { cls = c === 'failed' ? 'v-fail' : 'v-wait'; title = c === 'failed' ? 'Səs bağlantısı qurulmadı' : 'Səs bağlantısı qurulur…'; }
  else if (speaking.has(id)) { cls = 'v-speak'; title = 'Danışır'; }
  if (!enabled) return `<span class="vbadge ${cls}" title="${title} (eşitmək üçün 🎤 ilə qoşulun)" aria-label="${title}">🎙</span>`;
  const lm = localMute.has(id);
  const label = `${title}. ${lm ? 'Siz onu susdurmusunuz — toxunun: səsi yalnız sizdə açılsın' : 'Toxunun: səsi yalnız sizdə kəsilsin'}`;
  return `<button class="vbadge vp-btn ${cls} ${lm ? 'off' : ''}" data-a="voicePeerMute" data-id="${id}" aria-pressed="${lm}" aria-label="${label}" title="${label}">${lm ? '🔇' : (c === 'failed' ? '⚠️' : c === 'connected' || vp.muted ? '🔊' : '⏳')}</button>`;
}

export function toggleLocalMute(id) {
  id = String(id);
  syncMuteRoom();
  if (localMute.has(id)) localMute.delete(id); else localMute.add(id);
  const a = audios.get(id);
  if (a) a.muted = localMute.has(id);
  repaint();
}
function syncMuteRoom() {
  const code = getRoom()?.code || null;
  if (code !== localMuteRoom) { localMute.clear(); localMuteRoom = code; }
}

async function getIce() {
  try {
    const r = await fetch('/api/voice/ice', { credentials: 'same-origin' });
    if (r.ok) { const d = await r.json(); if (Array.isArray(d.iceServers)) iceServers = d.iceServers; haveTurn = !!d.turn; }
  } catch { /* yalnız STUN ilə davam */ }
}

function announce(restart = false) { send({ t: 'voiceState', enabled: true, muted, restart }); }

export async function toggleVoice() {
  if (enabled) {
    muted = !muted;
    stream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    if (muted) speaking.delete('me');
    announce(false);
    repaint();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    notify('Bu brauzerdə mikrofon/WebRTC dəstəyi yoxdur (sayt HTTPS ilə açılmalıdır). Oyuna səssiz davam edə bilərsiniz.');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  } catch (e) {
    stream = null;
    notify(e?.name === 'NotAllowedError'
      ? 'Mikrofona icazə verilmədi. Oyuna səssiz davam edə bilərsiniz (icazəni sonra brauzer ayarlarından verə bilərsiniz).'
      : 'Mikrofon açıla bilmədi (başqa tətbiq istifadə edir və ya cihaz yoxdur). Oyuna səssiz davam edə bilərsiniz.');
    repaint();
    return;
  }
  enabled = true; muted = false;
  syncMuteRoom();
  await getIce();
  if (!haveTurn) notify('Səsli danışıq açıldı. Qeyd: TURN qurulmayıb — eyni Wi-Fi-da adətən işləyir, mobil internetdə bəzi oyunçular qoşulmaya bilər.');
  meter('me', stream);
  announce(true);
  // artıq səsdə olanlar: kiçik İD-li tərəf təklif göndərir
  for (const id of voicePeers.keys()) if (myId() < Number(id)) offerTo(id);
  repaint();
}

export function stopVoice(notifyServer = true, forgetPeers = false) {
  const was = enabled;
  enabled = false; muted = false;
  stream?.getTracks().forEach((t) => t.stop()); stream = null;
  for (const id of [...peers.keys()]) dropPeer(id);
  unmeter('me');
  speaking.clear();
  if (forgetPeers) { voicePeers.clear(); localMute.clear(); localMuteRoom = null; }
  if (notifyServer && was) send({ t: 'voiceState', enabled: false });
  repaint();
}

// WebSocket yenidən qoşulanda: səs açıq idisə hamısı təzədən qurulur
export function onReconnect() {
  if (!enabled) return;
  for (const id of [...peers.keys()]) dropPeer(id);
  announce(true);
}

function dropPeer(id) {
  const e = peers.get(id);
  if (e) { try { e.pc.close(); } catch { /* */ } peers.delete(id); }
  const a = audios.get(id);
  if (a) { a.srcObject = null; a.remove(); audios.delete(id); }
  unmeter(id);
  speaking.delete(id);
  conn.delete(id);
}

function setConn(id, st) { if (conn.get(id) !== st) { conn.set(id, st); lazyRepaint(); } }

function makePeer(id) {
  let e = peers.get(id);
  if (e) return e;
  const pc = new RTCPeerConnection({ iceServers });
  e = { pc, queue: Promise.resolve(), pending: [], retried: false };
  peers.set(id, e);
  setConn(id, 'connecting');
  stream?.getTracks().forEach((track) => pc.addTrack(track, stream));
  pc.onicecandidate = (ev) => { if (ev.candidate) send({ t: 'voiceSignal', to: Number(id), signal: { candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate } }); };
  pc.ontrack = (ev) => {
    let audio = audios.get(id);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true; audio.playsInline = true; audio.setAttribute('playsinline', '');
      audio.dataset.voicePeer = id;
      document.body.append(audio);
      audios.set(id, audio);
    }
    audio.muted = localMute.has(id);
    audio.srcObject = ev.streams[0];
    audio.play().catch(() => { /* iOS bəzən növbəti toxunuşu gözləyir — aşağıdakı "unlock" bunu həll edir */ });
    meter(id, ev.streams[0]);
  };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'connected') setConn(id, 'connected');
    else if (s === 'connecting' || s === 'new') setConn(id, 'connecting');
    else if (s === 'failed') {
      // bir dəfə yenidən cəhd (məs. şəbəkə dəyişdi); TURN olmadan mobil şəbəkədə alınmaya bilər
      const retry = !e.retried && myId() < Number(id) && enabled && voicePeers.has(id);
      dropPeer(id);
      if (retry) setTimeout(() => { offerTo(id); const n = peers.get(id); if (n) n.retried = true; }, 1500);
      else if (enabled && voicePeers.has(id)) {
        conn.set(id, 'failed'); lazyRepaint();
        const name = getRoom()?.members?.find((m) => String(m.id) === id)?.name || 'oyunçu';
        notify(`${name} ilə səs bağlantısı qurulmadı.${haveTurn ? '' : ' Mobil internetdə TURN serveri lazım ola bilər.'} Oyun davam edir.`);
      }
    }
  };
  return e;
}

async function offerTo(id) {
  id = String(id);
  if (!enabled || !voicePeers.has(id) || peers.has(id)) return;
  const e = makePeer(id);
  e.queue = e.queue.then(async () => {
    const offer = await e.pc.createOffer();
    await e.pc.setLocalDescription(offer);
    send({ t: 'voiceSignal', to: Number(id), signal: { description: e.pc.localDescription } });
  }).catch(() => dropPeer(id));
}

export function onVoiceSignal(m) {
  if (!enabled || !m.fromId || !m.signal) return;
  const id = String(m.fromId);
  const d = m.signal.description;
  // İD-si böyük tərəfdən təklif gəlməməlidir; yenidən qoşulmada köhnə bağlantı ilə yeni təklif toqquşsa köhnəsi atılır
  if (d?.type === 'offer') {
    const old = peers.get(id);
    if (old && (old.pc.signalingState !== 'stable' || old.pc.connectionState === 'failed' || old.pc.connectionState === 'closed')) dropPeer(id);
  }
  const e = makePeer(id);
  // eyni qarşı tərəfin siqnalları ardıcıl emal olunur (yoxsa ICE namizədi təsvirdən qabaq tətbiq oluna bilərdi)
  e.queue = e.queue.then(async () => {
    const { pc } = e;
    if (d) {
      if (d.type === 'answer' && pc.signalingState !== 'have-local-offer') return; // köhnəlmiş cavab
      await pc.setRemoteDescription(d);
      for (const c of e.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      if (d.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer());
        send({ t: 'voiceSignal', to: Number(id), signal: { description: pc.localDescription } });
      }
    } else if (m.signal.candidate) {
      if (!pc.remoteDescription) e.pending.push(m.signal.candidate);
      else await pc.addIceCandidate(m.signal.candidate).catch(() => {});
    }
  }).catch(() => dropPeer(id));
}

export function onVoiceState(m) {
  const id = String(m.userId);
  if (Number(id) === myId()) return;
  if (m.enabled) {
    voicePeers.set(id, { muted: !!m.muted });
    if (m.muted) speaking.delete(id);
    // qarşı tərəf təzədən qoşulub: köhnə bağlantı atılır, yenisi qurulur
    if (m.restart && peers.has(id)) dropPeer(id);
    if (enabled && myId() < Number(id)) offerTo(id);
  } else {
    voicePeers.delete(id);
    dropPeer(id);
  }
  repaint();
}

// ---------- danışan göstəricisi (yüngül: 4 dəfə/saniyə səs səviyyəsi) ----------
function meter(id, st) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !st) return;
    if (!meterCtx) meterCtx = new AC();
    if (meterCtx.state === 'suspended') meterCtx.resume().catch(() => {});
    unmeter(id);
    const src = meterCtx.createMediaStreamSource(st);
    const analyser = meterCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser); // çıxışa qoşulmur — səs yalnız <audio> ilə çalınır (ikiqat səs olmasın)
    meters.set(String(id), { src, analyser, data: new Uint8Array(analyser.fftSize) });
    if (!meterTimer) meterTimer = setInterval(tickMeters, 250);
  } catch { /* göstərici olmasa da səs işləyir */ }
}
function unmeter(id) {
  const m = meters.get(String(id));
  if (m) { try { m.src.disconnect(); } catch { /* */ } meters.delete(String(id)); }
  if (!meters.size && meterTimer) { clearInterval(meterTimer); meterTimer = 0; }
}
function tickMeters() {
  let changed = false;
  for (const [id, m] of meters) {
    m.analyser.getByteTimeDomainData(m.data);
    let sum = 0;
    for (let i = 0; i < m.data.length; i++) { const v = (m.data[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / m.data.length);
    const isMuted = id === 'me' ? muted : (voicePeers.get(id)?.muted || false);
    const on = rms > 0.035 && !isMuted;
    if (on !== speaking.has(id)) { if (on) speaking.add(id); else speaking.delete(id); changed = true; }
  }
  if (changed) lazyRepaint();
}

// iOS Safari: səs elementləri ilk toxunuşdan sonra çalına bilər — hər toxunuşda dayanmış elementləri yenidən başlat
document.addEventListener('pointerdown', () => {
  for (const a of audios.values()) if (a.paused && a.srcObject) a.play().catch(() => {});
  if (meterCtx?.state === 'suspended') meterCtx.resume().catch(() => {});
}, { passive: true, capture: true });

export const voiceDebug = () => ({ enabled, muted, haveTurn, peers: [...peers.keys()], voicePeers: [...voicePeers.keys()], conn: Object.fromEntries(conn), localMute: [...localMute] });
