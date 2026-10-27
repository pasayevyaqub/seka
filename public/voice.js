// Otaqdaxili səs: WebRTC media, mövcud WebSocket isə yalnız siqnallaşdırma üçündür.
let send = () => false, getRoom = () => null, getUser = () => null, repaint = () => {};
let stream = null, enabled = false, muted = false, iceServers = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const peers = new Map(), voicePeers = new Set(), audios = new Map();

export function initVoice(opts) { send = opts.send; getRoom = opts.getRoom; getUser = opts.getUser; repaint = opts.repaint; }
export const voiceEnabled = () => enabled;
export const peerVoiceActive = (id) => voicePeers.has(String(id));
export function voiceButtonHTML() {
  return `<button class="rb-btn voice-btn ${enabled && !muted ? 'voice-on' : ''}" data-a="voiceToggle" aria-pressed="${enabled && !muted}" title="${!enabled ? 'Mikrofonu qoş' : muted ? 'Mikrofonun səsini aç' : 'Mikrofonu səssizə al'}">${!enabled ? '🎤' : muted ? '🔇' : '🎙️'}</button>`;
}

async function getIce() {
  try {
    const r = await fetch('/api/voice/ice', { credentials: 'same-origin' });
    if (r.ok) iceServers = (await r.json()).iceServers || iceServers;
  } catch { /* STUN ilə davam et; TURN olmasa bəzi mobil şəbəkələr qoşulmaya bilər */ }
}

export async function toggleVoice() {
  if (enabled) {
    muted = !muted;
    stream?.getAudioTracks().forEach(t => { t.enabled = !muted; });
    repaint(); return;
  }
  if (!navigator.mediaDevices?.getUserMedia) { alert('Bu brauzerdə mikrofon/WebRTC dəstəyi yoxdur. HTTPS ilə açın.'); return; }
  try {
    // Bu funksiya yalnız istifadəçi 🎤 düyməsinə basanda çağırılır.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    enabled = true; muted = false;
    await getIce();
    send({ t: 'voiceState', enabled: true });
    for (const id of voicePeers) if (Number(getUser()?.id) < Number(id)) await offerTo(id);
    repaint();
  } catch (e) {
    enabled = false; stream?.getTracks().forEach(t => t.stop()); stream = null;
    alert(e.name === 'NotAllowedError' ? 'Mikrofona icazə verilmədi. Oyuna səssiz davam edə bilərsiniz.' : 'Mikrofon açıla bilmədi. Oyuna səssiz davam edə bilərsiniz.');
    repaint();
  }
}

export function stopVoice(notify = true) {
  enabled = false; muted = false;
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  for (const [id, pc] of peers) { pc.close(); removeAudio(id); }
  peers.clear();
  if (notify) send({ t: 'voiceState', enabled: false });
  repaint();
}

function makePeer(id) {
  let pc = peers.get(id);
  if (pc) return pc;
  pc = new RTCPeerConnection({ iceServers });
  peers.set(id, pc);
  stream?.getTracks().forEach(track => pc.addTrack(track, stream));
  pc.onicecandidate = e => { if (e.candidate) send({ t: 'voiceSignal', to: id, signal: { candidate: e.candidate } }); };
  pc.ontrack = e => {
    let audio = audios.get(id);
    if (!audio) { audio = document.createElement('audio'); audio.autoplay = true; audio.playsInline = true; audio.dataset.voicePeer = id; document.body.append(audio); audios.set(id, audio); }
    audio.srcObject = e.streams[0]; audio.play().catch(() => { /* iOS may need another user tap */ });
  };
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) { pc.close(); peers.delete(id); removeAudio(id); } };
  return pc;
}
async function offerTo(id) {
  if (!enabled || !voicePeers.has(id) || peers.has(id)) return;
  const pc = makePeer(id);
  const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
  send({ t: 'voiceSignal', to: id, signal: { description: pc.localDescription } });
}
function removeAudio(id) { const a = audios.get(id); if (a) { a.srcObject = null; a.remove(); audios.delete(id); } }

export async function onVoiceSignal(m) {
  if (!enabled || !m.fromId || !m.signal) return;
  const pc = makePeer(String(m.fromId));
  try {
    if (m.signal.description) {
      await pc.setRemoteDescription(m.signal.description);
      if (m.signal.description.type === 'offer') {
        const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
        send({ t: 'voiceSignal', to: m.fromId, signal: { description: pc.localDescription } });
      }
    } else if (m.signal.candidate) await pc.addIceCandidate(m.signal.candidate);
  } catch { pc.close(); peers.delete(String(m.fromId)); }
}
export function onVoiceState(m) {
  const id = String(m.userId);
  if (Number(id) === Number(getUser()?.id)) return;
  if (m.enabled) {
    voicePeers.add(id);
    if (enabled && Number(getUser()?.id) < Number(id)) offerTo(id).catch(() => {});
  } else {
    voicePeers.delete(id); peers.get(id)?.close(); peers.delete(id); removeAudio(id);
  }
  repaint();
}
