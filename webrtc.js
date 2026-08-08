// webrtc.js — canais de voz/vídeo em malha (mesh) usando o Realtime Database
// como sinalizador. Funciona bem para poucas pessoas por canal (2–4). Sem TURN
// dedicado: em redes muito restritas (CGNAT/firewalls corporativos) pode falhar.
import { rtdb } from "./firebase-config.js";
import {
  ref, set, remove, get, push, onValue, onChildAdded, off,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

let localStream = null;
let micOn = true;
let camOn = true;
let ctx = null; // { serverId, channelId, uid, displayName }
let peers = {};        // uid -> RTCPeerConnection
let presenceCb = null;
let callCbs = {};      // peerUid -> [{ path, cb }]

const $ = (id) => document.getElementById(id);

function presencePath() {
  return `voicePresence/${ctx.serverId}/${ctx.channelId}`;
}
function callKey(peerUid) {
  return [ctx.uid, peerUid].sort().join("_");
}
function callPath(peerUid) {
  return `calls/${ctx.serverId}_${ctx.channelId}_${callKey(peerUid)}`;
}

export async function joinVoiceChannel({ serverId, channelId, uid, displayName }) {
  ctx = { serverId, channelId, uid, displayName };

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }
  addVideoTile(uid, displayName + " (você)", localStream, true);

  await set(ref(rtdb, `${presencePath()}/${uid}`), { displayName, joinedAt: Date.now() });

  presenceCb = onValue(ref(rtdb, presencePath()), (snap) => {
    const val = snap.val() || {};
    const currentPeers = Object.keys(val).filter((k) => k !== uid);

    // Conecta com quem ainda não está conectado
    currentPeers.forEach((peerUid) => {
      if (peers[peerUid]) return;
      const peerName = val[peerUid].displayName;
      if (uid < peerUid) startCall(peerUid, peerName);
      else listenForIncomingCall(peerUid, peerName);
    });

    // Fecha quem saiu
    Object.keys(peers).forEach((peerUid) => {
      if (!currentPeers.includes(peerUid)) closePeer(peerUid);
    });

    renderParticipants(val);
  });
}

function renderParticipants(val) {
  const box = $("voice-participants");
  if (!box) return;
  box.innerHTML = "";
  Object.values(val).forEach((p) => {
    const el = document.createElement("div");
    el.className = "voice-participant";
    el.innerHTML = `<div class="avatar avatar-sm" style="display:flex;align-items:center;justify-content:center;background:var(--bg-3)">🎤</div><span>${escapeHTML(p.displayName)}</span>`;
    box.appendChild(el);
  });
}

function escapeHTML(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

async function startCall(peerUid, peerName) {
  const pc = createPeerConnection(peerUid, peerName);
  const base = callPath(peerUid);
  callCbs[peerUid] = [];

  pc.onicecandidate = (event) => {
    if (event.candidate) push(ref(rtdb, `${base}/callerCandidates`), event.candidate.toJSON());
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await set(ref(rtdb, base), {
    offer: { type: offer.type, sdp: offer.sdp },
    from: ctx.uid,
    to: peerUid,
  });

  const answerCb = onValue(ref(rtdb, `${base}/answer`), async (snap) => {
    const answer = snap.val();
    if (answer && pc.signalingState !== "stable") {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  });
  callCbs[peerUid].push({ path: `${base}/answer`, cb: answerCb });

  const candCb = onChildAdded(ref(rtdb, `${base}/calleeCandidates`), (snap) => {
    pc.addIceCandidate(new RTCIceCandidate(snap.val()));
  });
  callCbs[peerUid].push({ path: `${base}/calleeCandidates`, cb: candCb, isChildAdded: true });
}

function listenForIncomingCall(peerUid, peerName) {
  const base = callPath(peerUid);
  callCbs[peerUid] = [];

  const offerCb = onValue(ref(rtdb, `${base}/offer`), async (snap) => {
    const offer = snap.val();
    if (!offer || peers[peerUid]) return;
    const pc = createPeerConnection(peerUid, peerName);

    pc.onicecandidate = (event) => {
      if (event.candidate) push(ref(rtdb, `${base}/calleeCandidates`), event.candidate.toJSON());
    };

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await set(ref(rtdb, `${base}/answer`), { type: answer.type, sdp: answer.sdp });

    const candCb = onChildAdded(ref(rtdb, `${base}/callerCandidates`), (s2) => {
      pc.addIceCandidate(new RTCIceCandidate(s2.val()));
    });
    callCbs[peerUid].push({ path: `${base}/callerCandidates`, cb: candCb, isChildAdded: true });
  });
  callCbs[peerUid].push({ path: `${base}/offer`, cb: offerCb });
}

function createPeerConnection(peerUid, peerName) {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  const remoteStream = new MediaStream();
  addVideoTile(peerUid, peerName, remoteStream, false);
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((t) => remoteStream.addTrack(t));
  };
  peers[peerUid] = pc;
  return pc;
}

function addVideoTile(uid, label, stream, muted) {
  removeVideoTile(uid);
  const wrap = document.createElement("div");
  wrap.id = "tile-" + uid;
  wrap.style.cssText = "position:relative";
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = muted;
  video.srcObject = stream;
  const tag = document.createElement("span");
  tag.textContent = label;
  tag.style.cssText = "position:absolute;bottom:6px;left:8px;background:rgba(0,0,0,.5);padding:2px 8px;border-radius:6px;font-size:12px";
  wrap.appendChild(video);
  wrap.appendChild(tag);
  $("video-grid")?.appendChild(wrap);
}

function removeVideoTile(uid) {
  document.getElementById("tile-" + uid)?.remove();
}

function closePeer(peerUid) {
  peers[peerUid]?.close();
  delete peers[peerUid];
  (callCbs[peerUid] || []).forEach(({ path, cb }) => off(ref(rtdb, path), "value", cb));
  delete callCbs[peerUid];
  removeVideoTile(peerUid);
  if (ctx) remove(ref(rtdb, callPath(peerUid))).catch(() => {});
}

export function leaveVoiceChannel() {
  if (!ctx) return;
  Object.keys(peers).forEach(closePeer);
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  if (presenceCb) off(ref(rtdb, presencePath()), "value", presenceCb);
  remove(ref(rtdb, `${presencePath()}/${ctx.uid}`)).catch(() => {});
  const grid = $("video-grid");
  if (grid) grid.innerHTML = "";
  ctx = null;
}

window.devcordToggleMic = () => {
  if (!localStream) return true;
  micOn = !micOn;
  localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
  return micOn;
};
window.devcordToggleCam = () => {
  if (!localStream) return true;
  camOn = !camOn;
  localStream.getVideoTracks().forEach((t) => (t.enabled = camOn));
  return camOn;
};
