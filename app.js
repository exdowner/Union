// app.js — núcleo do DevCord: servidores, canais, chat, uploads, stickers, fórum,
// perfil, amigos, DMs, notificações, reações, GIPHY, emojis, busca, galeria, cargos,
// moderação e previews de links. Tudo com Firebase Realtime Database.
import { auth, rtdb, signOut, updateProfile, serverTimestamp } from "./firebase-config.js";
import {
  ref, push, set, update, remove, get, onValue, off, onChildAdded,
  onDisconnect, query, orderByChild, limitToLast,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { uploadFile } from "./cloudinary.js";
import { joinVoiceChannel, leaveVoiceChannel, setDeafMode, startScreenShare, stopScreenShare, sendCallChatMessage } from "./webrtc.js";
import { icon } from "./icons.js";
import { renderEmojiPicker, addRecentEmoji, isFavEmoji, toggleFavEmoji, getFavEmojis } from "./emoji.js";
import { renderGiphyPicker, searchGifs, searchStickers, trendingGifs, trendingStickers, addRecentGif, getRecentGifs } from "./giphy.js";
import { appendLinkCards, openLightbox } from "./links.js";
import { getTheme, setTheme, initTheme } from "./theme.js";

// ===================== HELPERS =====================
const $ = (id) => document.getElementById(id);
const MAX_MSG = 5000;
const MAX_UPLOAD = 5 * 1024 * 1024;

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

function sanitizeUrl(url) {
  if (typeof url !== "string") return "";
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.href;
  } catch { return ""; }
}

function defaultAvatar(seed) {
  return `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(seed)}`;
}

function toast(msg, type = "info", ms = 2600) {
  const wrap = $("toast-wrap");
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  t.setAttribute("role", "status");
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity 200ms"; }, ms - 200);
  setTimeout(() => t.remove(), ms);
}
window.addEventListener("devcord:toast", (e) => toast(e.detail?.msg, e.detail?.type));

function iconButton(name, opts = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "icon-btn" + (opts.className ? " " + opts.className : "");
  b.innerHTML = icon(name, opts.size || 18);
  if (opts.label) b.setAttribute("aria-label", opts.label);
  if (opts.tooltip) b.dataset.tooltip = opts.tooltip;
  if (opts.on) b.addEventListener("click", opts.on);
  return b;
}

function skeletonLines(container, n, cls = "skel-line") {
  container.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const s = document.createElement("div");
    s.className = "skeleton " + cls;
    s.style.width = (60 + ((i * 37) % 35)) + "%";
    s.style.marginBottom = "10px";
    container.appendChild(s);
  }
}

function emptyState(iconName, title, desc) {
  return `<div class="empty-state"><div class="es-icon">${icon(iconName, 34)}</div><h3>${esc(title)}</h3><p>${esc(desc || "")}</p></div>`;
}
function errorState(title, desc) {
  return `<div class="error-state"><div class="es-icon">${icon("alert-triangle", 34)}</div><h3>${esc(title)}</h3><p>${esc(desc || "")}</p></div>`;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ===================== ESTADO GLOBAL =====================
let currentUser = null;
let userProfile = null;
let currentServerId = null;
let currentChannelId = null;
let currentChannelType = null;
let pendingFile = null;
let uploadCtrl = null;

let serverCache = {};
let serverUnsubs = {};
let unsubUserServers = null;
let unsubChannels = null;
let unsubMessages = null;
let unsubForumPosts = null;
let unsubForumReplies = null;
let unsubTyping = null;
let unsubFriends = null;
let unsubNotifs = null;
let unsubFeed = null;

let rolesCache = {};
let unreadChannels = {};   // `${serverId}/${channelId}` -> count
let readsCache = {};       // `${serverId}/${channelId}` -> lastRead ts
let typingCache = {};      // `${serverId}/${channelId}` -> {uid:name}
let feedSubs = {};         // `${serverId}/${channelId}` -> unsub fn
let feedChannels = {};     // `${serverId}` -> {channelId:true}
let dmOpenPair = null;
let dmUnsub = null;
let dmMessagesCache = null;
let lastSentAt = {};
let pendingGif = null;
let userFavGifs = [];
let userFavStickers = [];

// ===================== MODAIS / DRAWERS =====================
function openModal(id) {
  $("modal-overlay").classList.remove("hidden");
  document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden"));
  $(id).classList.remove("hidden");
  $(id).querySelector("input, textarea, select, button:not(.modal-cancel)")?.focus?.();
}
function closeModals() { $("modal-overlay").classList.add("hidden"); }
document.querySelectorAll(".modal-cancel").forEach((b) => b.addEventListener("click", closeModals));
$("modal-overlay").addEventListener("click", (e) => { if (e.target.id === "modal-overlay") closeModals(); });
document.querySelectorAll(".modal-close:not(.modal-cancel)").forEach((b) => {
  if (b.id === "user-profile-close") return;
  b.addEventListener("click", closeModals);
});
$("user-profile-close").addEventListener("click", closeModals);

function openDrawer(id) {
  closeDrawers();
  $("drawer-overlay").classList.remove("hidden");
  $(id).classList.remove("hidden");
}
function closeDrawers() {
  $("drawer-overlay").classList.add("hidden");
  document.querySelectorAll(".drawer").forEach((d) => d.classList.add("hidden"));
}
$("drawer-overlay").addEventListener("click", closeDrawers);
document.querySelectorAll(".drawer-close").forEach((b) => b.addEventListener("click", closeDrawers));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDrawers(); closeModals(); } });

// ===================== TEMA =====================
initTheme();
function cycleTheme() {
  const order = ["dark", "light", "amoled"];
  const cur = getTheme();
  const next = order[(order.indexOf(cur) + 1) % order.length];
  setTheme(next);
  updateThemeButton();
}
function updateThemeButton() {
  const icons = { dark: "moon", light: "sun", amoled: "moon" };
  [$("theme-btn"), $("auth-theme-btn")].forEach((b) => { if (b) b.innerHTML = icon(icons[getTheme()] || "moon", 18); });
}
$("theme-btn").addEventListener("click", cycleTheme);
$("auth-theme-btn").addEventListener("click", cycleTheme);

// ===================== BOOT =====================
window.addEventListener("devcord:signed-in", async (e) => {
  currentUser = e.detail;
  const snap = await get(ref(rtdb, `users/${currentUser.uid}`));
  userProfile = snap.val();
  renderUserCard();
  listenServers();
  listenFriends();
  listenNotifications();
  setupPresence();
  updateThemeButton();
  handleDeepLink();
  await loadUserFavs();
});

function setupPresence() {
  const myRef = ref(rtdb, `presence/${currentUser.uid}`);
  const conn = ref(rtdb, ".info/connected");
  onValue(conn, (s) => {
    if (s.val() === true) {
      const d = onDisconnect(myRef);
      d.update({ status: "offline", lastSeen: serverTimestamp() }).then(() => {
        set(myRef, { status: userProfile?.presence || "online", lastSeen: serverTimestamp() });
      }).catch(() => {});
    }
  });
  listenUserPresence(currentUser.uid, "online");
}

function renderUserCard() {
  $("user-card-avatar").src = userProfile.photoURL || defaultAvatar(currentUser.uid);
  $("user-card-name").textContent = userProfile.displayName || "Usuário";
  $("user-card-name").style.fontFamily = userProfile.nameFont || "Inter";
  const st = userProfile.presence || "online";
  const label = { online: "Online", idle: "Ausente", dnd: "Não perturbe", offline: "Invisível" }[st] || "Online";
  $("user-card-status").lastChild.textContent = " " + label;
  const pd = $("user-card-status").querySelector(".pd");
  pd.className = "pd " + st;
  $("user-card-presence").className = "presence-dot " + st;
}

$("user-card-info").addEventListener("click", () => { loadSettings(); openModal("modal-settings"); });
$("status-menu-btn").addEventListener("click", () => { loadSettings(); openModal("modal-settings"); });

// ===================== PRESENÇA (online/offline/ausente/dnd) =====================
const presenceListeners = {};
export function listenUserPresence(uid, fallback) {
  if (presenceListeners[uid]) return presenceListeners[uid];
  const cb = onValue(ref(rtdb, `presence/${uid}`), (s) => {
    const v = s.val();
    window.dispatchEvent(new CustomEvent("devcord:presence", { detail: { uid, status: v?.status || "offline" } }));
  });
  presenceListeners[uid] = cb;
  return cb;
}

// ===================== SERVIDORES =====================
function listenServers() {
  const uServRef = ref(rtdb, `userServers/${currentUser.uid}`);
  unsubUserServers = onValue(uServRef, (snap) => {
    const ids = snap.exists() ? Object.keys(snap.val()) : [];
    Object.keys(serverUnsubs).forEach((id) => {
      if (!ids.includes(id)) {
        off(ref(rtdb, `servers/${id}`), "value", serverUnsubs[id]);
        delete serverUnsubs[id];
        delete serverCache[id];
      }
    });
    ids.forEach((id) => {
      if (!serverUnsubs[id]) {
        const sRef = ref(rtdb, `servers/${id}`);
        const cb = onValue(sRef, (s2) => {
          serverCache[id] = { id, ...(s2.val() || {}) };
          renderServerList();
          loadServerRoles(id);
          loadChannelMeta(id);
        });
        serverUnsubs[id] = cb;
      }
    });
    renderServerList();
  });
}

async function loadServerRoles(serverId) {
  const snap = await get(ref(rtdb, `servers/${serverId}/roles`));
  rolesCache[serverId] = snap.val() || {};
  window.dispatchEvent(new CustomEvent("devcord:roles", { detail: { serverId } }));
}

function renderServerList() {
  const list = $("server-list");
  list.innerHTML = "";
  Object.values(serverCache).forEach((s) => {
    const btn = document.createElement("button");
    btn.className = "server-pill" + (s.id === currentServerId ? " active" : "");
    btn.title = s.name || "";
    btn.setAttribute("aria-label", s.name || "Servidor");
    if (hasServerUnread(s.id)) {
      const dot = document.createElement("span");
      dot.className = "unread-pill";
      dot.setAttribute("aria-hidden", "true");
      btn.appendChild(dot);
    }
    if (s.iconURL) {
      const img = document.createElement("img");
      img.src = s.iconURL;
      img.alt = "";
      btn.appendChild(img);
    } else {
      btn.textContent = (s.name || "??").slice(0, 2).toUpperCase();
    }
    btn.addEventListener("click", () => selectServer(s.id, s));
    list.appendChild(btn);
  });
}

// ... rest of file unchanged until composer section ...

// ===================== COMPOSER =====================
const input = $("message-input");
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
  emitTyping();
});

let typingLastWrite = 0;
function emitTyping() {
  if (!currentServerId || !currentChannelId || !currentUser) return;
  const now = Date.now();
  if (now - typingLastWrite < 1500) return;
  typingLastWrite = now;
  const path = `typing/${currentServerId}/${currentChannelId}/${currentUser.uid}`;
  const r = ref(rtdb, path);
  set(r, { name: userProfile.displayName, at: serverTimestamp() }).catch(() => {});
  onDisconnect(r).remove();
}

function listenTyping() {
  if (unsubTyping) off(ref(rtdb, unsubTyping.path), "value", unsubTyping.cb);
  const path = `typing/${currentServerId}/${currentChannelId}`;
  const r = ref(rtdb, path);
  const cb = onValue(r, (snap) => {
    const box = $("typing-indicator");
    const val = snap.val() || {};
    const now = Date.now();
    const names = [];
    Object.entries(val).forEach(([uid, t]) => {
      if (uid === currentUser.uid) return;
      const at = typeof t?.at === "number" ? t.at : now;
      if (now - at < 4000 && !names.includes(t.name)) names.push(t.name);
    });
    if (names.length) {
      box.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span> ${esc(names.join(", "))} ${names.length > 1 ? "estão digitando..." : "está digitando..."}`;
    } else box.innerHTML = "";
  });
  unsubTyping = { path, cb };
}

$("message-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim().slice(0, MAX_MSG);
  if (!text && !pendingFile && !pendingGif) return;

  const now = Date.now();
  if (lastSentAt[currentChannelId] && now - lastSentAt[currentChannelId] < 700) {
    toast("Devagar! Você está enviando rápido demais.", "error");
    return;
  }
  lastSentAt[currentChannelId] = now;

  const base = {
    uid: currentUser.uid,
    authorName: userProfile.displayName,
    authorPhoto: userProfile.photoURL || "",
    authorColor: userProfile.accentColor || "#5ee6c4",
    text: text || "",
    createdAt: serverTimestamp(),
  };

  if (pendingGif) {
    // pendingGif: normalized item from giphy.js
    base.type = pendingGif.type || "gif";
    base.provider = pendingGif.provider || "giphy";
    base.gifId = pendingGif.gifId || pendingGif.id;
    base.url = pendingGif.full || pendingGif.url;
    base.preview = pendingGif.preview || pendingGif.url;
    base.width = pendingGif.width || 0;
    base.height = pendingGif.height || 0;
    base.title = pendingGif.title || "";
    pendingGif = null;
    $("gif-picker").classList.add("hidden");
  }

  if (pendingFile) {
    try {
      const { url, isVideo } = await uploadFile(pendingFile);
      base[isVideo ? "videoURL" : "imageURL"] = url;
    } catch (err) {
      toast("Falha no upload: " + err.message, "error");
      return;
    }
    pendingFile = null;
    $("attach-preview").classList.add("hidden");
  }

  input.value = "";
  input.style.height = "auto";
  const msgRef = await push(ref(rtdb, `messages/${currentServerId}/${currentChannelId}`), base);
  update(ref(rtdb, `channelMeta/${currentServerId}/${currentChannelId}`), { lastMsgAt: serverTimestamp() }).catch(() => {});
});

// ===================== UPLOAD (preview, progresso, cancelar, 5MB) =====================
$("attach-btn").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > MAX_UPLOAD) {
    toast("Arquivo acima de 5MB. Escolha outro.", "error");
    e.target.value = "";
    return;
  }
  pendingFile = file;
  const box = $("attach-preview");
  const isImg = file.type.startsWith("image/");
  const sizeKb = Math.round(file.size / 1024);
  box.innerHTML = `
    <div class="ap-info">
      <div class="ap-name">${esc(file.name)}</div>
      <div class="ap-size">${sizeKb < 1024 ? sizeKb + " KB" : (sizeKb / 1024).toFixed(1) + " MB"} · ${isImg ? "imagem" : "vídeo"}</div>
      <div class="upload-error hidden" id="upload-error"></div>
    </div>
    <button class="icon-btn danger" id="cancel-upload" aria-label="Cancelar envio"></button>`;
  box.querySelector("#cancel-upload").innerHTML = icon("x", 18);
  box.querySelector("#cancel-upload").addEventListener("click", () => {
    pendingFile = null;
    box.classList.add("hidden");
    $("file-input").value = "";
  });
  if (isImg) {
    const thumb = document.createElement("img");
    thumb.className = "ap-img";
    thumb.src = URL.createObjectURL(file);
    thumb.alt = "";
    box.insertBefore(thumb, box.firstChild);
  }
  box.classList.remove("hidden");
});

// ===================== GIPHY PICKER =====================
$("gif-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const picker = $("gif-picker");
  $("emoji-picker").classList.add("hidden");
  picker.classList.toggle("hidden");
  if (picker.classList.contains("hidden")) return;
  renderGiphyPicker(picker, {
    onPick: (item) => {
      // item is normalized from giphy.js
      pendingGif = item;
      $("composer-hint").classList.remove("hidden");
      $("composer-hint").innerHTML = `${icon("film", 14)} <span>GIF pronto: ${esc(item.title || "GIF")} (clique em Enviar)</span> <button class="icon-btn" id="cancel-gif" aria-label="Cancelar GIF"></button>`;
      $("composer-hint").querySelector("#cancel-gif").innerHTML = icon("x", 14);
      $("composer-hint").querySelector("#cancel-gif").addEventListener("click", () => {
        pendingGif = null;
        $("composer-hint").classList.add("hidden");
      });
      picker.classList.add("hidden");
    },
    getFavs: () => userFavGifs || [],
    toggleFav: async (item) => {
      await toggleUserFav(item);
    },
    isFav: (item) => (userFavGifs || []).some((f) => f.id === item.id),
  });
});

async function loadUserFavs() {
  if (!currentUser) return;
  try {
    const snap = await get(ref(rtdb, `users/${currentUser.uid}/favorites/gifs`));
    userFavGifs = snap.val() ? Object.values(snap.val()) : [];
  } catch { userFavGifs = [] }
  try {
    const snap2 = await get(ref(rtdb, `users/${currentUser.uid}/favorites/stickers`));
    userFavStickers = snap2.val() ? Object.values(snap2.val()) : [];
  } catch { userFavStickers = [] }
}

async function toggleUserFav(item) {
  if (!currentUser) { toast("Faça login para favoritar.", "info"); return; }
  const path = `users/${currentUser.uid}/favorites/${item.type === 'sticker' ? 'stickers' : 'gifs'}/${item.id}`;
  const snap = await get(ref(rtdb, path));
  if (snap.exists()) {
    await remove(ref(rtdb, path));
    toast("Removido dos favoritos.", "info");
  } else {
    await set(ref(rtdb, path), { id: item.id, url: item.url, preview: item.preview, title: item.title, provider: item.provider, at: serverTimestamp() });
    toast("Adicionado aos favoritos! ⭐", "success");
  }
  await loadUserFavs();
}

// ===================== STICKERS (customizadas) =====================
$("sticker-btn").addEventListener("click", async (e) => {
  e.stopPropagation();
  const picker = $("sticker-picker");
  picker.classList.toggle("hidden");
  if (picker.classList.contains("hidden")) return;
  // Reuse GIPHY picker but default to stickers tab
  renderGiphyPicker(picker, {
    onPick: async (item) => {
      // send as sticker message
      await push(ref(rtdb, `messages/${currentServerId}/${currentChannelId}`), {
        uid: currentUser.uid,
        authorName: userProfile.displayName,
        authorPhoto: userProfile.photoURL || "",
        authorColor: userProfile.accentColor || "#5ee6c4",
        createdAt: serverTimestamp(),
        type: item.type || 'sticker',
        provider: item.provider || 'giphy',
        gifId: item.id,
        url: item.full || item.url,
        preview: item.preview || item.url,
        title: item.title || "",
      });
      update(ref(rtdb, `channelMeta/${currentServerId}/${currentChannelId}`), { lastMsgAt: serverTimestamp() }).catch(() => {});
      picker.classList.add("hidden");
    },
    getFavs: () => userFavStickers || [],
    toggleFav: async (item) => { await toggleUserFav(item); },
    isFav: (item) => (userFavStickers || []).some((f) => f.id === item.id),
  });
});

// ===================== RENDER MESSAGES (adjust to GIF/Stickers) =====================
function renderMessage(container, m, grouped, dmMode) {
  const el = document.createElement("div");
  el.className = "msg" + (grouped ? " msg-grouped" : "");
  el.dataset.msgId = m.id || "";

  const avatarWrap = document.createElement("div");
  avatarWrap.className = "avatar-wrap";
  const avatar = document.createElement("img");
  avatar.className = "avatar avatar-sm";
  avatar.src = sanitizeUrl(m.authorPhoto) || defaultAvatar(m.uid);
  avatar.alt = "";
  avatar.loading = "lazy";
  avatar.addEventListener("click", () => viewUserProfile(m.uid));
  avatarWrap.appendChild(avatar);

  const body = document.createElement("div");
  body.className = "msg-body";
  if (!grouped) {
    const head = document.createElement("div");
    head.className = "msg-head";
    const author = document.createElement("span");
    author.className = "msg-author";
    author.textContent = m.authorName || "Usuário";
    author.style.color = m.authorColor || "var(--text-0)";
    author.addEventListener("click", () => viewUserProfile(m.uid));
    head.appendChild(author);
    const time = document.createElement("span");
    time.className = "msg-time";
    time.textContent = m.createdAt ? new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
    head.appendChild(time);
    if (m.pinned) {
      const pin = document.createElement("span");
      pin.className = "msg-edited";
      pin.textContent = "📌 fixado";
      head.appendChild(pin);
    }
    if (m.edited) {
      const ed = document.createElement("span");
      ed.className = "msg-edited";
      ed.textContent = "(editado)";
      head.appendChild(ed);
    }
    body.appendChild(head);
  }

  if (m.text) {
    const txt = document.createElement("div");
    txt.className = "msg-text";
    txt.textContent = m.text;
    body.appendChild(txt);
    appendLinkCards(body, m.text);
  }

  // GIF / Sticker handling
  if (m.type === 'gif' || m.type === 'sticker') {
    const wrap = document.createElement("div");
    wrap.className = "msg-media";
    const img = document.createElement("img");
    img.src = sanitizeUrl(m.preview || m.url);
    img.loading = "lazy";
    img.alt = m.title || "GIF";
    img.addEventListener("click", () => openLightbox(m.url || m.full || m.preview, m.type === 'gif' ? 'img' : 'img'));
    wrap.appendChild(img);
    body.appendChild(wrap);
  } else if (m.gifUrl) {
    const wrap = document.createElement("div");
    wrap.className = "msg-media";
    const img = document.createElement("img");
    img.src = sanitizeUrl(m.gifUrl);
    img.loading = "lazy";
    img.alt = m.gifTitle || "GIF";
    img.addEventListener("click", () => openLightbox(m.gifUrl, "img"));
    wrap.appendChild(img);
    body.appendChild(wrap);
  } else if (m.stickerURL) {
    const wrap = document.createElement("div");
    wrap.className = "msg-sticker";
    const img = document.createElement("img");
    img.src = sanitizeUrl(m.stickerURL);
    img.loading = "lazy";
    img.alt = "";
    wrap.appendChild(img);
    body.appendChild(wrap);
  } else if (m.imageURL) {
    const wrap = document.createElement("div");
    wrap.className = "msg-media";
    const img = document.createElement("img");
    img.src = sanitizeUrl(m.imageURL);
    img.loading = "lazy";
    img.alt = "";
    img.addEventListener("click", () => openLightbox(m.imageURL, "img"));
    wrap.appendChild(img);
    body.appendChild(wrap);
  } else if (m.videoURL) {
    const wrap = document.createElement("div");
    wrap.className = "msg-media";
    const vid = document.createElement("video");
    vid.src = sanitizeUrl(m.videoURL);
    vid.controls = true;
    vid.preload = "metadata";
    wrap.appendChild(vid);
    body.appendChild(wrap);
  } else if (m.sticker) {
    const wrap = document.createElement("div");
    wrap.className = "msg-sticker";
    wrap.textContent = m.sticker;
    body.appendChild(wrap);
  }

  if (m.reactions) renderReactions(body, m);

  el.appendChild(avatarWrap);
  el.appendChild(body);
  if (dmMode) el.appendChild(buildDmActions(el, m));
  else el.appendChild(buildMsgActions(el, m));
  container.appendChild(el);
}

// ... rest of file unchanged ...
