// webrtc.js — canais de voz/vídeo em malha (mesh) usando o Realtime Database
// como sinalizador. Melhorias: buffering de ICE, remoção correta de listeners,
// mute/deaf, compartilhamento de tela e chat durante a call.
import { rtdb } from "./firebase-config.js";
import {
  ref, set, remove, get, push, onValue, onChildAdded, off, update, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

let localStream = null;
let camStream = null;
let micOn = true;
let camOn = true;
let deaf = false;
let sharing = false;
let screenStream = null;
let ctx = null;
let peers = {};
let presenceCb = null;
let callCbs = {};
let callChatCb = null;
let pendingCandidates = {};

const $ = (id) => document.getElementById(id);

function presencePath() { return `voicePresence/${ctx.serverId}/${ctx.channelId}`; }
function callKey(peerUid) { return [ctx.uid, peerUid].sort().join("_"); }
function callPath(peerUid) { return `calls/${ctx.serverId}_${ctx.channelId}_${callKey(peerUid)}`; }
function chatPath() { return `callChats/${ctx.serverId}_${ctx.channelId}`; }

function escapeHTML(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

export async function joinVoiceChannel({ serverId, channelId, uid, displayName }) {
  ctx = { serverId, channelId, uid, displayName };

  try {
    camStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    localStream = camStream;
  } catch {
    camStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream = camStream;
  }
  addVideoTile(uid, displayName + " (você)", localStream, true);

  await set(ref(rtdb, `${presencePath()}/${uid}`), { displayName, joinedAt: Date.now() });

  presenceCb = onValue(ref(rtdb, presencePath()), (snap) => {
    const val = snap.val() || {};
    const currentPeers = Object.keys(val).filter((k) => k !== uid);

    currentPeers.forEach((peerUid) => {
      if (peers[peerUid]) return;
      const peerName = val[peerUid].displayName;
      if (uid < peerUid) startCall(peerUid, peerName);
      else listenForIncomingCall(peerUid, peerName);
    });

    Object.keys(peers).forEach((peerUid) => {
      if (!currentPeers.includes(peerUid)) closePeer(peerUid);
    });

    renderParticipants(val);
  });

  listenCallChat();
}

// ===================== CHAT DURANTE A CALL =====================
export function sendCallChatMessage(text) {
  if (!ctx) return;
  push(ref(rtdb, chatPath()), {
    uid: ctx.uid,
    name: ctx.displayName,
    text: String(text).slice(0, 5000),
    createdAt: serverTimestamp(),
  });
}

function listenCallChat() {
  if (callChatCb) return;
  const cRef = ref(rtdb, chatPath());
  const box = $("call-chat-msgs");
  callChatCb = onValue(cRef, (snap) => {
    if (!box) return;
    const val = snap.val() || {};
    const list = Object.values(val).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    box.innerHTML = "";
    list.forEach((m) => {
      const line = document.createElement("div");
      line.className = "cc-line";
      const b = document.createElement("b");
      b.textContent = m.name + ": ";
      line.appendChild(b);
      line.appendChild(document.createTextNode(m.text));
      box.appendChild(line);
    });
    box.scrollTop = box.scrollHeight;
  });
}

function renderParticipants(val) {
  const box = $("voice-participants");
  if (!box) return;
  box.innerHTML = "";
  Object.values(val).forEach((p) => {
    const el = document.createElement("div");
    el.className = "voice-participant";
    const av = document.createElement("div");
    av.className = "avatar avatar-sm";
    av.style.cssText = "display:flex;align-items:center;justify-content:center;background:var(--bg-3)";
    av.textContent = "🎤";
    const span = document.createElement("span");
    span.textContent = p.displayName;
    el.appendChild(av);
    el.appendChild(span);
    box.appendChild(el);
  });
}

// ===================== CALL (offer/answer/ICE) =====================
async function startCall(peerUid, peerName) {
  const pc = createPeerConnection(peerUid, peerName);
  const base = callPath(peerUid);
  callCbs[peerUid] = [];

  pc.onicecandidate = (event) => {
    if (event.candidate) push(ref(rtdb, `${base}/callerCandidates`), event.candidate.toJSON());
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await set(ref(rtdb, base), { offer: { type: offer.type, sdp: offer.sdp }, from: ctx.uid, to: peerUid });

  const answerCb = onValue(ref(rtdb, `${base}/answer`), async (snap) => {
    const answer = snap.val();
    if (answer && pc.signalingState !== "stable") {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      flushCandidates(peerUid);
    }
  });
  callCbs[peerUid].push({ path: `${base}/answer`, cb: answerCb, event: "value" });

  const candCb = onChildAdded(ref(rtdb, `${base}/calleeCandidates`), (snap) => {
    queueCandidate(peerUid, snap.val());
  });
  callCbs[peerUid].push({ path: `${base}/calleeCandidates`, cb: candCb, event: "child_added" });
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
    flushCandidates(peerUid);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await set(ref(rtdb, `${base}/answer`), { type: answer.type, sdp: answer.sdp });

    const candCb = onChildAdded(ref(rtdb, `${base}/callerCandidates`), (s2) => {
      queueCandidate(peerUid, s2.val());
    });
    callCbs[peerUid].push({ path: `${base}/callerCandidates`, cb: candCb, event: "child_added" });
  });
  callCbs[peerUid].push({ path: `${base}/offer`, cb: offerCb, event: "value" });
}

function queueCandidate(peerUid, candidate) {
  const pc = peers[peerUid];
  if (!pc || !candidate) return;
  if (pc.remoteDescription) {
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
  } else {
    if (!pendingCandidates[peerUid]) pendingCandidates[peerUid] = [];
    pendingCandidates[peerUid].push(candidate);
  }
}

function flushCandidates(peerUid) {
  (pendingCandidates[peerUid] || []).forEach((c) => {
    peers[peerUid]?.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
  });
  delete pendingCandidates[peerUid];
}

function createPeerConnection(peerUid, peerName) {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  const remoteStream = new MediaStream();
  addVideoTile(peerUid, peerName, remoteStream, false);
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((t) => {
      remoteStream.addTrack(t);
      if (deaf && t.kind === "audio") t.enabled = false;
    });
  };
  peers[peerUid] = pc;
  return pc;
}

function addVideoTile(uid, label, stream, muted) {
  removeVideoTile(uid);
  const wrap = document.createElement("div");
  wrap.id = "tile-" + uid;
  wrap.className = "video-tile";
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = muted;
  video.srcObject = stream;
  const tag = document.createElement("span");
  tag.className = "vt-tag";
  tag.textContent = label;
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
  (callCbs[peerUid] || []).forEach(({ path, cb, event }) => off(ref(rtdb, path), event || "value", cb));
  delete callCbs[peerUid];
  delete pendingCandidates[peerUid];
  removeVideoTile(peerUid);
  if (ctx) remove(ref(rtdb, callPath(peerUid))).catch(() => {});
}

export function leaveVoiceChannel() {
  if (!ctx) return;
  Object.keys(peers).forEach(closePeer);
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  camStream = null;
  if (screenStream) { screenStream.getTracks().forEach((t) => t.stop()); screenStream = null; }
  sharing = false; deaf = false;
  if (presenceCb) off(ref(rtdb, presencePath()), "value", presenceCb);
  if (callChatCb) off(ref(rtdb, chatPath()), "value", callChatCb);
  callChatCb = null;
  remove(ref(rtdb, `${presencePath()}/${ctx.uid}`)).catch(() => {});
  const grid = $("video-grid");
  if (grid) grid.innerHTML = "";
  ctx = null;
}

// ===================== MUTE / DEAF / CAM / SCREENSHARE =====================
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

export function setDeafMode(mute) {
  deaf = mute;
  Object.values(peers).forEach((pc) => {
    pc.getReceivers?.().forEach((r) => {
      if (r.track?.kind === "audio") r.track.enabled = !mute;
    });
  });
}
window.devcordToggleDeaf = () => {
  setDeafMode(!deaf);
  return !deaf;
};
window.devcordIsDeaf = () => deaf;

export async function startScreenShare() {
  if (!ctx || !localStream) return false;
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    sharing = true;
    Object.values(peers).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      sender?.replaceTrack(screenTrack);
    });
    screenTrack.addEventListener("ended", () => stopScreenShare());
    return true;
  } catch { return false; }
}

export async function stopScreenShare() {
  if (!sharing) return;
  sharing = false;
  if (screenStream) { screenStream.getTracks().forEach((t) => t.stop()); screenStream = null; }
  const camTrack = camStream?.getVideoTracks()[0];
  Object.values(peers).forEach((pc) => {
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (camTrack && sender) sender.replaceTrack(camTrack);
  });
}
window.devcordSharing = () => sharing;