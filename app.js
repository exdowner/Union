// app.js — Union Chat (COMPLETO)
import {
    auth, rtdb, signOut, updateProfile, serverTimestamp
} from "./firebase-config.js";
import {
    ref, push, set, update, remove, get, onValue, off
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { imageToBase64 } from "./image.js";
import { joinVoiceChannel, leaveVoiceChannel } from "./webrtc.js";

// =====================================================
// ESTADO
// =====================================================
let currentUser = null;
let userProfile = null;
let currentServerId = null;
let currentChannelId = null;
let currentChannelType = null;
let pendingFile = null;
let pendingAudio = null;
let newAvatarFile = null;
let newBannerFile = null;
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];

const serverCache = {};
const serverListeners = {};
let userServersListener = null;
let channelsListener = null;
let messagesListener = null;
let forumPostsListener = null;
let forumRepliesListener = null;
let stickersListener = null;

const EMOJIS = ["😀","😂","🥹","😍","😎","🤩","😭","😡","👍","👎","❤️","🔥","✨","🎉","💯","🚀","💻","🎮","☕","🌙","⭐","🍀","🐱","🐶","🌈","🍕","🎵","📱","💡","⚡"];

// =====================================================
// UTIL
// =====================================================
const $ = (id) => document.getElementById(id);
const exists = (id) => !!$(id);

function toast(msg) {
    const el = $("toast");
    if (!el) return console.log("[Union]", msg);
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), 2600);
}

function openModal(id) {
    const overlay = $("modal-overlay");
    const modal = $(id);
    if (!overlay || !modal) return;
    overlay.classList.remove("hidden");
    document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
    modal.classList.remove("hidden");
}

function closeModals() {
    $("modal-overlay")?.classList.add("hidden");
    document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
}

function escapeHTML(v) {
    const d = document.createElement("div");
    d.textContent = v ?? "";
    return d.innerHTML;
}

function escapeAttribute(v) {
    return escapeHTML(v).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeName(v, fb = "Usuário") {
    return String(v || "").trim() || fb;
}

function getCurrentDisplayName() {
    return safeName(userProfile?.displayName);
}

function getCurrentPhoto() {
    return userProfile?.photoURL || createDefaultAvatar(currentUser?.uid || "uc");
}

function getCurrentColor() {
    return userProfile?.accentColor || "#5ee6c4";
}

function getCurrentPresence() {
    return userProfile?.presence || "online";
}

function normalizeTimestamp(v) {
    if (typeof v === "number") return v;
    if (typeof v === "string") {
        const n = Number(v);
        return Number.isNaN(n) ? 0 : n;
    }
    return 0;
}

function normalizeURL(v) {
    let u = String(v || "").trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    try {
        const p = new URL(u);
        return ["http:", "https:"].includes(p.protocol) ? p.href : "";
    } catch {
        return "";
    }
}

function getURLLabel(url) {
    try {
        return new URL(url).hostname.replace(/^www\./i, "");
    } catch {
        return "Link";
    }
}

function createDefaultAvatar(seed = "uc") {
    const t = String(seed);
    let h = 0;
    for (let i = 0; i < t.length; i++) {
        h = ((h << 5) - h) + t.charCodeAt(i);
        h |= 0;
    }
    const hue = Math.abs(h) % 360;
    const letter = t.replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase() || "U";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="hsl(${hue},70%,55%)"/><stop offset="100%" stop-color="hsl(${(hue + 45) % 360},70%,35%)"/></linearGradient></defs><rect width="256" height="256" rx="64" fill="url(#g)"/><text x="128" y="148" text-anchor="middle" font-family="Arial" font-size="110" font-weight="700" fill="white">${letter}</text></svg>`;
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

function channelIcon(type) {
    if (type === "voice") {
        return `<svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
    }
    if (type === "forum") {
        return `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="15" rx="3"/><path d="M7 8h10M7 12h7M7 16h5"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>`;
}

function svgIcon(type) {
    if (type === "link") {
        return `<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.07.07l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15"/><path d="M14 11a5 5 0 0 0-7.07-.07l-2 2A5 5 0 0 0 7 20l1.15-1.15"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>`;
}

async function convertImage(file, opts = {}) {
    if (!file) throw new Error("Nenhuma imagem.");
    if (!file.type?.startsWith("image/")) throw new Error("Apenas imagens.");
    return imageToBase64(file, opts);
}

function databaseRef(path) {
    return ref(rtdb, path);
}

async function safeSet(p, v) {
    return set(databaseRef(p), v);
}

async function safeUpdate(p, v) {
    return update(databaseRef(p), v);
}

async function safePush(p, v) {
    return push(databaseRef(p), v);
}

async function safeGet(p) {
    return get(databaseRef(p));
}

function stopListener(obj) {
    if (!obj) return;
    try {
        off(obj.reference, "value", obj.callback);
    } catch {}
}

function stopMessagesListener() {
    if (messagesListener) {
        stopListener(messagesListener);
        messagesListener = null;
    }
}

function stopForumPostsListener() {
    if (forumPostsListener) {
        stopListener(forumPostsListener);
        forumPostsListener = null;
    }
}

function stopForumRepliesListener() {
    if (forumRepliesListener) {
        stopListener(forumRepliesListener);
        forumRepliesListener = null;
    }
}

function stopChannelsListener() {
    if (channelsListener) {
        stopListener(channelsListener);
        channelsListener = null;
    }
}

function stopStickersListener() {
    if (stickersListener) {
        stopListener(stickersListener);
        stickersListener = null;
    }
}

function setPresence(status) {
    if (!currentUser) return;
    safeUpdate(`users/${currentUser.uid}`, {
        presence: status || "online",
        lastSeen: Date.now()
    }).catch(() => {});
}

// =====================================================
// MODAIS
// =====================================================
document.querySelectorAll(".modal-cancel").forEach(b => b.addEventListener("click", closeModals));
$("modal-overlay")?.addEventListener("click", e => {
    if (e.target.id === "modal-overlay") closeModals();
});

// =====================================================
// LOGIN
// =====================================================
window.addEventListener("devcord:signed-in", async (e) => {
    try {
        currentUser = e.detail;
        if (!currentUser?.uid) throw new Error("Usuário inválido");
        const snap = await safeGet(`users/${currentUser.uid}`);
        userProfile = snap.exists() ? snap.val() : {};
        renderUserCard();
        listenServers();
        listenStickers();
        setPresence(getCurrentPresence());
        applyTheme(localStorage.getItem("uc-theme") || "dark");
    } catch (err) {
        console.error(err);
        toast("Erro ao carregar conta.");
    }
});

// =====================================================
// USER CARD
// =====================================================
function renderUserCard() {
    if (!currentUser) return;
    if (exists("user-card-avatar")) $("user-card-avatar").src = getCurrentPhoto();
    if (exists("user-card-name")) {
        $("user-card-name").textContent = getCurrentDisplayName();
        $("user-card-name").style.fontFamily = userProfile?.nameFont || "Inter";
        $("user-card-name").style.color = getCurrentColor();
    }
    if (exists("user-card-status")) $("user-card-status").textContent = userProfile?.customStatus || "Online";
    if (exists("user-card-status-dot")) {
        $("user-card-status-dot").className = "status-dot status-" + getCurrentPresence();
    }
    if (exists("user-card")) $("user-card").dataset.userId = currentUser.uid;
}

// =====================================================
// TEMA
// =====================================================
function applyTheme(theme) {
    document.body.dataset.theme = theme;
    localStorage.setItem("uc-theme", theme);
    document.querySelectorAll(".theme-option").forEach(b => {
        b.classList.toggle("active", b.dataset.theme === theme);
    });
}
$("theme-btn")?.addEventListener("click", () => openModal("modal-theme"));
document.querySelectorAll(".theme-option").forEach(btn => {
    btn.addEventListener("click", () => {
        applyTheme(btn.dataset.theme);
        closeModals();
    });
});

// =====================================================
// SERVIDORES
// =====================================================
function listenServers() {
    if (!currentUser) return;
    if (userServersListener) stopListener(userServersListener);
    const reference = databaseRef(`userServers/${currentUser.uid}`);
    const callback = (snap) => {
        const ids = Object.keys(snap.exists() ? snap.val() : {});
        Object.keys(serverListeners).forEach(id => {
            if (!ids.includes(id)) {
                stopListener(serverListeners[id]);
                delete serverListeners[id];
                delete serverCache[id];
            }
        });
        ids.forEach(id => listenServer(id));
        renderServerList();
    };
    onValue(reference, callback);
    userServersListener = { reference, callback };
}

function listenServer(id) {
    if (serverListeners[id]) return;
    const reference = databaseRef(`servers/${id}`);
    const callback = (snap) => {
        if (!snap.exists()) {
            delete serverCache[id];
            renderServerList();
            return;
        }
        serverCache[id] = { id, ...snap.val() };
        renderServerList();
    };
    onValue(reference, callback);
    serverListeners[id] = { reference, callback };
}

function renderServerList() {
    if (!exists("server-list")) return;
    const list = $("server-list");
    list.innerHTML = "";
    Object.values(serverCache).forEach(server => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "server-pill" + (server.id === currentServerId ? " active" : "");
        btn.title = server.name || "";
        if (server.iconURL) {
            const img = document.createElement("img");
            img.src = server.iconURL;
            img.alt = "";
            img.loading = "lazy";
            btn.appendChild(img);
        } else {
            btn.textContent = safeName(server.name, "UC").slice(0, 2).toUpperCase();
        }
        btn.addEventListener("click", () => selectServer(server.id, server));
        list.appendChild(btn);
    });
}

$("add-server-btn")?.addEventListener("click", () => {
    const a = prompt("Digite 'criar' ou cole o ID do servidor:");
    if (!a) return;
    if (a.trim().toLowerCase() === "criar") openModal("modal-create-server");
    else joinServerById(a.trim());
});

async function joinServerById(id) {
    if (!currentUser) return;
    try {
        const snap = await safeGet(`servers/${id}`);
        if (!snap.exists()) return toast("Servidor não encontrado.");
        await safeSet(`serverMembers/${id}/${currentUser.uid}`, true);
        await safeSet(`userServers/${currentUser.uid}/${id}`, true);
        toast("Entrou no servidor.");
    } catch (e) {
        toast("Erro: " + e.message);
    }
}

$("confirm-create-server")?.addEventListener("click", async () => {
    if (!currentUser) return;
    const name = $("new-server-name")?.value.trim();
    if (!name) return toast("Dê um nome.");
    const file = $("new-server-icon")?.files?.[0];
    try {
        const sRef = push(databaseRef("servers"));
        const id = sRef.key;
        await set(sRef, {
            name,
            ownerId: currentUser.uid,
            iconURL: "",
            bannerURL: "",
            createdAt: serverTimestamp()
        });
        await safeSet(`serverMembers/${id}/${currentUser.uid}`, true);
        await safeSet(`userServers/${currentUser.uid}/${id}`, true);
        if (file) {
            try {
                const b64 = await convertImage(file, { maxWidth: 512, maxHeight: 512, quality: 0.82 });
                await safeUpdate(`servers/${id}`, { iconURL: b64 });
            } catch {
                toast("Servidor criado, ícone falhou.");
            }
        }
        if (exists("new-server-name")) $("new-server-name").value = "";
        if (exists("new-server-icon")) $("new-server-icon").value = "";
        closeModals();
        toast(`Servidor criado. ID: ${id}`);
        selectServer(id, { id, name });
    } catch (e) {
        toast("Erro: " + e.message);
    }
});

// =====================================================
// SELECT SERVER / HOME / SETTINGS
// =====================================================
async function selectServer(id, data) {
    stopMessagesListener();
    stopForumPostsListener();
    stopForumRepliesListener();
    currentServerId = id;
    currentChannelId = null;
    currentChannelType = null;
    if (exists("current-server-name")) {
        $("current-server-name").textContent = data?.name || serverCache[id]?.name || "Servidor";
    }
    $("server-settings-btn")?.classList.remove("hidden");
    renderServerList();
    listenChannels();
    showView(null);
}

$("home-pill")?.addEventListener("click", () => {
    stopChannelsListener();
    stopMessagesListener();
    stopForumPostsListener();
    stopForumRepliesListener();
    if (currentChannelType === "voice") leaveVoiceChannel();
    currentServerId = null;
    currentChannelId = null;
    currentChannelType = null;
    if (exists("current-server-name")) $("current-server-name").textContent = "Bem-vindo";
    $("server-settings-btn")?.classList.add("hidden");
    if (exists("channel-groups")) {
        $("channel-groups").innerHTML = '<p class="empty-hint">Crie ou entre em um servidor para ver os canais aqui.</p>';
    }
    showView(null);
    document.querySelectorAll(".server-pill").forEach(p => p.classList.remove("active"));
    $("home-pill")?.classList.add("active");
});

$("server-settings-btn")?.addEventListener("click", () => {
    if (!currentServerId) return;
    openServerSettings();
});

function openServerSettings() {
    showView("server-settings");
    const server = serverCache[currentServerId];
    if (!server) return;
    if (exists("server-name-edit")) $("server-name-edit").value = server.name || "";
    if (exists("server-invite-link")) $("server-invite-link").value = currentServerId;
    if (exists("server-icon-preview")) {
        $("server-icon-preview").src = server.iconURL || createDefaultAvatar(server.name);
    }
    if (exists("server-banner-preview")) {
        $("server-banner-preview").style.background = server.bannerURL
            ? `url("${escapeAttribute(server.bannerURL)}") center/cover`
            : "linear-gradient(135deg,var(--accent-dim),var(--bg-3))";
    }
    const isOwner = server.ownerId === currentUser?.uid;
    $("delete-server-btn")?.classList.toggle("hidden", !isOwner);
}

$("back-from-server-settings")?.addEventListener("click", () => {
    showView(null);
    if (currentServerId) listenChannels();
});

// =====================================================
// CANAIS
// =====================================================
function listenChannels() {
    if (!currentServerId) return;
    stopChannelsListener();
    const reference = databaseRef(`channels/${currentServerId}`);
    const callback = (snap) => {
        const groups = { text: [], voice: [], forum: [] };
        Object.entries(snap.val() || {})
            .sort((a, b) => normalizeTimestamp(a[1]?.createdAt) - normalizeTimestamp(b[1]?.createdAt))
            .forEach(([id, d]) => {
                if (groups[d?.type]) groups[d.type].push({ id, ...d });
            });
        renderChannels(groups);
    };
    onValue(reference, callback);
    channelsListener = { reference, callback };
}

const TYPE_LABEL = {
    text: "Canais de texto",
    voice: "Canais de voz",
    forum: "Fóruns"
};

function renderChannels(groups) {
    if (!exists("channel-groups")) return;
    const root = $("channel-groups");
    root.innerHTML = "";
    Object.keys(TYPE_LABEL).forEach(type => {
        const label = document.createElement("div");
        label.className = "channel-group-label";
        label.innerHTML = `<span>${TYPE_LABEL[type]}</span>`;
        const add = document.createElement("button");
        add.type = "button";
        add.textContent = "+";
        add.title = "Criar canal";
        add.addEventListener("click", () => {
            openModal("modal-create-channel");
            if (exists("new-channel-type")) $("new-channel-type").value = type;
        });
        label.appendChild(add);
        root.appendChild(label);
        if (!groups[type].length) {
            const p = document.createElement("p");
            p.className = "empty-hint";
            p.textContent = "Nenhum canal ainda.";
            root.appendChild(p);
            return;
        }
        groups[type].forEach(ch => {
            const item = document.createElement("div");
            item.className = "channel-item" + (ch.id === currentChannelId ? " active" : "");
            item.innerHTML = `<span class="ch-icon">${channelIcon(type)}</span><span>${escapeHTML(ch.name || "canal")}</span>`;
            item.addEventListener("click", () => selectChannel(ch));
            root.appendChild(item);
        });
    });
}

$("confirm-create-channel")?.addEventListener("click", async () => {
    if (!currentServerId) return toast("Selecione um servidor.");
    const raw = $("new-channel-name")?.value.trim();
    const type = $("new-channel-type")?.value;
    if (!raw) return toast("Dê um nome.");
    const name = raw.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/gi, "").slice(0, 80);
    if (!name || !["text", "voice", "forum"].includes(type)) return toast("Dados inválidos.");
    try {
        await safePush(`channels/${currentServerId}`, {
            name,
            type,
            createdAt: serverTimestamp()
        });
        if (exists("new-channel-name")) $("new-channel-name").value = "";
        closeModals();
        toast("Canal criado.");
    } catch (e) {
        toast("Erro: " + e.message);
    }
});

// =====================================================
// SELECT CHANNEL / VIEWS
// =====================================================
function selectChannel(ch) {
    if (!ch?.id) return;
    if (currentChannelType === "voice" && currentChannelId !== ch.id) {
        try { leaveVoiceChannel(); } catch {}
    }
    stopMessagesListener();
    stopForumPostsListener();
    stopForumRepliesListener();
    currentChannelId = ch.id;
    currentChannelType = ch.type;
    if (exists("channel-title")) {
        $("channel-title").textContent = (ch.type === "text" ? "# " : "") + (ch.name || "canal");
    }
    document.querySelectorAll(".channel-item").forEach(el => el.classList.remove("active"));
    showView(ch.type);
    if (ch.type === "text") listenMessages();
    if (ch.type === "voice") setupVoiceView(ch);
    if (ch.type === "forum") listenForum();
    $("call-btn")?.classList.toggle("hidden", ch.type !== "voice");
}

function showView(type) {
    ["text", "voice", "forum", "server-settings"].forEach(t => {
        $("view-" + t)?.classList.toggle("hidden", t !== type);
    });
}

// =====================================================
// MENSAGENS
// =====================================================
function listenMessages() {
    if (!currentServerId || !currentChannelId) return;
    stopMessagesListener();
    const path = `messages/${currentServerId}/${currentChannelId}`;
    const reference = databaseRef(path);
    const callback = (snap) => {
        if (!exists("messages")) return;
        const root = $("messages");
        root.innerHTML = "";
        Object.entries(snap.val() || {})
            .sort((a, b) => normalizeTimestamp(a[1]?.createdAt) - normalizeTimestamp(b[1]?.createdAt))
            .forEach(([id, msg]) => {
                const el = document.createElement("div");
                el.className = "message";
                el.dataset.userId = msg.uid || "";
                const photo = msg.authorPhoto || createDefaultAvatar(msg.uid || "u");
                const time = normalizeTimestamp(msg.createdAt)
                    ? new Date(normalizeTimestamp(msg.createdAt)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
                    : "";
                let content = escapeHTML(msg.text || "");
                if (msg.image) content += `<div class="msg-image"><img src="${escapeAttribute(msg.image)}" alt="" loading="lazy"></div>`;
                if (msg.sticker) content += `<div class="msg-sticker"><img src="${escapeAttribute(msg.sticker)}" alt="" loading="lazy"></div>`;
                if (msg.audio) content += `<div class="msg-audio"><audio controls src="${escapeAttribute(msg.audio)}"></audio></div>`;
                el.innerHTML = `
                    <img class="avatar avatar-sm" src="${escapeAttribute(photo)}" alt="" data-user-id="${escapeAttribute(msg.uid || "")}">
                    <div class="message-body">
                        <div class="message-header">
                            <strong style="color:${escapeAttribute(msg.authorColor || "#5ee6c4")};font-family:${escapeAttribute(msg.authorFont || "Inter")}" data-user-id="${escapeAttribute(msg.uid || "")}">${escapeHTML(msg.authorName || "Usuário")}</strong>
                            <span class="meta">${escapeHTML(time)}</span>
                        </div>
                        <div class="message-content">${content}</div>
                    </div>`;
                root.appendChild(el);
            });
        root.scrollTop = root.scrollHeight;
    };
    onValue(reference, callback);
    messagesListener = { reference, callback };
}

$("message-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentServerId || !currentChannelId || !currentUser) return;
    const input = $("message-input");
    let text = input?.value?.trim() || "";
    if (!text && !pendingFile && !pendingAudio) return;

    const urlMatch = text.match(/https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i);
    let imageFromUrl = null;
    if (urlMatch && !pendingFile) {
        imageFromUrl = urlMatch[0];
        text = text.replace(urlMatch[0], "").trim();
    }

    try {
        const payload = {
            uid: currentUser.uid,
            authorName: getCurrentDisplayName(),
            authorPhoto: userProfile?.photoURL || "",
            authorColor: getCurrentColor(),
            authorFont: userProfile?.nameFont || "Inter",
            text,
            createdAt: serverTimestamp()
        };
        if (pendingFile) {
            payload.image = await convertImage(pendingFile, { maxWidth: 1280, maxHeight: 1280, quality: 0.8 });
            pendingFile = null;
            clearAttachPreview();
        } else if (imageFromUrl) {
            payload.image = imageFromUrl;
        }
        if (pendingAudio) {
            payload.audio = pendingAudio;
            pendingAudio = null;
        }
        await safePush(`messages/${currentServerId}/${currentChannelId}`, payload);
        if (input) input.value = "";
    } catch (err) {
        console.error(err);
        toast("Erro ao enviar: " + err.message);
    }
});

function clearAttachPreview() {
    if (exists("attach-preview")) {
        $("attach-preview").classList.add("hidden");
        $("attach-preview").innerHTML = "";
    }
    if (exists("file-input")) $("file-input").value = "";
}

$("attach-btn")?.addEventListener("click", () => $("file-input")?.click());
$("file-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
        toast("Apenas imagens.");
        e.target.value = "";
        pendingFile = null;
        return;
    }
    pendingFile = file;
    if (exists("attach-preview")) {
        const url = URL.createObjectURL(file);
        $("attach-preview").innerHTML = `<img src="${url}" alt=""><button type="button" id="clear-attach">×</button>`;
        $("attach-preview").classList.remove("hidden");
        $("clear-attach")?.addEventListener("click", () => {
            pendingFile = null;
            clearAttachPreview();
        });
    }
});

// =====================================================
// ÁUDIO
// =====================================================
$("record-btn")?.addEventListener("click", async () => {
    if (isRecording) {
        mediaRecorder?.stop();
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            isRecording = false;
            $("record-btn")?.classList.remove("recording");
            const blob = new Blob(audioChunks, { type: "audio/webm" });
            const reader = new FileReader();
            reader.onload = () => {
                pendingAudio = reader.result;
                toast("Áudio pronto. Clique em Enviar.");
            };
            reader.readAsDataURL(blob);
        };
        mediaRecorder.start();
        isRecording = true;
        $("record-btn")?.classList.add("recording");
        toast("Gravando... clique de novo para parar.");
    } catch {
        toast("Não foi possível acessar o microfone.");
    }
});

// =====================================================
// STICKERS + EMOJIS
// =====================================================
function listenStickers() {
    if (!currentUser) return;
    stopStickersListener();
    const reference = databaseRef(`stickers/${currentUser.uid}`);
    const callback = (snap) => renderStickerGrid(snap.val() || {});
    onValue(reference, callback);
    stickersListener = { reference, callback };
}

function renderStickerGrid(data) {
    const grid = $("sticker-grid");
    if (!grid) return;
    grid.innerHTML = "";
    const entries = Object.entries(data);
    if (!entries.length) {
        grid.innerHTML = '<p class="empty-hint" style="grid-column:1/-1">Nenhuma figurinha. Use + ou URL.</p>';
        return;
    }
    entries.forEach(([id, s]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        const img = document.createElement("img");
        img.src = s.url || s;
        img.alt = "";
        img.loading = "lazy";
        btn.appendChild(img);
        btn.addEventListener("click", () => sendSticker(s.url || s));
        grid.appendChild(btn);
    });
}

function renderEmojiGrid() {
    const grid = $("emoji-grid");
    if (!grid || grid.children.length) return;
    EMOJIS.forEach(em => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = em;
        btn.addEventListener("click", () => {
            const input = $("message-input");
            if (input) {
                input.value += em;
                input.focus();
            }
            $("sticker-picker")?.classList.add("hidden");
        });
        grid.appendChild(btn);
    });
}

async function sendSticker(url) {
    if (!currentServerId || !currentChannelId) return;
    try {
        await safePush(`messages/${currentServerId}/${currentChannelId}`, {
            uid: currentUser.uid,
            authorName: getCurrentDisplayName(),
            authorPhoto: userProfile?.photoURL || "",
            authorColor: getCurrentColor(),
            authorFont: userProfile?.nameFont || "Inter",
            sticker: url,
            text: "",
            createdAt: serverTimestamp()
        });
        $("sticker-picker")?.classList.add("hidden");
    } catch {
        toast("Erro ao enviar figurinha.");
    }
}

$("sticker-btn")?.addEventListener("click", () => {
    $("sticker-picker")?.classList.toggle("hidden");
    renderEmojiGrid();
});

document.querySelectorAll(".picker-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".picker-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const panel = tab.dataset.picker;
        $("picker-stickers")?.classList.toggle("hidden", panel !== "stickers");
        $("picker-emojis")?.classList.toggle("hidden", panel !== "emojis");
    });
});

$("sticker-upload-input")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return toast("Apenas imagens.");
    try {
        const b64 = await convertImage(file, { maxWidth: 256, maxHeight: 256, quality: 0.85 });
        await safePush(`stickers/${currentUser.uid}`, { url: b64, createdAt: serverTimestamp() });
        toast("Figurinha adicionada.");
        e.target.value = "";
    } catch (err) {
        toast("Erro: " + err.message);
    }
});

$("sticker-url-btn")?.addEventListener("click", () => openModal("modal-sticker-url"));
$("confirm-sticker-url")?.addEventListener("click", async () => {
    const url = normalizeURL($("sticker-url-input")?.value);
    if (!url) return toast("URL inválida.");
    try {
        await safePush(`stickers/${currentUser.uid}`, { url, createdAt: serverTimestamp() });
        if (exists("sticker-url-input")) $("sticker-url-input").value = "";
        closeModals();
        toast("Figurinha adicionada.");
    } catch (err) {
        toast("Erro: " + err.message);
    }
});

// =====================================================
// FÓRUM
// =====================================================
function listenForum() {
    if (!currentServerId || !currentChannelId) return;
    stopForumPostsListener();
    stopForumRepliesListener();
    const path = `posts/${currentServerId}/${currentChannelId}`;
    const reference = databaseRef(path);
    const callback = (snapshot) => {
        if (!exists("forum-posts")) return;
        const root = $("forum-posts");
        root.innerHTML = "";
        root.classList.remove("hidden");
        if (exists("forum-thread")) $("forum-thread").classList.add("hidden");
        const value = snapshot.val() || {};
        const entries = Object.entries(value).sort(
            (a, b) => normalizeTimestamp(b[1]?.createdAt) - normalizeTimestamp(a[1]?.createdAt)
        );
        entries.forEach(([id, post]) => {
            const card = document.createElement("div");
            card.className = "forum-post-card";
            const time = normalizeTimestamp(post?.createdAt)
                ? new Date(normalizeTimestamp(post.createdAt)).toLocaleString("pt-BR")
                : "";
            const photo = post?.authorPhoto || createDefaultAvatar(post?.uid || "u");
            const body = String(post?.body || "");
            card.innerHTML = `
                <div class="forum-post-author">
                    <img class="avatar avatar-sm" src="${escapeAttribute(photo)}" alt="" loading="lazy">
                    <div>
                        <strong>${escapeHTML(post?.authorName || "Usuário")}</strong>
                        ${time ? `<div class="meta">${escapeHTML(time)}</div>` : ""}
                    </div>
                </div>
                <h3>${escapeHTML(post?.title || "Sem título")}</h3>
                <p>${escapeHTML(body.slice(0, 180))}${body.length > 180 ? "…" : ""}</p>`;
            card.addEventListener("click", () => openThread(id, post));
            root.appendChild(card);
        });
        if (!entries.length) root.innerHTML = '<p class="empty-hint">Nenhum tópico ainda.</p>';
    };
    onValue(reference, callback);
    forumPostsListener = { reference, callback };
}

function openThread(postId, post) {
    if (!currentServerId || !currentChannelId || !postId) return;
    if (exists("forum-posts")) $("forum-posts").classList.add("hidden");
    if (exists("forum-thread")) $("forum-thread").classList.remove("hidden");
    const time = normalizeTimestamp(post?.createdAt)
        ? new Date(normalizeTimestamp(post.createdAt)).toLocaleString("pt-BR")
        : "";
    const photo = post?.authorPhoto || createDefaultAvatar(post?.uid || "u");
    if (exists("forum-thread-content")) {
        $("forum-thread-content").innerHTML = `
            <div class="thread-author">
                <img class="avatar avatar-sm" src="${escapeAttribute(photo)}" alt="">
                <div>
                    <strong>${escapeHTML(post?.authorName || "Usuário")}</strong>
                    ${time ? `<div class="meta">${escapeHTML(time)}</div>` : ""}
                </div>
            </div>
            <h2>${escapeHTML(post?.title || "Sem título")}</h2>
            <p style="line-height:1.6">${escapeHTML(post?.body || "")}</p>
            <hr style="border-color:var(--line);margin:16px 0">
            <div id="thread-replies"></div>
            <form id="reply-form" style="display:flex;gap:8px;margin-top:12px">
                <input id="reply-input" type="text" placeholder="Responder..." style="flex:1" maxlength="2000">
                <button class="btn-primary" type="submit">Responder</button>
            </form>`;
    }
    const repliesPath = `replies/${currentServerId}/${currentChannelId}/${postId}`;
    stopForumRepliesListener();
    const reference = databaseRef(repliesPath);
    const callback = (snapshot) => {
        const box = $("thread-replies");
        if (!box) return;
        box.innerHTML = "";
        Object.values(snapshot.val() || {})
            .sort((a, b) => normalizeTimestamp(a?.createdAt) - normalizeTimestamp(b?.createdAt))
            .forEach((reply) => {
                const el = document.createElement("div");
                el.className = "thread-reply";
                const rp = reply?.authorPhoto || createDefaultAvatar(reply?.uid || "u");
                el.innerHTML = `
                    <div style="display:flex;gap:9px;align-items:flex-start">
                        <img class="avatar avatar-sm" src="${escapeAttribute(rp)}" alt="" loading="lazy">
                        <div>
                            <strong>${escapeHTML(reply?.authorName || "Usuário")}</strong>
                            <div>${escapeHTML(reply?.text || "")}</div>
                        </div>
                    </div>`;
                box.appendChild(el);
            });
    };
    onValue(reference, callback);
    forumRepliesListener = { reference, callback };

    const form = $("reply-form");
    if (form) {
        form.onsubmit = async (ev) => {
            ev.preventDefault();
            const text = $("reply-input")?.value?.trim();
            if (!text) return;
            try {
                await safePush(repliesPath, {
                    uid: currentUser.uid,
                    authorName: getCurrentDisplayName(),
                    authorPhoto: userProfile?.photoURL || "",
                    text,
                    createdAt: serverTimestamp()
                });
                if (exists("reply-input")) $("reply-input").value = "";
            } catch {
                toast("Erro ao responder.");
            }
        };
    }
}

$("new-post-btn")?.addEventListener("click", () => {
    if (currentChannelType !== "forum") return toast("Abra um fórum primeiro.");
    openModal("modal-new-post");
});

$("back-to-forum")?.addEventListener("click", () => {
    stopForumRepliesListener();
    $("forum-thread")?.classList.add("hidden");
    $("forum-posts")?.classList.remove("hidden");
});

$("confirm-new-post")?.addEventListener("click", async () => {
    if (!currentServerId || !currentChannelId) return toast("Selecione um fórum.");
    const title = $("new-post-title")?.value?.trim();
    const body = $("new-post-body")?.value?.trim();
    if (!title || !body) return toast("Preencha tudo.");
    try {
        await safePush(`posts/${currentServerId}/${currentChannelId}`, {
            title,
            body,
            uid: currentUser.uid,
            authorName: getCurrentDisplayName(),
            authorPhoto: userProfile?.photoURL || "",
            authorColor: getCurrentColor(),
            createdAt: serverTimestamp()
        });
        if (exists("new-post-title")) $("new-post-title").value = "";
        if (exists("new-post-body")) $("new-post-body").value = "";
        closeModals();
        toast("Tópico criado.");
    } catch (e) {
        toast("Erro: " + e.message);
    }
});

// =====================================================
// VOZ
// =====================================================
function setupVoiceView(channel) {
    if (exists("voice-channel-name")) $("voice-channel-name").textContent = channel?.name || "Canal de voz";
    $("join-voice-btn")?.classList.remove("hidden");
    $("leave-voice-btn")?.classList.add("hidden");
    $("toggle-mic-btn")?.classList.add("hidden");
    $("toggle-cam-btn")?.classList.add("hidden");
    if (exists("video-grid")) $("video-grid").innerHTML = "";
}

$("join-voice-btn")?.addEventListener("click", async () => {
    if (!currentServerId || !currentChannelId || !currentUser) return;
    try {
        await joinVoiceChannel({
            serverId: currentServerId,
            channelId: currentChannelId,
            uid: currentUser.uid,
            displayName: getCurrentDisplayName()
        });
        $("join-voice-btn").classList.add("hidden");
        $("leave-voice-btn").classList.remove("hidden");
        $("toggle-mic-btn").classList.remove("hidden");
        $("toggle-cam-btn").classList.remove("hidden");
    } catch (e) {
        toast("Erro microfone/câmera: " + e.message);
    }
});

$("leave-voice-btn")?.addEventListener("click", () => {
    try { leaveVoiceChannel(); } catch {}
    $("join-voice-btn")?.classList.remove("hidden");
    $("leave-voice-btn")?.classList.add("hidden");
    $("toggle-mic-btn")?.classList.add("hidden");
    $("toggle-cam-btn")?.classList.add("hidden");
});

$("toggle-mic-btn")?.addEventListener("click", (e) => {
    try {
        const on = window.devcordToggleMic?.();
        e.currentTarget.classList.toggle("disabled", on === false);
    } catch {}
});

$("toggle-cam-btn")?.addEventListener("click", (e) => {
    try {
        const on = window.devcordToggleCam?.();
        e.currentTarget.classList.toggle("disabled", on === false);
    } catch {}
});

// =====================================================
// PERFIL
// =====================================================
function loadProfileFields() {
    if (!userProfile) userProfile = {};
    if (exists("profile-avatar-preview")) $("profile-avatar-preview").src = getCurrentPhoto();
    if (exists("profile-name-input")) $("profile-name-input").value = userProfile.displayName || "";
    if (exists("profile-bio-input")) $("profile-bio-input").value = userProfile.bio || "";
    if (exists("profile-color-input")) $("profile-color-input").value = userProfile.accentColor || "#5ee6c4";
    if (exists("profile-font-input")) $("profile-font-input").value = userProfile.nameFont || "Inter";
    if (exists("profile-social-input")) $("profile-social-input").value = userProfile.socialLinks || "";
    if (exists("profile-status-input")) $("profile-status-input").value = userProfile.customStatus || "";
    if (exists("profile-presence-input")) $("profile-presence-input").value = userProfile.presence || "online";
    if (exists("profile-avatar-url-input")) $("profile-avatar-url-input").value = userProfile.photoURL || "";
    if (exists("profile-banner-url-input")) $("profile-banner-url-input").value = userProfile.bannerURL || "";
    if (exists("profile-banner-preview")) {
        const b = userProfile.bannerURL;
        $("profile-banner-preview").style.background = b
            ? `url("${escapeAttribute(b)}") center/cover`
            : "linear-gradient(135deg,var(--accent-dim),var(--bg-3))";
    }
}

$("open-profile-btn")?.addEventListener("click", () => {
    loadProfileFields();
    openModal("modal-profile");
});

$("profile-avatar-input")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f && !f.type.startsWith("image/")) {
        toast("Só imagem.");
        return;
    }
    newAvatarFile = f || null;
    if (newAvatarFile && exists("profile-avatar-preview")) {
        $("profile-avatar-preview").src = URL.createObjectURL(newAvatarFile);
    }
});

$("profile-banner-input")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f && !f.type.startsWith("image/")) {
        toast("Só imagem.");
        return;
    }
    newBannerFile = f || null;
    if (newBannerFile && exists("profile-banner-preview")) {
        $("profile-banner-preview").style.background = `url("${URL.createObjectURL(newBannerFile)}") center/cover`;
    }
});

$("confirm-profile")?.addEventListener("click", async () => {
    if (!currentUser) return;
    const updates = {
        displayName: $("profile-name-input")?.value?.trim().slice(0, 32) || "Usuário",
        bio: $("profile-bio-input")?.value?.trim().slice(0, 190) || "",
        accentColor: $("profile-color-input")?.value || "#5ee6c4",
        nameFont: $("profile-font-input")?.value || "Inter",
        socialLinks: $("profile-social-input")?.value?.trim().slice(0, 500) || "",
        customStatus: $("profile-status-input")?.value?.trim().slice(0, 32) || "",
        presence: $("profile-presence-input")?.value || "online"
    };
    try {
        if (newAvatarFile) {
            updates.photoURL = await convertImage(newAvatarFile, { maxWidth: 512, maxHeight: 512, quality: 0.82 });
        } else if ($("profile-avatar-url-input")?.value.trim()) {
            updates.photoURL = $("profile-avatar-url-input").value.trim();
        }
        if (newBannerFile) {
            updates.bannerURL = await convertImage(newBannerFile, { maxWidth: 1920, maxHeight: 1080, quality: 0.78 });
        } else if ($("profile-banner-url-input")?.value.trim()) {
            updates.bannerURL = $("profile-banner-url-input").value.trim();
        }
        await safeUpdate(`users/${currentUser.uid}`, updates);
        await updateProfile(currentUser, { displayName: updates.displayName });
        userProfile = { ...userProfile, ...updates };
        newAvatarFile = null;
        newBannerFile = null;
        renderUserCard();
        closeModals();
        toast("Perfil salvo.");
    } catch (e) {
        toast("Erro: " + e.message);
    }
});

// =====================================================
// PERFIL PÚBLICO
// =====================================================
function renderPublicProfile(profile, uid) {
    if (!exists("modal-public-profile")) return;
    const d = profile || {};
    if (exists("public-profile-banner")) {
        $("public-profile-banner").style.backgroundImage = d.bannerURL ? `url("${escapeAttribute(d.bannerURL)}")` : "";
    }
    if (exists("public-profile-avatar")) {
        $("public-profile-avatar").src = d.photoURL || createDefaultAvatar(uid);
    }
    if (exists("public-profile-name")) {
        $("public-profile-name").textContent = safeName(d.displayName);
        $("public-profile-name").style.color = d.accentColor || "#5ee6c4";
        $("public-profile-name").style.fontFamily = d.nameFont || "Inter";
    }
    if (exists("public-profile-status")) $("public-profile-status").textContent = d.customStatus || "Online";
    if (exists("public-profile-bio")) $("public-profile-bio").textContent = d.bio || "Sem biografia.";
    if (exists("public-profile-socials")) {
        const c = $("public-profile-socials");
        c.innerHTML = "";
        String(d.socialLinks || "").split(/\n|,/).map(s => s.trim()).filter(Boolean).forEach(u => {
            const n = normalizeURL(u);
            if (!n) return;
            const a = document.createElement("a");
            a.href = n;
            a.target = "_blank";
            a.rel = "noopener";
            a.className = "profile-social-link";
            a.innerHTML = `${svgIcon("link")} <span>${escapeHTML(getURLLabel(n))}</span>`;
            c.appendChild(a);
        });
    }
    openModal("modal-public-profile");
}

document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-user-id]");
    if (!el) return;
    const uid = el.dataset.userId;
    if (!uid) return;
    try {
        const snap = await safeGet(`users/${uid}`);
        renderPublicProfile(snap.exists() ? snap.val() : {}, uid);
    } catch {
        toast("Erro ao abrir perfil.");
    }
});

// =====================================================
// LOGOUT
// =====================================================
$("logout-btn")?.addEventListener("click", async () => {
    try { leaveVoiceChannel(); } catch {}
    stopChannelsListener();
    stopMessagesListener();
    stopForumPostsListener();
    stopForumRepliesListener();
    stopStickersListener();
    if (userServersListener) {
        stopListener(userServersListener);
        userServersListener = null;
    }
    Object.keys(serverListeners).forEach(id => {
        stopListener(serverListeners[id]);
        delete serverListeners[id];
    });
    Object.keys(serverCache).forEach(id => delete serverCache[id]);
    currentUser = null;
    userProfile = null;
    currentServerId = null;
    currentChannelId = null;
    currentChannelType = null;
    pendingFile = null;
    pendingAudio = null;
    newAvatarFile = null;
    newBannerFile = null;
    await signOut(auth);
    closeModals();
});

// =====================================================
// PRESENÇA + TECLAS + INIT
// =====================================================
window.addEventListener("focus", () => setPresence(getCurrentPresence()));
window.addEventListener("blur", () => {
    if (getCurrentPresence() === "online") setPresence("idle");
});
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") setPresence(getCurrentPresence());
    else if (getCurrentPresence() === "online") setPresence("idle");
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        closeModals();
        $("sticker-picker")?.classList.add("hidden");
    }
});
document.addEventListener("click", (e) => {
    const p = $("sticker-picker");
    const b = $("sticker-btn");
    if (p && b && !p.contains(e.target) && !b.contains(e.target)) {
        p.classList.add("hidden");
    }
});
window.addEventListener("beforeunload", () => {
    try { leaveVoiceChannel(); } catch {}
});

(function init() {
    showView(null);
    $("sticker-picker")?.classList.add("hidden");
    $("home-pill")?.classList.add("active");
    console.log("%cUnion Chat completo.", "font-weight:700");
})();
