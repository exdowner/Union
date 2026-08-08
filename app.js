// app.js — núcleo do DevCord
//
// Firebase Realtime Database
// Imagens:
// - Sem Cloudinary
// - Sem API externa de armazenamento
// - Imagens convertidas para Base64
// - Compressão automática através de image.js
//
// Recursos:
// - Servidores
// - Canais de texto
// - Canais de voz
// - Fóruns
// - Mensagens
// - Upload de imagens
// - Stickers
// - Perfil
// - Avatar
// - Banner
// - WebRTC
//
// =====================================================
// IMPORTS
// =====================================================

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

// =====================================================
// UTILITÁRIOS
// =====================================================

const $ = (id) => document.getElementById(id);

function exists(id) {
    return !!$(id);
}

function toast(message) {
    const element = $("toast");

    if (!element) {
        console.log("[DevCord]", message);
        return;
    }

    element.textContent = message;
    element.classList.remove("hidden");

    clearTimeout(toast._timer);

    toast._timer = setTimeout(() => {
        element.classList.add("hidden");
    }, 2600);
}

function openModal(id) {
    const overlay = $("modal-overlay");
    const modal = $(id);

    if (!overlay || !modal) {
        return;
    }

    overlay.classList.remove("hidden");

    document
        .querySelectorAll(".modal")
        .forEach((element) => {
            element.classList.add("hidden");
        });

    modal.classList.remove("hidden");
}

function closeModals() {
    const overlay = $("modal-overlay");

    if (overlay) {
        overlay.classList.add("hidden");
    }
}

function escapeHTML(value) {
    const div = document.createElement("div");

    div.textContent = value ?? "";

    return div.innerHTML;
}

function escapeAttribute(value) {
    return escapeHTML(value)
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function safeName(value, fallback = "Usuário") {
    const name = String(value || "").trim();

    return name || fallback;
}

function getCurrentDisplayName() {
    return safeName(
        userProfile?.displayName,
        "Usuário"
    );
}

function getCurrentPhoto() {
    return userProfile?.photoURL || createDefaultAvatar(
        currentUser?.uid || "devcord"
    );
}

function getCurrentColor() {
    return userProfile?.accentColor || "#5ee6c4";
}

// =====================================================
// AVATAR PADRÃO LOCAL
// =====================================================

function createDefaultAvatar(seed = "devcord") {
    const text = String(seed);

    let hash = 0;

    for (let i = 0; i < text.length; i++) {
        hash =
            ((hash << 5) - hash) +
            text.charCodeAt(i);

        hash |= 0;
    }

    const hue = Math.abs(hash) % 360;

    const letter =
        text
            .replace(/[^a-zA-Z0-9]/g, "")
            .slice(0, 1)
            .toUpperCase() || "D";

    const svg = `
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="256"
            height="256"
            viewBox="0 0 256 256"
        >
            <defs>
                <linearGradient
                    id="g"
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="1"
                >
                    <stop
                        offset="0%"
                        stop-color="hsl(${hue},70%,55%)"
                    />
                    <stop
                        offset="100%"
                        stop-color="hsl(${(hue + 45) % 360},70%,35%)"
                    />
                </linearGradient>
            </defs>

            <rect
                width="256"
                height="256"
                rx="64"
                fill="url(#g)"
            />

            <text
                x="128"
                y="148"
                text-anchor="middle"
                font-family="Arial,sans-serif"
                font-size="110"
                font-weight="700"
                fill="white"
            >
                ${letter}
            </text>
        </svg>
    `;

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

// =====================================================
// ÍCONES SVG
// =====================================================

function channelIcon(type) {
    if (type === "voice") {
        return `
            <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                class="channel-svg"
            >
                <path
                    d="M12 3a4 4 0 0 0-4 4v5a4 4 0 0 0 8 0V7a4 4 0 0 0-4-4Z"
                />
                <path
                    d="M5 11a7 7 0 0 0 14 0"
                />
                <path
                    d="M12 18v3"
                />
                <path
                    d="M8 21h8"
                />
            </svg>
        `;
    }

    if (type === "forum") {
        return `
            <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                class="channel-svg"
            >
                <rect
                    x="3"
                    y="4"
                    width="18"
                    height="15"
                    rx="3"
                />
                <path d="M7 8h10" />
                <path d="M7 12h7" />
                <path d="M7 16h5" />
            </svg>
        `;
    }

    return `
        <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            class="channel-svg"
        >
            <path d="M5 5h14" />
            <path d="M5 12h14" />
            <path d="M5 19h14" />
        </svg>
    `;
}

// =====================================================
// IMAGENS
// =====================================================

async function convertImage(file, options = {}) {
    if (!file) {
        throw new Error("Nenhuma imagem selecionada.");
    }

    if (!file.type || !file.type.startsWith("image/")) {
        throw new Error("Apenas imagens são permitidas.");
    }

    return await imageToBase64(file, options);
}

// =====================================================
// FIREBASE HELPERS
// =====================================================

function databaseRef(path) {
    return ref(rtdb, path);
}

async function safeSet(path, value) {
    return await set(
        databaseRef(path),
        value
    );
}

async function safeUpdate(path, value) {
    return await update(
        databaseRef(path),
        value
    );
}

async function safePush(path, value) {
    return await push(
        databaseRef(path),
        value
    );
}

async function safeGet(path) {
    return await get(
        databaseRef(path)
    );
}

// =====================================================
// LISTENER HELPERS
// =====================================================

function stopListener(listenerObject) {
    if (!listenerObject) {
        return;
    }

    try {
        off(
            listenerObject.reference,
            "value",
            listenerObject.callback
        );
    } catch (error) {
        console.warn(
            "Não foi possível remover listener:",
            error
        );
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

// =====================================================
// MODAIS
// =====================================================

document
    .querySelectorAll(".modal-cancel")
    .forEach((button) => {
        button.addEventListener(
            "click",
            closeModals
        );
    });

if (exists("modal-overlay")) {
    $("modal-overlay").addEventListener(
        "click",
        (event) => {
            if (
                event.target.id ===
                "modal-overlay"
            ) {
                closeModals();
            }
        }
    );
}

// =====================================================
// LOGIN
// =====================================================

window.addEventListener(
    "devcord:signed-in",
    async (event) => {
        try {
            currentUser = event.detail;

            if (!currentUser?.uid) {
                throw new Error(
                    "Usuário inválido."
                );
            }

            const snapshot =
                await safeGet(
                    `users/${currentUser.uid}`
                );

            userProfile =
                snapshot.exists()
                    ? snapshot.val()
                    : {};

            renderUserCard();

            listenServers();

        } catch (error) {
            console.error(error);

            toast(
                "Erro ao carregar sua conta."
            );
        }
    }
);

// =====================================================
// USUÁRIO
// =====================================================

function renderUserCard() {
    if (!currentUser) {
        return;
    }

    if (exists("user-card-avatar")) {
        $("user-card-avatar").src =
            getCurrentPhoto();
    }

    if (exists("user-card-name")) {
        $("user-card-name").textContent =
            getCurrentDisplayName();

        $("user-card-name").style.fontFamily =
            userProfile?.nameFont ||
            "Inter";
    }

    if (exists("user-card-status")) {
        $("user-card-status").textContent =
            userProfile?.customStatus ||
            "Online";
    }
}

// =====================================================
// SERVIDORES
// =====================================================

function listenServers() {
    if (!currentUser) {
        return;
    }

    if (userServersListener) {
        stopListener(
            userServersListener
        );

        userServersListener = null;
    }

    const reference =
        databaseRef(
            `userServers/${currentUser.uid}`
        );

    const callback =
        (snapshot) => {
            const value =
                snapshot.exists()
                    ? snapshot.val()
                    : {};

            const ids =
                Object.keys(value);

            cleanupRemovedServers(ids);

            ids.forEach((serverId) => {
                listenServer(serverId);
            });

            renderServerList();
        };

    onValue(
        reference,
        callback
    );

    userServersListener = {
        reference,
        callback
    };
}

function cleanupRemovedServers(ids) {
    Object.keys(serverListeners)
        .forEach((serverId) => {
            if (!ids.includes(serverId)) {
                stopListener(
                    serverListeners[serverId]
                );

                delete serverListeners[serverId];
                delete serverCache[serverId];
            }
        });
}

function listenServer(serverId) {
    if (serverListeners[serverId]) {
        return;
    }

    const reference =
        databaseRef(
            `servers/${serverId}`
        );

    const callback =
        (snapshot) => {
            if (!snapshot.exists()) {
                delete serverCache[serverId];
                renderServerList();
                return;
            }

            serverCache[serverId] = {
                id: serverId,
                ...(snapshot.val() || {})
            };

            renderServerList();
        };

    onValue(
        reference,
        callback
    );

    serverListeners[serverId] = {
        reference,
        callback
    };
}

function renderServerList() {
    if (!exists("server-list")) {
        return;
    }

    const list =
        $("server-list");

    list.innerHTML = "";

    Object.values(serverCache)
        .forEach((server) => {
            const button =
                document.createElement(
                    "button"
                );

            button.type = "button";

            button.className =
                "server-pill" +
                (
                    server.id ===
                    currentServerId
                        ? " active"
                        : ""
                );

            button.title =
                server.name || "";

            if (server.iconURL) {
                const image =
                    document.createElement(
                        "img"
                    );

                image.src =
                    server.iconURL;

                image.alt =
                    server.name || "";

                image.loading =
                    "lazy";

                button.appendChild(
                    image
                );
            } else {
                button.textContent =
                    safeName(
                        server.name,
                        "DV"
                    )
                        .slice(0, 2)
                        .toUpperCase();
            }

            button.addEventListener(
                "click",
                () =>
                    selectServer(
                        server.id,
                        server
                    )
            );

            list.appendChild(
                button
            );
        });
}

// =====================================================
// ENTRAR / CRIAR SERVIDOR
// =====================================================

if (exists("add-server-btn")) {
    $("add-server-btn")
        .addEventListener(
            "click",
            () => {
                const action =
                    prompt(
                        "Digite 'criar' para criar um servidor ou cole o ID de um servidor para entrar:"
                    );

                if (!action) {
                    return;
                }

                const value =
                    action.trim();

                if (
                    value.toLowerCase() ===
                    "criar"
                ) {
                    openModal(
                        "modal-create-server"
                    );

                    return;
                }

                joinServerById(
                    value
                );
            }
        );
}

async function joinServerById(serverId) {
    if (!currentUser) {
        return;
    }

    try {
        const snapshot =
            await safeGet(
                `servers/${serverId}`
            );

        if (!snapshot.exists()) {
            toast(
                "Servidor não encontrado."
            );

            return;
        }

        await safeSet(
            `serverMembers/${serverId}/${currentUser.uid}`,
            true
        );

        await safeSet(
            `userServers/${currentUser.uid}/${serverId}`,
            true
        );

        toast(
            "Você entrou no servidor."
        );

    } catch (error) {
        console.error(error);

        toast(
            "Não foi possível entrar: " +
            error.message
        );
    }
}

// =====================================================
// CRIAR SERVIDOR
// =====================================================

if (exists("confirm-create-server")) {
    $("confirm-create-server")
        .addEventListener(
            "click",
            async () => {
                if (!currentUser) {
                    return;
                }

                const name =
                    $("new-server-name")
                        ?.value
                        .trim();

                if (!name) {
                    toast(
                        "Dê um nome ao servidor."
                    );

                    return;
                }

                const file =
                    $("new-server-icon")
                        ?.files?.[0];

                try {
                    const serverRef =
                        push(
                            databaseRef(
                                "servers"
                            )
                        );

                    const serverId =
                        serverRef.key;

                    await set(
                        serverRef,
                        {
                            name,

                            ownerId:
                                currentUser.uid,

                            iconURL: "",

                            createdAt:
                                serverTimestamp()
                        }
                    );

                    await safeSet(
                        `serverMembers/${serverId}/${currentUser.uid}`,
                        true
                    );

                    await safeSet(
                        `userServers/${currentUser.uid}/${serverId}`,
                        true
                    );

                    if (file) {
                        try {
                            const base64 =
                                await convertImage(
                                    file,
                                    {
                                        maxWidth: 512,
                                        maxHeight: 512,
                                        quality: 0.82,
                                        maxSizeMB: 5
                                    }
                                );

                            await safeUpdate(
                                `servers/${serverId}`,
                                {
                                    iconURL:
                                        base64
                                }
                            );

                        } catch (imageError) {
                            console.error(
                                imageError
                            );

                            toast(
                                "Servidor criado, mas o ícone falhou."
                            );
                        }
                    }

                    if (exists("new-server-name")) {
                        $("new-server-name")
                            .value = "";
                    }

                    if (exists("new-server-icon")) {
                        $("new-server-icon")
                            .value = "";
                    }

                    closeModals();

                    toast(
                        `Servidor "${name}" criado. ID: ${serverId}`
                    );

                    selectServer(
                        serverId,
                        {
                            id: serverId,
                            name
                        }
                    );

                } catch (error) {
                    console.error(error);

                    toast(
                        "Erro ao criar servidor: " +
                        error.message
                    );
                }
            }
        );
}

// =====================================================
// SELECIONAR SERVIDOR
// =====================================================

async function selectServer(
    serverId,
    serverData
) {
    if (!serverId) {
        return;
    }

    stopMessagesListener();
    stopForumPostsListener();
    stopForumRepliesListener();

    currentServerId =
        serverId;

    currentChannelId =
        null;

    currentChannelType =
        null;

    if (exists("current-server-name")) {
        $("current-server-name")
            .textContent =
            serverData?.name ||
            serverCache[serverId]?.name ||
            "Servidor";
    }

    if (exists("server-settings-btn")) {
        $("server-settings-btn")
            .classList
            .remove("hidden");
    }

    document
        .querySelectorAll(".server-pill")
        .forEach((pill) => {
            pill.classList.remove(
                "active"
            );
        });

    if (exists("home-pill")) {
        $("home-pill")
            .classList
            .remove("active");
    }

    renderServerList();

    listenChannels();
}

// =====================================================
// HOME
// =====================================================

if (exists("home-pill")) {
    $("home-pill")
        .addEventListener(
            "click",
            () => {
                stopChannelsListener();
                stopMessagesListener();
                stopForumPostsListener();
                stopForumRepliesListener();

                if (
                    currentChannelType ===
                    "voice"
                ) {
                    leaveVoiceChannel();
                }

                currentServerId = null;
                currentChannelId = null;
                currentChannelType = null;

                if (exists("current-server-name")) {
                    $("current-server-name")
                        .textContent =
                        "Bem-vindo";
                }

                if (exists("server-settings-btn")) {
                    $("server-settings-btn")
                        .classList
                        .add("hidden");
                }

                if (exists("channel-groups")) {
                    $("channel-groups")
                        .innerHTML =
                        '<p class="empty-hint">Crie ou entre em um servidor para ver os canais aqui.</p>';
                }

                showView(null);

                document
                    .querySelectorAll(
                        ".server-pill"
                    )
                    .forEach((pill) => {
                        pill.classList.remove(
                            "active"
                        );
                    });

                $("home-pill")
                    .classList
                    .add("active");
            }
        );
}

// =====================================================
// CONFIGURAÇÕES DO SERVIDOR
// =====================================================

if (exists("server-settings-btn")) {
    $("server-settings-btn")
        .addEventListener(
            "click",
            () => {
                if (!currentServerId) {
                    return;
                }

                const choice =
                    prompt(
                        `ID de convite deste servidor:\n\n${currentServerId}\n\nDigite "canal" para criar um canal novo.`
                    );

                if (
                    choice &&
                    choice.trim()
                        .toLowerCase() ===
                    "canal"
                ) {
                    openModal(
                        "modal-create-channel"
                    );
                }
            }
        );
}

// =====================================================
// CANAIS
// =====================================================

function listenChannels() {
    if (!currentServerId) {
        return;
    }

    stopChannelsListener();

    const reference =
        databaseRef(
            `channels/${currentServerId}`
        );

    const callback =
        (snapshot) => {
            const groups = {
                text: [],
                voice: [],
                forum: []
            };

            const value =
                snapshot.val() || {};

            Object.entries(value)
                .sort(
                    (a, b) =>
                        normalizeTimestamp(
                            a[1]?.createdAt
                        ) -
                        normalizeTimestamp(
                            b[1]?.createdAt
                        )
                )
                .forEach(
                    ([id, data]) => {
                        if (
                            groups[data?.type]
                        ) {
                            groups[
                                data.type
                            ].push({
                                id,
                                ...data
                            });
                        }
                    }
                );

            renderChannels(
                groups
            );
        };

    onValue(
        reference,
        callback
    );

    channelsListener = {
        reference,
        callback
    };
}

function normalizeTimestamp(value) {
    if (
        typeof value ===
        "number"
    ) {
        return value;
    }

    if (
        typeof value ===
        "string"
    ) {
        const parsed =
            Number(value);

        return Number.isNaN(
            parsed
        )
            ? 0
            : parsed;
    }

    return 0;
}

const TYPE_LABEL = {
    text: "Canais de texto",
    voice: "Canais de voz",
    forum: "Fóruns"
};

function renderChannels(groups) {
    if (!exists("channel-groups")) {
        return;
    }

    const root =
        $("channel-groups");

    root.innerHTML = "";

    Object.keys(TYPE_LABEL)
        .forEach((type) => {
            const label =
                document.createElement(
                    "div"
                );

            label.className =
                "channel-group-label";

            const title =
                document.createElement(
                    "span"
                );

            title.textContent =
                TYPE_LABEL[type];

            label.appendChild(
                title
            );

            const addButton =
                document.createElement(
                    "button"
                );

            addButton.type =
                "button";

            addButton.textContent =
                "+";

            addButton.title =
                "Criar canal";

            addButton.addEventListener(
                "click",
                () => {
                    openModal(
                        "modal-create-channel"
                    );

                    if (
                        exists(
                            "new-channel-type"
                        )
                    ) {
                        $("new-channel-type")
                            .value =
                            type;
                    }
                }
            );

            label.appendChild(
                addButton
            );

            root.appendChild(
                label
            );

            if (
                !groups[type].length
            ) {
                const empty =
                    document.createElement(
                        "p"
                    );

                empty.className =
                    "empty-hint";

                empty.textContent =
                    "Nenhum canal ainda.";

                root.appendChild(
                    empty
                );

                return;
            }

            groups[type]
                .forEach((channel) => {
                    const item =
                        document.createElement(
                            "div"
                        );

                    item.className =
                        "channel-item" +
                        (
                            channel.id ===
                            currentChannelId
                                ? " active"
                                : ""
                        );

                    const icon =
                        document.createElement(
                            "span"
                        );

                    icon.className =
                        "ch-icon";

                    icon.innerHTML =
                        channelIcon(
                            type
                        );

                    const name =
                        document.createElement(
                            "span"
                        );

                    name.textContent =
                        channel.name ||
                        "canal";

                    item.appendChild(
                        icon
                    );

                    item.appendChild(
                        name
                    );

                    item.addEventListener(
                        "click",
                        () =>
                            selectChannel(
                                channel
                            )
                    );

                    root.appendChild(
                        item
                    );
                });
        });
}

// =====================================================
// CRIAR CANAL
// =====================================================

if (exists("confirm-create-channel")) {
    $("confirm-create-channel")
        .addEventListener(
            "click",
            async () => {
                if (!currentServerId) {
                    toast(
                        "Selecione um servidor."
                    );

                    return;
                }

                const rawName =
                    $("new-channel-name")
                        ?.value
                        .trim();

                const type =
                    $("new-channel-type")
                        ?.value;

                if (!rawName) {
                    toast(
                        "Dê um nome ao canal."
                    );

                    return;
                }

                const name =
                    rawName
                        .toLowerCase()
                        .replace(
                            /\s+/g,
                            "-"
                        )
                        .replace(
                            /[^a-z0-9_-]/gi,
                            ""
                        )
                        .slice(0, 80);

                if (!name) {
                    toast(
                        "Nome de canal inválido."
                    );

                    return;
                }

                if (
                    ![
                        "text",
                        "voice",
                        "forum"
                    ].includes(type)
                ) {
                    toast(
                        "Tipo de canal inválido."
                    );

                    return;
                }

                try {
                    await safePush(
                        `channels/${currentServerId}`,
                        {
                            name,
                            type,
                            createdAt:
                                serverTimestamp()
                        }
                    );

                    if (
                        exists(
                            "new-channel-name"
                        )
                    ) {
                        $("new-channel-name")
                            .value = "";
                    }

                    closeModals();

                    toast(
                        "Canal criado."
                    );

                } catch (error) {
                    console.error(error);

                    toast(
                        "Erro ao criar canal: " +
                        error.message
                    );
                }
            }
        );
}

// =====================================================
// SELECIONAR CANAL
// =====================================================

function selectChannel(channel) {
    if (!channel?.id) {
        return;
    }

    if (
        currentChannelType ===
        "voice" &&
        currentChannelId !==
        channel.id
    ) {
        try {
            leaveVoiceChannel();
        } catch (error) {
            console.warn(
                error
            );
        }
    }

    stopMessagesListener();
    stopForumPostsListener();
    stopForumRepliesListener();

    currentChannelId =
        channel.id;

    currentChannelType =
        channel.type;

    if (exists("channel-title")) {
        const prefix =
            channel.type === "text"
                ? "# "
                : "";

        $("channel-title")
            .textContent =
            prefix +
            (
                channel.name ||
                "canal"
            );
    }

    document
        .querySelectorAll(
            ".channel-item"
        )
        .forEach((element) => {
            element.classList.remove(
                "active"
            );
        });

    showView(
        channel.type
    );

    if (
        channel.type ===
        "text"
    ) {
        listenMessages();
    }

    if (
        channel.type ===
        "voice"
    ) {
        setupVoiceView(
            channel
        );
    }

    if (
        channel.type ===
        "forum"
    ) {
        listenForum();
    }

    if (exists("call-btn")) {
        $("call-btn")
            .classList
            .toggle(
                "hidden",
                channel.type !==
                "voice"
            );
    }
}

// =====================================================
// VIEWS
// =====================================================

function showView(type) {
    [
        "text",
        "voice",
        "forum"
    ].forEach((viewType) => {
        const element =
            $("view-" + viewType);

        if (!element) {
            return;
        }

        element.classList.toggle(
            "hidden",
            viewType !== type
        );
    });
}

// =====================================================
// MENSAGENS
// =====================================================

function listenMessages() {
    if (
        !currentServerId ||
        !currentChannelId
    ) {
        return;
    }

    stopMessagesListener();

    const path =
        `messages/${currentServerId}/${currentChannelId}`;

    const reference =
        databaseRef(path);

    const callback =
        (snapshot) => {
            if (!exists("messages")) {
                return;
            }

            const box =
                $("messages");

            box.innerHTML = "";

            const value =
                snapshot.val() || {};

            const messages =
                Object.values(value)
                    .sort(
                        (a, b) =>
                            normalizeTimestamp(
                                a?.createdAt
                            ) -
                            normalizeTimestamp(
                                b?.createdAt
                            )
                    );

            messages.forEach(
                renderMessage
            );

            requestAnimationFrame(
                () => {
                    box.scrollTop =
                        box.scrollHeight;
                }
            );
        };

    onValue(
        reference,
        callback
    );

    messagesListener = {
        reference,
        callback
    };
}

function renderMessage(message) {
    const box =
        $("messages");

    if (!box || !message) {
        return;
    }

    const element =
        document.createElement(
            "div"
        );

    element.className =
        "msg";

    const timestamp =
        normalizeTimestamp(
            message.createdAt
        );

    const time =
        timestamp
            ? new Date(
                timestamp
            ).toLocaleTimeString(
                "pt-BR",
                {
                    hour: "2-digit",
                    minute: "2-digit"
                }
            )
            : "";

    const avatar =
        message.authorPhoto ||
        createDefaultAvatar(
            message.uid ||
            message.authorName ||
            "user"
        );

    const author =
        safeName(
            message.authorName
        );

    const color =
        message.authorColor ||
        "var(--text-0)";

    element.innerHTML = `
        <img
            class="avatar avatar-sm"
            src="${escapeAttribute(avatar)}"
            alt=""
            loading="lazy"
        >

        <div class="msg-body">

            <div class="msg-head">

                <span
                    class="msg-author"
                    style="color:${escapeAttribute(color)}"
                >
                    ${escapeHTML(author)}
                </span>

                <span class="msg-time">
                    ${escapeHTML(time)}
                </span>

            </div>

            ${
                message.text
                    ? `
                        <div class="msg-text">
                            ${escapeHTML(
                                message.text
                            )}
                        </div>
                    `
                    : ""
            }

            ${
                message.imageURL
                    ? `
                        <div class="msg-media">
                            <img
                                src="${escapeAttribute(
                                    message.imageURL
                                )}"
                                loading="lazy"
                                alt="Imagem enviada"
                            >
                        </div>
                    `
                    : ""
            }

            ${
                message.videoURL
                    ? `
                        <div class="msg-media">
                            <video
                                src="${escapeAttribute(
                                    message.videoURL
                                )}"
                                controls
                                preload="metadata"
                            ></video>
                        </div>
                    `
                    : ""
            }

            ${
                message.sticker
                    ? `
                        <div class="msg-sticker">
                            ${escapeHTML(
                                message.sticker
                            )}
                        </div>
                    `
                    : ""
            }

            ${
                message.stickerURL
                    ? `
                        <div class="msg-media">
                            <img
                                src="${escapeAttribute(
                                    message.stickerURL
                                )}"
                                loading="lazy"
                                alt="Sticker"
                                style="
                                    max-width:120px;
                                    max-height:120px;
                                    object-fit:contain;
                                "
                            >
                        </div>
                    `
                    : ""
            }

        </div>
    `;

    box.appendChild(
        element
    );
}

// =====================================================
// ENVIAR MENSAGEM
// =====================================================

if (exists("message-form")) {
    $("message-form")
        .addEventListener(
            "submit",
            async (event) => {
                event.preventDefault();

                if (
                    !currentUser ||
                    !currentServerId ||
                    !currentChannelId
                ) {
                    return;
                }

                const input =
                    $("message-input");

                const text =
                    input?.value
                        ?.trim() || "";

                if (
                    !text &&
                    !pendingFile
                ) {
                    return;
                }

                const message = {
                    uid:
                        currentUser.uid,

                    authorName:
                        getCurrentDisplayName(),

                    authorPhoto:
                        userProfile?.photoURL ||
                        "",

                    authorColor:
                        getCurrentColor(),

                    text,

                    createdAt:
                        serverTimestamp()
                };

                try {
                    if (pendingFile) {
                        const base64 =
                            await convertImage(
                                pendingFile,
                                {
                                    maxWidth: 1280,
                                    maxHeight: 1280,
                                    quality: 0.78,
                                    maxSizeMB: 5
                                }
                            );

                        message.imageURL =
                            base64;

                        pendingFile =
                            null;

                        if (
                            exists(
                                "attach-preview"
                            )
                        ) {
                            $("attach-preview")
                                .classList
                                .add("hidden");

                            $("attach-preview")
                                .textContent =
                                "";
                        }

                        if (
                            exists(
                                "file-input"
                            )
                        ) {
                            $("file-input")
                                .value =
                                "";
                        }
                    }

                    await safePush(
                        `messages/${currentServerId}/${currentChannelId}`,
                        message
                    );

                    if (input) {
                        input.value = "";
                        input.focus();
                    }

                } catch (error) {
                    console.error(
                        error
                    );

                    toast(
                        "Não foi possível enviar a mensagem: " +
                        error.message
                    );
                }
            }
        );
}

// =====================================================
// ANEXO
// =====================================================

if (exists("attach-btn")) {
    $("attach-btn")
        .addEventListener(
            "click",
            () => {
                if (exists("file-input")) {
                    $("file-input")
                        .click();
                }
            }
        );
}

if (exists("file-input")) {
    $("file-input")
        .addEventListener(
            "change",
            (event) => {
                const file =
                    event.target.files?.[0];

                if (!file) {
                    pendingFile =
                        null;

                    return;
                }

                if (
                    !file.type ||
                    !file.type.startsWith(
                        "image/"
                    )
                ) {
                    toast(
                        "Somente imagens são permitidas."
                    );

                    event.target.value =
                        "";

                    pendingFile =
                        null;

                    if (
                        exists(
                            "attach-preview"
                        )
                    ) {
                        $("attach-preview")
                            .classList
                            .add("hidden");
                    }

                    return;
                }

                pendingFile =
                    file;

                if (
                    exists(
                        "attach-preview"
                    )
                ) {
                    $("attach-preview")
                        .textContent =
                        file.name;

                    $("attach-preview")
                        .classList
                        .remove("hidden");
                }
            }
        );
}

// =====================================================
// STICKERS
// =====================================================

const EMOJI_STICKERS = [
    "😀",
    "😂",
    "😍",
    "🔥",
    "🎉",
    "👍",
    "💀",
    "😭",
    "🤔",
    "❤️",
    "😎",
    "👀"
];

async function sendSticker(stickerData) {
    if (
        !currentUser ||
        !currentServerId ||
        !currentChannelId
    ) {
        return;
    }

    try {
        await safePush(
            `messages/${currentServerId}/${currentChannelId}`,
            {
                uid:
                    currentUser.uid,

                authorName:
                    getCurrentDisplayName(),

                authorPhoto:
                    userProfile?.photoURL ||
                    "",

                authorColor:
                    getCurrentColor(),

                ...stickerData,

                createdAt:
                    serverTimestamp()
            }
        );

    } catch (error) {
        console.error(
            error
        );

        toast(
            "Não foi possível enviar o sticker."
        );
    }
}

if (exists("sticker-btn")) {
    $("sticker-btn")
        .addEventListener(
            "click",
            async () => {
                const picker =
                    $("sticker-picker");

                if (!picker) {
                    return;
                }

                picker.classList.toggle(
                    "hidden"
                );

                if (
                    picker.classList.contains(
                        "hidden"
                    )
                ) {
                    return;
                }

                picker.innerHTML = "";

                EMOJI_STICKERS
                    .forEach((emoji) => {
                        const button =
                            document.createElement(
                                "button"
                            );

                        button.type =
                            "button";

                        button.textContent =
                            emoji;

                        button.addEventListener(
                            "click",
                            async () => {
                                await sendSticker(
                                    {
                                        sticker:
                                            emoji
                                    }
                                );

                                picker
                                    .classList
                                    .add(
                                        "hidden"
                                    );
                            }
                        );

                        picker.appendChild(
                            button
                        );
                    });

                try {
                    const snapshot =
                        await safeGet(
                            `stickers/${currentUser.uid}`
                        );

                    const stickers =
                        snapshot.val() ||
                        {};

                    Object.values(
                        stickers
                    ).forEach(
                        (sticker) => {
                            if (
                                !sticker?.url
                            ) {
                                return;
                            }

                            const button =
                                document.createElement(
                                    "button"
                                );

                            button.type =
                                "button";

                            const image =
                                document.createElement(
                                    "img"
                                );

                            image.src =
                                sticker.url;

                            image.alt =
                                "Sticker";

                            image.loading =
                                "lazy";

                            image.style.width =
                                "32px";

                            image.style.height =
                                "32px";

                            image.style.objectFit =
                                "contain";

                            button.appendChild(
                                image
                            );

                            button.addEventListener(
                                "click",
                                async () => {
                                    await sendSticker(
                                        {
                                            stickerURL:
                                                sticker.url
                                        }
                                    );

                                    picker
                                        .classList
                                        .add(
                                            "hidden"
                                        );
                                }
                            );

                            picker.appendChild(
                                button
                            );
                        }
                    );

                    // =================================
                    // CRIAR STICKER
                    // =================================

                    const addButton =
                        document.createElement(
                            "button"
                        );

                    addButton.type =
                        "button";

                    addButton.textContent =
                        "+";

                    addButton.title =
                        "Criar figurinha";

                    addButton.addEventListener(
                        "click",
                        () => {
                            const input =
                                document.createElement(
                                    "input"
                                );

                            input.type =
                                "file";

                            input.accept =
                                "image/*";

                            input.addEventListener(
                                "change",
                                async () => {
                                    const file =
                                        input.files?.[0];

                                    if (!file) {
                                        return;
                                    }

                                    try {
                                        const base64 =
                                            await convertImage(
                                                file,
                                                {
                                                    maxWidth: 512,
                                                    maxHeight: 512,
                                                    quality: 0.82,
                                                    maxSizeMB: 3
                                                }
                                            );

                                        await safePush(
                                            `stickers/${currentUser.uid}`,
                                            {
                                                url:
                                                    base64,

                                                createdAt:
                                                    serverTimestamp()
                                            }
                                        );

                                        toast(
                                            "Figurinha criada."
                                        );

                                    } catch (
                                        error
                                    ) {
                                        console.error(
                                            error
                                        );

                                        toast(
                                            "Falha ao criar figurinha: " +
                                            error.message
                                        );
                                    }

                                    picker
                                        .classList
                                        .add(
                                            "hidden"
                                        );
                                }
                            );

                            input.click();
                        }
                    );

                    picker.appendChild(
                        addButton
                    );

                } catch (error) {
                    console.error(
                        error
                    );
                }
            }
        );
}

// =====================================================
// FÓRUM
// =====================================================

function listenForum() {
    if (
        !currentServerId ||
        !currentChannelId
    ) {
        return;
    }

    stopForumPostsListener();
    stopForumRepliesListener();

    const path =
        `posts/${currentServerId}/${currentChannelId}`;

    const reference =
        databaseRef(path);

    const callback =
        (snapshot) => {
            if (
                !exists(
                    "forum-posts"
                )
            ) {
                return;
            }

            const root =
                $("forum-posts");

            root.innerHTML = "";

            root.classList
                .remove("hidden");

            if (
                exists(
                    "forum-thread"
                )
            ) {
                $("forum-thread")
                    .classList
                    .add("hidden");
            }

            const value =
                snapshot.val() ||
                {};

            const entries =
                Object.entries(
                    value
                )
                    .sort(
                        (a, b) =>
                            normalizeTimestamp(
                                b[1]?.createdAt
                            ) -
                            normalizeTimestamp(
                                a[1]?.createdAt
                            )
                    );

            entries.forEach(
                ([id, post]) => {
                    const card =
                        document.createElement(
                            "div"
                        );

                    card.className =
                        "forum-post-card";

                    const timestamp =
                        normalizeTimestamp(
                            post?.createdAt
                        );

                    const time =
                        timestamp
                            ? new Date(
                                timestamp
                            ).toLocaleString(
                                "pt-BR"
                            )
                            : "";

                    const body =
                        String(
                            post?.body ||
                            ""
                        );

                    card.innerHTML = `
                        <h3>
                            ${escapeHTML(
                                post?.title ||
                                "Sem título"
                            )}
                        </h3>

                        <div class="meta">
                            por
                            ${escapeHTML(
                                post?.authorName ||
                                "Usuário"
                            )}
                            ${
                                time
                                    ? ` · ${escapeHTML(time)}`
                                    : ""
                            }
                        </div>

                        <p>
                            ${escapeHTML(
                                body.slice(
                                    0,
                                    140
                                )
                            )}
                            ${
                                body.length >
                                140
                                    ? "…"
                                    : ""
                            }
                        </p>
                    `;

                    card.addEventListener(
                        "click",
                        () =>
                            openThread(
                                id,
                                post
                            )
                    );

                    root.appendChild(
                        card
                    );
                }
            );

            if (!entries.length) {
                root.innerHTML =
                    '<p class="empty-hint">Nenhum tópico ainda. Crie o primeiro.</p>';
            }
        };

    onValue(
        reference,
        callback
    );

    forumPostsListener = {
        reference,
        callback
    };
}

// =====================================================
// ABRIR THREAD
// =====================================================

function openThread(
    postId,
    post
) {
    if (
        !currentServerId ||
        !currentChannelId ||
        !postId
    ) {
        return;
    }

    if (
        exists("forum-posts")
    ) {
        $("forum-posts")
            .classList
            .add("hidden");
    }

    if (
        exists("forum-thread")
    ) {
        $("forum-thread")
            .classList
            .remove("hidden");
    }

    const timestamp =
        normalizeTimestamp(
            post?.createdAt
        );

    const time =
        timestamp
            ? new Date(
                timestamp
            ).toLocaleString(
                "pt-BR"
            )
            : "";

    if (
        exists(
            "forum-thread-content"
        )
    ) {
        $("forum-thread-content")
            .innerHTML = `
                <h2>
                    ${escapeHTML(
                        post?.title ||
                        "Sem título"
                    )}
                </h2>

                <div
                    class="meta"
                    style="
                        color:var(--text-2);
                        font-size:12px;
                        margin-bottom:12px
                    "
                >
                    por
                    ${escapeHTML(
                        post?.authorName ||
                        "Usuário"
                    )}
                    ${
                        time
                            ? ` · ${escapeHTML(time)}`
                            : ""
                    }
                </div>

                <p
                    style="line-height:1.6"
                >
                    ${escapeHTML(
                        post?.body ||
                        ""
                    )}
                </p>

                <hr
                    style="
                        border-color:var(--line);
                        margin:16px 0
                    "
                >

                <div
                    id="thread-replies"
                ></div>

                <form
                    id="reply-form"
                    style="
                        display:flex;
                        gap:8px;
                        margin-top:12px
                    "
                >
                    <input
                        id="reply-input"
                        type="text"
                        placeholder="Responder..."
                        style="flex:1"
                        maxlength="2000"
                    >

                    <button
                        class="btn-primary"
                        type="submit"
                    >
                        Responder
                    </button>
                </form>
            `;
    }

    const repliesPath =
        `replies/${currentServerId}/${currentChannelId}/${postId}`;

    stopForumRepliesListener();

    const reference =
        databaseRef(
            repliesPath
        );

    const callback =
        (snapshot) => {
            const box =
                $("thread-replies");

            if (!box) {
                return;
            }

            box.innerHTML = "";

            const value =
                snapshot.val() ||
                {};

            Object.values(value)
                .sort(
                    (a, b) =>
                        normalizeTimestamp(
                            a?.createdAt
                        ) -
                        normalizeTimestamp(
                            b?.createdAt
                        )
                )
                .forEach((reply) => {
                    const element =
                        document.createElement(
                            "div"
                        );

                    element.style.cssText =
                        `
                            padding:8px 0;
                            border-top:1px solid var(--line);
                            font-size:14px;
                        `;

                    element.innerHTML = `
                        <b>
                            ${escapeHTML(
                                reply?.authorName ||
                                "Usuário"
                            )}
                        </b>:
                        ${escapeHTML(
                            reply?.text ||
                            ""
                        )}
                    `;

                    box.appendChild(
                        element
                    );
                });
        };

    onValue(
        reference,
        callback
    );

    forumRepliesListener = {
        reference,
        callback
    };

    const replyForm =
        $("reply-form");

    if (replyForm) {
        replyForm.addEventListener(
            "submit",
            async (event) => {
                event.preventDefault();

                const input =
                    $("reply-input");

                const text =
                    input?.value
                        ?.trim() || "";

                if (!text) {
                    return;
                }

                try {
                    await safePush(
                        repliesPath,
                        {
                            uid:
                                currentUser.uid,

                            authorName:
                                getCurrentDisplayName(),

                            text,

                            createdAt:
                                serverTimestamp()
                        }
                    );

                    input.value = "";

                } catch (error) {
                    console.error(
                        error
                    );

                    toast(
                        "Não foi possível responder."
                    );
                }
            }
        );
    }
}

// =====================================================
// NOVO POST
// =====================================================

if (exists("new-post-btn")) {
    $("new-post-btn")
        .addEventListener(
            "click",
            () => {
                if (
                    currentChannelType !==
                    "forum"
                ) {
                    toast(
                        "Abra um canal de fórum primeiro."
                    );

                    return;
                }

                openModal(
                    "modal-new-post"
                );
            }
        );
}

if (exists("back-to-forum")) {
    $("back-to-forum")
        .addEventListener(
            "click",
            () => {
                stopForumRepliesListener();

                if (
                    exists(
                        "forum-thread"
                    )
                ) {
                    $("forum-thread")
                        .classList
                        .add("hidden");
                }

                if (
                    exists(
                        "forum-posts"
                    )
                ) {
                    $("forum-posts")
                        .classList
                        .remove("hidden");
                }
            }
        );
}

if (exists("confirm-new-post")) {
    $("confirm-new-post")
        .addEventListener(
            "click",
            async () => {
                if (
                    !currentServerId ||
                    !currentChannelId
                ) {
                    toast(
                        "Selecione um fórum."
                    );

                    return;
                }

                const title =
                    $("new-post-title")
                        ?.value
                        .trim();

                const body =
                    $("new-post-body")
                        ?.value
                        .trim();

                if (!title || !body) {
                    toast(
                        "Preencha título e conteúdo."
                    );

                    return;
                }

                try {
                    await safePush(
                        `posts/${currentServerId}/${currentChannelId}`,
                        {
                            title,
                            body,

                            uid:
                                currentUser.uid,

                            authorName:
                                getCurrentDisplayName(),

                            createdAt:
                                serverTimestamp()
                        }
                    );

                    if (
                        exists(
                            "new-post-title"
                        )
                    ) {
                        $("new-post-title")
                            .value = "";
                    }

                    if (
                        exists(
                            "new-post-body"
                        )
                    ) {
                        $("new-post-body")
                            .value = "";
                    }

                    closeModals();

                    toast(
                        "Tópico criado."
                    );

                } catch (error) {
                    console.error(
                        error
                    );

                    toast(
                        "Erro ao criar tópico: " +
                        error.message
                    );
                }
            }
        );
}

// =====================================================
// VOZ / VÍDEO
// =====================================================

function setupVoiceView(channel) {
    if (
        exists(
            "voice-channel-name"
        )
    ) {
        $("voice-channel-name")
            .textContent =
            channel?.name ||
            "Canal de voz";
    }

    if (exists("join-voice-btn")) {
        $("join-voice-btn")
            .classList
            .remove("hidden");
    }

    if (exists("leave-voice-btn")) {
        $("leave-voice-btn")
            .classList
            .add("hidden");
    }

    if (exists("toggle-mic-btn")) {
        $("toggle-mic-btn")
            .classList
            .add("hidden");
    }

    if (exists("toggle-cam-btn")) {
        $("toggle-cam-btn")
            .classList
            .add("hidden");
    }

    if (exists("video-grid")) {
        $("video-grid")
            .innerHTML = "";
    }
}

if (exists("join-voice-btn")) {
    $("join-voice-btn")
        .addEventListener(
            "click",
            async () => {
                if (
                    !currentServerId ||
                    !currentChannelId
                ) {
                    return;
                }

                try {
                    await joinVoiceChannel({
                        serverId:
                            currentServerId,

                        channelId:
                            currentChannelId,

                        uid:
                            currentUser.uid,

                        displayName:
                            getCurrentDisplayName()
                    });

                    $("join-voice-btn")
                        .classList
                        .add("hidden");

                    $("leave-voice-btn")
                        .classList
                        .remove("hidden");

                    $("toggle-mic-btn")
                        .classList
                        .remove("hidden");

                    $("toggle-cam-btn")
                        .classList
                        .remove("hidden");

                } catch (error) {
                    console.error(
                        error
                    );

                    toast(
                        "Não foi possível acessar microfone/câmera: " +
                        error.message
                    );
                }
            }
        );
}

if (exists("leave-voice-btn")) {
    $("leave-voice-btn")
        .addEventListener(
            "click",
            () => {
                try {
                    leaveVoiceChannel();
                } catch (error) {
                    console.warn(
                        error
                    );
                }

                $("join-voice-btn")
                    .classList
                    .remove("hidden");

                $("leave-voice-btn")
                    .classList
                    .add("hidden");

                $("toggle-mic-btn")
                    .classList
                    .add("hidden");

                $("toggle-cam-btn")
                    .classList
                    .add("hidden");
            }
        );
}

if (exists("toggle-mic-btn")) {
    $("toggle-mic-btn")
        .addEventListener(
            "click",
            (event) => {
                try {
                    const enabled =
                        window
                            .devcordToggleMic
                            ?.();

                    event.currentTarget
                        .classList
                        .toggle(
                            "disabled",
                            enabled ===
                            false
                        );

                } catch (error) {
                    console.warn(
                        error
                    );
                }
            }
        );
}

if (exists("toggle-cam-btn")) {
    $("toggle-cam-btn")
        .addEventListener(
            "click",
            (event) => {
                try {
                    const enabled =
                        window
                            .devcordToggleCam
                            ?.();

                    event.currentTarget
                        .classList
                        .toggle(
                            "disabled",
                            enabled ===
                            false
                        );

                } catch (error) {
                    console.warn(
                        error
                    );
                }
            }
        );
}

// =====================================================
// PERFIL
// =====================================================

if (exists("open-profile-btn")) {
    $("open-profile-btn")
        .addEventListener(
            "click",
            () => {
                if (!userProfile) {
                    userProfile = {};
                }

                if (
                    exists(
                        "profile-avatar-preview"
                    )
                ) {
                    $("profile-avatar-preview")
                        .src =
                        getCurrentPhoto();
                }

                if (
                    exists(
                        "profile-name-input"
                    )
                ) {
                    $("profile-name-input")
                        .value =
                        userProfile.displayName ||
                        "";
                }

                if (
                    exists(
                        "profile-bio-input"
                    )
                ) {
                    $("profile-bio-input")
                        .value =
                        userProfile.bio ||
                        "";
                }

                if (
                    exists(
                        "profile-color-input"
                    )
                ) {
                    $("profile-color-input")
                        .value =
                        userProfile.accentColor ||
                        "#5ee6c4";
                }

                if (
                    exists(
                        "profile-font-input"
                    )
                ) {
                    $("profile-font-input")
                        .value =
                        userProfile.nameFont ||
                        "Inter";
                }

                if (
                    exists(
                        "profile-social-input"
                    )
                ) {
                    $("profile-social-input")
                        .value =
                        userProfile.socialLinks ||
                        "";
                }

                if (
                    exists(
                        "profile-banner-preview"
                    )
                ) {
                    $("profile-banner-preview")
                        .style.background =
                        userProfile.bannerURL
                            ? `url("${userProfile.bannerURL}") center/cover`
                            : "linear-gradient(135deg, var(--accent-dim), var(--bg-3))";
                }

                openModal(
                    "modal-profile"
                );
            }
        );
}

// =====================================================
// NOVO AVATAR
// =====================================================

if (exists("profile-avatar-input")) {
    $("profile-avatar-input")
        .addEventListener(
            "change",
            (event) => {
                const file =
                    event.target.files?.[0];

                if (
                    file &&
                    !file.type.startsWith(
                        "image/"
                    )
                ) {
                    toast(
                        "O avatar precisa ser uma imagem."
                    );

                    event.target.value =
                        "";

                    newAvatarFile =
                        null;

                    return;
                }

                newAvatarFile =
                    file || null;

                if (
                    newAvatarFile &&
                    exists(
                        "profile-avatar-preview"
                    )
                ) {
                    const url =
                        URL.createObjectURL(
                            newAvatarFile
                        );

                    $("profile-avatar-preview")
                        .src =
                        url;
                }
            }
        );
}

// =====================================================
// NOVO BANNER
// =====================================================

if (exists("profile-banner-input")) {
    $("profile-banner-input")
        .addEventListener(
            "change",
            (event) => {
                const file =
                    event.target.files?.[0];

                if (
                    file &&
                    !file.type.startsWith(
                        "image/"
                    )
                ) {
                    toast(
                        "O banner precisa ser uma imagem."
                    );

                    event.target.value =
                        "";

                    newBannerFile =
                        null;

                    return;
                }

                newBannerFile =
                    file || null;

                if (
                    newBannerFile &&
                    exists(
                        "profile-banner-preview"
                    )
                ) {
                    const url =
                        URL.createObjectURL(
                            newBannerFile
                        );

                    $("profile-banner-preview")
                        .style.background =
                        `url("${url}") center/cover`;
                }
            }
        );
}

// =====================================================
// SALVAR PERFIL
// =====================================================

if (exists("confirm-profile")) {
    $("confirm-profile")
        .addEventListener(
            "click",
            async () => {
                if (!currentUser) {
                    return;
                }

                const displayName =
                    $("profile-name-input")
                        ?.value
                        ?.trim() ||
                    userProfile?.displayName ||
                    "Usuário";

                const updates = {
                    displayName,

                    bio:
                        $("profile-bio-input")
                            ?.value
                            ?.trim() ||
                        "",

                    accentColor:
                        $("profile-color-input")
                            ?.value ||
                        "#5ee6c4",

                    nameFont:
                        $("profile-font-input")
                            ?.value ||
                        "Inter",

                    socialLinks:
                        $("profile-social-input")
                            ?.value
                            ?.trim() ||
                        ""
                };

                try {
                    // =================================
                    // AVATAR
                    // =================================

                    if (newAvatarFile) {
                        updates.photoURL =
                            await convertImage(
                                newAvatarFile,
                                {
                                    maxWidth: 512,
                                    maxHeight: 512,
                                    quality: 0.82,
                                    maxSizeMB: 5
                                }
                            );
                    }

                    // =================================
                    // BANNER
                    // =================================

                    if (newBannerFile) {
                        updates.bannerURL =
                            await convertImage(
                                newBannerFile,
                                {
                                    maxWidth: 1920,
                                    maxHeight: 1080,
                                    quality: 0.78,
                                    maxSizeMB: 8
                                }
                            );
                    }

                    // =================================
                    // RTDB
                    // =================================

                    await safeUpdate(
                        `users/${currentUser.uid}`,
                        updates
                    );

                    // =================================
                    // FIREBASE AUTH
                    //
                    // IMPORTANTE:
                    // Não mandamos o Base64 para
                    // photoURL do Auth.
                    //
                    // O Base64 fica somente no RTDB.
                    // =================================

                    await updateProfile(
                        currentUser,
                        {
                            displayName:
                                updates.displayName
                        }
                    );

                    userProfile = {
                        ...userProfile,
                        ...updates
                    };

                    newAvatarFile =
                        null;

                    newBannerFile =
                        null;

                    renderUserCard();

                    closeModals();

                    toast(
                        "Perfil atualizado."
                    );

                } catch (error) {
                    console.error(
                        error
                    );

                    toast(
                        "Falha ao salvar perfil: " +
                        error.message
                    );
                }
            }
        );
}

// =====================================================
// LOGOUT
// =====================================================

if (exists("logout-btn")) {
    $("logout-btn")
        .addEventListener(
            "click",
            async () => {
                try {
                    leaveVoiceChannel();
                } catch (error) {
                    console.warn(
                        error
                    );
                }

                stopChannelsListener();
                stopMessagesListener();
                stopForumPostsListener();
                stopForumRepliesListener();

                if (userServersListener) {
                    stopListener(
                        userServersListener
                    );

                    userServersListener =
                        null;
                }

                Object.keys(
                    serverListeners
                ).forEach((id) => {
                    stopListener(
                        serverListeners[id]
                    );

                    delete serverListeners[
                        id
                    ];
                });

                Object.keys(
                    serverCache
                ).forEach((id) => {
                    delete serverCache[
                        id
                    ];
                });

                currentUser =
                    null;

                userProfile =
                    null;

                currentServerId =
                    null;

                currentChannelId =
                    null;

                currentChannelType =
                    null;

                pendingFile =
                    null;

                await signOut(
                    auth
                );

                closeModals();

            }
        );
}

// =====================================================
// LIMPEZA AO FECHAR / RECARREGAR
// =====================================================

window.addEventListener(
    "beforeunload",
    () => {
        try {
            leaveVoiceChannel();
        } catch (error) {
            // Ignorar durante unload
        }
    }
);

// =====================================================
// DEBUG
// =====================================================

console.log(
    "%cDevCord carregado.",
    "font-weight:700"
);