// app.js — Union Chat (COMPLETO)
import {
    auth, rtdb, signOut, updateProfile, serverTimestamp
} from "./firebase-config.js";
import {
    ref, push, set, update, remove, get, onValue, off, query, orderByChild, startAt, endAt, limitToFirst
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
let pendingInviteId = null;

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

function getCurrentDisplayName(withClan = false) {
    const name = safeName(userProfile?.displayName);
    if (withClan && userProfile?.clanTag) return `${userProfile.clanTag} ${name}`;
    return name;
}
function getCurrentName() {
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
    // GIF: preserva animação (canvas mata o GIF)
    if (file.type === "image/gif") {
        return fileToDataURL(file);
    }
    return imageToBase64(file, opts);
}

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
        reader.readAsDataURL(file);
    });
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
        try { applyAppearance(userProfile?.appearance); } catch {}
        listenServers();
        listenStickers();
        setPresence(getCurrentPresence());
        applyTheme(localStorage.getItem("uc-theme") || "dark");
        checkInviteFromURL();
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
        $("user-card-name").innerHTML = escapeHTML(getCurrentDisplayName(false)) + clanTagHTML(userProfile);
        $("user-card-name").style.fontFamily = userProfile?.nameFont || "Inter";
        $("user-card-name").style.color = getCurrentColor();
        $("user-card-name").dataset.userId = currentUser.uid;
    }
    if (exists("user-card-status")) $("user-card-status").textContent = userProfile?.customStatus || "Online";
    if (exists("user-card-status-dot")) {
        $("user-card-status-dot").className = "status-dot status-" + getCurrentPresence();
    }
    if (exists("user-card")) {
        $("user-card").dataset.userId = currentUser.uid;
        const wrap = $("user-card")?.querySelector(".user-card-avatar-wrap");
        if (wrap) wrap.dataset.userId = currentUser.uid;
    }
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

// + abre modal
$("add-server-btn")?.addEventListener("click", () => {
    openModal("modal-create-server");
});

$("join-server-id-btn")?.addEventListener("click", () => {
    const id = prompt("Cole o ID do servidor:");
    if (id) joinServerById(id.trim());
});

async function joinServerById(id) {
    if (!currentUser) return;
    try {
        const snap = await safeGet(`servers/${id}`);
        if (!snap.exists()) return toast("Servidor não encontrado.");
        await safeSet(`serverMembers/${id}/${currentUser.uid}`, true);
        await safeSet(`userServers/${currentUser.uid}/${id}`, true);
        toast("Entrou no servidor.");
        closeModals();
        selectServer(id, { id, ...snap.val() });
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
        const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);
        await set(sRef, {
            name,
            slug,
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
        toast(`Servidor criado!`);
        selectServer(id, { id, name, ownerId: currentUser.uid });
    } catch (e) {
        toast("Erro: " + e.message);
    }
});

// =====================================================
// SELECT SERVER / HOME
// =====================================================
async function selectServer(id, data) {
    stopMessagesListener();
    stopForumPostsListener();
    stopForumRepliesListener();
    currentServerId = id;
    currentChannelId = null;
    currentChannelType = null;

    const server = data || serverCache[id];
    if (exists("current-server-name")) {
        $("current-server-name").textContent = server?.name || "Servidor";
    }

    // Todos veem a engrenagem; conteúdo muda por permissão
    $("server-settings-btn")?.classList.remove("hidden");
    $("header-server-settings-btn")?.classList.remove("hidden");

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
    $("header-server-settings-btn")?.classList.add("hidden");
    if (exists("channel-groups")) {
        $("channel-groups").innerHTML = '<p class="empty-hint">Crie ou entre em um servidor para ver os canais aqui.</p>';
    }
    showView(null);
    document.querySelectorAll(".server-pill").forEach(p => p.classList.remove("active"));
    $("home-pill")?.classList.add("active");
});

// =====================================================
// DESCOBRIR SERVIDORES
// =====================================================
$("discover-btn")?.addEventListener("click", () => {
    showView("discover");
    loadDiscoverServers();
});

async function loadDiscoverServers(search = "") {
    const list = $("discover-list");
    if (!list) return;
    list.innerHTML = "<p class='empty-hint'>Carregando...</p>";
    try {
        const snap = await safeGet("servers");
        if (!snap.exists()) {
            list.innerHTML = "<p class='empty-hint'>Nenhum servidor encontrado.</p>";
            return;
        }
        let servers = Object.entries(snap.val())
            .map(([id, s]) => ({ id, ...s }))
            .filter(s => !s.deleted);
        if (search) {
            const q = search.toLowerCase();
            servers = servers.filter(s =>
                (s.name || "").toLowerCase().includes(q) ||
                (s.description || "").toLowerCase().includes(q) ||
                (Array.isArray(s.tags) ? s.tags.join(" ") : "").toLowerCase().includes(q)
            );
        }
        list.innerHTML = "";
        if (!servers.length) {
            list.innerHTML = "<p class='empty-hint'>Nenhum servidor encontrado.</p>";
            return;
        }
        servers.slice(0, 50).forEach(server => {
            const tags = Array.isArray(server.tags) ? server.tags : [];
            const card = document.createElement("div");
            card.className = "discover-card";
            card.innerHTML = `
                <img class="discover-icon" src="${escapeAttribute(server.iconURL || createDefaultAvatar(server.name))}" alt="">
                <div class="discover-info">
                    <strong>${escapeHTML(server.name || "Servidor")}${server.nsfw ? ' <span class="role-badge">18+</span>' : ""}</strong>
                    <span class="meta">${escapeHTML((server.description || server.slug || server.id || "").slice(0, 80))}</span>
                    <div class="tags-list" style="margin-top:6px">${tags.map(t => `<span class="tag">${escapeHTML(t)}</span>`).join("")}</div>
                </div>
                <button type="button" class="btn-primary btn-sm" data-join="${server.id}">Entrar</button>
            `;
            list.appendChild(card);
        });
        list.querySelectorAll("[data-join]").forEach(btn => {
            btn.addEventListener("click", () => joinServerById(btn.dataset.join));
        });
    } catch {
        list.innerHTML = "<p class='empty-hint'>Erro ao carregar.</p>";
    }
}

$("discover-search")?.addEventListener("input", (e) => {
    loadDiscoverServers(e.target.value.trim());
});

// =====================================================
// SERVER SETTINGS
// =====================================================
function bindServerSettingsBtn(btn) {
    btn?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!currentServerId) {
            toast("Selecione um servidor primeiro.");
            return;
        }
        openServerSettings();
    });
}
bindServerSettingsBtn($("server-settings-btn"));
bindServerSettingsBtn($("header-server-settings-btn"));

async function openServerSettings() {
    showView("server-settings");
    let server = serverCache[currentServerId];
    if (!server) {
        try {
            const snap = await safeGet(`servers/${currentServerId}`);
            if (snap.exists()) {
                server = { id: currentServerId, ...snap.val() };
                serverCache[currentServerId] = server;
            }
        } catch (_) {}
    }
    if (!server) {
        toast("Não foi possível carregar o servidor.");
        return;
    }
    if (exists("server-name-edit")) $("server-name-edit").value = server.name || "";
    if (exists("server-desc-edit")) $("server-desc-edit").value = server.description || "";
    if (exists("server-icon-url")) $("server-icon-url").value = server.iconURL?.startsWith("http") ? server.iconURL : "";
    if (exists("server-banner-url")) $("server-banner-url").value = server.bannerURL?.startsWith("http") ? server.bannerURL : "";
    if (exists("server-tags-edit")) $("server-tags-edit").value = Array.isArray(server.tags) ? server.tags.join(", ") : (server.tags || "");
    if (exists("server-slug-edit")) $("server-slug-edit").value = server.slug || "";
    if (exists("server-verification-edit")) $("server-verification-edit").value = server.verificationLevel || "none";
    if (exists("server-nsfw-edit")) $("server-nsfw-edit").checked = !!server.nsfw;
    renderServerTagsPreview(server.tags);
    if (exists("server-invite-link")) {
        const slug = server.slug || currentServerId;
        $("server-invite-link").value = `https://exdowner.github.io/Union/?invite=${slug}`;
    }
    if (exists("server-icon-preview")) {
        $("server-icon-preview").src = server.iconURL || createDefaultAvatar(server.name);
    }
    if (exists("server-banner-preview")) {
        $("server-banner-preview").style.background = server.bannerURL
            ? `url("${escapeAttribute(server.bannerURL)}") center/cover`
            : "linear-gradient(135deg,var(--accent-dim),var(--bg-3))";
    }
    const isOwner = server.ownerId === currentUser?.uid;
    // canEdit async filled below
    applyServerSettingsPermissions(server, isOwner);
}

async function applyServerSettingsPermissions(server, isOwner) {
    const isAdmin = isOwner || await userHasAdminPower(currentServerId, currentUser?.uid);
    $("delete-server-btn")?.classList.toggle("hidden", !isOwner);
    const tabs = document.querySelectorAll(".settings-tab");
    tabs.forEach(t => {
        const id = t.dataset.stab;
        if (!isAdmin && id !== "overview") t.classList.add("hidden");
        else t.classList.remove("hidden");
    });
    // member overview: show info only
    ["roles", "emojis", "servertags", "members", "bans"].forEach(p => {
        if (!isAdmin) $(`stab-${p}`)?.classList.add("hidden");
    });
    [
        "server-name-edit", "server-desc-edit", "server-icon-edit", "server-banner-edit",
        "server-icon-url", "server-banner-url", "server-tags-edit", "server-slug-edit",
        "server-verification-edit", "server-nsfw-edit", "save-server-overview", "create-role-btn",
        "server-tag-text", "server-tag-file", "server-tag-url", "save-server-tag-btn",
        "server-emoji-file", "server-emoji-name", "server-emoji-url-btn"
    ].forEach(id => {
        const el = $(id);
        if (el) el.disabled = !isAdmin;
    });
    // hide save/delete for members
    $("save-server-overview")?.classList.toggle("hidden", !isAdmin);
    document.querySelectorAll(".upload-label").forEach(l => {
        if (l.closest("#stab-overview") || l.closest("#stab-emojis") || l.closest("#stab-servertags")) {
            l.style.display = isAdmin ? "" : "none";
        }
    });
    if (exists("server-settings-hint")) {
        $("server-settings-hint").textContent = isOwner
            ? "Você é o dono — pode editar tudo."
            : (isAdmin ? "Você tem cargo de administrador." : "Visualização do servidor (somente leitura).");
    }
}

function renderServerTagsPreview(tags) {
    const box = $("server-tags-preview");
    if (!box) return;
    const list = Array.isArray(tags)
        ? tags
        : String(tags || "").split(",").map(t => t.trim()).filter(Boolean);
    box.innerHTML = list.map(t => `<span class="tag">${escapeHTML(t)}</span>`).join("");
}

$("back-from-server-settings")?.addEventListener("click", () => {
    showView(null);
    if (currentServerId) listenChannels();
});

$("save-server-overview")?.addEventListener("click", async () => {
    if (!currentServerId || !currentUser) return;
    const server = serverCache[currentServerId];
    if (!server || server.ownerId !== currentUser.uid) return toast("Sem permissão.");

    const name = ($("server-name-edit")?.value || "").trim();
    if (!name) return toast("Nome obrigatório.");

    const tagsRaw = ($("server-tags-edit")?.value || "").trim();
    const tags = tagsRaw
        ? tagsRaw.split(",").map(t => t.trim().toLowerCase().slice(0, 24)).filter(Boolean).slice(0, 8)
        : [];

    let slug = ($("server-slug-edit")?.value || "").trim().toLowerCase()
        .replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);
    if (!slug) slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);

    const updates = {
        name,
        description: ($("server-desc-edit")?.value || "").trim().slice(0, 300),
        tags,
        slug,
        verificationLevel: $("server-verification-edit")?.value || "none",
        nsfw: !!$("server-nsfw-edit")?.checked
    };

    const iconFile = $("server-icon-edit")?.files?.[0];
    const bannerFile = $("server-banner-edit")?.files?.[0];
    const iconUrl = normalizeURL(($("server-icon-url")?.value || "").trim());
    const bannerUrl = normalizeURL(($("server-banner-url")?.value || "").trim());

    try {
        if (window.__pendingServerIcon) {
            updates.iconURL = window.__pendingServerIcon;
            window.__pendingServerIcon = null;
        } else if (iconFile) {
            updates.iconURL = iconFile.type === "image/gif"
                ? await fileToDataURL(iconFile)
                : await convertImage(iconFile, { maxWidth: 512, maxHeight: 512, quality: 0.82 });
        } else if (iconUrl) {
            updates.iconURL = iconUrl;
        }

        if (bannerFile) {
            updates.bannerURL = bannerFile.type === "image/gif"
                ? await fileToDataURL(bannerFile)
                : await convertImage(bannerFile, { maxWidth: 1920, maxHeight: 400, quality: 0.8 });
        } else if (bannerUrl) {
            updates.bannerURL = bannerUrl;
        }

        await safeUpdate(`servers/${currentServerId}`, updates);
        serverCache[currentServerId] = { ...server, ...updates, id: currentServerId };
        toast("Servidor atualizado.");
        if (exists("current-server-name")) $("current-server-name").textContent = name;
        if (exists("server-invite-link")) {
            $("server-invite-link").value = `https://exdowner.github.io/Union/?invite=${slug}`;
        }
        renderServerTagsPreview(tags);
        renderServerList();
    } catch (err) {
        console.error(err);
        toast("Erro ao salvar: " + (err.message || err.code || "permission denied"));
    }
});

$("server-tags-edit")?.addEventListener("input", (e) => {
    renderServerTagsPreview(e.target.value);
});

$("server-icon-url")?.addEventListener("input", (e) => {
    const url = normalizeURL(e.target.value.trim()) || e.target.value.trim();
    if (url && exists("server-icon-preview")) $("server-icon-preview").src = url;
});

$("server-banner-url")?.addEventListener("input", (e) => {
    const url = normalizeURL(e.target.value.trim()) || e.target.value.trim();
    if (exists("server-banner-preview")) {
        $("server-banner-preview").style.backgroundImage = url ? `url("${escapeAttribute(url)}")` : "";
        $("server-banner-preview").style.backgroundSize = "cover";
    }
});

$("server-icon-edit")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (typeof openImageCropper === "function") {
        openImageCropper(f, async (dataUrl) => {
            if (!dataUrl) return;
            if (exists("server-icon-preview")) $("server-icon-preview").src = dataUrl;
            window.__pendingServerIcon = dataUrl;
            toast("Ícone ajustado. Clique em Salvar.");
        });
    } else if (exists("server-icon-preview")) {
        $("server-icon-preview").src = URL.createObjectURL(f);
    }
});

$("server-banner-edit")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f && exists("server-banner-preview")) {
        $("server-banner-preview").style.backgroundImage = `url("${URL.createObjectURL(f)}")`;
        $("server-banner-preview").style.backgroundSize = "cover";
    }
});

$("delete-server-btn")?.addEventListener("click", async () => {
    if (!currentServerId || !currentUser) return;
    const server = serverCache[currentServerId];
    if (!server || server.ownerId !== currentUser.uid) return toast("Só o dono pode excluir.");
    if (!confirm(`Excluir o servidor "${server.name}" permanentemente?`)) return;

    const sid = currentServerId;
    const errors = [];
    try {
        // Remove vínculo do usuário primeiro (quase sempre permitido)
        try { await remove(databaseRef(`userServers/${currentUser.uid}/${sid}`)); }
        catch (e) { errors.push("userServers: " + e.message); }

        try { await remove(databaseRef(`serverMembers/${sid}`)); }
        catch (e) { errors.push("members: " + e.message); }

        try { await remove(databaseRef(`channels/${sid}`)); }
        catch (e) { errors.push("channels: " + e.message); }

        try { await remove(databaseRef(`messages/${sid}`)); }
        catch (e) { /* opcional */ }

        try { await remove(databaseRef(`servers/${sid}`)); }
        catch (e) {
            // Fallback: marca como deletado se a rule bloquear remove
            try {
                await safeUpdate(`servers/${sid}`, { deleted: true, name: "[deletado]", ownerId: server.ownerId });
            } catch (e2) {
                errors.push("servers: " + e.message);
            }
        }

        delete serverCache[sid];
        currentServerId = null;
        currentChannelId = null;
        toast(errors.length ? ("Parcial: " + errors.join(" | ")) : "Servidor excluído.");
        showView(null);
        $("home-pill")?.click();
        renderServerList();
    } catch (err) {
        toast("Erro ao excluir: " + (err.message || err.code || "permission-denied"));
        console.error(err);
    }
});

document.querySelectorAll(".settings-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".settings-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const id = tab.dataset.stab;
        ["overview", "roles", "emojis", "servertags", "members", "bans"].forEach(p => {
            $(`stab-${p}`)?.classList.toggle("hidden", p !== id);
        });
        if (id === "members") loadMembers();
        if (id === "roles") loadRoles();
        if (id === "emojis") loadServerEmojis();
        if (id === "servertags") loadServerTagEditor();
        if (id === "bans") loadBans();
    });
});

async function loadMembers() {
    const list = $("members-list");
    if (!list || !currentServerId) return;
    list.innerHTML = "<p class='empty-hint'>Carregando...</p>";
    const server = serverCache[currentServerId];
    const isOwner = server?.ownerId === currentUser?.uid;
    try {
        const snap = await safeGet(`serverMembers/${currentServerId}`);
        const members = snap.exists() ? Object.entries(snap.val()) : [];
        const rolesSnap = await safeGet(`servers/${currentServerId}/roles`);
        const roles = rolesSnap.exists() ? Object.entries(rolesSnap.val()) : [];
        list.innerHTML = "";
        for (const [uid, raw] of members) {
            const uSnap = await safeGet(`users/${uid}`);
            const u = uSnap.exists() ? uSnap.val() : {};
            const memberRoles = (raw && typeof raw === "object" && raw.roles) ? raw.roles : [];
            const div = document.createElement("div");
            div.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);flex-wrap:wrap";
            let roleSelect = "";
            if (isOwner && uid !== server.ownerId) {
                roleSelect = `<select data-assign-role="${uid}" style="max-width:140px;padding:6px 8px;font-size:12px">
                    <option value="">Sem cargo</option>
                    ${roles.map(([rid, r]) => `<option value="${rid}" ${memberRoles.includes(rid) ? "selected" : ""}>${escapeHTML(r.name || "Cargo")}</option>`).join("")}
                </select>`;
            }
            const roleNames = roles.filter(([rid]) => memberRoles.includes(rid)).map(([, r]) => r.name).join(", ");
            div.innerHTML = `
                <img class="avatar avatar-sm" src="${escapeAttribute(u.photoURL || createDefaultAvatar(uid))}" alt="">
                <span style="flex:1;min-width:80px">${escapeHTML(u.displayName || "Usuário")}${uid === server?.ownerId ? " 👑" : ""}${roleNames ? ` <span class="role-badge">${escapeHTML(roleNames)}</span>` : ""}</span>
                ${roleSelect}
                ${isOwner && uid !== currentUser.uid ? `<button type="button" class="btn-secondary" data-kick="${uid}" style="padding:4px 10px;font-size:12px">Remover</button>` : ""}
            `;
            list.appendChild(div);
        }
        if (!members.length) list.innerHTML = "<p class='empty-hint'>Nenhum membro.</p>";

        list.querySelectorAll("[data-kick]").forEach(btn => {
            btn.addEventListener("click", async () => {
                const uid = btn.dataset.kick;
                if (uid === currentUser.uid) return toast("Você não pode se remover.");
                if (!confirm("Remover este membro?")) return;
                await remove(databaseRef(`serverMembers/${currentServerId}/${uid}`));
                await remove(databaseRef(`userServers/${uid}/${currentServerId}`));
                toast("Membro removido.");
                loadMembers();
            });
        });
        list.querySelectorAll("[data-assign-role]").forEach(sel => {
            sel.addEventListener("change", async () => {
                const uid = sel.dataset.assignRole;
                const rid = sel.value;
                try {
                    await safeSet(`serverMembers/${currentServerId}/${uid}`, {
                        roles: rid ? [rid] : [],
                        joinedAt: serverTimestamp()
                    });
                    toast(rid ? "Cargo atribuído." : "Cargo removido.");
                    loadMembers();
                } catch (e) {
                    toast("Erro: " + e.message);
                }
            });
        });
    } catch {
        list.innerHTML = "<p class='empty-hint'>Erro ao carregar.</p>";
    }
}

async function loadRoles() {
    const list = $("roles-list");
    if (!list || !currentServerId) return;
    list.innerHTML = "<p class='empty-hint'>Carregando cargos...</p>";
    try {
        const snap = await safeGet(`servers/${currentServerId}/roles`);
        const roles = snap.exists() ? Object.entries(snap.val()) : [];
        list.innerHTML = "";

        // Dono implícito
        const ownerDiv = document.createElement("div");
        ownerDiv.className = "role-card";
        ownerDiv.innerHTML = `
            <div class="role-card-left">
                <span class="role-color-dot" style="background:#faa81a"></span>
                <strong>Dono do servidor</strong>
                <span class="role-badge">todas as permissões</span>
            </div>
        `;
        list.appendChild(ownerDiv);

        if (!roles.length) {
            const empty = document.createElement("p");
            empty.className = "empty-hint";
            empty.textContent = "Nenhum cargo criado ainda. Clique em Criar cargo.";
            list.appendChild(empty);
        }

        roles
            .sort((a, b) => (b[1].position || 0) - (a[1].position || 0))
            .forEach(([id, role]) => {
                const div = document.createElement("div");
                div.className = "role-card";
                const perms = role.permissions || {};
                const tags = [];
                if (perms.admin) tags.push("ADM");
                if (perms.manageChannels) tags.push("Canais");
                if (perms.manageMessages) tags.push("Msgs");
                if (perms.kick) tags.push("Kick");
                if (perms.ban) tags.push("Ban");
                if (perms.manageRoles) tags.push("Cargos");
                div.innerHTML = `
                    <div class="role-card-left">
                        <span class="role-color-dot" style="background:${escapeAttribute(role.color || "#5ee6c4")}"></span>
                        <strong style="color:${escapeAttribute(role.color || "var(--text-0)")}">${escapeHTML(role.name || "Cargo")}</strong>
                        ${tags.map(t => `<span class="role-badge">${t}</span>`).join("")}
                    </div>
                    <div class="role-card-actions">
                        <button type="button" class="btn-secondary btn-sm" data-edit-role="${id}">Editar</button>
                        <button type="button" class="btn-secondary btn-sm danger-btn" data-del-role="${id}">Excluir</button>
                    </div>
                `;
                list.appendChild(div);
            });

        list.querySelectorAll("[data-edit-role]").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.editRole;
                const snap = await safeGet(`servers/${currentServerId}/roles/${id}`);
                if (!snap.exists()) return;
                openRoleModal(id, snap.val());
            });
        });
        list.querySelectorAll("[data-del-role]").forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!confirm("Excluir este cargo?")) return;
                await remove(databaseRef(`servers/${currentServerId}/roles/${btn.dataset.delRole}`));
                toast("Cargo excluído.");
                loadRoles();
            });
        });
    } catch (e) {
        list.innerHTML = `<p class='empty-hint'>Erro: ${escapeHTML(e.message)}</p>`;
    }
}

function loadBans() {
    const list = $("bans-list");
    if (!list) return;
    list.innerHTML = `<p class="empty-hint">Nenhum banimento.</p>`;
}

function openRoleModal(editId = null, data = null) {
    if (exists("role-edit-id")) $("role-edit-id").value = editId || "";
    if (exists("role-modal-title")) $("role-modal-title").textContent = editId ? "Editar cargo" : "Criar cargo";
    if (exists("role-name-input")) $("role-name-input").value = data?.name || "";
    if (exists("role-color-input")) $("role-color-input").value = data?.color || "#5ee6c4";
    const perms = data?.permissions || {};
    if (exists("perm-admin")) $("perm-admin").checked = !!perms.admin;
    if (exists("perm-manage-channels")) $("perm-manage-channels").checked = !!perms.manageChannels;
    if (exists("perm-manage-messages")) $("perm-manage-messages").checked = !!perms.manageMessages;
    if (exists("perm-kick")) $("perm-kick").checked = !!perms.kick;
    if (exists("perm-ban")) $("perm-ban").checked = !!perms.ban;
    if (exists("perm-manage-roles")) $("perm-manage-roles").checked = !!perms.manageRoles;
    openModal("modal-role");
}

$("create-role-btn")?.addEventListener("click", () => {
    const server = serverCache[currentServerId];
    if (!server || server.ownerId !== currentUser?.uid) {
        return toast("Só o dono pode criar cargos.");
    }
    openRoleModal();
});

$("confirm-role")?.addEventListener("click", async () => {
    if (!currentServerId || !currentUser) return;
    const server = serverCache[currentServerId];
    if (!server || server.ownerId !== currentUser.uid) return toast("Sem permissão.");

    const name = ($("role-name-input")?.value || "").trim();
    if (!name) return toast("Nome obrigatório.");

    const permissions = {
        admin: !!$("perm-admin")?.checked,
        manageChannels: !!$("perm-manage-channels")?.checked,
        manageMessages: !!$("perm-manage-messages")?.checked,
        kick: !!$("perm-kick")?.checked,
        ban: !!$("perm-ban")?.checked,
        manageRoles: !!$("perm-manage-roles")?.checked
    };
    // Admin liga tudo
    if (permissions.admin) {
        Object.keys(permissions).forEach(k => permissions[k] = true);
    }

    const payload = {
        name: name.slice(0, 32),
        color: $("role-color-input")?.value || "#5ee6c4",
        permissions,
        position: Date.now()
    };

    const editId = ($("role-edit-id")?.value || "").trim();
    try {
        if (editId) {
            await safeUpdate(`servers/${currentServerId}/roles/${editId}`, payload);
            toast("Cargo atualizado!");
        } else {
            await safePush(`servers/${currentServerId}/roles`, payload);
            toast("Cargo criado!");
        }
        closeModals();
        loadRoles();
    } catch (e) {
        toast("Erro: " + e.message);
    }
});

// Admin checkbox liga/desliga os outros
$("perm-admin")?.addEventListener("change", (e) => {
    const on = e.target.checked;
    ["perm-manage-channels", "perm-manage-messages", "perm-kick", "perm-ban", "perm-manage-roles"].forEach(id => {
        const el = $(id);
        if (el) {
            el.checked = on;
            el.disabled = on;
        }
    });
});


// =====================================================
// EMOJIS DO SERVIDOR (estilo Discord, tamanho emoji)
// =====================================================
async function loadServerEmojis() {
    const list = $("server-emojis-list");
    if (!list || !currentServerId) return;
    list.innerHTML = "<p class='empty-hint'>Carregando...</p>";
    try {
        const snap = await safeGet(`servers/${currentServerId}/emojis`);
        const emojis = snap.exists() ? Object.entries(snap.val()) : [];
        list.innerHTML = "";
        if (!emojis.length) {
            list.innerHTML = "<p class='empty-hint'>Nenhum emoji ainda.</p>";
            return;
        }
        emojis.forEach(([id, em]) => {
            const div = document.createElement("div");
            div.className = "server-emoji-item";
            div.innerHTML = `
                <button type="button" class="emoji-del" data-del-emoji="${id}" title="Remover">×</button>
                <img src="${escapeAttribute(em.url)}" alt=":${escapeAttribute(em.name)}:">
                <span>:${escapeHTML(em.name)}:</span>
            `;
            list.appendChild(div);
        });
        list.querySelectorAll("[data-del-emoji]").forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!confirm("Remover emoji?")) return;
                try {
                    await remove(databaseRef(`servers/${currentServerId}/emojis/${btn.dataset.delEmoji}`));
                    toast("Emoji removido.");
                    loadServerEmojis();
                } catch (e) {
                    toast("Erro: " + e.message);
                }
            });
        });
    } catch (e) {
        list.innerHTML = `<p class='empty-hint'>Erro: ${escapeHTML(e.message)}</p>`;
    }
}

async function addServerEmoji(name, url) {
    if (!currentServerId || !currentUser) return;
    const server = serverCache[currentServerId];
    if (!server || server.ownerId !== currentUser.uid) return toast("Só o dono pode adicionar emojis.");
    name = String(name || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32);
    if (!name) return toast("Nome inválido.");
    if (!url) return toast("URL/imagem obrigatória.");
    try {
        await safePush(`servers/${currentServerId}/emojis`, {
            name,
            url,
            animated: /\\.gif(\\?|$)/i.test(url) || String(url).includes("image/gif"),
            createdAt: serverTimestamp()
        });
        toast(`Emoji :${name}: adicionado!`);
        loadServerEmojis();
    } catch (e) {
        toast("Erro ao salvar emoji: " + (e.message || "permission-denied — atualize as Rules do Firebase"));
    }
}

$("server-emoji-file")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = ($("server-emoji-name")?.value || file.name.replace(/\\.[^.]+$/, "")).trim();
    try {
        let url;
        if (file.type === "image/gif") url = await fileToDataURL(file);
        else url = await convertImage(file, { maxWidth: 128, maxHeight: 128, quality: 0.9, maxSizeMB: 2 });
        await addServerEmoji(name, url);
        e.target.value = "";
        if (exists("server-emoji-name")) $("server-emoji-name").value = "";
    } catch (err) {
        toast("Erro: " + err.message);
    }
});

$("server-emoji-url-btn")?.addEventListener("click", () => {
    if (exists("server-emoji-url-name")) {
        $("server-emoji-url-name").value = ($("server-emoji-name")?.value || "").trim();
    }
    openModal("modal-server-emoji-url");
});

$("confirm-server-emoji-url")?.addEventListener("click", async () => {
    const name = ($("server-emoji-url-name")?.value || "").trim();
    const url = normalizeURL(($("server-emoji-url-input")?.value || "").trim());
    if (!url) return toast("URL inválida.");
    await addServerEmoji(name, url);
    closeModals();
    if (exists("server-emoji-url-input")) $("server-emoji-url-input").value = "";
});

// Render :nome: nos textos de mensagem
function renderCustomEmojis(text, emojiMap) {
    if (!text || !emojiMap) return escapeHTML(text || "");
    let out = escapeHTML(text);
    out = out.replace(/:([a-z0-9_]{1,32}):/gi, (m, name) => {
        const em = emojiMap[name.toLowerCase()];
        if (!em) return m;
        return `<img class="msg-emoji" src="${escapeAttribute(em.url)}" alt=":${escapeAttribute(em.name)}:" title=":${escapeAttribute(em.name)}:">`;
    });
    return out;
}

let serverEmojiCache = {};
async function refreshServerEmojiCache() {
    serverEmojiCache = {};
    if (!currentServerId) return;
    try {
        const snap = await safeGet(`servers/${currentServerId}/emojis`);
        if (!snap.exists()) return;
        Object.values(snap.val()).forEach(em => {
            if (em?.name) serverEmojiCache[String(em.name).toLowerCase()] = em;
        });
    } catch (_) {}
}

// =====================================================
// CONVITE POR URL (query ?invite=slug — não dá 404 no GitHub Pages)
// =====================================================
function checkInviteFromURL() {
    const params = new URLSearchParams(window.location.search || "");
    let slugOrId = params.get("invite") || "";
    if (!slugOrId) {
        const hash = window.location.hash || "";
        const hm = hash.match(/#(?:invite\/)?([a-z0-9-]+)/i);
        if (hm) slugOrId = hm[1];
    }
    if (!slugOrId) {
        const path = window.location.pathname || "";
        const pm = path.match(/\/Union\/([a-z0-9-]+)\/?$/i);
        if (pm) slugOrId = pm[1];
    }
    if (!slugOrId || slugOrId === "index.html") return;
    pendingInviteId = slugOrId;
    openInviteModal(slugOrId);
}

async function openInviteModal(slugOrId) {
    try {
        let server = null;
        let serverId = slugOrId;

        let snap = await safeGet(`servers/${slugOrId}`);
        if (snap.exists() && !snap.val()?.deleted) {
            server = snap.val();
        } else {
            const all = await safeGet("servers");
            if (all.exists()) {
                const found = Object.entries(all.val()).find(([id, s]) => !s.deleted && (s.slug === slugOrId || id === slugOrId));
                if (found) {
                    serverId = found[0];
                    server = found[1];
                }
            }
        }

        if (!server) return toast("Convite inválido ou servidor não encontrado.");

        pendingInviteId = serverId;
        if (exists("invite-server-name")) $("invite-server-name").textContent = server.name || "Servidor";
        if (exists("invite-server-icon")) $("invite-server-icon").src = server.iconURL || createDefaultAvatar(server.name);
        if (exists("invite-server-desc")) {
            $("invite-server-desc").textContent = server.description
                || "Ao entrar, este servidor poderá ver seu nome, foto e banner.";
        }
        if (exists("invite-server-tags")) {
            const tags = Array.isArray(server.tags) ? server.tags : [];
            $("invite-server-tags").innerHTML = tags.map(t => `<span class="tag">${escapeHTML(t)}</span>`).join("");
        }
        openModal("modal-invite");
    } catch (e) {
        console.error(e);
        toast("Erro ao carregar convite.");
    }
}

function clearInviteFromURL() {
    if (!window.history?.replaceState) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    url.hash = "";
    // Mantém path base do GitHub Pages
    const base = url.pathname.includes("/Union") ? url.pathname.replace(/\/Union\/.+$/, "/Union/") : url.pathname;
    url.pathname = base.endsWith("/") || base.endsWith("index.html") ? base : base;
    window.history.replaceState({}, "", url.pathname + (url.search || "") + url.hash);
}

$("confirm-join-invite")?.addEventListener("click", async () => {
    if (!pendingInviteId || !currentUser) return toast("Faça login para aceitar o convite.");
    await joinServerById(pendingInviteId);
    pendingInviteId = null;
    clearInviteFromURL();
    closeModals();
});

$("decline-invite-btn")?.addEventListener("click", () => {
    pendingInviteId = null;
    clearInviteFromURL();
    closeModals();
    toast("Convite recusado.");
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
    const can = await userHasAdminPower(currentServerId, currentUser?.uid);
    if (!can) return toast("Sem permissão (precisa ser dono ou cargo ADM / gerenciar canais).");
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
    ["text", "voice", "forum", "server-settings", "discover", "friends", "dm"].forEach(t => {
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
                let content = renderCustomEmojis(msg.text || "", serverEmojiCache);
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
    if (!grid) return;
    if (!grid.children.length && typeof EMOJIS !== "undefined") {
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
    renderServerEmojiPicker();
}

async function renderServerEmojiPicker() {
    const grid = $("server-emoji-picker-grid");
    if (!grid) return;
    grid.innerHTML = "";
    if (!currentServerId) {
        grid.innerHTML = "<p class='empty-hint' style='grid-column:1/-1'>Entre em um servidor</p>";
        return;
    }
    await refreshServerEmojiCache();
    const entries = Object.values(serverEmojiCache || {});
    if (!entries.length) {
        grid.innerHTML = "<p class='empty-hint' style='grid-column:1/-1'>Nenhum emoji do servidor</p>";
        return;
    }
    entries.forEach(em => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.title = `:${em.name}:`;
        btn.innerHTML = `<img src="${escapeAttribute(em.url)}" alt=":${escapeAttribute(em.name)}:" style="width:28px;height:28px;object-fit:contain">`;
        btn.addEventListener("click", () => {
            const input = $("message-input");
            if (input) {
                input.value += `:${em.name}:`;
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
        if (panel === "emojis") renderServerEmojiPicker();
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
    $("share-screen-btn")?.classList.add("hidden");
    if (exists("video-grid")) $("video-grid").innerHTML = "";
    if (exists("voice-participants")) {
        $("voice-participants").innerHTML = "<p class='empty-hint'>Entre na call para ver os participantes</p>";
    }
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

$("open-profile-btn")?.addEventListener("click", async () => {
    loadProfileFields();
    await populateClanTagSelect();
    if (exists("privacy-profile-visibility")) $("privacy-profile-visibility").value = userProfile?.privacy?.profileVisibility || "everyone";
    if (exists("privacy-allow-dms")) $("privacy-allow-dms").checked = userProfile?.privacy?.allowDms !== false;
    if (exists("privacy-show-online")) $("privacy-show-online").checked = userProfile?.privacy?.showOnline !== false;
    const ap = userProfile?.appearance || {};
    if (exists("appearance-bg-color")) $("appearance-bg-color").value = ap.bgColor || "#0e1013";
    if (exists("appearance-panel-opacity")) $("appearance-panel-opacity").value = ap.panelOpacity ?? 1;
    if (exists("appearance-bg-url")) $("appearance-bg-url").value = ap.bgImage && String(ap.bgImage).startsWith("http") ? ap.bgImage : "";
    openModal("modal-profile");
    updateFontPreview();
});

function updateFontPreview() {
    const sel = $("profile-font-input");
    const preview = $("font-preview");
    if (!sel || !preview) return;
    const font = sel.value || "Inter";
    preview.style.fontFamily = font;
    const name = ($("profile-name-input")?.value || userProfile?.displayName || "Seu nick").trim();
    preview.textContent = name || "Prévia do nick";
}

$("profile-font-input")?.addEventListener("change", updateFontPreview);
$("profile-name-input")?.addEventListener("input", updateFontPreview);

$("profile-avatar-input")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f || !f.type.startsWith("image/")) {
        toast("Só imagem.");
        e.target.value = "";
        newAvatarFile = null;
        return;
    }
    newAvatarFile = f;
    if (exists("profile-avatar-preview")) $("profile-avatar-preview").src = URL.createObjectURL(f);
});

$("profile-banner-input")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f || !f.type.startsWith("image/")) {
        toast("Só imagem.");
        e.target.value = "";
        newBannerFile = null;
        return;
    }
    newBannerFile = f;
    if (exists("profile-banner-preview")) {
        $("profile-banner-preview").style.backgroundImage = `url("${URL.createObjectURL(f)}")`;
        $("profile-banner-preview").style.backgroundSize = "cover";
        $("profile-banner-preview").style.backgroundPosition = "center";
    }
});

$("profile-avatar-url-input")?.addEventListener("input", (e) => {
    const url = normalizeURL(e.target.value.trim()) || e.target.value.trim();
    if (url && exists("profile-avatar-preview")) $("profile-avatar-preview").src = url;
});

$("profile-banner-url-input")?.addEventListener("input", (e) => {
    const url = normalizeURL(e.target.value.trim()) || e.target.value.trim();
    if (exists("profile-banner-preview")) {
        $("profile-banner-preview").style.backgroundImage = url ? `url("${escapeAttribute(url)}")` : "";
        $("profile-banner-preview").style.backgroundSize = "cover";
    }
});

$("confirm-profile")?.addEventListener("click", async () => {
    if (!currentUser) return toast("Não logado.");
    const btn = $("confirm-profile");
    btn.disabled = true;
    btn.textContent = "Salvando...";

    const clanServerId = ($("profile-clan-tag")?.value || "").trim();
    let clanTag = "";
    let clanTagData = null;
    if (clanServerId) {
        const s = serverCache[clanServerId];
        if (s?.serverTag?.text) {
            clanTagData = { text: s.serverTag.text, iconURL: s.serverTag.iconURL || null, serverId: clanServerId };
            clanTag = s.serverTag.text;
        }
    }
    const bgFromFile = $("appearance-bg-url")?.dataset?.local || "";
    const bgUrl = bgFromFile || normalizeURL(($("appearance-bg-url")?.value || "").trim()) || "";
    const updates = {
        displayName: ($("profile-name-input")?.value || "").trim().slice(0, 32) || "Usuário",
        bio: ($("profile-bio-input")?.value || "").trim().slice(0, 190),
        accentColor: $("profile-color-input")?.value || "#5ee6c4",
        nameFont: $("profile-font-input")?.value || "Inter",
        socialLinks: ($("profile-social-input")?.value || "").trim().slice(0, 500),
        customStatus: ($("profile-status-input")?.value || "").trim().slice(0, 32),
        presence: $("profile-presence-input")?.value || "online",
        clanTag,
        clanTagData,
        clanTagServerId: clanServerId || null,
        privacy: {
            profileVisibility: $("privacy-profile-visibility")?.value || "everyone",
            allowDms: !!$("privacy-allow-dms")?.checked,
            showOnline: !!$("privacy-show-online")?.checked
        },
        appearance: {
            bgColor: $("appearance-bg-color")?.value || "#0e1013",
            panelOpacity: parseFloat($("appearance-panel-opacity")?.value || "1"),
            bgImage: bgUrl || null
        }
    };

    try {
        if (newAvatarFile) {
            // GIF mantém animação (não passa pelo canvas)
            if (newAvatarFile.type === "image/gif") {
                updates.photoURL = await fileToDataURL(newAvatarFile);
            } else {
                updates.photoURL = await convertImage(newAvatarFile, {
                    maxWidth: 512, maxHeight: 512, quality: 0.82, maxSizeMB: 5
                });
            }
        } else {
            const raw = ($("profile-avatar-url-input")?.value || "").trim();
            const url = normalizeURL(raw);
            if (url) updates.photoURL = url;
            else if (raw === "") updates.photoURL = null;
        }

        if (newBannerFile) {
            if (newBannerFile.type === "image/gif") {
                updates.bannerURL = await fileToDataURL(newBannerFile);
            } else {
                updates.bannerURL = await convertImage(newBannerFile, {
                    maxWidth: 1920, maxHeight: 1080, quality: 0.78, maxSizeMB: 8
                });
            }
        } else {
            const raw = ($("profile-banner-url-input")?.value || "").trim();
            const url = normalizeURL(raw);
            if (url) updates.bannerURL = url;
            else if (raw === "") updates.bannerURL = null;
        }

        await safeUpdate(`users/${currentUser.uid}`, updates);
        await updateProfile(currentUser, { displayName: updates.displayName });

        userProfile = { ...userProfile, ...updates };
        newAvatarFile = null;
        newBannerFile = null;
        renderUserCard();
        applyAppearance(updates.appearance);
        closeModals();
        toast("Perfil salvo!");
    } catch (err) {
        console.error(err);
        toast("Erro ao salvar: " + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "Salvar";
    }
});

// =====================================================
// PERFIL PÚBLICO vs EDITOR
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

// Clique em avatar/nick: eu = editor | outros = público
document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-user-id]");
    if (!el) return;
    const uid = el.dataset.userId;
    if (!uid) return;

    if (currentUser && uid === currentUser.uid) {
        loadProfileFields();
        openModal("modal-profile");
        return;
    }

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


// =====================================================
// PERMISSÕES (dono ou cargo ADM)
// =====================================================
async function userHasAdminPower(serverId, uid) {
    const server = serverCache[serverId];
    if (!server) return false;
    if (server.ownerId === uid) return true;
    try {
        const mem = await safeGet(`serverMembers/${serverId}/${uid}`);
        if (!mem.exists()) return false;
        const raw = mem.val();
        const roleIds = (raw && typeof raw === "object" && raw.roles) ? raw.roles : [];
        if (!roleIds.length) return false;
        const rolesSnap = await safeGet(`servers/${serverId}/roles`);
        if (!rolesSnap.exists()) return false;
        const roles = rolesSnap.val();
        return roleIds.some(rid => roles[rid]?.permissions?.admin || roles[rid]?.permissions?.manageChannels);
    } catch {
        return false;
    }
}

// =====================================================
// AMIGOS / DM / DENÚNCIA / TAG / APARÊNCIA
// =====================================================
const REPORT_WEBHOOK = "https://discord.com/api/webhooks/1538717876440010892/tBySoprNe_dQAMR-8im2k8SFzW1G3sgYOh5sMryyzvyqYs3lQOlEn085d_E2K5hUWqTM";
let currentDmUid = null;
let dmListener = null;
let pendingDmFile = null;

$("friends-btn")?.addEventListener("click", () => {
    showView("friends");
    loadFriendsList();
    if (exists("friends-search")) $("friends-search").value = "";
    if (exists("friends-results")) $("friends-results").innerHTML = "";
});

$("friends-search")?.addEventListener("input", async (e) => {
    const q = e.target.value.trim().toLowerCase();
    const box = $("friends-results");
    if (!box) return;
    if (q.length < 2) { box.innerHTML = ""; return; }
    box.innerHTML = "<p class='empty-hint'>Buscando...</p>";
    try {
        const snap = await safeGet("users");
        if (!snap.exists()) { box.innerHTML = "<p class='empty-hint'>Ninguém encontrado.</p>"; return; }
        const hits = Object.entries(snap.val())
            .filter(([uid, u]) => uid !== currentUser?.uid && (u.displayName || "").toLowerCase().includes(q))
            .slice(0, 20);
        box.innerHTML = "";
        hits.forEach(([uid, u]) => {
            const card = document.createElement("div");
            card.className = "discover-card";
            card.innerHTML = `
                <img class="discover-icon" src="${escapeAttribute(u.photoURL || createDefaultAvatar(uid))}" alt="">
                <div class="discover-info">
                    <strong>${escapeHTML(u.displayName || "User")}${u.clanTag ? ` <span class="role-badge">${escapeHTML(u.clanTag)}</span>` : ""}</strong>
                    <span class="meta">${escapeHTML(u.customStatus || u.bio || "").slice(0, 60)}</span>
                </div>
                <button type="button" class="btn-secondary btn-sm" data-add-friend="${uid}">Amigo</button>
                <button type="button" class="btn-primary btn-sm" data-open-dm="${uid}">DM</button>
            `;
            box.appendChild(card);
        });
        if (!hits.length) box.innerHTML = "<p class='empty-hint'>Ninguém encontrado.</p>";
        box.querySelectorAll("[data-add-friend]").forEach(btn => {
            btn.addEventListener("click", async () => {
                try {
                    await safeSet(`friends/${currentUser.uid}/${btn.dataset.addFriend}`, true);
                    await safeSet(`friends/${btn.dataset.addFriend}/${currentUser.uid}`, true);
                    toast("Amigo adicionado!");
                    loadFriendsList();
                } catch (e) { toast("Erro: " + e.message); }
            });
        });
        box.querySelectorAll("[data-open-dm]").forEach(btn => {
            btn.addEventListener("click", () => openDm(btn.dataset.openDm));
        });
    } catch (e) {
        box.innerHTML = `<p class='empty-hint'>Erro: ${escapeHTML(e.message)}</p>`;
    }
});

async function loadFriendsList() {
    const box = $("friends-list");
    if (!box || !currentUser) return;
    box.innerHTML = "<p class='empty-hint'>Carregando...</p>";
    try {
        const snap = await safeGet(`friends/${currentUser.uid}`);
        if (!snap.exists()) { box.innerHTML = "<p class='empty-hint'>Nenhum amigo ainda.</p>"; return; }
        box.innerHTML = "";
        for (const uid of Object.keys(snap.val())) {
            const uSnap = await safeGet(`users/${uid}`);
            const u = uSnap.exists() ? uSnap.val() : {};
            const card = document.createElement("div");
            card.className = "discover-card";
            card.innerHTML = `
                <img class="discover-icon" src="${escapeAttribute(u.photoURL || createDefaultAvatar(uid))}" alt="">
                <div class="discover-info"><strong>${escapeHTML(u.displayName || "User")}</strong></div>
                <button type="button" class="btn-primary btn-sm" data-open-dm="${uid}">DM</button>
            `;
            box.appendChild(card);
        }
        box.querySelectorAll("[data-open-dm]").forEach(btn => {
            btn.addEventListener("click", () => openDm(btn.dataset.openDm));
        });
    } catch {
        box.innerHTML = "<p class='empty-hint'>Erro ao carregar amigos.</p>";
    }
}

function dmIdFor(a, b) {
    return [a, b].sort().join("_");
}

async function openDm(uid) {
    if (!currentUser || !uid) return;
    currentDmUid = uid;
    const uSnap = await safeGet(`users/${uid}`);
    const u = uSnap.exists() ? uSnap.val() : {};
    if (exists("dm-title")) $("dm-title").textContent = u.displayName || "DM";
    showView("dm");
    listenDm(uid);
}

function stopDmListener() {
    if (dmListener) {
        try { off(dmListener.reference, "value", dmListener.callback); } catch {}
        dmListener = null;
    }
}

function listenDm(uid) {
    stopDmListener();
    const id = dmIdFor(currentUser.uid, uid);
    const reference = databaseRef(`dms/${id}/messages`);
    const callback = (snap) => {
        const root = $("dm-messages");
        if (!root) return;
        root.innerHTML = "";
        Object.entries(snap.val() || {})
            .sort((a, b) => normalizeTimestamp(a[1]?.createdAt) - normalizeTimestamp(b[1]?.createdAt))
            .forEach(([, msg]) => {
                const el = document.createElement("div");
                el.className = "message";
                let content = escapeHTML(msg.text || "");
                if (msg.image) content += `<div class="msg-image"><img src="${escapeAttribute(msg.image)}" alt=""></div>`;
                el.innerHTML = `
                    <img class="avatar avatar-sm" src="${escapeAttribute(msg.authorPhoto || createDefaultAvatar(msg.uid))}" alt="">
                    <div class="message-body">
                        <div class="message-header"><strong>${escapeHTML(msg.authorName || "User")}</strong></div>
                        <div class="message-content">${content}</div>
                    </div>`;
                root.appendChild(el);
            });
        root.scrollTop = root.scrollHeight;
    };
    onValue(reference, callback);
    dmListener = { reference, callback };
}

$("back-from-dm")?.addEventListener("click", () => {
    stopDmListener();
    currentDmUid = null;
    showView("friends");
});

$("dm-attach-btn")?.addEventListener("click", () => $("dm-file-input")?.click());
$("dm-file-input")?.addEventListener("change", (e) => {
    pendingDmFile = e.target.files?.[0] || null;
    if (pendingDmFile) toast("Imagem pronta para enviar.");
});

$("dm-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser || !currentDmUid) return;
    const text = ($("dm-input")?.value || "").trim();
    if (!text && !pendingDmFile) return;
    const id = dmIdFor(currentUser.uid, currentDmUid);
    const payload = {
        uid: currentUser.uid,
        authorName: getCurrentDisplayName(false),
        authorPhoto: getCurrentPhoto(),
        text,
        createdAt: serverTimestamp()
    };
    try {
        if (pendingDmFile) {
            payload.image = pendingDmFile.type === "image/gif"
                ? await fileToDataURL(pendingDmFile)
                : await convertImage(pendingDmFile, { maxWidth: 1280, maxHeight: 1280, quality: 0.8 });
            pendingDmFile = null;
            if (exists("dm-file-input")) $("dm-file-input").value = "";
        }
        await safePush(`dms/${id}/messages`, payload);
        if (exists("dm-input")) $("dm-input").value = "";
    } catch (err) {
        toast("Erro DM: " + err.message);
    }
});

$("dm-block-btn")?.addEventListener("click", async () => {
    if (!currentDmUid || !currentUser) return;
    if (!confirm("Bloquear? Isso remove a amizade e a conversa.")) return;
    try {
        const id = dmIdFor(currentUser.uid, currentDmUid);
        await safeSet(`blocks/${currentUser.uid}/${currentDmUid}`, true);
        try { await remove(databaseRef(`friends/${currentUser.uid}/${currentDmUid}`)); } catch {}
        try { await remove(databaseRef(`friends/${currentDmUid}/${currentUser.uid}`)); } catch {}
        try { await remove(databaseRef(`dms/${id}`)); } catch {}
        toast("Usuário bloqueado. Conversa e amizade removidas.");
        stopDmListener();
        currentDmUid = null;
        showView("friends");
        loadFriendsList();
    } catch (e) {
        toast("Erro: " + e.message);
    }
});

$("dm-remove-friend-btn")?.addEventListener("click", async () => {
    if (!currentDmUid || !currentUser) return;
    if (!confirm("Remover amizade?")) return;
    try {
        await remove(databaseRef(`friends/${currentUser.uid}/${currentDmUid}`));
        await remove(databaseRef(`friends/${currentDmUid}/${currentUser.uid}`));
        toast("Amizade removida.");
        loadFriendsList();
    } catch (e) {
        toast("Erro: " + e.message);
    }
});

$("dm-report-btn")?.addEventListener("click", async () => {
    if (!currentDmUid) return;
    const uSnap = await safeGet(`users/${currentDmUid}`);
    const u = uSnap.exists() ? uSnap.val() : {};
    if (exists("report-target-name")) $("report-target-name").value = u.displayName || currentDmUid;
    if (exists("report-target-uid")) $("report-target-uid").value = currentDmUid;
    if (exists("report-text")) $("report-text").value = "";
    openModal("modal-report");
});

$("confirm-report")?.addEventListener("click", async () => {
    if (!currentUser) return;
    const targetUid = $("report-target-uid")?.value || "";
    const targetName = $("report-target-name")?.value || targetUid;
    const reason = ($("report-text")?.value || "").trim();
    if (!reason) return toast("Escreva o motivo.");
    const btn = $("confirm-report");
    btn.disabled = true;
    btn.textContent = "Enviando...";
    let imageUrl = "";
    try {
        const file = $("report-image")?.files?.[0];
        if (file) {
            imageUrl = file.type === "image/gif" ? await fileToDataURL(file) : await convertImage(file, { maxWidth: 1280, maxHeight: 1280, quality: 0.8 });
            // data URLs são grandes demais pro Discord às vezes — aviso
            if (imageUrl.startsWith("data:") && imageUrl.length > 2000) {
                imageUrl = "[imagem em base64 anexada no app — tamanho grande para preview no Discord]";
            }
        }
        const embed = {
            title: "🚨 Nova denúncia — Union Chat",
            color: 15158332,
            fields: [
                { name: "Denunciante", value: `${getCurrentDisplayName(false)} (\`${currentUser.uid}\`)`, inline: false },
                { name: "Denunciado", value: `${targetName} (\`${targetUid}\`)`, inline: false },
                { name: "Motivo", value: reason.slice(0, 1000), inline: false },
                { name: "Prova / imagem", value: imageUrl ? String(imageUrl).slice(0, 1000) : "Nenhuma", inline: false }
            ],
            timestamp: new Date().toISOString()
        };
        await fetch(REPORT_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ embeds: [embed] })
        });
        // salva também no RTDB
        await safePush("reports", {
            from: currentUser.uid,
            fromName: getCurrentDisplayName(false),
            target: targetUid,
            targetName,
            reason,
            image: imageUrl && !String(imageUrl).startsWith("data:") ? imageUrl : null,
            createdAt: serverTimestamp()
        });
        toast("Denúncia enviada.");
        closeModals();
    } catch (e) {
        toast("Erro ao denunciar: " + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "Enviar denúncia";
    }
});

// Clan tag select
async function populateClanTagSelect() {
    const sel = $("profile-clan-tag");
    if (!sel || !currentUser) return;
    const current = userProfile?.clanTagServerId || "";
    sel.innerHTML = `<option value="">Nenhuma</option>`;
    try {
        const snap = await safeGet(`userServers/${currentUser.uid}`);
        if (!snap.exists()) return;
        for (const sid of Object.keys(snap.val())) {
            let s = serverCache[sid];
            if (!s) {
                const ss = await safeGet(`servers/${sid}`);
                s = ss.exists() ? ss.val() : null;
            }
            if (!s || s.deleted || !s.serverTag?.text) continue;
            const t = s.serverTag;
            const opt = document.createElement("option");
            opt.value = sid;
            opt.textContent = `${t.text} — ${s.name || sid}`;
            if (sid === current) opt.selected = true;
            sel.appendChild(opt);
        }
    } catch {}
}

// Profile tabs
document.querySelectorAll(".profile-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".profile-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const id = tab.dataset.ptab;
        $("ptab-privacy")?.classList.toggle("hidden", id !== "privacy");
        $("ptab-appearance")?.classList.toggle("hidden", id !== "appearance");
        // main fields always visible above tabs
    });
});

function applyAppearance(settings) {
    const s = settings || userProfile?.appearance || {};
    if (s.bgColor) {
        document.documentElement.style.setProperty("--bg-0", s.bgColor);
        document.body.style.backgroundColor = s.bgColor;
    }
    if (s.panelOpacity != null) {
        document.documentElement.style.setProperty("--panel-opacity", s.panelOpacity);
        document.querySelectorAll(".channel-sidebar, .main-header, .message-form, .auth-card").forEach(el => {
            el.style.opacity = s.panelOpacity;
        });
    }
    if (s.bgImage) {
        document.body.style.backgroundImage = `url("${s.bgImage}")`;
        document.body.style.backgroundSize = "cover";
        document.body.style.backgroundPosition = "center";
        document.body.style.backgroundAttachment = "fixed";
    } else {
        document.body.style.backgroundImage = "";
    }
}

$("appearance-bg-file")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
        const url = f.type === "image/gif" ? await fileToDataURL(f) : await convertImage(f, { maxWidth: 1920, maxHeight: 1080, quality: 0.75 });
        if (exists("appearance-bg-url")) $("appearance-bg-url").value = url.startsWith("http") ? url : "";
        // store temp on element
        $("appearance-bg-url").dataset.local = url;
        applyAppearance({
            bgColor: $("appearance-bg-color")?.value,
            panelOpacity: $("appearance-panel-opacity")?.value,
            bgImage: url
        });
        toast("Prévia do fundo aplicada.");
    } catch (err) {
        toast("Erro: " + err.message);
    }
});

$("appearance-clear-bg")?.addEventListener("click", () => {
    if (exists("appearance-bg-url")) {
        $("appearance-bg-url").value = "";
        delete $("appearance-bg-url").dataset.local;
    }
    document.body.style.backgroundImage = "";
});

$("appearance-bg-color")?.addEventListener("input", (e) => {
    document.documentElement.style.setProperty("--bg-0", e.target.value);
    document.body.style.backgroundColor = e.target.value;
});

// Screen share
$("share-screen-btn")?.addEventListener("click", async () => {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        toast("Compartilhamento de tela iniciado (navegador).");
        // anexa preview local
        const grid = $("video-grid");
        if (grid) {
            let tile = document.getElementById("local-screen-tile");
            if (!tile) {
                tile = document.createElement("div");
                tile.id = "local-screen-tile";
                tile.className = "video-tile";
                tile.innerHTML = `<video autoplay playsinline muted></video><div class="video-tile-label">Sua tela</div>`;
                grid.appendChild(tile);
            }
            const v = tile.querySelector("video");
            v.srcObject = stream;
            stream.getVideoTracks()[0].onended = () => {
                tile.remove();
                toast("Compartilhamento encerrado.");
            };
        }
    } catch (e) {
        toast("Não foi possível compartilhar: " + (e.message || "cancelado"));
    }
});



// =====================================================
// TAG DE SERVIDOR + CROPPER
// =====================================================
function loadServerTagEditor() {
    if (!currentServerId) return;
    const server = serverCache[currentServerId] || {};
    const tag = server.serverTag || {};
    if (exists("server-tag-text")) $("server-tag-text").value = tag.text || "";
    if (exists("server-tag-url")) $("server-tag-url").value = tag.iconURL && String(tag.iconURL).startsWith("http") ? tag.iconURL : "";
    renderServerTagPreview(tag);
}

function renderServerTagPreview(tag) {
    const box = $("server-tag-preview");
    if (!box) return;
    if (!tag || (!tag.text && !tag.iconURL)) {
        box.innerHTML = "<span class='empty-hint'>Prévia da tag</span>";
        return;
    }
    box.innerHTML = `<span class="clan-tag-badge">${tag.iconURL ? `<img src="${escapeAttribute(tag.iconURL)}" alt="">` : ""}${escapeHTML(tag.text || "")}</span>`;
}

$("save-server-tag-btn")?.addEventListener("click", async () => {
    if (!currentServerId || !currentUser) return;
    const can = await userHasAdminPower(currentServerId, currentUser.uid);
    if (!can) return toast("Sem permissão.");
    const textVal = ($("server-tag-text")?.value || "").trim().slice(0, 8).toUpperCase();
    if (!textVal) return toast("Texto da tag obrigatório.");
    let iconURL = normalizeURL(($("server-tag-url")?.value || "").trim());
    const file = $("server-tag-file")?.files?.[0];
    try {
        if (file) {
            iconURL = file.type === "image/gif" ? await fileToDataURL(file) : await convertImage(file, { maxWidth: 64, maxHeight: 64, quality: 0.9 });
        }
        // 1 tag por servidor (sobrescreve a anterior)
        const serverTag = { text: textVal, iconURL: iconURL || null };
        await safeUpdate(`servers/${currentServerId}`, { serverTag });
        if (serverCache[currentServerId]) serverCache[currentServerId].serverTag = serverTag;
        renderServerTagPreview(serverTag);
        toast("Tag do servidor salva (1 por servidor)!");
    } catch (e) {
        toast("Erro: " + e.message);
    }
});

$("delete-server-tag-btn")?.addEventListener("click", async () => {
    if (!currentServerId || !currentUser) return;
    const can = await userHasAdminPower(currentServerId, currentUser.uid);
    if (!can) return toast("Sem permissão.");
    if (!confirm("Apagar a tag deste servidor?")) return;
    try {
        await safeUpdate(`servers/${currentServerId}`, { serverTag: null });
        if (serverCache[currentServerId]) serverCache[currentServerId].serverTag = null;
        if (exists("server-tag-text")) $("server-tag-text").value = "";
        if (exists("server-tag-url")) $("server-tag-url").value = "";
        renderServerTagPreview(null);
        toast("Tag apagada.");
    } catch (e) {
        toast("Erro: " + e.message);
    }
});

function clanTagHTML(userOrProfile) {
    const t = userOrProfile?.clanTagData || null;
    if (!t && userOrProfile?.clanTag) {
        return `<span class="clan-tag-badge">${escapeHTML(userOrProfile.clanTag)}</span>`;
    }
    if (!t || !t.text) return "";
    return `<span class="clan-tag-badge">${t.iconURL ? `<img src="${escapeAttribute(t.iconURL)}" alt="">` : ""}${escapeHTML(t.text)}</span>`;
}

let cropCallback = null;
let cropScale = 1;
let cropPos = { x: 0, y: 0 };

function openImageCropper(file, onDone) {
    const url = URL.createObjectURL(file);
    const img = $("crop-image");
    if (!img) return onDone && onDone(null);
    img.src = url;
    cropScale = 1;
    cropPos = { x: 0, y: 0 };
    if (exists("crop-zoom")) $("crop-zoom").value = "1";
    cropCallback = onDone;
    openModal("modal-image-crop");
    const apply = () => {
        img.style.transform = `translate(calc(-50% + ${cropPos.x}px), calc(-50% + ${cropPos.y}px)) scale(${cropScale})`;
    };
    img.onload = apply;
    const zoom = $("crop-zoom");
    if (zoom) zoom.oninput = (e) => { cropScale = parseFloat(e.target.value) || 1; apply(); };
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    img.onmousedown = (e) => { e.preventDefault(); dragging = true; sx = e.clientX; sy = e.clientY; ox = cropPos.x; oy = cropPos.y; };
    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        cropPos.x = ox + (e.clientX - sx);
        cropPos.y = oy + (e.clientY - sy);
        apply();
    });
    window.addEventListener("mouseup", () => { dragging = false; });
}

$("crop-cancel")?.addEventListener("click", () => { cropCallback = null; closeModals(); });

$("crop-confirm")?.addEventListener("click", async () => {
    const img = $("crop-image");
    const frame = $("crop-frame");
    if (!img || !frame || !cropCallback) return closeModals();
    try {
        const size = 512;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        const rect = frame.getBoundingClientRect();
        const iw = img.naturalWidth, ih = img.naturalHeight;
        const base = Math.max(size / iw, size / ih) * cropScale;
        const dw = iw * base, dh = ih * base;
        const dx = (size - dw) / 2 + cropPos.x * (size / Math.max(rect.width, 1));
        const dy = (size - dh) / 2 + cropPos.y * (size / Math.max(rect.height, 1));
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, dx, dy, dw, dh);
        const dataUrl = canvas.toDataURL("image/png", 0.92);
        await cropCallback(dataUrl);
    } catch (e) {
        toast("Erro no recorte: " + e.message);
    }
    cropCallback = null;
    closeModals();
});


(function init() {
    showView(null);
    $("sticker-picker")?.classList.add("hidden");
    $("home-pill")?.classList.add("active");
    console.log("%cUnion Chat completo.", "font-weight:700");
})();
