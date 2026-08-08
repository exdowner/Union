// app.js — núcleo do DevCord (corrigido e completo)
import {
    auth,
    rtdb,
    signOut,
    updateProfile,
    serverTimestamp
} from "./firebase-config.js";
import {
    ref,
    push,
    set,
    update,
    remove,
    get,
    onValue,
    off
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { imageToBase64 } from "./image.js";
import {
    joinVoiceChannel,
    leaveVoiceChannel
} from "./webrtc.js";

// =====================================================
// ESTADO GLOBAL
// =====================================================
let currentUser = null;
let userProfile = null;
let currentServerId = null;
let currentChannelId = null;
let currentChannelType = null;
let pendingFile = null;
let newAvatarFile = null;
let newBannerFile = null;

const serverCache = {};
const serverListeners = {};
let userServersListener = null;
let channelsListener = null;
let messagesListener = null;
let forumPostsListener = null;
let forumRepliesListener = null;
let stickersListener = null;

// =====================================================
// UTILITÁRIOS
// =====================================================
const $ = (id) => document.getElementById(id);
function exists(id) {
    return !!$(id);
}
function toast(message) {
    const el = $("toast");
    if (!el) {
        console.log("[DevCord]", message);
        return;
    }
    el.textContent = message;
    el.classList.remove("hidden");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.add("hidden"), 2600);
}
function openModal(id) {
    const overlay = $("modal-overlay");
    const modal = $(id);
    if (!overlay || !modal) return;
    overlay.classList.remove("hidden");
    document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden"));
    modal.classList.remove("hidden");
}
function closeModals() {
    const overlay = $("modal-overlay");
    if (overlay) overlay.classList.add("hidden");
    document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden"));
}
function escapeHTML(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
}
function escapeAttribute(value) {
    return escapeHTML(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function safeName(value, fallback = "Usuário") {
    const name = String(value || "").trim();
    return name || fallback;
}
function getCurrentDisplayName() {
    return safeName(userProfile?.displayName, "Usuário");
}
function getCurrentPhoto() {
    return userProfile?.photoURL || createDefaultAvatar(currentUser?.uid || "devcord");
}
function getCurrentBanner() {
    return userProfile?.bannerURL || "";
}
function getCurrentStatus() {
    return userProfile?.customStatus || "Online";
}
function getCurrentColor() {
    return userProfile?.accentColor || "#5ee6c4";
}
function getCurrentPresence() {
    return userProfile?.presence || "online";
}
function normalizeTimestamp(value) {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        const n = Number(value);
        return Number.isNaN(n) ? 0 : n;
    }
    return 0;
}
function normalizeURL(value) {
    let url = String(value || "").trim();
    if (!url) return "";
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) return "";
        return parsed.href;
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

// =====================================================
// AVATAR PADRÃO
// =====================================================
function createDefaultAvatar(seed = "devcord") {
    const text = String(seed);
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    const letter = text.replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase() || "D";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="hsl(${hue},70%,55%)"/><stop offset="100%" stop-color="hsl(${(hue + 45) % 360},70%,35%)"/></linearGradient></defs><rect width="256" height="256" rx="64" fill="url(#g)"/><text x="128" y="148" text-anchor="middle" font-family="Arial,sans-serif" font-size="110" font-weight="700" fill="white">${letter}</text></svg>`;
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

// =====================================================
// ÍCONES SVG
// =====================================================
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
    const icons = {
        link: `<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.07.07l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15"/><path d="M14 11a5 5 0 0 0-7.07-.07l-2 2A5 5 0 0 0 7 20l1.15-1.15"/></svg>`,
        close: `<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>`
    };
    return icons[type] || icons.link;
}

// =====================================================
// IMAGENS
// =====================================================
async function convertImage(file, options = {}) {
    if (!file) throw new Error("Nenhuma imagem selecionada.");
    if (!file.type || !file.type.startsWith("image/")) throw new Error("Apenas imagens são permitidas.");
    return await imageToBase64(file, options);
}

// =====================================================
// FIREBASE HELPERS
// =====================================================
function databaseRef(path) {
    return ref(rtdb, path);
}
async function safeSet(path, value) {
    return await set(databaseRef(path), value);
}
async function safeUpdate(path, value) {
    return await update(databaseRef(path), value);
}
async function safePush(path, value) {
    return await push(databaseRef(path), value);
}
async function safeGet(path) {
    return await get(databaseRef(path));
}

// =====================================================
// LISTENER HELPERS
// =====================================================
function stopListener(obj) {
    if (!obj) return;
    try {
        off(obj.reference, "value", obj.callback);
    } catch (e) {
        console.warn("Não foi possível remover listener:", e);
    }
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

// =====================================================
// MODAIS
// =====================================================
document.querySelectorAll(".modal-cancel").forEach((btn) => {
    btn.addEventListener("click", closeModals);
});
if (exists("modal-overlay")) {
    $("modal-overlay").addEventListener("click", (e) => {
        if (e.target.id === "modal-overlay") closeModals();
    });
}

// =====================================================
// LOGIN
// =====================================================
window.addEventListener("devcord:signed-in", async (event) => {
    try {
        currentUser = event.detail;
        if (!currentUser?.uid) throw new Error("Usuário inválido.");
        const snap = await safeGet(`users/${currentUser.uid}`);
        userProfile = snap.exists() ? snap.val() : {};
        renderUserCard();
        listenServers();
        listenStickers();
        setPresence(getCurrentPresence());
    } catch (error) {
        console.error(error);
        toast("Erro ao carregar sua conta.");
    }
});

// =====================================================
// USUÁRIO
// =====================================================
function renderUserCard() {
    if (!currentUser) return;
    if (exists("user-card-avatar")) $("user-card-avatar").src = getCurrentPhoto();
    if (exists("user-card-name")) {
        $("user-card-name").textContent = getCurrentDisplayName();
        $("user-card-name").style.fontFamily = userProfile?.nameFont || "Inter";
        $("user-card-name").style.color = getCurrentColor();
    }
    if (exists("user-card-status")) $("user-card-status").textContent = getCurrentStatus();
    if (exists("user-card-status-dot")) {
        const dot = $("user-card-status-dot");
        dot.className = "status-dot status-" + (getCurrentPresence() || "online");
    }
    if (exists("user-card")) $("user-card").dataset.userId = currentUser.uid;
}

// =====================================================
// SERVIDORES
// =====================================================
function listenServers() {
    if (!currentUser) return;
    if (userServersListener) {
        stopListener(userServersListener);
        userServersListener = null;
    }
    const reference = databaseRef(`userServers/${currentUser.uid}`);
    const callback = (snapshot) => {
        const value = snapshot.exists() ? snapshot.val() : {};
        const ids = Object.keys(value);
        cleanupRemovedServers(ids);
        ids.forEach((id) => listenServer(id));
        renderServerList();
    };
    onValue(reference, callback);
    userServersListener = { reference, callback };
}
function cleanupRemovedServers(ids) {
    Object.keys(serverListeners).forEach((id) => {
        if (!ids.includes(id)) {
            stopListener(serverListeners[id]);
            delete serverListeners[id];
            delete serverCache[id];
        }
    });
}
function listenServer(serverId) {
    if (serverListeners[serverId]) return;
    const reference = databaseRef(`servers/${serverId}`);
    const callback = (snapshot) => {
        if (!snapshot.exists()) {
            delete serverCache[serverId];
            renderServerList();
            return;
        }
        serverCache[serverId] = { id: serverId, ...(snapshot.val() || {}) };
        renderServerList();
    };
    onValue(reference, callback);
    serverListeners[serverId] = { reference, callback };
}
function renderServerList() {
    if (!exists("server-list")) return;
    const list = $("server-list");
    list.innerHTML = "";
    Object.values(serverCache).forEach((server) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "server-pill" + (server.id === currentServerId ? " active" : "");
        btn.title = server.name || "";
        if (server.iconURL) {
            const img = document.createElement("img");
            img.src = server.iconURL;
            img.alt = server.name || "";
            img.loading = "lazy";
            btn.appendChild(img);
        } else {
            btn.textContent = safeName(server.name, "DV").slice(0, 2).toUpperCase();
        }
        btn.addEventListener("click", () => selectServer(server.id, server));
        list.appendChild(btn);
    });
}

// =====================================================
// CRIAR / ENTRAR SERVIDOR
// =====================================================
if (exists("add-server-btn")) {
    $("add-server-btn").addEventListener("click", () => {
        const action = prompt("Digite 'criar' para criar um servidor ou cole o ID de um servidor para entrar:");
        if (!action) return;
        const value = action.trim();
        if (value.toLowerCase() === "criar") {
            openModal("modal-create-server");
            return;
        }
        joinServerById(value);
    });
}
async function joinServerById(serverId) {
    if (!currentUser) return;
    try {
        const snap = await safeGet(`servers/${serverId}`);
        if (!snap.exists()) {
            toast("Servidor não encontrado.");
            return;
        }
        await safeSet(`serverMembers/${serverId}/${currentUser.uid}`, true);
        await safeSet(`userServers/${currentUser.uid}/${serverId}`, true);
        toast("Você entrou no servidor.");
    } catch (error) {
        console.error(error);
        toast("Não foi possível entrar: " + error.message);
    }
}
if (exists("confirm-create-server")) {
    $("confirm-create-server").addEventListener("click", async () => {
        if (!currentUser) return;
        const name = $("new-server-name")?.value.trim();
        if (!name) {
            toast("Dê um nome ao servidor.");
            return;
        }
        const file = $("new-server-icon")?.files?.[0];
        try {
            const serverRef = push(databaseRef("servers"));
            const serverId = serverRef.key;
            await set(serverRef, {
                name,
                ownerId: currentUser.uid,
                iconURL: "",
                createdAt: serverTimestamp()
            });
            await safeSet(`serverMembers/${serverId}/${currentUser.uid}`, true);
            await safeSet(`userServers/${currentUser.uid}/${serverId}`, true);
            if (file) {
                try {
                    const base64 = await convertImage(file, { maxWidth: 512, maxHeight: 512, quality: 0.82, maxSizeMB: 5 });
                    await safeUpdate(`servers/${serverId}`, { iconURL: base64 });
                } catch (err) {
                    console.error(err);
                    toast("Servidor criado, mas o ícone falhou.");
                }
            }
            if (exists("new-server-name")) $("new-server-name").value = "";
            if (exists("new-server-icon")) $("new-server-icon").value = "";
            closeModals();
            toast(`Servidor "${name}" criado. ID: ${serverId}`);
            selectServer(serverId, { id: serverId, name });
        } catch (error) {
            console.error(error);
            toast("Erro ao criar servidor: " + error.message);
        }
    });
}

// =====================================================
// SELECIONAR SERVIDOR / HOME
// =====================================================
async function selectServer(serverId, serverData) {
    if (!serverId) return;
    stopMessagesListener();
    stopForumPostsListener();
    stopForumRepliesListener();
    currentServerId = serverId;
    currentChannelId = null;
    currentChannelType = null;
    if (exists("current-server-name")) {
        $("current-server-name").textContent = serverData?.name || serverCache[serverId]?.name || "Servidor";
    }
    if (exists("server-settings-btn")) $("server-settings-btn").classList.remove("hidden");
    renderServerList();
    listenChannels();
}
if (exists("home-pill")) {
    $("home-pill").addEventListener("click", () => {
        stopChannelsListener();
        stopMessagesListener();
        stopForumPostsListener();
        stopForumRepliesListener();
        if (currentChannelType === "voice") leaveVoiceChannel();
        currentServerId = null;
        currentChannelId = null;
        currentChannelType = null;
        if (exists("current-server-name")) $("current-server-name").textContent = "Bem-vindo";
        if (exists("server-settings-btn")) $("server-settings-btn").classList.add("hidden");
        if (exists("channel-groups")) {
            $("channel-groups").innerHTML = '<p class="empty-hint">Crie ou entre em um servidor pra ver os canais aqui.</p>';
        }
        showView(null);
        document.querySelectorAll(".server-pill").forEach((p) => p.classList.remove("active"));
        $("home-pill").classList.add("active");
    });
}
if (exists("server-settings-btn")) {
    $("server-settings-btn").addEventListener("click", () => {
        if (!currentServerId) return;
        const choice = prompt(`ID de convite deste servidor:\n\n${currentServerId}\n\nDigite "canal" para criar um canal novo.`);
        if (choice && choice.trim().toLowerCase() === "canal") {
            openModal("modal-create-channel");
        }
    });
}

// =====================================================
// CANAIS
// =====================================================
function listenChannels() {
    if (!currentServerId) return;
    stopChannelsListener();
    const reference = databaseRef(`channels/${currentServerId}`);
    const callback = (snapshot) => {
        const groups = { text: [], voice: [], forum: [] };
        const value = snapshot.val() || {};
        Object.entries(value)
            .sort((a, b) => normalizeTimestamp(a[1]?.createdAt) - normalizeTimestamp(b[1]?.createdAt))
            .forEach(([id, data]) => {
                if (groups[data?.type]) groups[data.type].push({ id, ...data });
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
    Object.keys(TYPE_LABEL).forEach((type) => {
        const label = document.createElement("div");
        label.className = "channel-group-label";
        const title = document.createElement("span");
        title.textContent = TYPE_LABEL[type];
        label.appendChild(title);
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.textContent = "+";
        addBtn.title = "Criar canal";
        addBtn.addEventListener("click", () => {
            openModal("modal-create-channel");
            if (exists("new-channel-type")) $("new-channel-type").value = type;
        });
        label.appendChild(addBtn);
        root.appendChild(label);
        if (!groups[type].length) {
            const empty = document.createElement("p");
            empty.className = "empty-hint";
            empty.textContent = "Nenhum canal ainda.";
            root.appendChild(empty);
            return;
        }
        groups[type].forEach((channel) => {
            const item = document.createElement("div");
            item.className = "channel-item" + (channel.id === currentChannelId ? " active" : "");
            const icon = document.createElement("span");
            icon.className = "ch-icon";
            icon.innerHTML = channelIcon(type);
            const name = document.createElement("span");
            name.textContent = channel.name || "canal";
            item.appendChild(icon);
            item.appendChild(name);
            item.addEventListener("click", () => selectChannel(channel));
            root.appendChild(item);
        });
    });
}
if (exists("confirm-create-channel")) {
    $("confirm-create-channel").addEventListener("click", async () => {
        if (!currentServerId) {
            toast("Selecione um servidor.");
            return;
        }
        const rawName = $("new-channel-name")?.value.trim();
        const type = $("new-channel-type")?.value;
        if (!rawName) {
            toast("Dê um nome ao canal.");
            return;
        }
        const name = rawName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/gi, "").slice(0, 80);
        if (!name) {
            toast("Nome de canal inválido.");
            return;
        }
        if (!["text", "voice", "forum"].includes(type)) {
            toast("Tipo de canal inválido.");
            return;
        }
        try {
            await safePush(`channels/${currentServerId}`, {
                name,
                type,
                createdAt: serverTimestamp()
            });
            if (exists("new-channel-name")) $("new-channel-name").value = "";
            closeModals();
            toast("Canal criado.");
        } catch (error) {
            console.error(error);
            toast("Erro ao criar canal: " + error.message);
        }
    });
}

// =====================================================
// SELECIONAR CANAL / VIEWS
// =====================================================
function selectChannel(channel) {
    if (!channel?.id) return;
    if (currentChannelType === "voice" && currentChannelId !== channel.id) {
        try { leaveVoiceChannel(); } catch (e) { console.warn(e); }
    }
    stopMessagesListener();
    stopForumPostsListener();
    stopForumRepliesListener();
    currentChannelId = channel.id;
    currentChannelType = channel.type;
    if (exists("channel-title")) {
        const prefix = channel.type === "text" ? "# " : "";
        $("channel-title").textContent = prefix + (channel.name || "canal");
    }
    document.querySelectorAll(".channel-item").forEach((el) => el.classList.remove("active"));
    showView(channel.type);
    if (channel.type === "text") listenMessages();
    if (channel.type === "voice") setupVoiceView(channel);
    if (channel.type === "forum") listenForum();
    if (exists("call-btn")) $("call-btn").classList.toggle("hidden", channel.type !== "voice");
}
function showView(type) {
    ["text", "voice", "forum"].forEach((t) => {
        const el = $("view-" + t);
        if (!el) return;
        el.classList.toggle("hidden", t !== type);
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
    const callback = (snapshot) => {
        if (!exists("messages")) return;
        const root = $("messages");
        root.innerHTML = "";
        const value = snapshot.val() || {};
        Object.entries(value)
            .sort((a, b) => normalizeTimestamp(a[1]?.createdAt) - normalizeTimestamp(b[1]?.createdAt))
            .forEach(([id, msg]) => {
                const el = document.createElement("div");
                el.className = "message";
                el.dataset.userId = msg.uid || "";
                const photo = msg.authorPhoto || createDefaultAvatar(msg.uid || "user");
                const time = normalizeTimestamp(msg.createdAt)
                    ? new Date(normalizeTimestamp(msg.createdAt)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
                    : "";
                let content = escapeHTML(msg.text || "");
                if (msg.image) {
                    content += `<div class="msg-image"><img src="${escapeAttribute(msg.image)}" alt="imagem" loading="lazy"></div>`;
                }
                if (msg.sticker) {
                    content += `<div class="msg-sticker"><img src="${escapeAttribute(msg.sticker)}" alt="figurinha" loading="lazy"></div>`;
                }
                el.innerHTML = `
                    <img class="avatar avatar-sm" src="${escapeAttribute(photo)}" alt="" loading="lazy" data-user-id="${escapeAttribute(msg.uid || "")}">
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
if (exists("message-form")) {
    $("message-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!currentServerId || !currentChannelId || !currentUser) return;
        const input = $("message-input");
        const text = input?.value?.trim() || "";
        if (!text && !pendingFile) return;
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
                payload.image = await convertImage(pendingFile, { maxWidth: 1280, maxHeight: 1280, quality: 0.8, maxSizeMB: 6 });
                pendingFile = null;
                if (exists("attach-preview")) {
                    $("attach-preview").classList.add("hidden");
                    $("attach-preview").innerHTML = "";
                }
                if (exists("file-input")) $("file-input").value = "";
            }
            await safePush(`messages/${currentServerId}/${currentChannelId}`, payload);
            if (input) input.value = "";
        } catch (error) {
            console.error(error);
            toast("Erro ao enviar mensagem: " + error.message);
        }
    });
}
if (exists("attach-btn") && exists("file-input")) {
    $("attach-btn").addEventListener("click", () => $("file-input").click());
    $("file-input").addEventListener("change", (e) => {
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
            $("attach-preview").innerHTML = `<img src="${url}" alt="preview"><button type="button" id="clear-attach">×</button>`;
            $("attach-preview").classList.remove("hidden");
            $("clear-attach")?.addEventListener("click", () => {
                pendingFile = null;
                $("file-input").value = "";
                $("attach-preview").classList.add("hidden");
                $("attach-preview").innerHTML = "";
            });
        }
    });
}

// =====================================================
// STICKERS (upload Base64)
// =====================================================
function listenStickers() {
    if (!currentUser) return;
    stopStickersListener();
    const reference = databaseRef(`stickers/${currentUser.uid}`);
    const callback = (snapshot) => {
        renderStickerGrid(snapshot.val() || {});
    };
    onValue(reference, callback);
    stickersListener = { reference, callback };
}
function renderStickerGrid(data) {
    const grid = $("sticker-grid");
    if (!grid) return;
    grid.innerHTML = "";
    const entries = Object.entries(data);
    if (!entries.length) {
        grid.innerHTML = '<p class="empty-hint" style="grid-column:1/-1">Nenhuma figurinha ainda. Clique no + para adicionar.</p>';
        return;
    }
    entries.forEach(([id, sticker]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        const img = document.createElement("img");
        img.src = sticker.url || sticker;
        img.alt = "figurinha";
        img.loading = "lazy";
        btn.appendChild(img);
        btn.addEventListener("click", async () => {
            if (!currentServerId || !currentChannelId) return;
            try {
                await safePush(`messages/${currentServerId}/${currentChannelId}`, {
                    uid: currentUser.uid,
                    authorName: getCurrentDisplayName(),
                    authorPhoto: userProfile?.photoURL || "",
                    authorColor: getCurrentColor(),
                    authorFont: userProfile?.nameFont || "Inter",
                    sticker: sticker.url || sticker,
                    text: "",
                    createdAt: serverTimestamp()
                });
                $("sticker-picker")?.classList.add("hidden");
            } catch (err) {
                console.error(err);
                toast("Erro ao enviar figurinha.");
            }
        });
        grid.appendChild(btn);
    });
}
if (exists("sticker-btn") && exists("sticker-picker")) {
    $("sticker-btn").addEventListener("click", () => {
        $("sticker-picker").classList.toggle("hidden");
    });
}
if (exists("sticker-upload-input")) {
    $("sticker-upload-input").addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (!file || !file.type.startsWith("image/")) {
            toast("Apenas imagens.");
            e.target.value = "";
            return;
        }
        if (!currentUser) return;
        try {
            const base64 = await convertImage(file, { maxWidth: 256, maxHeight: 256, quality: 0.85, maxSizeMB: 2 });
            await safePush(`stickers/${currentUser.uid}`, {
                url: base64,
                createdAt: serverTimestamp()
            });
            toast("Figurinha adicionada.");
            e.target.value = "";
        } catch (err) {
            console.error(err);
            toast("Erro ao adicionar figurinha: " + err.message);
        }
    });
}

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
            const timestamp = normalizeTimestamp(post?.createdAt);
            const time = timestamp ? new Date(timestamp).toLocaleString("pt-BR") : "";
            const authorPhoto = post?.authorPhoto || createDefaultAvatar(post?.uid || "user");
            const body = String(post?.body || "");
            card.innerHTML = `
                <div class="forum-post-author">
                    <img class="avatar avatar-sm" src="${escapeAttribute(authorPhoto)}" alt="" loading="lazy">
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
        if (!entries.length) {
            root.innerHTML = '<p class="empty-hint">Nenhum tópico ainda. Crie o primeiro.</p>';
        }
    };
    onValue(reference, callback);
    forumPostsListener = { reference, callback };
}
function openThread(postId, post) {
    if (!currentServerId || !currentChannelId || !postId) return;
    if (exists("forum-posts")) $("forum-posts").classList.add("hidden");
    if (exists("forum-thread")) $("forum-thread").classList.remove("hidden");
    const timestamp = normalizeTimestamp(post?.createdAt);
    const time = timestamp ? new Date(timestamp).toLocaleString("pt-BR") : "";
    const authorPhoto = post?.authorPhoto || createDefaultAvatar(post?.uid || "user");
    if (exists("forum-thread-content")) {
        $("forum-thread-content").innerHTML = `
            <div class="thread-author">
                <img class="avatar avatar-sm" src="${escapeAttribute(authorPhoto)}" alt="">
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
        const value = snapshot.val() || {};
        Object.values(value)
            .sort((a, b) => normalizeTimestamp(a?.createdAt) - normalizeTimestamp(b?.createdAt))
            .forEach((reply) => {
                const el = document.createElement("div");
                el.className = "thread-reply";
                const replyPhoto = reply?.authorPhoto || createDefaultAvatar(reply?.uid || "user");
                el.innerHTML = `
                    <div style="display:flex;gap:9px;align-items:flex-start">
                        <img class="avatar avatar-sm" src="${escapeAttribute(replyPhoto)}" alt="" loading="lazy">
                        <div>
                            <div><strong>${escapeHTML(reply?.authorName || "Usuário")}</strong></div>
                            <div>${escapeHTML(reply?.text || "")}</div>
                        </div>
                    </div>`;
                box.appendChild(el);
            });
    };
    onValue(reference, callback);
    forumRepliesListener = { reference, callback };
    const replyForm = $("reply-form");
    if (replyForm) {
        replyForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const input = $("reply-input");
            const text = input?.value?.trim() || "";
            if (!text) return;
            try {
                await safePush(repliesPath, {
                    uid: currentUser.uid,
                    authorName: getCurrentDisplayName(),
                    authorPhoto: userProfile?.photoURL || "",
                    text,
                    createdAt: serverTimestamp()
                });
                input.value = "";
            } catch (error) {
                console.error(error);
                toast("Não foi possível responder.");
            }
        });
    }
}
if (exists("new-post-btn")) {
    $("new-post-btn").addEventListener("click", () => {
        if (currentChannelType !== "forum") {
            toast("Abra um canal de fórum primeiro.");
            return;
        }
        openModal("modal-new-post");
    });
}
if (exists("back-to-forum")) {
    $("back-to-forum").addEventListener("click", () => {
        stopForumRepliesListener();
        if (exists("forum-thread")) $("forum-thread").classList.add("hidden");
        if (exists("forum-posts")) $("forum-posts").classList.remove("hidden");
    });
}
if (exists("confirm-new-post")) {
    $("confirm-new-post").addEventListener("click", async () => {
        if (!currentServerId || !currentChannelId) {
            toast("Selecione um fórum.");
            return;
        }
        const title = $("new-post-title")?.value?.trim();
        const body = $("new-post-body")?.value?.trim();
        if (!title || !body) {
            toast("Preencha título e conteúdo.");
            return;
        }
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
        } catch (error) {
            console.error(error);
            toast("Erro ao criar tópico: " + error.message);
        }
    });
}

// =====================================================
// VOZ
// =====================================================
function setupVoiceView(channel) {
    if (exists("voice-channel-name")) $("voice-channel-name").textContent = channel?.name || "Canal de voz";
    if (exists("join-voice-btn")) $("join-voice-btn").classList.remove("hidden");
    if (exists("leave-voice-btn")) $("leave-voice-btn").classList.add("hidden");
    if (exists("toggle-mic-btn")) $("toggle-mic-btn").classList.add("hidden");
    if (exists("toggle-cam-btn")) $("toggle-cam-btn").classList.add("hidden");
    if (exists("video-grid")) $("video-grid").innerHTML = "";
}
if (exists("join-voice-btn")) {
    $("join-voice-btn").addEventListener("click", async () => {
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
        } catch (error) {
            console.error(error);
            toast("Não foi possível acessar microfone/câmera: " + error.message);
        }
    });
}
if (exists("leave-voice-btn")) {
    $("leave-voice-btn").addEventListener("click", () => {
        try { leaveVoiceChannel(); } catch (e) { console.warn(e); }
        $("join-voice-btn")?.classList.remove("hidden");
        $("leave-voice-btn")?.classList.add("hidden");
        $("toggle-mic-btn")?.classList.add("hidden");
        $("toggle-cam-btn")?.classList.add("hidden");
    });
}
if (exists("toggle-mic-btn")) {
    $("toggle-mic-btn").addEventListener("click", (event) => {
        try {
            const enabled = window.devcordToggleMic?.();
            event.currentTarget.classList.toggle("disabled", enabled === false);
        } catch (e) { console.warn(e); }
    });
}
if (exists("toggle-cam-btn")) {
    $("toggle-cam-btn").addEventListener("click", (event) => {
        try {
            const enabled = window.devcordToggleCam?.();
            event.currentTarget.classList.toggle("disabled", enabled === false);
        } catch (e) { console.warn(e); }
    });
}

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
        const banner = userProfile.bannerURL;
        $("profile-banner-preview").style.background = banner
            ? `url("${escapeAttribute(banner)}") center/cover`
            : "linear-gradient(135deg,var(--accent-dim),var(--bg-3))";
    }
}
if (exists("open-profile-btn")) {
    $("open-profile-btn").addEventListener("click", () => {
        loadProfileFields();
        openModal("modal-profile");
    });
}
if (exists("profile-avatar-input")) {
    $("profile-avatar-input").addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (file && !file.type.startsWith("image/")) {
            toast("O avatar precisa ser uma imagem.");
            e.target.value = "";
            newAvatarFile = null;
            return;
        }
        newAvatarFile = file || null;
        if (newAvatarFile && exists("profile-avatar-preview")) {
            $("profile-avatar-preview").src = URL.createObjectURL(newAvatarFile);
        }
    });
}
if (exists("profile-banner-input")) {
    $("profile-banner-input").addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (file && !file.type.startsWith("image/")) {
            toast("O banner precisa ser uma imagem.");
            e.target.value = "";
            newBannerFile = null;
            return;
        }
        newBannerFile = file || null;
        if (newBannerFile && exists("profile-banner-preview")) {
            $("profile-banner-preview").style.background = `url("${URL.createObjectURL(newBannerFile)}") center/cover`;
        }
    });
}
if (exists("profile-avatar-url-input")) {
    $("profile-avatar-url-input").addEventListener("input", (e) => {
        const url = e.target.value.trim();
        if (url && exists("profile-avatar-preview")) $("profile-avatar-preview").src = url;
    });
}
if (exists("profile-banner-url-input")) {
    $("profile-banner-url-input").addEventListener("input", (e) => {
        const url = e.target.value.trim();
        if (!exists("profile-banner-preview")) return;
        $("profile-banner-preview").style.background = url
            ? `url("${escapeAttribute(url)}") center/cover`
            : "linear-gradient(135deg,var(--accent-dim),var(--bg-3))";
    });
}
if (exists("confirm-profile")) {
    $("confirm-profile").addEventListener("click", async () => {
        if (!currentUser) return;
        const displayName = $("profile-name-input")?.value?.trim().slice(0, 32) || userProfile?.displayName || "Usuário";
        const avatarURL = $("profile-avatar-url-input")?.value?.trim() || "";
        const bannerURL = $("profile-banner-url-input")?.value?.trim() || "";
        const updates = {
            displayName,
            bio: $("profile-bio-input")?.value?.trim().slice(0, 190) || "",
            accentColor: $("profile-color-input")?.value || "#5ee6c4",
            nameFont: $("profile-font-input")?.value || "Inter",
            socialLinks: $("profile-social-input")?.value?.trim().slice(0, 500) || "",
            customStatus: $("profile-status-input")?.value?.trim().slice(0, 32) || "",
            presence: $("profile-presence-input")?.value || "online"
        };
        try {
            if (newAvatarFile) {
                updates.photoURL = await convertImage(newAvatarFile, { maxWidth: 512, maxHeight: 512, quality: 0.82, maxSizeMB: 5 });
            } else if (avatarURL) {
                updates.photoURL = avatarURL;
            }
            if (newBannerFile) {
                updates.bannerURL = await convertImage(newBannerFile, { maxWidth: 1920, maxHeight: 1080, quality: 0.78, maxSizeMB: 8 });
            } else if (bannerURL) {
                updates.bannerURL = bannerURL;
            }
            await safeUpdate(`users/${currentUser.uid}`, updates);
            await updateProfile(currentUser, { displayName: updates.displayName });
            userProfile = { ...userProfile, ...updates };
            newAvatarFile = null;
            newBannerFile = null;
            renderUserCard();
            closeModals();
            toast("Perfil atualizado.");
        } catch (error) {
            console.error(error);
            toast("Falha ao salvar perfil: " + error.message);
        }
    });
}

// =====================================================
// PERFIL PÚBLICO
// =====================================================
function renderPublicProfile(profile, uid) {
    if (!exists("modal-public-profile")) return;
    const data = profile || {};
    const avatar = data.photoURL || createDefaultAvatar(uid || "user");
    const banner = data.bannerURL || "";
    const name = safeName(data.displayName, "Usuário");
    const status = safeName(data.customStatus, "Online");
    const bio = String(data.bio || "");
    const color = data.accentColor || "#5ee6c4";
    const font = data.nameFont || "Inter";
    const social = String(data.socialLinks || "");
    if (exists("public-profile-banner")) {
        $("public-profile-banner").style.backgroundImage = banner ? `url("${escapeAttribute(banner)}")` : "";
    }
    if (exists("public-profile-avatar")) $("public-profile-avatar").src = avatar;
    if (exists("public-profile-name")) {
        $("public-profile-name").textContent = name;
        $("public-profile-name").style.color = color;
        $("public-profile-name").style.fontFamily = font;
    }
    if (exists("public-profile-status")) $("public-profile-status").textContent = status;
    if (exists("public-profile-bio")) $("public-profile-bio").textContent = bio || "Sem biografia.";
    if (exists("public-profile-socials")) {
        const container = $("public-profile-socials");
        container.innerHTML = "";
        social.split(/\n|,/).map((v) => v.trim()).filter(Boolean).forEach((url) => {
            const normalized = normalizeURL(url);
            if (!normalized) return;
            const link = document.createElement("a");
            link.href = normalized;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.className = "profile-social-link";
            link.innerHTML = `${svgIcon("link")} <span>${escapeHTML(getURLLabel(normalized))}</span>`;
            container.appendChild(link);
        });
    }
    openModal("modal-public-profile");
}
document.addEventListener("click", async (event) => {
    const el = event.target.closest("[data-user-id]");
    if (!el) return;
    const uid = el.dataset.userId;
    if (!uid) return;
    try {
        const snap = await safeGet(`users/${uid}`);
        renderPublicProfile(snap.exists() ? snap.val() : {}, uid);
    } catch (error) {
        console.error(error);
        toast("Não foi possível abrir o perfil.");
    }
});

// =====================================================
// LOGOUT
// =====================================================
if (exists("logout-btn")) {
    $("logout-btn").addEventListener("click", async () => {
        try { leaveVoiceChannel(); } catch (e) { console.warn(e); }
        stopChannelsListener();
        stopMessagesListener();
        stopForumPostsListener();
        stopForumRepliesListener();
        stopStickersListener();
        if (userServersListener) {
            stopListener(userServersListener);
            userServersListener = null;
        }
        Object.keys(serverListeners).forEach((id) => {
            stopListener(serverListeners[id]);
            delete serverListeners[id];
        });
        Object.keys(serverCache).forEach((id) => delete serverCache[id]);
        currentUser = null;
        userProfile = null;
        currentServerId = null;
        currentChannelId = null;
        currentChannelType = null;
        pendingFile = null;
        newAvatarFile = null;
        newBannerFile = null;
        await signOut(auth);
        closeModals();
    });
}

// =====================================================
// PRESENÇA + TECLAS + LIMPEZA
// =====================================================
function setPresence(status) {
    if (!currentUser) return;
    safeUpdate(`users/${currentUser.uid}`, { presence: status, lastSeen: Date.now() })
        .catch((err) => console.warn("Presence:", err));
}
window.addEventListener("focus", () => setPresence(getCurrentPresence() || "online"));
window.addEventListener("blur", () => {
    if (getCurrentPresence() === "online") setPresence("idle");
});
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        setPresence(getCurrentPresence() || "online");
    } else if (getCurrentPresence() === "online") {
        setPresence("idle");
    }
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeModals();
        $("sticker-picker")?.classList.add("hidden");
    }
});
document.addEventListener("click", (event) => {
    const picker = $("sticker-picker");
    const button = $("sticker-btn");
    if (!picker || !button) return;
    if (!picker.contains(event.target) && !button.contains(event.target)) {
        picker.classList.add("hidden");
    }
});
window.addEventListener("beforeunload", () => {
    try { leaveVoiceChannel(); } catch (e) {}
});

// =====================================================
// EXPORTS + INIT
// =====================================================
window.DevCord = {
    getCurrentUser: () => currentUser,
    getCurrentProfile: () => userProfile,
    getCurrentServer: () => currentServerId,
    getCurrentChannel: () => currentChannelId,
    openProfile: (uid) => {
        if (!uid) return;
        safeGet(`users/${uid}`).then((snap) => {
            renderPublicProfile(snap.exists() ? snap.val() : {}, uid);
        }).catch((err) => {
            console.error(err);
            toast("Erro ao abrir perfil.");
        });
    },
    closeModals,
    toast
};

(function init() {
    console.log("%cDevCord carregado.", "font-weight:700");
    showView(null);
    $("sticker-picker")?.classList.add("hidden");
    $("home-pill")?.classList.add("active");
})();

window.addEventListener("error", (e) => console.error("[DevCord Error]", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => console.error("[DevCord Promise Error]", e.reason));
