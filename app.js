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
import { renderGiphyPicker } from "./giphy.js";
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

$("add-server-btn").addEventListener("click", () => {
  const action = prompt("Digite 'criar' para criar um servidor novo, ou cole o ID de um servidor para entrar nele:");
  if (!action) return;
  if (action.trim().toLowerCase() === "criar") openModal("modal-create-server");
  else joinServerById(action.trim());
});

async function joinServerById(serverId) {
  try {
    const snap = await get(ref(rtdb, `servers/${serverId}`));
    if (!snap.exists()) { toast("Servidor não encontrado.", "error"); return; }
    await set(ref(rtdb, `serverMembers/${serverId}/${currentUser.uid}`), true);
    await set(ref(rtdb, `userServers/${currentUser.uid}/${serverId}`), true);
    toast("Você entrou no servidor!", "success");
  } catch (err) {
    toast("Não foi possível entrar: " + err.message, "error");
  }
}

$("confirm-create-server").addEventListener("click", async () => {
  const name = $("new-server-name").value.trim();
  if (!name) { toast("Dê um nome ao servidor.", "error"); return; }
  const file = $("new-server-icon").files[0];
  if (file && file.size > MAX_UPLOAD) { toast("Ícone deve ter até 5MB.", "error"); return; }

  const newRef = push(ref(rtdb, "servers"));
  const serverId = newRef.key;
  await set(newRef, {
    name, ownerId: currentUser.uid, iconURL: "",
    createdAt: serverTimestamp(),
    roles: {
      owner: { name: "Dono", color: "#f1c40f", icon: "👑", permissions: { admin: true }, position: 999, isOwner: true },
      admin: { name: "Admin", color: "#e74c3c", icon: "🛡", permissions: { admin: true }, position: 90 },
    },
  });
  await set(ref(rtdb, `serverMembers/${serverId}/${currentUser.uid}`), true);
  await set(ref(rtdb, `userServers/${currentUser.uid}/${serverId}`), true);

  if (file) {
    try {
      const { url } = await uploadFile(file);
      await update(ref(rtdb, `servers/${serverId}`), { iconURL: url });
    } catch (err) { toast("Servidor criado, mas o ícone falhou: " + err.message, "error"); }
  }
  $("new-server-name").value = "";
  $("new-server-icon").value = "";
  closeModals();
  toast(`Servidor "${name}" criado! ID de convite: ${serverId}`, "success");
  selectServer(serverId, { name });
});

async function selectServer(serverId, serverData) {
  if (currentChannelType === "voice" && currentServerId !== serverId) leaveVoiceChannel();
  currentServerId = serverId;
  currentChannelId = null;
  currentChannelType = null;
  $("current-server-name").textContent = serverData.name;
  $("server-settings-btn").classList.remove("hidden");
  $("server-settings-btn").innerHTML = icon("settings", 18);
  document.querySelectorAll(".server-pill").forEach((p) => p.classList.remove("active"));
  $("home-pill").classList.remove("active");
  renderServerList();
  $("channel-sidebar").classList.remove("open");
  listenChannels();
  showView(null);
  $("call-btn").classList.add("hidden");
}

$("home-pill").addEventListener("click", () => {
  if (currentChannelType === "voice") leaveVoiceChannel();
  currentServerId = null;
  currentChannelId = null;
  currentChannelType = null;
  $("current-server-name").textContent = "Bem-vindo";
  $("server-settings-btn").classList.add("hidden");
  $("channel-groups").innerHTML = emptyState("message-circle", "Bem-vindo ao DevCord", "Crie ou entre em um servidor pra ver os canais aqui.");
  showView(null);
  $("call-btn").classList.add("hidden");
  document.querySelectorAll(".server-pill").forEach((p) => p.classList.remove("active"));
  $("home-pill").classList.add("active");
});

$("server-settings-btn").addEventListener("click", () => {
  if (!currentServerId) return;
  const choice = prompt(
    `ID de convite deste servidor (compartilhe para outras pessoas entrarem):\n${currentServerId}\n\nDigite 'canal' para criar um canal, 'cargos' para gerenciar cargos, ou cancele.`
  );
  if (!choice) return;
  const c = choice.trim().toLowerCase();
  if (c === "canal") openModal("modal-create-channel");
  else if (c === "cargos") openRolesModal();
});

function hasServerUnread(serverId) {
  return Object.entries(unreadChannels).some(([k, v]) => k.startsWith(serverId + "/") && v > 0);
}

function refreshChannelBadge(serverId, channelId) {
  if (serverId !== currentServerId) return;
  const item = document.querySelector(`.channel-item[data-sid="${serverId}"][data-cid="${channelId}"]`);
  if (!item) return;
  item.querySelector(".ch-unread")?.remove();
  item.querySelector(".ch-fav")?.remove();
  const favs = JSON.parse(localStorage.getItem("devcord-chanfavs") || "{}");
  if (favs[channelId]) {
    const favEl = document.createElement("span");
    favEl.className = "ch-fav";
    favEl.innerHTML = icon("star", 14);
    item.appendChild(favEl);
  }
  const unread = unreadChannels[`${serverId}/${channelId}`] || 0;
  if (unread > 0 && channelId !== currentChannelId) {
    const badge = document.createElement("span");
    badge.className = "ch-unread";
    badge.textContent = unread > 99 ? "99+" : unread;
    item.appendChild(badge);
  }
}

// ===================== CANAIS =====================
function listenChannels() {
  if (unsubChannels) off(ref(rtdb, `channels/${currentServerId}`), "value", unsubChannels);
  const chRef = ref(rtdb, `channels/${currentServerId}`);
  skeletonLines($("channel-groups"), 6, "skel-line");
  unsubChannels = onValue(chRef, async (snap) => {
    const groups = { text: [], voice: [], forum: [] };
    const val = snap.val() || {};
    Object.entries(val)
      .sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0))
      .forEach(([id, data]) => groups[data.type]?.push({ id, ...data }));
    feedChannels[currentServerId] = { text: [], voice: [], forum: [] };
    Object.entries(groups).forEach(([t, arr]) => { feedChannels[currentServerId][t] = arr; });
    renderChannels(groups);
    await subscribeCurrentServerFeed();
  });
}

const TYPE_LABEL = { text: "Canais de texto", voice: "Canais de voz", forum: "Fóruns" };
const TYPE_ICON = { text: "hash", voice: "volume", forum: "folder" };

async function loadChannelMeta(serverId) {
  const snap = await get(ref(rtdb, `channelMeta/${serverId}`));
  (snap.val() || null) && setMetaCache(serverId, snap.val());
}

let metaCache = {};
function setMetaCache(serverId, val) {
  Object.entries(val || {}).forEach(([cid, m]) => {
    metaCache[`${serverId}/${cid}`] = m;
  });
}

function renderChannels(groups) {
  const root = $("channel-groups");
  root.innerHTML = "";
  const collapsed = JSON.parse(localStorage.getItem("devcord-collapsed") || "{}");
  const favs = JSON.parse(localStorage.getItem("devcord-chanfavs") || "{}");

  Object.keys(groups).forEach((type) => {
    const grp = document.createElement("div");
    grp.className = "channel-group" + (collapsed[type] ? " collapsed" : "");

    const label = document.createElement("div");
    label.className = "channel-group-label";
    const caret = document.createElement("span");
    caret.className = "caret";
    caret.innerHTML = icon("chevron-right", 12);
    const nameSpan = document.createElement("span");
    nameSpan.textContent = TYPE_LABEL[type];
    const clickable = document.createElement("span");
    clickable.appendChild(caret);
    clickable.appendChild(nameSpan);
    clickable.addEventListener("click", () => {
      collapsed[type] = !collapsed[type];
      localStorage.setItem("devcord-collapsed", JSON.stringify(collapsed));
      grp.classList.toggle("collapsed", collapsed[type]);
    });

    const addBtn = iconButton("plus", { size: 14, label: "Criar canal " + TYPE_LABEL[type], on: () => { openModal("modal-create-channel"); $("new-channel-type").value = type; } });
    const actions = document.createElement("div");
    actions.className = "grp-actions";
    actions.appendChild(addBtn);
    label.appendChild(clickable);
    label.appendChild(actions);
    grp.appendChild(label);

    const items = document.createElement("div");
    items.className = "channel-items";
    groups[type].forEach((ch) => {
      items.appendChild(renderChannelItem(ch, favs));
    });
    if (!groups[type].length) {
      const empty = document.createElement("p");
      empty.className = "empty-hint";
      empty.textContent = "Nenhum canal ainda.";
      items.appendChild(empty);
    }
    grp.appendChild(items);
    root.appendChild(grp);
  });
}

function renderChannelItem(ch, favs) {
  const item = document.createElement("button");
  item.className = "channel-item" + (ch.id === currentChannelId ? " active" : "") + (favs[ch.id] ? " faved" : "");
  item.setAttribute("role", "listitem");
  item.dataset.sid = currentServerId;
  item.dataset.cid = ch.id;
  const key = `${currentServerId}/${ch.id}`;
  const unread = unreadChannels[key] || 0;

  const iconEl = document.createElement("span");
  iconEl.className = "ch-icon";
  iconEl.innerHTML = icon(TYPE_ICON[ch.type], 16);
  const name = document.createElement("span");
  name.className = "ch-name";
  name.textContent = ch.name;
  item.appendChild(iconEl);
  item.appendChild(name);

  if (favs[ch.id]) {
    const favEl = document.createElement("span");
    favEl.className = "ch-fav";
    favEl.innerHTML = icon("star", 14);
    item.appendChild(favEl);
  }
  if (unread > 0 && currentChannelId !== ch.id) {
    const badge = document.createElement("span");
    badge.className = "ch-unread";
    badge.textContent = unread > 99 ? "99+" : unread;
    item.appendChild(badge);
  }
  item.addEventListener("click", () => selectChannel(ch));
  item.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    channelMenu(ch);
  });
  return item;
}

function channelMenu(ch) {
  const menu = prompt(
    `${ch.name}\n\nDigite: favoritar | desfavoritar | editar | mover | excluir`
  );
  if (!menu) return;
  const c = menu.trim().toLowerCase();
  if (c === "favoritar") toggleChannelFav(ch.id, true);
  else if (c === "desfavoritar") toggleChannelFav(ch.id, false);
  else if (c === "editar") openEditChannel(ch);
  else if (c === "mover") moveChannel(ch);
  else if (c === "excluir") deleteChannel(ch);
}

function toggleChannelFav(channelId, fav) {
  const favs = JSON.parse(localStorage.getItem("devcord-chanfavs") || "{}");
  if (fav) favs[channelId] = true; else delete favs[channelId];
  localStorage.setItem("devcord-chanfavs", JSON.stringify(favs));
  listenChannels();
  toast(fav ? "Canal favoritado ⭐" : "Canal desfavoritado", "info");
}

function openEditChannel(ch) {
  $("edit-channel-name").value = ch.name;
  $("edit-channel-type").value = ch.type;
  window._editChannel = ch;
  openModal("modal-edit-channel");
}

$("confirm-edit-channel").addEventListener("click", async () => {
  const ch = window._editChannel;
  if (!ch) return;
  const name = $("edit-channel-name").value.trim().toLowerCase().replace(/\s+/g, "-");
  const type = $("edit-channel-type").value;
  if (!name) { toast("Dê um nome.", "error"); return; }
  await update(ref(rtdb, `channels/${currentServerId}/${ch.id}`), { name, type });
  if (currentChannelId === ch.id) $("channel-title-name").textContent = (type === "text" ? "# " : type === "voice" ? "🔊 " : "🗂 ") + name;
  closeModals();
  toast("Canal atualizado!", "success");
});

async function moveChannel(ch) {
  const to = prompt("Para qual tipo você quer mover? (text, voice, forum)");
  if (!to || !["text", "voice", "forum"].includes(to.trim())) return;
  await update(ref(rtdb, `channels/${currentServerId}/${ch.id}`), { type: to.trim() });
  toast("Canal movido!", "success");
}

async function deleteChannel(ch) {
  if (!confirm(`Excluir o canal #${ch.name}?`)) return;
  await remove(ref(rtdb, `channels/${currentServerId}/${ch.id}`));
  if (currentChannelId === ch.id) { currentChannelId = null; showView(null); }
  toast("Canal excluído.", "info");
}

$("confirm-create-channel").addEventListener("click", async () => {
  const name = $("new-channel-name").value.trim().toLowerCase().replace(/\s+/g, "-");
  const type = $("new-channel-type").value;
  if (!name) { toast("Dê um nome ao canal.", "error"); return; }
  await push(ref(rtdb, `channels/${currentServerId}`), { name, type, createdAt: serverTimestamp() });
  $("new-channel-name").value = "";
  closeModals();
});

function selectChannel(ch) {
  if (currentChannelType === "voice" && currentChannelId !== ch.id) leaveVoiceChannel();
  currentChannelId = ch.id;
  currentChannelType = ch.type;
  $("channel-title-name").textContent = (ch.type === "text" ? "# " : ch.type === "voice" ? "🔊 " : "🗂 ") + ch.name;
  document.querySelectorAll(".channel-item").forEach((el) => el.classList.remove("active"));
  showView(ch.type);
  if (ch.type === "text") {
    listenMessages();
    listenTyping();
    markChannelRead();
    $("gallery-btn").classList.remove("hidden");
    $("composer-wrap").classList.remove("hidden");
  } else {
    $("gallery-btn").classList.add("hidden");
    $("composer-wrap").classList.add("hidden");
  }
  if (ch.type === "voice") { setupVoiceView(ch); $("composer-wrap").classList.add("hidden"); }
  if (ch.type === "forum") listenForum();
  $("call-btn").classList.toggle("hidden", ch.type !== "voice");
}

function showView(type) {
  ["text", "voice", "forum"].forEach((t) => $("view-" + t).classList.toggle("hidden", t !== type));
}

function markChannelRead() {
  if (!currentServerId || !currentChannelId) return;
  const key = `${currentServerId}/${currentChannelId}`;
  const now = Date.now();
  unreadChannels[key] = 0;
  readsCache[key] = now;
  set(ref(rtdb, `reads/${currentUser.uid}/${currentServerId}/${currentChannelId}`), now).catch(() => {});
  renderServerList();
  renderNotificationsBadge();
}

// ===================== LEITURA DE MENSAGENS / META =====================
async function subscribeCurrentServerFeed() {
  if (!currentServerId) return;
  const chans = feedChannels[currentServerId]?.text || [];
  chans.forEach((ch) => subscribeFeedChannel(currentServerId, ch.id));
}

function subscribeFeedChannel(serverId, channelId) {
  const key = `${serverId}/${channelId}`;
  if (feedSubs[key]) return;
  const subStart = Date.now();
  const seen = new Set();
  const q = query(ref(rtdb, `messages/${serverId}/${channelId}`), orderByChild("createdAt"), limitToLast(15));
  const cb = onChildAdded(q, (s) => {
    const m = s.val();
    if (!m || m.uid === currentUser.uid) return;
    if (Date.now() - subStart < 600) { seen.add(s.key); return; }
    if (seen.has(s.key)) return;
    seen.add(s.key);
    handleIncomingMessage(serverId, channelId, m, s.key);
  });
  feedSubs[key] = cb;
}

function handleIncomingMessage(serverId, channelId, m, msgId) {
  if (!m || !currentUser) return;
  if (m.uid === currentUser.uid) return;
  if (serverId === currentServerId && channelId === currentChannelId) return;

  const key = `${serverId}/${channelId}`;
  unreadChannels[key] = (unreadChannels[key] || 0) + 1;
  renderServerList();
  refreshChannelBadge(serverId, channelId);

  const cfg = userProfile?.notifSettings || {};
  const text = (m.text || "") + (m.authorName || "");
  const mentioned = cfg.mentions !== false && (text.includes("@" + (userProfile?.displayName || "")) || text.includes("@everyone"));
  const shouldNotify = (cfg.messages !== false && cfg.messages !== "none") || mentioned;
  if (!shouldNotify) return;

  const cname = feedChannels[serverId]?.text.find((c) => c.id === channelId)?.name || "canal";
  createNotification({
    type: mentioned ? "mention" : "message",
    fromUid: m.uid,
    fromName: m.authorName || "Alguém",
    serverId, channelId, messageId: msgId,
    text: mentioned ? `te mencionou em #${cname}` : `nova mensagem em #${cname}`,
  });
}

// ===================== MENSAGENS =====================
function listenMessages() {
  const path = `messages/${currentServerId}/${currentChannelId}`;
  if (unsubMessages) off(ref(rtdb, unsubMessages.path), "value", unsubMessages.cb);
  const mRef = ref(rtdb, path);
  skeletonLines($("messages"), 5, "skel-block");
  const cb = onValue(mRef, (snap) => {
    const box = $("messages");
    const inner = document.createElement("div");
    inner.className = "messages-inner";
    box.innerHTML = "";
    box.appendChild(inner);
    const val = snap.val() || {};
    const entries = Object.entries(val).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    if (!entries.length) {
      inner.innerHTML = emptyState("message-circle", "Comece a conversa!", "Este é o começo deste canal. Seja o primeiro a mandar uma mensagem.");
      return;
    }
    let last = null;
    entries.forEach(([id, m]) => {
      m.id = id;
      const grouped = last && last.uid === m.uid && (m.createdAt - last.createdAt) < 5 * 60 * 1000 && !m.imageURL && !m.videoURL && !m.sticker && !m.stickerURL && !last.imageURL && !last.videoURL && !last.sticker && !last.stickerURL;
      renderMessage(inner, m, grouped, false);
      last = m;
    });
    if (currentChannelId) markChannelRead();
    requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  });
  unsubMessages = { path, cb };
}

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

  if (m.stickerURL) {
    const wrap = document.createElement("div");
    wrap.className = "msg-sticker";
    const img = document.createElement("img");
    img.src = sanitizeUrl(m.stickerURL);
    img.loading = "lazy";
    img.alt = "";
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

function buildDmActions(el, m) {
  const bar = document.createElement("div");
  bar.className = "msg-actions";
  bar.appendChild(iconButton("link", { size: 16, label: "Copiar link", tooltip: "Copiar link", on: (e) => { e.stopPropagation(); copyMessageLink(m); } }));
  if (m.uid === currentUser.uid) {
    bar.appendChild(iconButton("trash", { size: 16, label: "Apagar", tooltip: "Apagar", className: "danger", on: async (e) => { e.stopPropagation(); await deleteDmMessage(m); } }));
  }
  return bar;
}

async function deleteDmMessage(m) {
  if (!confirm("Apagar esta mensagem?")) return;
  if (!dmOpenPair) return;
  await remove(ref(rtdb, `dms/${dmOpenPair}/messages/${m.id}`));
  toast("Mensagem apagada.", "info");
}

function buildMsgActions(el, m) {
  const bar = document.createElement("div");
  bar.className = "msg-actions";
  const mine = currentUser && m.uid === currentUser.uid;

  bar.appendChild(iconButton("smile", { size: 16, label: "Reagir", tooltip: "Reagir", on: (e) => { e.stopPropagation(); openReactionPicker(m); } }));
  bar.appendChild(iconButton("bookmark", { size: 16, label: "Salvar mensagem", tooltip: "Salvar", on: (e) => { e.stopPropagation(); saveMessage(m); } }));
  bar.appendChild(iconButton("pin", { size: 16, label: "Fixar mensagem", tooltip: "Fixar", on: (e) => { e.stopPropagation(); pinMessage(m); } }));
  bar.appendChild(iconButton("link", { size: 16, label: "Copiar link da mensagem", tooltip: "Copiar link", on: (e) => { e.stopPropagation(); copyMessageLink(m); } }));

  const canModerate = canModerateMessages();
  if (mine || canModerate) {
    bar.appendChild(iconButton("trash", { size: 16, label: "Apagar mensagem", tooltip: "Apagar", className: "danger", on: async (e) => { e.stopPropagation(); await deleteMessage(m); } }));
  }
  return bar;
}

// ===================== REAÇÕES =====================
function renderReactions(container, m) {
  const reactions = document.createElement("div");
  reactions.className = "reactions";
  const obj = m.reactions || {};
  Object.entries(obj).forEach(([emoji, users]) => {
    const count = Object.keys(users || {}).length;
    const mine = users?.[currentUser?.uid];
    const b = document.createElement("button");
    b.className = "reaction" + (mine ? " active" : "");
    b.textContent = emoji + " " + count;
    b.setAttribute("aria-label", `Reação ${emoji} por ${count} pessoa(s)`);
    b.addEventListener("click", () => toggleReaction(m, emoji));
    reactions.appendChild(b);
  });
  if (Object.keys(obj).length) container.appendChild(reactions);
}

function msgPath(m) {
  if (!m.id) return null;
  return `messages/${currentServerId}/${currentChannelId}/${m.id}`;
}

async function toggleReaction(m, emoji) {
  const path = msgPath(m);
  if (!path) return;
  const uid = currentUser.uid;
  const refReaction = ref(rtdb, `${path}/reactions/${emoji}/${uid}`);
  const snap = await get(refReaction);
  if (snap.exists()) await remove(refReaction);
  else await set(refReaction, true);
  // se eu reajo na mensagem de outra pessoa
  if (m.uid !== uid) {
    createNotification({
      type: "reaction",
      fromUid: uid, fromName: userProfile.displayName,
      serverId: currentServerId, channelId: currentChannelId, messageId: m.id,
      text: `reagiu com ${emoji} na sua mensagem`,
    });
  }
}

function openReactionPicker(m) {
  const root = $("reactions-picker");
  root.innerHTML = "";
  const quick = ["👍", "❤️", "😂", "🔥", "🎉", "😮", "😢", "🙏"];
  const grid = document.createElement("div");
  grid.className = "picker-grid";
  quick.forEach((e) => {
    const b = document.createElement("button");
    b.textContent = e;
    b.addEventListener("click", async () => { toggleReaction(m, e); closeModals(); });
    grid.appendChild(b);
  });
  root.appendChild(grid);
  root.appendChild(document.createElement("br"));
  renderEmojiPicker(root, {
    onPick: (e) => { toggleReaction(m, e); closeModals(); },
    onFav: toggleFavEmoji,
  });
  openModal("modal-reactions");
}

// ===================== AÇÕES DE MENSAGEM =====================
async function saveMessage(m) {
  try {
    const saved = {
      serverId: currentServerId, channelId: currentChannelId,
      authorName: m.authorName, authorPhoto: m.authorPhoto || "",
      text: m.text || "", imageURL: m.imageURL || "", videoURL: m.videoURL || "",
      gifUrl: m.gifUrl || "", sticker: m.sticker || "", stickerURL: m.stickerURL || "",
      createdAt: m.createdAt || serverTimestamp(), savedAt: serverTimestamp(),
    };
    await set(ref(rtdb, `saved/${currentUser.uid}/${m.id}`), saved);
    toast("Mensagem salva! 📌", "success");
  } catch (err) { toast("Não deu pra salvar: " + err.message, "error"); }
}

async function pinMessage(m) {
  try {
    const pins = ref(rtdb, `pins/${currentServerId}/${currentChannelId}/${m.id}`);
    const snap = await get(pins);
    if (snap.exists()) {
      await remove(pins);
      await update(ref(rtdb, msgPath(m)), { pinned: false });
      toast("Mensagem desfixada.", "info");
    } else {
      await set(pins, { by: currentUser.uid, at: serverTimestamp() });
      await update(ref(rtdb, msgPath(m)), { pinned: true });
      toast("Mensagem fixada! 📌", "success");
    }
  } catch (err) { toast("Erro: " + err.message, "error"); }
}

async function copyMessageLink(m) {
  const url = `${location.origin}${location.pathname}#server=${currentServerId}&channel=${currentChannelId}&msg=${m.id}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Link da mensagem copiado!", "success");
  } catch {
    window.prompt("Copie o link:", url);
  }
}

async function deleteMessage(m) {
  if (!confirm("Apagar esta mensagem?")) return;
  try {
    await remove(ref(rtdb, msgPath(m)));
    await remove(ref(rtdb, `pins/${currentServerId}/${currentChannelId}/${m.id}`)).catch(() => {});
    toast("Mensagem apagada.", "info");
  } catch (err) { toast("Erro: " + err.message, "error"); }
}

function handleDeepLink() {
  const h = new URLSearchParams(location.hash.slice(1));
  const s = h.get("server"), c = h.get("channel");
  if (s && c) {
    const sData = { id: s, name: "..." };
    selectServer(s, sData);
    setTimeout(() => {
      const ch = { id: c, name: "...", type: "text" };
      selectChannel(ch);
    }, 600);
  }
}

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
    base.gifUrl = pendingGif.url;
    base.gifId = pendingGif.id;
    base.gifTitle = pendingGif.title;
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

// ===================== EMOJI PICKER =====================
$("emoji-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const picker = $("emoji-picker");
  $("gif-picker").classList.add("hidden");
  picker.classList.toggle("hidden");
  if (picker.classList.contains("hidden")) return;
  renderEmojiPicker(picker, {
    onPick: (emoji) => { input.value += emoji; input.focus(); addRecentEmoji(emoji); },
    onFav: toggleFavEmoji,
  });
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
      pendingGif = { url: item.url, id: item.id, title: item.title, full: item.full };
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
    toggleFav: (item) => toggleGifFav(item),
    isFav: (item) => (userFavGifs || []).some((f) => f.id === item.id),
  });
});

let userFavGifs = [];
async function loadUserFavGifs() {
  const snap = await get(ref(rtdb, `gifFavs/${currentUser.uid}`));
  userFavGifs = snap.val() ? Object.values(snap.val()) : [];
}
async function toggleGifFav(item) {
  const path = `gifFavs/${currentUser.uid}/${item.id}`;
  const snap = await get(ref(rtdb, path));
  if (snap.exists()) {
    await remove(ref(rtdb, path));
    toast("Removido dos favoritos.", "info");
  } else {
    await set(ref(rtdb, path), { id: item.id, url: item.url, title: item.title, kind: item.kind, at: serverTimestamp() });
    toast("Adicionado aos favoritos! ⭐", "success");
  }
  await loadUserFavGifs();
}

// ===================== STICKERS (customizadas) =====================
$("sticker-btn").addEventListener("click", async (e) => {
  e.stopPropagation();
  const picker = $("sticker-picker");
  picker.classList.toggle("hidden");
  if (picker.classList.contains("hidden")) return;
  const emojiBtn = picker.querySelector("#emoji-stickers");
  if (!emojiBtn) {
    renderEmojiPicker(picker, {
      onPick: async (emoji) => {
        await sendStickerMessage({ sticker: emoji });
        picker.classList.add("hidden");
      },
      onFav: toggleFavEmoji,
    });
  }
});

async function sendStickerMessage(payload) {
  await push(ref(rtdb, `messages/${currentServerId}/${currentChannelId}`), {
    uid: currentUser.uid,
    authorName: userProfile.displayName,
    authorPhoto: userProfile.photoURL || "",
    authorColor: userProfile.accentColor || "#5ee6c4",
    createdAt: serverTimestamp(),
    ...payload,
  });
  update(ref(rtdb, `channelMeta/${currentServerId}/${currentChannelId}`), { lastMsgAt: serverTimestamp() }).catch(() => {});
}

// ===================== FÓRUM =====================
function listenForum() {
  const path = `posts/${currentServerId}/${currentChannelId}`;
  if (unsubForumPosts) off(ref(rtdb, unsubForumPosts.path), "value", unsubForumPosts.cb);
  const pRef = ref(rtdb, path);
  const cb = onValue(pRef, (snap) => {
    const root = $("forum-posts");
    root.innerHTML = "";
    root.classList.remove("hidden");
    $("forum-thread").classList.add("hidden");
    const val = snap.val() || {};
    const entries = Object.entries(val).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    const pinned = entries.filter(([, p]) => p.pinned);
    const rest = entries.filter(([, p]) => !p.pinned);
    [...pinned, ...rest].forEach(([id, p]) => {
      const card = document.createElement("div");
      card.className = "forum-post-card" + (p.pinned ? " pinned" : "");
      const time = p.createdAt ? new Date(p.createdAt).toLocaleString("pt-BR") : "";
      card.innerHTML = `<h3>${p.pinned ? "📌 " : ""}${esc(p.title)}</h3><div class="meta">por ${esc(p.authorName)} · ${time}</div><p>${esc((p.body || "").slice(0, 140))}${p.body?.length > 140 ? "…" : ""}</p>`;
      card.addEventListener("click", () => openThread(id, p));
      root.appendChild(card);
    });
    if (!entries.length) root.innerHTML = emptyState("folder", "Nenhum tópico ainda", "Crie o primeiro tópico deste fórum.");
  });
  unsubForumPosts = { path, cb };
}

function openThread(postId, post) {
  $("forum-posts").classList.add("hidden");
  $("forum-thread").classList.remove("hidden");
  const time = post.createdAt ? new Date(post.createdAt).toLocaleString("pt-BR") : "";
  const mine = post.uid === currentUser.uid;
  $("forum-thread-content").innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap">
      <h2 style="margin:0">${post.pinned ? "📌 " : ""}${esc(post.title)}</h2>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" id="pin-topic-btn">${post.pinned ? "Desfixar" : "Fixar"}</button>
        ${mine ? `<button class="btn btn-danger btn-sm" id="del-topic-btn">Excluir</button>` : ""}
      </div>
    </div>
    <div class="meta" style="color:var(--text-2);font-size:12px;margin-bottom:12px">por ${esc(post.authorName)} · ${time}</div>
    <p style="line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere">${esc(post.body)}</p>
    <hr style="border-color:var(--line);margin:16px 0" />
    <div id="thread-replies"></div>
    <form id="reply-form" style="display:flex;gap:8px;margin-top:12px">
      <input id="reply-input" type="text" placeholder="Responder..." maxlength="5000" style="flex:1" aria-label="Resposta" />
      <button class="btn btn-primary" type="submit">Responder</button>
    </form>`;
  $("pin-topic-btn").addEventListener("click", async () => {
    await update(ref(rtdb, `posts/${currentServerId}/${currentChannelId}/${postId}`), { pinned: !post.pinned });
    toast(post.pinned ? "Tópico desfixado." : "Tópico fixado! 📌", "success");
  });
  $("del-topic-btn")?.addEventListener("click", async () => {
    if (!confirm("Excluir este tópico?")) return;
    await remove(ref(rtdb, `posts/${currentServerId}/${currentChannelId}/${postId}`));
    $("forum-thread").classList.add("hidden");
    $("forum-posts").classList.remove("hidden");
  });
  const repliesPath = `replies/${currentServerId}/${currentChannelId}/${postId}`;
  if (unsubForumReplies) off(ref(rtdb, unsubForumReplies.path), "value", unsubForumReplies.cb);
  const rRef = ref(rtdb, repliesPath);
  const cb = onValue(rRef, (snap) => {
    const box = $("thread-replies");
    if (!box) return;
    box.innerHTML = "";
    const val = snap.val() || {};
    Object.values(val).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).forEach((r) => {
      const el = document.createElement("div");
      el.style.cssText = "padding:8px 0;border-top:1px solid var(--line);font-size:14px";
      el.textContent = "";
      const b = document.createElement("b");
      b.textContent = r.authorName + ": ";
      el.appendChild(b);
      el.appendChild(document.createTextNode(r.text));
      box.appendChild(el);
    });
  });
  unsubForumReplies = { path: repliesPath, cb };

  $("reply-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const inp = $("reply-input");
    if (!inp.value.trim()) return;
    await push(ref(rtdb, repliesPath), { uid: currentUser.uid, authorName: userProfile.displayName, text: inp.value.trim().slice(0, 5000), createdAt: serverTimestamp() });
    inp.value = "";
  });
}

$("new-post-btn").addEventListener("click", () => openModal("modal-new-post"));
$("back-to-forum").addEventListener("click", () => {
  $("forum-thread").classList.add("hidden");
  $("forum-posts").classList.remove("hidden");
});
$("confirm-new-post").addEventListener("click", async () => {
  const title = $("new-post-title").value.trim();
  const body = $("new-post-body").value.trim();
  if (!title || !body) { toast("Preencha título e conteúdo.", "error"); return; }
  await push(ref(rtdb, `posts/${currentServerId}/${currentChannelId}`), { title, body, uid: currentUser.uid, authorName: userProfile.displayName, createdAt: serverTimestamp() });
  $("new-post-title").value = ""; $("new-post-body").value = "";
  closeModals();
});

// ===================== VOZ / VÍDEO =====================
function setupVoiceView(ch) {
  $("voice-channel-name").textContent = "🔊 " + ch.name;
  $("join-voice-btn").classList.remove("hidden");
  $("leave-voice-btn").classList.add("hidden");
  $("toggle-mic-btn").classList.add("hidden");
  $("toggle-cam-btn").classList.add("hidden");
  $("toggle-deaf-btn").classList.add("hidden");
  $("toggle-share-btn").classList.add("hidden");
  $("video-grid").innerHTML = "";
  $("voice-participants").innerHTML = "";
  initCallControls();
}

function initCallControls() {
  const actions = [
    ["toggle-mic-btn", "mic", "Mutar/desmutar mic"],
    ["toggle-cam-btn", "video", "Câmera"],
    ["toggle-deaf-btn", "volume-x", "Ensurdecer"],
    ["toggle-share-btn", "monitor", "Compartilhar tela"],
  ];
  actions.forEach(([id, ic, tip]) => {
    const b = $(id);
    if (!b) return;
    b.innerHTML = icon(ic, 18);
    b.dataset.tooltip = tip;
  });
  $("call-chat").classList.remove("hidden");
}

$("join-voice-btn").addEventListener("click", async () => {
  try {
    await joinVoiceChannel({ serverId: currentServerId, channelId: currentChannelId, uid: currentUser.uid, displayName: userProfile.displayName });
    $("join-voice-btn").classList.add("hidden");
    $("leave-voice-btn").classList.remove("hidden");
    $("toggle-mic-btn").classList.remove("hidden");
    $("toggle-cam-btn").classList.remove("hidden");
    $("toggle-deaf-btn").classList.remove("hidden");
    $("toggle-share-btn").classList.remove("hidden");
  } catch (err) {
    toast("Não deu pra acessar microfone/câmera: " + err.message, "error");
  }
});
$("leave-voice-btn").addEventListener("click", () => {
  leaveVoiceChannel();
  $("join-voice-btn").classList.remove("hidden");
  $("leave-voice-btn").classList.add("hidden");
  ["toggle-mic-btn", "toggle-cam-btn", "toggle-deaf-btn", "toggle-share-btn"].forEach((id) => $(id).classList.add("hidden"));
});
$("toggle-mic-btn").addEventListener("click", (e) => {
  const on = window.devcordToggleMic?.();
  e.currentTarget.classList.toggle("on", !on);
  e.currentTarget.innerHTML = icon(on ? "mic" : "mic-off", 18);
});
$("toggle-cam-btn").addEventListener("click", (e) => {
  const on = window.devcordToggleCam?.();
  e.currentTarget.classList.toggle("on", !on);
  e.currentTarget.innerHTML = icon(on ? "video" : "camera-off", 18);
});
$("toggle-deaf-btn").addEventListener("click", (e) => {
  const on = window.devcordToggleDeaf?.();
  e.currentTarget.classList.toggle("on", !on);
  e.currentTarget.innerHTML = icon(on ? "volume-2" : "volume-x", 18);
});
$("toggle-share-btn").addEventListener("click", async (e) => {
  const sharing = window.devcordSharing;
  if (sharing) {
    await stopScreenShare();
    e.currentTarget.classList.remove("on");
    e.currentTarget.innerHTML = icon("monitor", 18);
  } else {
    const ok = await startScreenShare();
    if (ok) { e.currentTarget.classList.add("on"); e.currentTarget.innerHTML = icon("monitor", 18); }
  }
});

$("call-chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const inp = $("call-chat-input");
  if (!inp.value.trim()) return;
  sendCallChatMessage(inp.value.trim().slice(0, MAX_MSG));
  inp.value = "";
});

// ===================== GALERIA =====================
$("gallery-btn").addEventListener("click", async () => {
  if (!currentServerId || !currentChannelId) return;
  const snap = await get(ref(rtdb, `messages/${currentServerId}/${currentChannelId}`));
  const val = snap.val() || {};
  const grid = $("gallery-grid");
  grid.innerHTML = "";
  const items = Object.values(val).filter((m) => m.imageURL || m.videoURL || m.gifUrl);
  if (!items.length) { grid.innerHTML = emptyState("inbox", "Nada por aqui", "Ainda não há mídia neste canal."); openModal("modal-gallery"); return; }
  items.slice().reverse().forEach((m) => {
    const url = m.imageURL || m.gifUrl || m.videoURL;
    const b = document.createElement("button");
    b.setAttribute("aria-label", "Ver mídia");
    if (m.videoURL) { const v = document.createElement("video"); v.src = url; v.muted = true; v.preload = "metadata"; b.appendChild(v); }
    else { const img = document.createElement("img"); img.src = url; img.loading = "lazy"; img.alt = ""; b.appendChild(img); }
    b.addEventListener("click", () => openLightbox(url, m.videoURL ? "video" : "img"));
    grid.appendChild(b);
  });
  openModal("modal-gallery");
});

// ===================== BUSCA DE MENSAGENS =====================
let searchFilters = new Set();
const searchInput = $("search-input");
document.querySelectorAll("#search-filters .filter-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const f = chip.dataset.filter;
    if (searchFilters.has(f)) { searchFilters.delete(f); chip.classList.remove("active"); }
    else { searchFilters.add(f); chip.classList.add("active"); }
    runSearch();
  });
});
searchInput.addEventListener("input", debounce(runSearch, 300));

async function runSearch() {
  const term = searchInput.value.trim().toLowerCase();
  const box = $("search-results");
  if (!term) { box.innerHTML = emptyState("search", "Buscar mensagens", "Pesquise por texto, autor, arquivos, imagens ou GIFs neste servidor."); return; }
  box.innerHTML = `<div class="loading-wrap"><div class="spinner"></div><span>Buscando...</span></div>`;
  const results = [];
  const chans = feedChannels[currentServerId]?.text || [];
  for (const ch of chans) {
    const snap = await get(ref(rtdb, `messages/${currentServerId}/${ch.id}`));
    const val = snap.val() || {};
    Object.entries(val).forEach(([id, m]) => {
      const has = (searchFilters.size === 0);
      if (!has) {
        for (const f of searchFilters) {
          if (f === "texto" && m.text?.toLowerCase().includes(term)) has = true;
          if (f === "arquivos" && (m.imageURL || m.videoURL) && (m.authorName?.toLowerCase().includes(term) || m.text?.toLowerCase().includes(term))) has = true;
          if (f === "imagens" && (m.imageURL)) has = true;
          if (f === "gifs" && m.gifUrl) has = true;
        }
      }
      if (has) {
        const hay = [m.text, m.authorName].join(" ").toLowerCase();
        if (hay.includes(term)) results.push({ ch, id, m });
      }
    });
  }
  results.sort((a, b) => (b.m.createdAt || 0) - (a.m.createdAt || 0));
  box.innerHTML = "";
  if (!results.length) { box.innerHTML = emptyState("search", "Nada encontrado", "Nenhuma mensagem corresponde à sua busca."); return; }
  results.slice(0, 50).forEach((r) => {
    const el = document.createElement("div");
    el.className = "search-result";
    const avatar = document.createElement("img");
    avatar.className = "avatar avatar-sm";
    avatar.src = sanitizeUrl(r.m.authorPhoto) || defaultAvatar(r.m.uid);
    avatar.alt = "";
    const t = document.createElement("div");
    t.className = "sr-text";
    const meta = document.createElement("div");
    meta.className = "sr-meta";
    meta.textContent = `#${r.ch.name} · ${r.m.authorName || "Usuário"} · ${r.m.createdAt ? new Date(r.m.createdAt).toLocaleString("pt-BR") : ""}`;
    t.textContent = r.m.text || (r.m.gifUrl ? "[GIF]" : r.m.imageURL ? "[Imagem]" : r.m.videoURL ? "[Vídeo]" : "[Anexo]");
    t.appendChild(meta);
    el.appendChild(avatar);
    el.appendChild(t);
    el.addEventListener("click", () => { selectChannel(r.ch); closeDrawers(); });
    box.appendChild(el);
  });
}

// ===================== PERFIL DE USUÁRIO =====================
async function viewUserProfile(uid) {
  try {
    const snap = await get(ref(rtdb, `users/${uid}`));
    if (!snap.exists()) { toast("Usuário não encontrado.", "error"); return; }
    const p = snap.val();
    const pres = await get(ref(rtdb, `presence/${uid}`));
    const presence = pres.val()?.status || "offline";

    const root = $("user-profile-content");
    root.innerHTML = "";
    const banner = document.createElement("div");
    banner.className = "up-banner";
    if (p.bannerURL) banner.style.background = `url(${sanitizeUrl(p.bannerURL)}) center/cover`;
    const row = document.createElement("div");
    row.className = "up-avatar-row";
    const wrap = document.createElement("div");
    wrap.className = "avatar-wrap";
    const av = document.createElement("img");
    av.className = "avatar avatar-xl";
    av.src = sanitizeUrl(p.photoURL) || defaultAvatar(uid);
    av.alt = "";
    const dot = document.createElement("span");
    dot.className = "presence-dot " + presence;
    wrap.appendChild(av); wrap.appendChild(dot);
    row.appendChild(wrap);
    const nameBlock = document.createElement("div");
    nameBlock.style.padding = "0 12px 8px";
    const name = document.createElement("div");
    name.className = "up-name";
    name.textContent = p.displayName || "Usuário";
    name.style.fontFamily = p.nameFont || "Inter";
    name.style.color = p.accentColor || "var(--text-0)";
    const tag = document.createElement("div");
    tag.className = "up-tag";
    tag.textContent = { online: "Online", idle: "Ausente", dnd: "Não perturbe", offline: "Offline" }[presence];
    nameBlock.appendChild(name); nameBlock.appendChild(tag);

    const actions = document.createElement("div");
    actions.className = "up-actions";
    const isFriend = friendStatusOf(uid);
    if (uid === currentUser.uid) {
      const btn = document.createElement("button");
      btn.className = "btn btn-secondary";
      btn.innerHTML = icon("pencil", 16) + " Editar meu perfil";
      btn.addEventListener("click", () => { closeModals(); $("open-profile-btn").click(); });
      actions.appendChild(btn);
    } else if (isFriend === "friend") {
      const dm = document.createElement("button");
      dm.className = "btn btn-primary";
      dm.innerHTML = icon("message-square", 16) + " Mensagem privada";
      dm.addEventListener("click", () => { closeModals(); openDM(uid); });
      actions.appendChild(dm);
    } else if (isFriend === "request_sent") {
      const b = document.createElement("button");
      b.className = "btn btn-secondary";
      b.innerHTML = icon("user-x", 16) + " Cancelar solicitação";
      b.addEventListener("click", async () => { await cancelFriendRequest(uid); closeModals(); });
      actions.appendChild(b);
    } else if (isFriend === "request_in") {
      const b = document.createElement("button");
      b.className = "btn btn-primary";
      b.innerHTML = icon("check", 16) + " Aceitar";
      b.addEventListener("click", async () => { await acceptFriend(uid); closeModals(); });
      actions.appendChild(b);
    } else if (isFriend !== "blocked") {
      const b = document.createElement("button");
      b.className = "btn btn-primary";
      b.innerHTML = icon("user-plus", 16) + " Adicionar amigo";
      b.addEventListener("click", async () => { await sendFriendRequest(uid); closeModals(); });
      actions.appendChild(b);
    }
    if (uid !== currentUser.uid) {
      const block = document.createElement("button");
      const blocked = isFriend === "blocked";
      block.className = "btn btn-secondary";
      block.innerHTML = icon(blocked ? "check" : "ban", 16) + (blocked ? " Desbloquear" : " Bloquear");
      block.addEventListener("click", async () => {
        if (blocked) { await unblockUser(uid); toast("Usuário desbloqueado.", "success"); }
        else { await blockUser(uid); toast("Usuário bloqueado.", "info"); }
        closeModals();
      });
      actions.appendChild(block);
    }

    const sections = document.createElement("div");
    sections.className = "up-section";
    if (p.bio) {
      const bioT = document.createElement("div");
      bioT.className = "section-title"; bioT.textContent = "Bio";
      const bio = document.createElement("div");
      bio.className = "bio-text"; bio.textContent = p.bio;
      sections.appendChild(bioT); sections.appendChild(bio);
    }
    const createdT = document.createElement("div");
    createdT.className = "section-title"; createdT.textContent = "Membro desde";
    const created = document.createElement("div");
    created.style.cssText = "font-size:13px;color:var(--text-1);display:flex;gap:6px;align-items:center;margin-bottom:12px";
    created.innerHTML = icon("calendar", 14) + `<span>${p.createdAt ? new Date(p.createdAt).toLocaleDateString("pt-BR") : "—"}</span>`;
    sections.appendChild(createdT); sections.appendChild(created);

    if (currentServerId && uid !== currentUser.uid) {
      const roles = await getServerRolesFor(uid);
      if (roles.length) {
        const rt = document.createElement("div");
        rt.className = "section-title"; rt.textContent = "Cargos neste servidor";
        const rl = document.createElement("div");
        rl.className = "role-list";
        roles.forEach((r) => {
          const chip = document.createElement("span");
          chip.className = "role-chip";
          chip.style.cssText = `background:${r.color}22;border-color:${r.color}88;color:${r.color}`;
          chip.textContent = (r.icon || "") + " " + r.name;
          rl.appendChild(chip);
        });
        sections.appendChild(rt); sections.appendChild(rl);
      }
    }

    root.appendChild(banner);
    root.appendChild(row);
    root.appendChild(nameBlock);
    root.appendChild(actions);
    root.appendChild(sections);
    openModal("modal-user-profile");
  } catch (err) { toast("Erro ao abrir perfil: " + err.message, "error"); }
}

async function getServerRolesFor(uid) {
  const snap = await get(ref(rtdb, `serverMembers/${currentServerId}/${uid}/roles`));
  const myRoles = snap.val() ? Object.keys(snap.val()) : [];
  const roles = rolesCache[currentServerId] || {};
  return myRoles.map((id) => roles[id]).filter(Boolean).sort((a, b) => (b.position || 0) - (a.position || 0));
}

// ===================== PERFIL (próprio) =====================
$("open-profile-btn").addEventListener("click", () => {
  $("profile-avatar-preview").src = userProfile.photoURL || defaultAvatar(currentUser.uid);
  $("profile-name-input").value = userProfile.displayName || "";
  $("profile-bio-input").value = userProfile.bio || "";
  $("profile-color-input").value = userProfile.accentColor || "#5ee6c4";
  $("profile-font-input").value = userProfile.nameFont || "Inter";
  $("profile-social-input").value = userProfile.socialLinks || "";
  $("profile-banner-preview").style.background = userProfile.bannerURL
    ? `url(${sanitizeUrl(userProfile.bannerURL)}) center/cover`
    : "linear-gradient(135deg, var(--accent-dim), var(--bg-3))";
  openModal("modal-profile");
});

let newAvatarFile = null, newBannerFile = null;
$("profile-avatar-input").addEventListener("change", (e) => {
  newAvatarFile = e.target.files[0];
  if (newAvatarFile) {
    if (newAvatarFile.size > MAX_UPLOAD) { toast("Arquivo acima de 5MB.", "error"); e.target.value = ""; newAvatarFile = null; return; }
    $("profile-avatar-preview").src = URL.createObjectURL(newAvatarFile);
  }
});
$("profile-banner-input").addEventListener("change", (e) => {
  newBannerFile = e.target.files[0];
  if (newBannerFile) {
    if (newBannerFile.size > MAX_UPLOAD) { toast("Arquivo acima de 5MB.", "error"); e.target.value = ""; newBannerFile = null; return; }
    $("profile-banner-preview").style.background = `url(${URL.createObjectURL(newBannerFile)}) center/cover`;
  }
});

$("confirm-profile").addEventListener("click", async () => {
  const updates = {
    displayName: $("profile-name-input").value.trim().slice(0, 32) || userProfile.displayName,
    bio: $("profile-bio-input").value.trim().slice(0, 190),
    accentColor: $("profile-color-input").value,
    nameFont: $("profile-font-input").value,
    socialLinks: $("profile-social-input").value.trim(),
  };
  try {
    if (newAvatarFile) { const { url } = await uploadFile(newAvatarFile); updates.photoURL = url; }
    if (newBannerFile) { const { url } = await uploadFile(newBannerFile); updates.bannerURL = url; }
  } catch (err) { toast("Falha no upload: " + err.message, "error"); return; }
  await update(ref(rtdb, `users/${currentUser.uid}`), updates);
  await updateProfile(currentUser, { displayName: updates.displayName, photoURL: updates.photoURL || userProfile.photoURL || "" });
  userProfile = { ...userProfile, ...updates };
  newAvatarFile = null; newBannerFile = null;
  renderUserCard();
  closeModals();
  toast("Perfil atualizado!", "success");
});

$("logout-btn").addEventListener("click", async () => {
  leaveVoiceChannel();
  await signOut(auth);
  closeModals();
});

// ===================== NOTIFICAÇÕES =====================
async function createNotification({ type, fromUid, fromName, serverId, channelId, messageId, text }) {
  if (fromUid === currentUser.uid) return;
  const cfg = userProfile?.notifSettings || {};
  if (type === "message" && cfg.messages === false) return;
  if (type === "reaction" && cfg.reactions === false) return;
  if (type === "mention" && cfg.mentions === false) return;
  if (type === "friend" && cfg.friends === false) return;
  try {
    await push(ref(rtdb, `notifications/${currentUser.uid}`), {
      type, fromUid, fromName, serverId, channelId, messageId,
      text: text || "", read: false, createdAt: serverTimestamp(),
    });
  } catch {}
  if (cfg.browser) {
    try {
      if (Notification.permission === "granted") {
        new Notification(fromName || "DevCord", { body: text });
      }
    } catch {}
  }
}

function listenNotifications() {
  if (unsubNotifs) off(ref(rtdb, `notifications/${currentUser.uid}`), "value", unsubNotifs);
  const cb = onValue(ref(rtdb, `notifications/${currentUser.uid}`), (snap) => {
    renderNotifications(snap.val() || {});
  });
  unsubNotifs = cb;
}

function renderNotifications(val) {
  const box = $("notif-list");
  const list = Object.entries(val).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  const unread = list.filter(([, n]) => !n.read).length;
  box.innerHTML = "";
  if (!list.length) { box.innerHTML = emptyState("bell", "Sem notificações", "Você verá menções, reações e novidades por aqui."); renderNotificationsBadge(); return; }
  list.forEach(([id, n]) => {
    const el = document.createElement("div");
    el.className = "notif-item" + (n.read ? "" : " unread");
    el.innerHTML = `<div class="notif-icon">${icon(n.type === "mention" ? "at-sign" : n.type === "reaction" ? "smile" : n.type === "friend" ? "user-plus" : "message-circle", 16)}</div>
      <div class="notif-body"><b>${esc(n.fromName || "Alguém")}</b> ${esc(n.text || "")}
        <div class="notif-time">${n.createdAt ? new Date(n.createdAt).toLocaleString("pt-BR") : ""}</div></div>`;
    el.addEventListener("click", async () => {
      if (n.serverId && n.channelId) {
        selectServer(n.serverId, { id: n.serverId, name: "..." });
        setTimeout(() => selectChannel({ id: n.channelId, name: "...", type: "text" }), 500);
      }
      await update(ref(rtdb, `notifications/${currentUser.uid}/${id}`), { read: true });
      closeDrawers();
    });
    box.appendChild(el);
  });
  renderNotificationsBadge(unread);
}

function renderNotificationsBadge(unread) {
  const btn = $("notif-btn");
  if (unread === undefined) {
    get(ref(rtdb, `notifications/${currentUser.uid}`)).then((s) => {
      const val = s.val() || {};
      const n = Object.values(val).filter((x) => !x.read).length;
      btn.innerHTML = icon("bell", 18) + (n ? `<span class="badge badge-sm">${n > 9 ? "9+" : n}</span>` : "");
    }).catch(() => {});
    return;
  }
  btn.innerHTML = icon("bell", 18) + (unread ? `<span class="badge badge-sm">${unread > 9 ? "9+" : unread}</span>` : "");
}

$("notif-btn").addEventListener("click", () => { renderNotificationsBadge(); openDrawer("notif-drawer"); });
$("notif-markall-btn").addEventListener("click", async () => {
  const snap = await get(ref(rtdb, `notifications/${currentUser.uid}`));
  const val = snap.val() || {};
  const updates = {};
  Object.keys(val).forEach((id) => { updates[id + "/read"] = true; });
  if (Object.keys(updates).length) await update(ref(rtdb, `notifications/${currentUser.uid}`), updates);
  toast("Todas marcadas como lidas.", "success");
});
$("notif-settings-btn").addEventListener("click", () => { closeDrawers(); loadSettings(); openModal("modal-settings"); });

// ===================== CONFIGURAÇÕES / NOTIFICAÇÕES =====================
function loadSettings() {
  const p = userProfile || {};
  const s = p.presence || "online";
  $("presence-select").value = s;
  const cfg = p.notifSettings || {};
  $("cfg-notify-browser").checked = !!cfg.browser;
  $("cfg-notify-messages").checked = cfg.messages !== false;
  $("cfg-notify-mentions").checked = cfg.mentions !== false;
  $("cfg-notify-reactions").checked = cfg.reactions !== false;
  $("cfg-notify-friends").checked = cfg.friends !== false;
  document.querySelectorAll(".theme-opt").forEach((b) => b.classList.toggle("active", getTheme() === b.dataset.theme));
}
document.querySelectorAll(".theme-opt").forEach((b) => {
  b.addEventListener("click", () => {
    setTheme(b.dataset.theme);
    document.querySelectorAll(".theme-opt").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    updateThemeButton();
  });
});
$("presence-select").addEventListener("change", async (e) => {
  const status = e.target.value;
  await update(ref(rtdb, `users/${currentUser.uid}`), { presence: status });
  userProfile.presence = status;
  set(ref(rtdb, `presence/${currentUser.uid}`), { status, lastSeen: serverTimestamp() });
  renderUserCard();
  toast("Status atualizado para " + status + ".", "success");
});
async function saveNotifSettings() {
  const cfg = {
    browser: $("cfg-notify-browser").checked,
    messages: $("cfg-notify-messages").checked,
    mentions: $("cfg-notify-mentions").checked,
    reactions: $("cfg-notify-reactions").checked,
    friends: $("cfg-notify-friends").checked,
  };
  if (cfg.browser && typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission();
  }
  await update(ref(rtdb, `users/${currentUser.uid}/notifSettings`), cfg);
  userProfile.notifSettings = cfg;
}
["cfg-notify-browser", "cfg-notify-messages", "cfg-notify-mentions", "cfg-notify-reactions", "cfg-notify-friends"].forEach((id) => {
  $(id).addEventListener("change", saveNotifSettings);
});

// ===================== AMIGOS =====================
let friendsData = {};
let friendListUnsub = null;

function listenFriends() {
  if (friendListUnsub) off(ref(rtdb, `friends/${currentUser.uid}`), "value", friendListUnsub);
  const cb = onValue(ref(rtdb, `friends/${currentUser.uid}`), async (snap) => {
    friendsData = snap.val() || {};
    renderFriendBadges();
    renderFriendList("online");
    await hydrateFriendNames();
    renderFriendList("online");
  });
  friendListUnsub = cb;
}

async function hydrateFriendNames() {
  const uids = Object.keys(friendsData);
  uids.forEach((uid) => listenUserPresence(uid, "offline"));
}

function friendStatusOf(uid) {
  return friendsData[uid]?.status;
}

function renderFriendBadges() {
  const pend = Object.values(friendsData).filter((f) => f.status === "request_in").length;
  const badge = $("friend-pending-badge");
  badge.classList.toggle("hidden", pend === 0);
  if (pend) badge.textContent = pend > 99 ? "99+" : pend;
  const inbox = Object.values(friendsData).filter((f) => f.status === "request_in").length;
  const friendsBtn = $("friends-btn");
  const total = inbox;
  friendsBtn.innerHTML = icon("users", 18) + (total ? `<span class="badge badge-sm">${total > 9 ? "9+" : total}</span>` : "");
}

let friendTab = "online";
document.querySelectorAll("#friend-tabs button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#friend-tabs button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    friendTab = b.dataset.f;
    renderFriendList(friendTab);
  });
});

function renderFriendList(tab) {
  const box = $("friend-list");
  box.innerHTML = "";
  const entries = Object.entries(friendsData);
  const filtered = entries.filter(([, f]) => {
    if (tab === "blocked") return f.status === "blocked";
    if (tab === "pending") return f.status === "request_in";
    if (tab === "online") return f.status === "friend";
    return f.status === "friend";
  });
  if (!filtered.length) {
    box.innerHTML = emptyState("users", "Nada aqui", tab === "pending" ? "Sem solicitações pendentes." : tab === "blocked" ? "Nenhum usuário bloqueado." : "Adicione amigos pra ver quem está online.");
    return;
  }
  filtered.forEach(async ([uid, f]) => {
    const row = document.createElement("div");
    row.className = "friend-row";
    const snap = await get(ref(rtdb, `users/${uid}`));
    const u = snap.val() || {};
    const pres = window.devPresence?.[uid] || "offline";
    const statusLabel = { online: "Online", idle: "Ausente", dnd: "Não perturbe", offline: "Offline" }[pres] || "Offline";
    row.innerHTML = `
      <div class="avatar-wrap"><img class="avatar avatar-md clickable" src="${sanitizeUrl(u.photoURL) || defaultAvatar(uid)}" alt="" /><span class="presence-dot ${pres}"></span></div>
      <div class="fr-info"><div class="fr-name">${esc(u.displayName || "Usuário")}</div><div class="fr-status">${statusLabel}</div></div>
      <div class="fr-actions">${f.status === "request_in" ? `<button class="icon-btn" data-act="accept" data-uid="${uid}" aria-label="Aceitar solicitação"></button>` : ""}
        ${f.status === "request_in" ? `<button class="icon-btn danger" data-act="reject" data-uid="${uid}" aria-label="Recusar solicitação"></button>` : ""}
        ${f.status === "friend" ? `<button class="icon-btn" data-act="dm" data-uid="${uid}" aria-label="Mensagem privada"></button>` : ""}
        <button class="icon-btn danger" data-act="remove" data-uid="${uid}" aria-label="Remover"></button></div>`;
    row.querySelectorAll("[data-act]").forEach((b) => {
      const act = b.dataset.act;
      b.innerHTML = icon({ accept: "check", reject: "x", dm: "message-square", remove: "user-x" }[act] || "ban", 16);
      b.addEventListener("click", async () => {
        const target = b.dataset.uid;
        if (act === "accept") await acceptFriend(target);
        else if (act === "reject") await rejectFriend(target);
        else if (act === "dm") openDM(target);
        else if (act === "remove") await removeFriend(target);
      });
    });
    row.querySelector(".fr-name").addEventListener("click", () => viewUserProfile(uid));
    box.appendChild(row);
  });
}

$("friend-add-btn").addEventListener("click", addFriendByEmail);
$("friend-add-input").addEventListener("keydown", (e) => { if (e.key === "Enter") addFriendByEmail(); });

async function addFriendByEmail() {
  const email = $("friend-add-input").value.trim().toLowerCase();
  if (!email) return;
  const snap = await get(ref(rtdb, "users")).catch(() => null);
  if (!snap || !snap.val()) { toast("Usuário não encontrado.", "error"); return; }
  const target = Object.entries(snap.val()).find(([, u]) => (u.email || "").toLowerCase() === email);
  if (!target) { toast("Nenhum usuário com esse email.", "error"); return; }
  const uid = target[0];
  if (uid === currentUser.uid) { toast("Você não pode se adicionar.", "error"); return; }
  if (friendsData[uid]?.status === "friend") { toast("Já são amigos!", "info"); return; }
  if (friendsData[uid]?.status === "request_sent") { toast("Solicitação já enviada.", "info"); return; }
  await sendFriendRequest(uid);
}

async function sendFriendRequest(uid) {
  try {
    await set(ref(rtdb, `friends/${currentUser.uid}/${uid}`), { status: "request_sent", at: serverTimestamp() });
    await set(ref(rtdb, `friends/${uid}/${currentUser.uid}`), { status: "request_in", at: serverTimestamp() });
    const u = await get(ref(rtdb, `users/${uid}`));
    createNotification({ type: "friend", fromUid: currentUser.uid, fromName: userProfile.displayName, text: "enviou uma solicitação de amizade para você" });
    toast("Solicitação enviada!", "success");
  } catch (err) { toast("Erro: " + err.message, "error"); }
}
async function cancelFriendRequest(uid) {
  await remove(ref(rtdb, `friends/${currentUser.uid}/${uid}`));
  await remove(ref(rtdb, `friends/${uid}/${currentUser.uid}`));
  toast("Solicitação cancelada.", "info");
}
async function acceptFriend(uid) {
  await set(ref(rtdb, `friends/${currentUser.uid}/${uid}`), { status: "friend", at: serverTimestamp() });
  await set(ref(rtdb, `friends/${uid}/${currentUser.uid}`), { status: "friend", at: serverTimestamp() });
  createNotification({ type: "friend", fromUid: currentUser.uid, fromName: userProfile.displayName, text: "aceitou sua solicitação de amizade" });
  toast("Agora vocês são amigos! 🎉", "success");
}
async function rejectFriend(uid) {
  await remove(ref(rtdb, `friends/${currentUser.uid}/${uid}`));
  await remove(ref(rtdb, `friends/${uid}/${currentUser.uid}`));
  toast("Solicitação recusada.", "info");
}
async function removeFriend(uid) {
  await remove(ref(rtdb, `friends/${currentUser.uid}/${uid}`));
  await remove(ref(rtdb, `friends/${uid}/${currentUser.uid}`));
  toast("Amigo removido.", "info");
}
async function blockUser(uid) {
  await set(ref(rtdb, `friends/${currentUser.uid}/${uid}`), { status: "blocked", at: serverTimestamp() });
  await set(ref(rtdb, `friends/${uid}/${currentUser.uid}`), { status: "blocked_by", at: serverTimestamp() });
  await remove(ref(rtdb, `presence/${uid}`)).catch(() => {});
  toast("Usuário bloqueado.", "info");
}
async function unblockUser(uid) {
  await remove(ref(rtdb, `friends/${currentUser.uid}/${uid}`));
  await remove(ref(rtdb, `friends/${uid}/${currentUser.uid}`));
  toast("Usuário desbloqueado.", "success");
}

function isBlocked(uid) { return friendsData[uid]?.status === "blocked"; }
function isBlockedBy(uid) { return friendsData[uid]?.status === "blocked_by"; }

// ===================== DM =====================
async function openDM(uid) {
  if (isBlocked(uid) || isBlockedBy(uid)) { toast("Não é possível abrir DM com este usuário.", "error"); return; }
  closeModals();
  const pair = [currentUser.uid, uid].sort().join("_");
  const u = await get(ref(rtdb, `users/${uid}`));
  const name = u.val()?.displayName || "Usuário";
  $("dm-title").textContent = "DM com " + name;
  $("dm-messages").innerHTML = "";
  openModal("modal-dm");
  dmOpenPair = pair;
  if (dmUnsub) off(ref(rtdb, dmUnsub.path), "value", dmUnsub.cb);
  const cb = onValue(ref(rtdb, `dms/${pair}/messages`), (snap) => {
    const box = $("dm-messages");
    const inner = document.createElement("div");
    inner.className = "messages-inner";
    box.innerHTML = "";
    box.appendChild(inner);
    const val = snap.val() || {};
    const list = Object.entries(val).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    if (!list.length) inner.innerHTML = emptyState("message-square", "Conversa nova", "Mande a primeira mensagem privada.");
    list.forEach(([id, m]) => { m.id = id; renderMessage(inner, m, false, true); });
    box.scrollTop = box.scrollHeight;
  });
  dmUnsub = { path: `dms/${pair}/messages`, cb };
  set(ref(rtdb, `dmsMeta/${currentUser.uid}/${pair}/unread`), 0).catch(() => {});
}

$("dm-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!dmOpenPair) return;
  const inp = $("dm-input");
  const text = inp.value.trim().slice(0, MAX_MSG);
  if (!text) return;
  const me = currentUser.uid;
  const other = dmOpenPair.replace(me, "").replace("_", "");
  const target = other.length ? other : dmOpenPair.split("_").find((x) => x !== me);
  if (!target) return;
  await push(ref(rtdb, `dms/${dmOpenPair}/messages`), {
    uid: me, to: target,
    authorName: userProfile.displayName, authorPhoto: userProfile.photoURL || "",
    authorColor: userProfile.accentColor || "#5ee6c4",
    text, createdAt: serverTimestamp(),
  });
  await set(ref(rtdb, `dmsMeta/${me}/${dmOpenPair}`), { lastMsgAt: serverTimestamp(), unread: 0 });
  await set(ref(rtdb, `dmsMeta/${target}/${dmOpenPair}`), { lastMsgAt: serverTimestamp(), unread: serverTimestamp() });
  inp.value = "";
});

// ===================== SEARCH / FRIENDS BOTÕES =====================
$("search-btn").addEventListener("click", () => {
  openDrawer("search-drawer");
  searchInput.value = "";
  $("search-results").innerHTML = emptyState("search", "Buscar mensagens", "Pesquise mensagens neste servidor.");
});
$("friends-btn").addEventListener("click", () => {
  renderFriendList(friendTab);
  openDrawer("friends-drawer");
});

// ===================== VOICE PRESENCE DO HEADER =====================
window.addEventListener("devcord:presence", (e) => {
  const { uid } = e.detail;
  if (!window.devPresence) window.devPresence = {};
  window.devPresence[uid] = e.detail.status;
  if (uid === currentUser?.uid) return;
  if (document.getElementById("friends-drawer").classList.contains("hidden") === false) renderFriendList(friendTab);
});

$("mobile-menu-btn").addEventListener("click", () => {
  $("channel-sidebar").classList.toggle("open");
});

window.addEventListener("devcord:signed-in", async () => {
  await loadUserFavGifs();
});

// ===================== MODERAÇÃO / CARGOS =====================
function canModerateMessages() {
  return true; // placeholder — regras reais no servidor
}

async function openRolesModal() {
  const snap = await get(ref(rtdb, `servers/${currentServerId}/roles`));
  const roles = snap.val() || {};
  const list = $("roles-list");
  list.innerHTML = "";
  Object.entries(roles).sort((a, b) => (b[1].position || 0) - (a[1].position || 0)).forEach(([id, r]) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:var(--bg-2);cursor:pointer";
    row.innerHTML = `<span style="color:${esc(r.color || "#fff")}">${esc(r.icon || "")} ${esc(r.name)}</span><span style="flex:1"></span>`;
    row.addEventListener("click", () => openRoleEdit(id, r));
    list.appendChild(row);
  });
  openModal("modal-roles");
}

function openRoleEdit(id, role) {
  $("role-edit-id").value = id;
  $("role-edit-name").value = role.name || "";
  $("role-edit-color").value = role.color || "#5ee6c4";
  $("role-edit-icon").value = role.icon || "";
  document.querySelectorAll("#role-perms [data-perm]").forEach((c) => {
    c.checked = !!role.permissions?.[c.dataset.perm];
  });
  $("role-delete-btn").classList.toggle("hidden", id === "owner");
  openModal("modal-role-edit");
}

$("create-role-btn").addEventListener("click", () => {
  $("role-edit-id").value = "";
  $("role-edit-name").value = "";
  $("role-edit-color").value = "#5ee6c4";
  $("role-edit-icon").value = "";
  document.querySelectorAll("#role-perms [data-perm]").forEach((c) => (c.checked = false));
  $("role-delete-btn").classList.add("hidden");
  openModal("modal-role-edit");
});

$("role-save-btn").addEventListener("click", async () => {
  const id = $("role-edit-id").value;
  const perms = {};
  document.querySelectorAll("#role-perms [data-perm]").forEach((c) => { if (c.checked) perms[c.dataset.perm] = true; });
  const role = {
    name: $("role-edit-name").value.trim().slice(0, 24) || "Cargo",
    color: $("role-edit-color").value,
    icon: $("role-edit-icon").value.trim().slice(0, 4),
    permissions: perms,
    position: Date.now(),
  };
  if (id) await update(ref(rtdb, `servers/${currentServerId}/roles/${id}`), role);
  else await push(ref(rtdb, `servers/${currentServerId}/roles`), role);
  await loadServerRoles(currentServerId);
  closeModals();
  toast("Cargo salvo!", "success");
  openRolesModal();
});

$("role-delete-btn").addEventListener("click", async () => {
  const id = $("role-edit-id").value;
  if (!id || id === "owner") return;
  if (!confirm("Excluir este cargo?")) return;
  await remove(ref(rtdb, `servers/${currentServerId}/roles/${id}`));
  await remove(ref(rtdb, `servers/${currentServerId}/memberRoles/${id}`)).catch(() => {});
  await loadServerRoles(currentServerId);
  closeModals();
  toast("Cargo excluído.", "info");
  openRolesModal();
});

// ===================== INICIALIZAÇÃO DOS ÍCONES =====================
function hydrateStaticIcons() {
  const map = {
    "server-settings-btn": "settings",
    "mobile-menu-btn": "menu",
    "gallery-btn": "inbox",
    "search-btn": "search",
    "friends-btn": "users",
    "notif-btn": "bell",
    "theme-btn": "moon",
    "call-btn": "phone",
    "open-profile-btn": "pencil",
    "status-menu-btn": "wifi-off",
    "attach-btn": "paperclip",
    "gif-btn": "film",
    "emoji-btn": "smile",
    "sticker-btn": "gift",
    "back-to-forum-label": "",
    "send-btn": "",
  };
  Object.entries(map).forEach(([id, ic]) => {
    const el = $(id);
    if (el && ic) el.innerHTML = icon(ic, 18);
  });
  const send = $("send-btn");
  if (send) send.innerHTML = icon("send", 16);
  const back = $("back-to-forum-label");
  if (back) back.innerHTML = icon("arrow-left", 16) + " Voltar";
  document.querySelectorAll(".drawer-close").forEach((b) => (b.innerHTML = icon("x", 18)));
  $("notif-settings-btn").innerHTML = icon("settings", 16);
  $("notif-markall-btn").innerHTML = icon("check-check", 16);
  updateThemeButton();
}
hydrateStaticIcons();
