// app.js — núcleo do DevCord:
// servidores, canais, chat, uploads, stickers, fórum e perfil
//
// Imagens:
// - Sem Cloudinary
// - Sem API externa de armazenamento
// - Imagens convertidas para Base64
// - Compressão automática antes de salvar no Firebase
//
// Tudo com Firebase Realtime Database.

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
// ESTADO
// =====================================================

let currentUser = null;
let userProfile = null;

let currentServerId = null;
let currentChannelId = null;
let currentChannelType = null;

let pendingFile = null;

let serverCache = {};
let serverUnsubs = {};

let unsubUserServers = null;
let unsubChannels = null;
let unsubMessages = null;
let unsubForumPosts = null;
let unsubForumReplies = null;


// =====================================================
// UTILITÁRIOS
// =====================================================

const $ = (id) => document.getElementById(id);


function toast(msg) {
    const t = $("toast");

    t.textContent = msg;
    t.classList.remove("hidden");

    clearTimeout(toast._t);

    toast._t = setTimeout(() => {
        t.classList.add("hidden");
    }, 2600);
}


function openModal(id) {
    $("modal-overlay").classList.remove("hidden");

    document
        .querySelectorAll(".modal")
        .forEach((m) => m.classList.add("hidden"));

    $(id).classList.remove("hidden");
}


function closeModals() {
    $("modal-overlay").classList.add("hidden");
}


document
    .querySelectorAll(".modal-cancel")
    .forEach((b) => {
        b.addEventListener("click", closeModals);
    });


$("modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") {
        closeModals();
    }
});


function defaultAvatar(seed) {
    return `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(seed)}`;
}


function escapeHTML(str) {
    const d = document.createElement("div");

    d.textContent = str ?? "";

    return d.innerHTML;
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
// BOOT AO LOGAR
// =====================================================

window.addEventListener(
    "devcord:signed-in",
    async (e) => {

        currentUser = e.detail;

        const snap = await get(
            ref(
                rtdb,
                `users/${currentUser.uid}`
            )
        );

        userProfile = snap.val();

        renderUserCard();

        listenServers();
    }
);


// =====================================================
// USUÁRIO
// =====================================================

function renderUserCard() {

    $("user-card-avatar").src =
        userProfile.photoURL ||
        defaultAvatar(currentUser.uid);

    $("user-card-name").textContent =
        userProfile.displayName ||
        "Usuário";

    $("user-card-name").style.fontFamily =
        userProfile.nameFont ||
        "Inter";

    $("user-card-status").textContent =
        userProfile.customStatus ||
        "Online";
}


// =====================================================
// SERVIDORES
// =====================================================

function listenServers() {

    const uServRef = ref(
        rtdb,
        `userServers/${currentUser.uid}`
    );

    onValue(uServRef, (snap) => {

        const ids = snap.exists()
            ? Object.keys(snap.val())
            : [];


        Object.keys(serverUnsubs).forEach((id) => {

            if (!ids.includes(id)) {

                off(
                    ref(rtdb, `servers/${id}`),
                    "value",
                    serverUnsubs[id]
                );

                delete serverUnsubs[id];
                delete serverCache[id];
            }
        });


        ids.forEach((id) => {

            if (!serverUnsubs[id]) {

                const sRef = ref(
                    rtdb,
                    `servers/${id}`
                );

                const cb = onValue(
                    sRef,
                    (s2) => {

                        serverCache[id] = {
                            id,
                            ...(s2.val() || {})
                        };

                        renderServerList();
                    }
                );

                serverUnsubs[id] = cb;
            }
        });


        renderServerList();
    });
}


function renderServerList() {

    const list = $("server-list");

    list.innerHTML = "";


    Object.values(serverCache).forEach((s) => {

        const btn = document.createElement("button");

        btn.className =
            "server-pill" +
            (
                s.id === currentServerId
                    ? " active"
                    : ""
            );

        btn.title = s.name || "";


        if (s.iconURL) {

            const img =
                document.createElement("img");

            img.src = s.iconURL;

            btn.appendChild(img);

        } else {

            btn.textContent =
                (s.name || "??")
                    .slice(0, 2)
                    .toUpperCase();
        }


        btn.addEventListener(
            "click",
            () => selectServer(s.id, s)
        );


        list.appendChild(btn);
    });
}


// =====================================================
// ENTRAR / CRIAR SERVIDOR
// =====================================================

$("add-server-btn").addEventListener(
    "click",
    () => {

        const action = prompt(
            "Digite 'criar' para criar um servidor novo, ou cole o ID de um servidor para entrar nele:"
        );

        if (!action) return;


        if (
            action
                .trim()
                .toLowerCase() === "criar"
        ) {

            openModal(
                "modal-create-server"
            );

        } else {

            joinServerById(
                action.trim()
            );
        }
    }
);


async function joinServerById(serverId) {

    try {

        const snap = await get(
            ref(
                rtdb,
                `servers/${serverId}`
            )
        );


        if (!snap.exists()) {

            toast(
                "Servidor não encontrado."
            );

            return;
        }


        await set(
            ref(
                rtdb,
                `serverMembers/${serverId}/${currentUser.uid}`
            ),
            true
        );


        await set(
            ref(
                rtdb,
                `userServers/${currentUser.uid}/${serverId}`
            ),
            true
        );


        toast(
            "Você entrou no servidor!"
        );

    } catch (err) {

        toast(
            "Não foi possível entrar: " +
            err.message
        );
    }
}


// =====================================================
// CRIAR SERVIDOR
// =====================================================

$("confirm-create-server").addEventListener(
    "click",
    async () => {

        const name =
            $("new-server-name")
                .value
                .trim();

        if (!name) {

            toast(
                "Dê um nome ao servidor."
            );

            return;
        }


        const file =
            $("new-server-icon")
                .files[0];


        const newRef =
            push(
                ref(
                    rtdb,
                    "servers"
                )
            );


        const serverId =
            newRef.key;


        await set(
            newRef,
            {
                name,

                ownerId:
                    currentUser.uid,

                iconURL: "",

                createdAt:
                    serverTimestamp()
            }
        );


        await set(
            ref(
                rtdb,
                `serverMembers/${serverId}/${currentUser.uid}`
            ),
            true
        );


        await set(
            ref(
                rtdb,
                `userServers/${currentUser.uid}/${serverId}`
            ),
            true
        );


        // =================================================
        // ÍCONE DO SERVIDOR → BASE64
        // =================================================

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


                await update(
                    ref(
                        rtdb,
                        `servers/${serverId}`
                    ),
                    {
                        iconURL: base64
                    }
                );

            } catch (err) {

                toast(
                    "Servidor criado, mas o ícone falhou: " +
                    err.message
                );
            }
        }


        $("new-server-name").value = "";

        $("new-server-icon").value = "";

        closeModals();


        toast(
            `Servidor "${name}" criado! ID de convite: ${serverId}`
        );


        selectServer(
            serverId,
            { name }
        );
    }
);


// =====================================================
// SELECIONAR SERVIDOR
// =====================================================

async function selectServer(
    serverId,
    serverData
) {

    currentServerId = serverId;

    currentChannelId = null;


    $("current-server-name")
        .textContent =
        serverData.name;


    $("server-settings-btn")
        .classList
        .remove("hidden");


    document
        .querySelectorAll(".server-pill")
        .forEach(
            (p) =>
                p.classList.remove("active")
        );


    $("home-pill")
        .classList
        .remove("active");


    renderServerList();

    listenChannels();
}


// =====================================================
// HOME
// =====================================================

$("home-pill").addEventListener(
    "click",
    () => {

        currentServerId = null;

        currentChannelId = null;


        $("current-server-name")
            .textContent =
            "Bem-vindo";


        $("server-settings-btn")
            .classList
            .add("hidden");


        $("channel-groups")
            .innerHTML =
            '<p class="empty-hint">Crie ou entre em um servidor pra ver os canais aqui.</p>';


        showView(null);


        document
            .querySelectorAll(".server-pill")
            .forEach(
                (p) =>
                    p.classList.remove("active")
            );


        $("home-pill")
            .classList
            .add("active");
    }
);


// =====================================================
// CONFIGURAÇÕES DO SERVIDOR
// =====================================================

$("server-settings-btn").addEventListener(
    "click",
    () => {

        if (!currentServerId) return;


        const choice = prompt(
            `ID de convite deste servidor (compartilhe para outras pessoas entrarem):\n${currentServerId}\n\nDigite 'canal' para criar um novo canal, ou cancele.`
        );


        if (
            choice &&
            choice
                .trim()
                .toLowerCase() === "canal"
        ) {

            openModal(
                "modal-create-channel"
            );
        }
    }
);


// =====================================================
// CANAIS
// =====================================================

function listenChannels() {

    if (unsubChannels) {

        off(
            ref(
                rtdb,
                `channels/${currentServerId}`
            ),
            "value",
            unsubChannels
        );
    }


    const chRef =
        ref(
            rtdb,
            `channels/${currentServerId}`
        );


    unsubChannels =
        onValue(
            chRef,
            (snap) => {

                const groups = {
                    text: [],
                    voice: [],
                    forum: []
                };


                const val =
                    snap.val() || {};


                Object.entries(val)
                    .sort(
                        (a, b) =>
                            (a[1].createdAt || 0) -
                            (b[1].createdAt || 0)
                    )
                    .forEach(
                        ([id, data]) =>
                            groups[data.type]?.push({
                                id,
                                ...data
                            })
                    );


                renderChannels(groups);
            }
        );
}


const TYPE_LABEL = {
    text: "Canais de texto",
    voice: "Canais de voz",
    forum: "Fóruns"
};


const TYPE_ICON = {
    text: "#",
    voice: "🔊",
    forum: "🗂"
};


function renderChannels(groups) {

    const root =
        $("channel-groups");

    root.innerHTML = "";


    Object.keys(groups).forEach(
        (type) => {

            const label =
                document.createElement(
                    "div"
                );


            label.className =
                "channel-group-label";


            label.innerHTML =
                `<span>${TYPE_LABEL[type]}</span>`;


            const addBtn =
                document.createElement(
                    "button"
                );


            addBtn.textContent = "+";

            addBtn.title =
                "Criar canal";


            addBtn.addEventListener(
                "click",
                () => {

                    openModal(
                        "modal-create-channel"
                    );

                    $("new-channel-type")
                        .value =
                        type;
                }
            );


            label.appendChild(addBtn);

            root.appendChild(label);


            groups[type].forEach(
                (ch) => {

                    const item =
                        document.createElement(
                            "div"
                        );


                    item.className =
                        "channel-item" +
                        (
                            ch.id === currentChannelId
                                ? " active"
                                : ""
                        );


                    item.innerHTML =
                        `<span class="ch-icon">${TYPE_ICON[type]}</span><span>${escapeHTML(ch.name)}</span>`;


                    item.addEventListener(
                        "click",
                        () =>
                            selectChannel(ch)
                    );


                    root.appendChild(item);
                }
            );


            if (!groups[type].length) {

                const empty =
                    document.createElement(
                        "p"
                    );


                empty.className =
                    "empty-hint";


                empty.textContent =
                    "Nenhum canal ainda.";


                root.appendChild(empty);
            }
        }
    );
}


// =====================================================
// CRIAR CANAL
// =====================================================

$("confirm-create-channel").addEventListener(
    "click",
    async () => {

        const name =
            $("new-channel-name")
                .value
                .trim()
                .toLowerCase()
                .replace(/\s+/g, "-");


        const type =
            $("new-channel-type")
                .value;


        if (!name) {

            toast(
                "Dê um nome ao canal."
            );

            return;
        }


        await push(
            ref(
                rtdb,
                `channels/${currentServerId}`
            ),
            {
                name,
                type,
                createdAt:
                    serverTimestamp()
            }
        );


        $("new-channel-name")
            .value = "";


        closeModals();
    }
);


// =====================================================
// SELECIONAR CANAL
// =====================================================

function selectChannel(ch) {

    if (
        currentChannelType === "voice" &&
        currentChannelId !== ch.id
    ) {

        leaveVoiceChannel();
    }


    currentChannelId =
        ch.id;


    currentChannelType =
        ch.type;


    $("channel-title")
        .textContent =
        (
            ch.type === "text"
                ? "# "
                : ch.type === "voice"
                    ? "🔊 "
                    : "🗂 "
        ) + ch.name;


    document
        .querySelectorAll(".channel-item")
        .forEach(
            (el) =>
                el.classList.remove("active")
        );


    showView(ch.type);


    if (ch.type === "text") {
        listenMessages();
    }


    if (ch.type === "voice") {
        setupVoiceView(ch);
    }


    if (ch.type === "forum") {
        listenForum();
    }


    $("call-btn")
        .classList
        .toggle(
            "hidden",
            ch.type !== "voice"
        );
}


// =====================================================
// VIEWS
// =====================================================

function showView(type) {

    [
        "text",
        "voice",
        "forum"
    ].forEach(
        (t) =>
            $("view-" + t)
                .classList
                .toggle(
                    "hidden",
                    t !== type
                )
    );
}


// =====================================================
// MENSAGENS
// =====================================================

function listenMessages() {

    const path =
        `messages/${currentServerId}/${currentChannelId}`;


    if (unsubMessages) {

        off(
            ref(
                rtdb,
                unsubMessages.path
            ),
            "value",
            unsubMessages.cb
        );
    }


    const mRef =
        ref(
            rtdb,
            path
        );


    const cb =
        onValue(
            mRef,
            (snap) => {

                const box =
                    $("messages");


                box.innerHTML = "";


                const val =
                    snap.val() || {};


                Object.values(val)
                    .sort(
                        (a, b) =>
                            (a.createdAt || 0) -
                            (b.createdAt || 0)
                    )
                    .forEach(renderMessage);


                box.scrollTop =
                    box.scrollHeight;
            }
        );


    unsubMessages = {
        path,
        cb
    };
}


function renderMessage(m) {

    const box =
        $("messages");


    const el =
        document.createElement(
            "div"
        );


    el.className =
        "msg";


    const time =
        m.createdAt
            ? new Date(
                m.createdAt
            ).toLocaleTimeString(
                "pt-BR",
                {
                    hour: "2-digit",
                    minute: "2-digit"
                }
            )
            : "";


    let mediaHtml = "";


    if (m.imageURL) {

        mediaHtml =
            `<div class="msg-media"><img src="${m.imageURL}" loading="lazy" /></div>`;
    }


    if (m.videoURL) {

        mediaHtml =
            `<div class="msg-media"><video src="${m.videoURL}" controls></video></div>`;
    }


    if (m.sticker) {

        mediaHtml =
            `<div class="msg-sticker">${m.sticker}</div>`;
    }


    if (m.stickerURL) {

        mediaHtml =
            `<div class="msg-media"><img src="${m.stickerURL}" style="max-width:120px" /></div>`;
    }


    el.innerHTML = `
        <img
            class="avatar avatar-sm"
            src="${m.authorPhoto || defaultAvatar(m.uid)}"
        />

        <div class="msg-body">

            <div class="msg-head">
                <span
                    class="msg-author"
                    style="color:${m.authorColor || "var(--text-0)"}"
                >
                    ${escapeHTML(m.authorName || "Usuário")}
                </span>

                <span class="msg-time">
                    ${time}
                </span>
            </div>

            ${
                m.text
                    ? `<div class="msg-text">${escapeHTML(m.text)}</div>`
                    : ""
            }

            ${mediaHtml}

        </div>
    `;


    box.appendChild(el);
}


// =====================================================
// ENVIAR MENSAGEM
// =====================================================

$("message-form").addEventListener(
    "submit",
    async (e) => {

        e.preventDefault();


        const input =
            $("message-input");


        const text =
            input.value.trim();


        if (!text && !pendingFile) {
            return;
        }


        const base = {

            uid:
                currentUser.uid,

            authorName:
                userProfile.displayName,

            authorPhoto:
                userProfile.photoURL || "",

            authorColor:
                userProfile.accentColor ||
                "#5ee6c4",

            text:
                text || "",

            createdAt:
                serverTimestamp()
        };


        // =================================================
        // IMAGEM → BASE64
        // =================================================

        if (pendingFile) {

            try {

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


                base.imageURL =
                    base64;


            } catch (err) {

                toast(
                    "Falha na imagem: " +
                    err.message
                );

                return;
            }


            pendingFile = null;


            $("attach-preview")
                .classList
                .add("hidden");
        }


        input.value = "";


        await push(
            ref(
                rtdb,
                `messages/${currentServerId}/${currentChannelId}`
            ),
            base
        );
    }
);


// =====================================================
// ANEXO
// =====================================================

$("attach-btn").addEventListener(
    "click",
    () =>
        $("file-input").click()
);


$("file-input").addEventListener(
    "change",
    (e) => {

        const file =
            e.target.files[0];


        if (!file) {
            pendingFile = null;
            return;
        }


        if (
            !file.type ||
            !file.type.startsWith("image/")
        ) {

            toast(
                "Somente imagens são permitidas."
            );

            e.target.value = "";

            pendingFile = null;

            $("attach-preview")
                .classList
                .add("hidden");

            return;
        }


        pendingFile = file;


        $("attach-preview")
            .textContent =
            "🖼️ " + file.name;


        $("attach-preview")
            .classList
            .remove("hidden");
    }
);


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


$("sticker-btn").addEventListener(
    "click",
    async () => {

        const picker =
            $("sticker-picker");


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


        // =================================================
        // EMOJIS
        // =================================================

        EMOJI_STICKERS.forEach(
            (emoji) => {

                const b =
                    document.createElement(
                        "button"
                    );


                b.textContent =
                    emoji;


                b.addEventListener(
                    "click",
                    async () => {

                        await push(
                            ref(
                                rtdb,
                                `messages/${currentServerId}/${currentChannelId}`
                            ),
                            {

                                uid:
                                    currentUser.uid,

                                authorName:
                                    userProfile.displayName,

                                authorPhoto:
                                    userProfile.photoURL ||
                                    "",

                                authorColor:
                                    userProfile.accentColor ||
                                    "#5ee6c4",

                                sticker:
                                    emoji,

                                createdAt:
                                    serverTimestamp()
                            }
                        );


                        picker
                            .classList
                            .add("hidden");
                    }
                );


                picker.appendChild(b);
            }
        );


        // =================================================
        // FIGURINHAS PERSONALIZADAS
        // =================================================

        const snap =
            await get(
                ref(
                    rtdb,
                    `stickers/${currentUser.uid}`
                )
            );


        Object.values(
            snap.val() || {}
        ).forEach(
            (s) => {

                const b =
                    document.createElement(
                        "button"
                    );


                b.innerHTML =
                    `<img src="${s.url}" style="width:32px;height:32px;object-fit:cover;border-radius:4px" />`;


                b.addEventListener(
                    "click",
                    async () => {

                        await push(
                            ref(
                                rtdb,
                                `messages/${currentServerId}/${currentChannelId}`
                            ),
                            {

                                uid:
                                    currentUser.uid,

                                authorName:
                                    userProfile.displayName,

                                authorPhoto:
                                    userProfile.photoURL ||
                                    "",

                                authorColor:
                                    userProfile.accentColor ||
                                    "#5ee6c4",

                                stickerURL:
                                    s.url,

                                createdAt:
                                    serverTimestamp()
                            }
                        );


                        picker
                            .classList
                            .add("hidden");
                    }
                );


                picker.appendChild(b);
            }
        );


        // =================================================
        // CRIAR FIGURINHA
        // =================================================

        const addBtn =
            document.createElement(
                "button"
            );


        addBtn.textContent =
            "+";


        addBtn.title =
            "Criar figurinha";


        addBtn.addEventListener(
            "click",
            () => {

                const inp =
                    document.createElement(
                        "input"
                    );


                inp.type =
                    "file";


                inp.accept =
                    "image/*";


                inp.onchange =
                    async () => {

                        const file =
                            inp.files[0];


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


                            await push(
                                ref(
                                    rtdb,
                                    `stickers/${currentUser.uid}`
                                ),
                                {
                                    url: base64,

                                    createdAt:
                                        serverTimestamp()
                                }
                            );


                            toast(
                                "Figurinha criada!"
                            );


                        } catch (err) {

                            toast(
                                "Falha na imagem: " +
                                err.message
                            );
                        }


                        picker
                            .classList
                            .add("hidden");
                    };


                inp.click();
            }
        );


        picker.appendChild(addBtn);
    }
);


// =====================================================
// FÓRUM
// =====================================================

function listenForum() {

    const path =
        `posts/${currentServerId}/${currentChannelId}`;


    if (unsubForumPosts) {

        off(
            ref(
                rtdb,
                unsubForumPosts.path
            ),
            "value",
            unsubForumPosts.cb
        );
    }


    const pRef =
        ref(
            rtdb,
            path
        );


    const cb =
        onValue(
            pRef,
            (snap) => {

                const root =
                    $("forum-posts");


                root.innerHTML = "";


                root.classList
                    .remove("hidden");


                $("forum-thread")
                    .classList
                    .add("hidden");


                const val =
                    snap.val() || {};


                const entries =
                    Object.entries(val)
                        .sort(
                            (a, b) =>
                                (b[1].createdAt || 0) -
                                (a[1].createdAt || 0)
                        );


                entries.forEach(
                    ([id, p]) => {

                        const card =
                            document.createElement(
                                "div"
                            );


                        card.className =
                            "forum-post-card";


                        const time =
                            p.createdAt
                                ? new Date(
                                    p.createdAt
                                ).toLocaleString(
                                    "pt-BR"
                                )
                                : "";


                        card.innerHTML =
                            `
                            <h3>
                                ${escapeHTML(p.title)}
                            </h3>

                            <div class="meta">
                                por ${escapeHTML(p.authorName)}
                                · ${time}
                            </div>

                            <p>
                                ${escapeHTML(
                                    (p.body || "").slice(
                                        0,
                                        140
                                    )
                                )}
                                ${
                                    p.body?.length > 140
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
                                    p
                                )
                        );


                        root.appendChild(card);
                    }
                );


                if (!entries.length) {

                    root.innerHTML =
                        '<p class="empty-hint">Nenhum tópico ainda. Crie o primeiro!</p>';
                }
            }
        );


    unsubForumPosts = {
        path,
        cb
    };
}


function openThread(
    postId,
    post
) {

    $("forum-posts")
        .classList
        .add("hidden");


    $("forum-thread")
        .classList
        .remove("hidden");


    const time =
        post.createdAt
            ? new Date(
                post.createdAt
            ).toLocaleString(
                "pt-BR"
            )
            : "";


    $("forum-thread-content")
        .innerHTML = `
            <h2>
                ${escapeHTML(post.title)}
            </h2>

            <div
                class="meta"
                style="color:var(--text-2);font-size:12px;margin-bottom:12px"
            >
                por ${escapeHTML(post.authorName)}
                · ${time}
            </div>

            <p
                style="line-height:1.6"
            >
                ${escapeHTML(post.body)}
            </p>

            <hr
                style="border-color:var(--line);margin:16px 0"
            />

            <div id="thread-replies"></div>

            <form
                id="reply-form"
                style="display:flex;gap:8px;margin-top:12px"
            >

                <input
                    id="reply-input"
                    type="text"
                    placeholder="Responder..."
                    style="flex:1"
                />

                <button
                    class="btn-primary"
                    type="submit"
                >
                    Responder
                </button>

            </form>
        `;


    const repliesPath =
        `replies/${currentServerId}/${currentChannelId}/${postId}`;


    if (unsubForumReplies) {

        off(
            ref(
                rtdb,
                unsubForumReplies.path
            ),
            "value",
            unsubForumReplies.cb
        );
    }


    const rRef =
        ref(
            rtdb,
            repliesPath
        );


    const cb =
        onValue(
            rRef,
            (snap) => {

                const box =
                    $("thread-replies");


                if (!box) return;


                box.innerHTML = "";


                const val =
                    snap.val() || {};


                Object.values(val)
                    .sort(
                        (a, b) =>
                            (a.createdAt || 0) -
                            (b.createdAt || 0)
                    )
                    .forEach(
                        (r) => {

                            const el =
                                document.createElement(
                                    "div"
                                );


                            el.style.cssText =
                                "padding:8px 0;border-top:1px solid var(--line);font-size:14px";


                            el.innerHTML =
                                `<b>${escapeHTML(r.authorName)}:</b> ${escapeHTML(r.text)}`;


                            box.appendChild(el);
                        }
                    );
            }
        );


    unsubForumReplies = {
        path: repliesPath,
        cb
    };


    $("reply-form").addEventListener(
        "submit",
        async (e) => {

            e.preventDefault();


            const inp =
                $("reply-input");


            if (!inp.value.trim()) {
                return;
            }


            await push(
                ref(
                    rtdb,
                    repliesPath
                ),
                {
                    uid:
                        currentUser.uid,

                    authorName:
                        userProfile.displayName,

                    text:
                        inp.value.trim(),

                    createdAt:
                        serverTimestamp()
                }
            );


            inp.value = "";
        }
    );
}


$("new-post-btn").addEventListener(
    "click",
    () =>
        openModal(
            "modal-new-post"
        )
);


$("back-to-forum").addEventListener(
    "click",
    () => {

        $("forum-thread")
            .classList
            .add("hidden");


        $("forum-posts")
            .classList
            .remove("hidden");
    }
);


$("confirm-new-post").addEventListener(
    "click",
    async () => {

        const title =
            $("new-post-title")
                .value
                .trim();


        const body =
            $("new-post-body")
                .value
                .trim();


        if (!title || !body) {

            toast(
                "Preencha título e conteúdo."
            );

            return;
        }


        await push(
            ref(
                rtdb,
                `posts/${currentServerId}/${currentChannelId}`
            ),
            {

                title,

                body,

                uid:
                    currentUser.uid,

                authorName:
                    userProfile.displayName,

                createdAt:
                    serverTimestamp()
            }
        );


        $("new-post-title")
            .value = "";


        $("new-post-body")
            .value = "";


        closeModals();
    }
);


// =====================================================
// VOZ / VÍDEO
// =====================================================

function setupVoiceView(ch) {

    $("voice-channel-name")
        .textContent =
        "🔊 " + ch.name;


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


    $("video-grid")
        .innerHTML = "";
}


$("join-voice-btn").addEventListener(
    "click",
    async () => {

        try {

            await joinVoiceChannel({

                serverId:
                    currentServerId,

                channelId:
                    currentChannelId,

                uid:
                    currentUser.uid,

                displayName:
                    userProfile.displayName
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


        } catch (err) {

            toast(
                "Não deu pra acessar microfone/câmera: " +
                err.message
            );
        }
    }
);


$("leave-voice-btn").addEventListener(
    "click",
    () => {

        leaveVoiceChannel();


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


$("toggle-mic-btn").addEventListener(
    "click",
    (e) => {

        const on =
            window.devcordToggleMic?.();


        e.target.style.color =
            on
                ? ""
                : "var(--danger)";
    }
);


$("toggle-cam-btn").addEventListener(
    "click",
    (e) => {

        const on =
            window.devcordToggleCam?.();


        e.target.style.color =
            on
                ? ""
                : "var(--danger)";
    }
);


// =====================================================
// PERFIL
// =====================================================

$("open-profile-btn").addEventListener(
    "click",
    () => {

        $("profile-avatar-preview")
            .src =
            userProfile.photoURL ||
            defaultAvatar(
                currentUser.uid
            );


        $("profile-name-input")
            .value =
            userProfile.displayName ||
            "";


        $("profile-bio-input")
            .value =
            userProfile.bio ||
            "";


        $("profile-color-input")
            .value =
            userProfile.accentColor ||
            "#5ee6c4";


        $("profile-font-input")
            .value =
            userProfile.nameFont ||
            "Inter";


        $("profile-social-input")
            .value =
            userProfile.socialLinks ||
            "";


        $("profile-banner-preview")
            .style.background =
            userProfile.bannerURL
                ? `url(${userProfile.bannerURL}) center/cover`
                : "linear-gradient(135deg, var(--accent-dim), var(--bg-3))";


        openModal(
            "modal-profile"
        );
    }
);


let newAvatarFile = null;
let newBannerFile = null;


$("profile-avatar-input")
    .addEventListener(
        "change",
        (e) => {

            const file =
                e.target.files[0];


            if (
                file &&
                !file.type.startsWith(
                    "image/"
                )
            ) {

                toast(
                    "O avatar precisa ser uma imagem."
                );

                e.target.value = "";

                newAvatarFile = null;

                return;
            }


            newAvatarFile =
                file;


            if (newAvatarFile) {

                $("profile-avatar-preview")
                    .src =
                    URL.createObjectURL(
                        newAvatarFile
                    );
            }
        }
    );


$("profile-banner-input")
    .addEventListener(
        "change",
        (e) => {

            const file =
                e.target.files[0];


            if (
                file &&
                !file.type.startsWith(
                    "image/"
                )
            ) {

                toast(
                    "O banner precisa ser uma imagem."
                );

                e.target.value = "";

                newBannerFile = null;

                return;
            }


            newBannerFile =
                file;


            if (newBannerFile) {

                $("profile-banner-preview")
                    .style.background =
                    `url(${URL.createObjectURL(newBannerFile)}) center/cover`;
            }
        }
    );


// =====================================================
// SALVAR PERFIL
// =====================================================

$("confirm-profile").addEventListener(
    "click",
    async () => {

        const updates = {

            displayName:
                $("profile-name-input")
                    .value
                    .trim() ||
                userProfile.displayName,

            bio:
                $("profile-bio-input")
                    .value
                    .trim(),

            accentColor:
                $("profile-color-input")
                    .value,

            nameFont:
                $("profile-font-input")
                    .value,

            socialLinks:
                $("profile-social-input")
                    .value
                    .trim()
        };


        try {

            // =============================================
            // AVATAR → BASE64
            // =============================================

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


            // =============================================
            // BANNER → BASE64
            // =============================================

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


        } catch (err) {

            toast(
                "Falha na imagem: " +
                err.message
            );

            return;
        }


        // =============================================
        // SALVAR NO FIREBASE
        // =============================================

        await update(
            ref(
                rtdb,
                `users/${currentUser.uid}`
            ),
            updates
        );


        await updateProfile(
            currentUser,
            {
                displayName:
                    updates.displayName,

                photoURL:
                    updates.photoURL ||
                    userProfile.photoURL ||
                    ""
            }
        );


        userProfile = {
            ...userProfile,
            ...updates
        };


        newAvatarFile = null;
        newBannerFile = null;


        renderUserCard();


        closeModals();


        toast(
            "Perfil atualizado!"
        );
    }
);


// =====================================================
// LOGOUT
// =====================================================

$("logout-btn").addEventListener(
    "click",
    async () => {

        leaveVoiceChannel();

        await signOut(auth);

        closeModals();
    }
);