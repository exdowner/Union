// webrtc.js
// Chamadas de voz/vídeo WebRTC usando o Firebase Realtime Database
// como sinalização.
// Não usa Cloudinary, servidor externo de mídia ou serviço pago.

import { rtdb } from "./firebase-config.js";

import {
    ref,
    set,
    remove,
    push,
    onValue,
    onChildAdded,
    off
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";


// ============================================================
// CONFIGURAÇÃO WEBRTC
// ============================================================

const ICE_SERVERS = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302"
        },
        {
            urls: "stun:stun1.l.google.com:19302"
        }
    ]
};


// ============================================================
// ESTADO
// ============================================================

let localStream = null;

let micOn = true;
let camOn = true;

let ctx = null;

const peers = {};

const listeners = {};

let presenceListener = null;


// ============================================================
// HELPERS
// ============================================================

const $ = (id) => document.getElementById(id);


function presencePath() {
    if (!ctx) return null;

    return `voicePresence/${ctx.serverId}/${ctx.channelId}`;
}


function callKey(peerUid) {
    return [ctx.uid, peerUid]
        .sort()
        .join("_");
}


function callPath(peerUid) {
    return `calls/${ctx.serverId}_${ctx.channelId}_${callKey(peerUid)}`;
}


function escapeHTML(value) {
    const div = document.createElement("div");

    div.textContent = value ?? "";

    return div.innerHTML;
}


// ============================================================
// ENTRAR NO CANAL
// ============================================================

export async function joinVoiceChannel({
    serverId,
    channelId,
    uid,
    displayName
}) {

    // Evita entrar duas vezes
    if (ctx) {
        leaveVoiceChannel();
    }


    ctx = {
        serverId,
        channelId,
        uid,
        displayName
    };


    micOn = true;
    camOn = false; // câmera só quando o usuário ligar

    // ========================================================
    // MICROFONE (áudio). Câmera opcional depois.
    // ========================================================

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
        });
    } catch (audioError) {
        console.error("Não foi possível acessar microfone.", audioError);
        ctx = null;
        throw new Error("Não foi possível acessar o microfone.");
    }


    // ========================================================
    // VÍDEO LOCAL
    // ========================================================

    addVideoTile(
        uid,
        `${displayName || "Você"} (você)`,
        localStream,
        true
    );


    // ========================================================
    // PRESENÇA
    // ========================================================

    const myPresenceRef =
        ref(rtdb, `${presencePath()}/${uid}`);


    await set(myPresenceRef, {
        displayName: displayName || "Usuário",
        joinedAt: Date.now()
    });


    // ========================================================
    // ESCUTA PARTICIPANTES
    // ========================================================

    presenceListener = onValue(
        ref(rtdb, presencePath()),
        async (snapshot) => {

            if (!ctx) return;


            const users =
                snapshot.val() || {};


            const currentPeers =
                Object.keys(users)
                    .filter((id) => id !== ctx.uid);


            // ------------------------------------------------
            // CONECTAR COM NOVOS USUÁRIOS
            // ------------------------------------------------

            for (const peerUid of currentPeers) {

                if (peers[peerUid]) {
                    continue;
                }


                const peerName =
                    users[peerUid]?.displayName ||
                    "Usuário";


                /*
                 * Para cada par:
                 *
                 * o UID menor cria a oferta.
                 * o UID maior espera a oferta.
                 *
                 * Isso evita dois offers simultâneos.
                 */

                if (ctx.uid < peerUid) {

                    try {

                        await startCall(
                            peerUid,
                            peerName
                        );

                    } catch (error) {

                        console.error(
                            "Erro iniciando chamada:",
                            error
                        );
                    }

                } else {

                    listenForIncomingCall(
                        peerUid,
                        peerName
                    );
                }
            }


            // ------------------------------------------------
            // REMOVER QUEM SAIU
            // ------------------------------------------------

            Object.keys(peers).forEach(
                (peerUid) => {

                    if (
                        !currentPeers.includes(peerUid)
                    ) {
                        closePeer(peerUid);
                    }
                }
            );


            renderParticipants(users);
        }
    );
}


// ============================================================
// PARTICIPANTES
// ============================================================

function renderParticipants(users) {

    const box =
        $("voice-participants");


    if (!box) return;


    box.innerHTML = "";


    Object.entries(users).forEach(
        ([uid, user]) => {

            const element =
                document.createElement("div");


            element.className =
                "voice-participant";


            const avatar =
                document.createElement("div");


            avatar.className =
                "avatar avatar-sm";


            avatar.style.cssText =
                `
                display:flex;
                align-items:center;
                justify-content:center;
                background:var(--bg-3);
                `;


            avatar.textContent =
                getInitial(
                    user?.displayName
                );


            const name =
                document.createElement("span");


            name.textContent =
                uid === ctx?.uid
                    ? `${user?.displayName || "Usuário"} (você)`
                    : user?.displayName || "Usuário";


            element.appendChild(avatar);
            element.appendChild(name);

            box.appendChild(element);
        }
    );
}


function getInitial(name) {

    const text =
        String(name || "U")
            .trim();


    return (
        text.charAt(0).toUpperCase() ||
        "U"
    );
}


// ============================================================
// CRIAR CONEXÃO
// ============================================================

function createPeerConnection(
    peerUid,
    peerName
) {

    if (!localStream) {
        throw new Error(
            "Stream local não está disponível."
        );
    }


    const pc =
        new RTCPeerConnection(
            ICE_SERVERS
        );


    // --------------------------------------------------------
    // STREAM LOCAL
    // --------------------------------------------------------

    localStream
        .getTracks()
        .forEach((track) => {

            pc.addTrack(
                track,
                localStream
            );
        });


    // --------------------------------------------------------
    // STREAM REMOTA
    // --------------------------------------------------------

    const remoteStream =
        new MediaStream();


    addVideoTile(
        peerUid,
        peerName,
        remoteStream,
        false
    );


    pc.ontrack = (event) => {

        const stream =
            event.streams?.[0];


        if (stream) {

            stream
                .getTracks()
                .forEach((track) => {

                    const exists =
                        remoteStream
                            .getTracks()
                            .some(
                                (t) =>
                                    t.id === track.id
                            );


                    if (!exists) {

                        remoteStream.addTrack(
                            track
                        );
                    }
                });

        } else {

            remoteStream.addTrack(
                event.track
            );
        }
    };


    // --------------------------------------------------------
    // ICE CONNECTION
    // --------------------------------------------------------

    pc.oniceconnectionstatechange = () => {

        const state =
            pc.iceConnectionState;


        console.log(
            `[WebRTC] ${peerUid}:`,
            state
        );


        if (
            state === "failed" ||
            state === "closed"
        ) {

            closePeer(
                peerUid
            );
        }
    };


    pc.onconnectionstatechange = () => {

        console.log(
            `[WebRTC] conexão ${peerUid}:`,
            pc.connectionState
        );


        if (
            pc.connectionState ===
                "failed" ||
            pc.connectionState ===
                "closed"
        ) {

            closePeer(
                peerUid
            );
        }
    };


    peers[peerUid] = pc;


    return pc;
}


// ============================================================
// CHAMADA DE SAÍDA
// ============================================================

async function startCall(
    peerUid,
    peerName
) {

    if (!ctx) return;

    if (peers[peerUid]) return;


    const pc =
        createPeerConnection(
            peerUid,
            peerName
        );


    const base =
        callPath(peerUid);


    listeners[peerUid] = {
        answer: null,
        calleeCandidates: null,
        offer: null,
        callerCandidates: null
    };


    // --------------------------------------------------------
    // ICE LOCAL
    // --------------------------------------------------------

    pc.onicecandidate = (event) => {

        if (!event.candidate) {
            return;
        }


        push(
            ref(
                rtdb,
                `${base}/callerCandidates`
            ),
            event.candidate.toJSON()
        ).catch((error) => {

            console.error(
                "Erro salvando ICE caller:",
                error
            );
        });
    };


    // --------------------------------------------------------
    // OFFER
    // --------------------------------------------------------

    const offer =
        await pc.createOffer();


    await pc.setLocalDescription(
        offer
    );


    await set(
        ref(rtdb, base),
        {
            offer: {
                type: offer.type,
                sdp: offer.sdp
            },

            from: ctx.uid,

            to: peerUid
        }
    );


    // --------------------------------------------------------
    // ANSWER
    // --------------------------------------------------------

    const answerRef =
        ref(
            rtdb,
            `${base}/answer`
        );


    const answerListener =
        onValue(
            answerRef,
            async (snapshot) => {

                if (!peers[peerUid]) {
                    return;
                }


                const answer =
                    snapshot.val();


                if (!answer) {
                    return;
                }


                try {

                    if (
                        pc.signalingState !==
                        "stable"
                    ) {

                        await pc.setRemoteDescription(
                            new RTCSessionDescription(
                                answer
                            )
                        );
                    }

                } catch (error) {

                    console.error(
                        "Erro aplicando answer:",
                        error
                    );
                }
            }
        );


    listeners[peerUid].answer =
        {
            type: "value",
            ref: answerRef,
            callback: answerListener
        };


    // --------------------------------------------------------
    // ICE DO CALLEE
    // --------------------------------------------------------

    const candidateRef =
        ref(
            rtdb,
            `${base}/calleeCandidates`
        );


    const candidateListener =
        onChildAdded(
            candidateRef,
            async (snapshot) => {

                if (!peers[peerUid]) {
                    return;
                }


                try {

                    const candidate =
                        snapshot.val();


                    if (candidate) {

                        await pc.addIceCandidate(
                            new RTCIceCandidate(
                                candidate
                            )
                        );
                    }

                } catch (error) {

                    console.warn(
                        "Erro adicionando ICE remoto:",
                        error
                    );
                }
            }
        );


    listeners[peerUid]
        .calleeCandidates =
        {
            type: "child_added",
            ref: candidateRef,
            callback: candidateListener
        };
}


// ============================================================
// ESCUTAR CHAMADA RECEBIDA
// ============================================================

function listenForIncomingCall(
    peerUid,
    peerName
) {

    if (!ctx) return;

    if (peers[peerUid]) return;


    /*
     * Evita registrar o mesmo listener
     * várias vezes enquanto o presence
     * atualiza.
     */

    if (
        listeners[peerUid]?.offer
    ) {

        return;
    }


    const base =
        callPath(peerUid);


    if (!listeners[peerUid]) {

        listeners[peerUid] = {
            answer: null,
            calleeCandidates: null,
            offer: null,
            callerCandidates: null
        };
    }


    const offerRef =
        ref(
            rtdb,
            `${base}/offer`
        );


    const offerListener =
        onValue(
            offerRef,
            async (snapshot) => {

                if (!ctx) return;

                if (peers[peerUid]) {
                    return;
                }


                const offer =
                    snapshot.val();


                if (!offer) {
                    return;
                }


                try {

                    const pc =
                        createPeerConnection(
                            peerUid,
                            peerName
                        );


                    // ------------------------------------------------
                    // ICE LOCAL
                    // ------------------------------------------------

                    pc.onicecandidate =
                        (event) => {

                            if (
                                !event.candidate
                            ) {
                                return;
                            }


                            push(
                                ref(
                                    rtdb,
                                    `${base}/calleeCandidates`
                                ),
                                event
                                    .candidate
                                    .toJSON()
                            ).catch(
                                (error) => {

                                    console.error(
                                        "Erro salvando ICE callee:",
                                        error
                                    );
                                }
                            );
                        };


                    // ------------------------------------------------
                    // OFFER
                    // ------------------------------------------------

                    await pc.setRemoteDescription(
                        new RTCSessionDescription(
                            offer
                        )
                    );


                    // ------------------------------------------------
                    // ANSWER
                    // ------------------------------------------------

                    const answer =
                        await pc.createAnswer();


                    await pc.setLocalDescription(
                        answer
                    );


                    await set(
                        ref(
                            rtdb,
                            `${base}/answer`
                        ),
                        {
                            type: answer.type,
                            sdp: answer.sdp
                        }
                    );


                    // ------------------------------------------------
                    // ICE DO CALLER
                    // ------------------------------------------------

                    const callerCandidateRef =
                        ref(
                            rtdb,
                            `${base}/callerCandidates`
                        );


                    const candidateListener =
                        onChildAdded(
                            callerCandidateRef,
                            async (
                                candidateSnapshot
                            ) => {

                                if (
                                    !peers[
                                        peerUid
                                    ]
                                ) {
                                    return;
                                }


                                try {

                                    const candidate =
                                        candidateSnapshot.val();


                                    if (
                                        candidate
                                    ) {

                                        await pc.addIceCandidate(
                                            new RTCIceCandidate(
                                                candidate
                                            )
                                        );
                                    }

                                } catch (
                                    error
                                ) {

                                    console.warn(
                                        "Erro adicionando ICE caller:",
                                        error
                                    );
                                }
                            }
                        );


                    listeners[peerUid]
                        .callerCandidates =
                        {
                            type:
                                "child_added",

                            ref:
                                callerCandidateRef,

                            callback:
                                candidateListener
                        };

                } catch (error) {

                    console.error(
                        "Erro aceitando chamada:",
                        error
                    );

                    closePeer(
                        peerUid
                    );
                }
            }
        );


    listeners[peerUid].offer =
        {
            type: "value",
            ref: offerRef,
            callback: offerListener
        };
}


// ============================================================
// VÍDEO
// ============================================================

function addVideoTile(
    uid,
    label,
    stream,
    muted
) {

    removeVideoTile(uid);


    const grid =
        $("video-grid");


    if (!grid) {
        return;
    }


    const wrapper =
        document.createElement("div");


    wrapper.id =
        `tile-${uid}`;


    wrapper.className =
        "video-tile";


    const video =
        document.createElement("video");


    video.autoplay = true;
    video.playsInline = true;
    video.muted = muted;


    video.srcObject =
        stream;


    const labelElement =
        document.createElement("span");


    labelElement.className =
        "video-tile-label";


    labelElement.textContent =
        label || "Usuário";


    wrapper.appendChild(
        video
    );


    wrapper.appendChild(
        labelElement
    );


    grid.appendChild(
        wrapper
    );


    // Alguns navegadores exigem play()
    // mesmo com autoplay.

    video.play().catch(
        () => {}
    );
}


function removeVideoTile(uid) {

    const element =
        document.getElementById(
            `tile-${uid}`
        );


    if (element) {
        element.remove();
    }
}


// ============================================================
// FECHAR PEER
// ============================================================

function closePeer(peerUid) {

    const peer =
        peers[peerUid];


    if (peer) {

        try {
            peer.close();
        } catch {
            // Ignora
        }

        delete peers[peerUid];
    }


    // --------------------------------------------------------
    // REMOVE LISTENERS
    // --------------------------------------------------------

    const peerListeners =
        listeners[peerUid];


    if (peerListeners) {

        Object.values(
            peerListeners
        ).forEach(
            (listener) => {

                if (
                    !listener ||
                    !listener.ref ||
                    !listener.callback
                ) {
                    return;
                }


                try {

                    off(
                        listener.ref,
                        listener.type ===
                            "child_added"
                            ? "child_added"
                            : "value",
                        listener.callback
                    );

                } catch {
                    // Ignora erro de cleanup
                }
            }
        );


        delete listeners[
            peerUid
        ];
    }


    removeVideoTile(
        peerUid
    );


    // --------------------------------------------------------
    // LIMPA SINALIZAÇÃO
    // --------------------------------------------------------

    if (ctx) {

        remove(
            ref(
                rtdb,
                callPath(peerUid)
            )
        ).catch(
            () => {}
        );
    }
}


// ============================================================
// SAIR DO CANAL
// ============================================================

export function leaveVoiceChannel() {
    try {
        if (screenStream) {
            screenStream.getTracks().forEach(t => { try { t.stop(); } catch {} });
        }
        screenStream = null;
        cameraVideoTrack = null;
    } catch {}


    if (!ctx) {
        return;
    }


    const oldCtx =
        ctx;


    // --------------------------------------------------------
    // FECHAR PEERS
    // --------------------------------------------------------

    Object.keys(peers)
        .forEach(
            (peerUid) => {

                closePeer(
                    peerUid
                );
            }
        );


    // --------------------------------------------------------
    // STREAM LOCAL
    // --------------------------------------------------------

    if (localStream) {

        localStream
            .getTracks()
            .forEach(
                (track) => {

                    try {
                        track.stop();
                    } catch {
                        // Ignora
                    }
                }
            );
    }


    localStream =
        null;


    // --------------------------------------------------------
    // PRESENCE LISTENER
    // --------------------------------------------------------

    if (presenceListener) {

        try {

            off(
                ref(
                    rtdb,
                    `voicePresence/${oldCtx.serverId}/${oldCtx.channelId}`
                ),
                "value",
                presenceListener
            );

        } catch {
            // Ignora
        }


        presenceListener =
            null;
    }


    // --------------------------------------------------------
    // REMOVE PRESENÇA
    // --------------------------------------------------------

    remove(
        ref(
            rtdb,
            `voicePresence/${oldCtx.serverId}/${oldCtx.channelId}/${oldCtx.uid}`
        )
    ).catch(
        () => {}
    );


    // --------------------------------------------------------
    // LIMPA GRID
    // --------------------------------------------------------

    const grid =
        $("video-grid");


    if (grid) {
        grid.innerHTML = "";
    }


    // --------------------------------------------------------
    // LIMPA ESTADO
    // --------------------------------------------------------

    Object.keys(
        listeners
    ).forEach(
        (key) => {
            delete listeners[key];
        }
    );


    Object.keys(
        peers
    ).forEach(
        (key) => {
            delete peers[key];
        }
    );


    ctx =
        null;


    micOn =
        true;


    camOn =
        true;
}


// ============================================================
// MICROFONE
// ============================================================

window.devcordToggleMic =
    () => {

        if (!localStream) {
            return true;
        }


        micOn =
            !micOn;


        localStream
            .getAudioTracks()
            .forEach(
                (track) => {

                    track.enabled =
                        micOn;
                }
            );


        return micOn;
    };


// ============================================================
// CÂMERA
// ============================================================

window.devcordToggleCam =
    () => {

        if (!localStream) {
            return true;
        }


        camOn =
            !camOn;


        localStream
            .getVideoTracks()
            .forEach(
                (track) => {

                    track.enabled =
                        camOn;
                }
            );


        return camOn;
    };


// ============================================================
// ESTADO
// ============================================================

export function isInVoiceChannel() {

    return !!ctx;
}


export function isMicEnabled() {

    return micOn;
}


export function isCameraEnabled() {

    return camOn;
}


// ============================================================
// COMPARTILHAMENTO DE TELA
// ============================================================

let screenStream = null;
let cameraVideoTrack = null; // guarda track da câmera ao trocar por tela

function canGetDisplayMedia() {
    try {
        const md = navigator.mediaDevices;
        return !!(md && typeof md.getDisplayMedia === "function");
    } catch {
        return false;
    }
}

/**
 * Substitui a track de vídeo enviada aos peers (câmera ↔ tela).
 */
async function replaceVideoTrackForPeers(newTrack) {
    const tasks = [];
    Object.values(peers).forEach((peer) => {
        const pc = peer?.pc;
        if (!pc) return;
        const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        if (sender) {
            tasks.push(sender.replaceTrack(newTrack));
        } else if (newTrack && localStream) {
            try {
                pc.addTrack(newTrack, localStream);
            } catch (e) {
                console.warn("addTrack video", e);
            }
        }
    });
    await Promise.allSettled(tasks);
}

/**
 * Inicia compartilhamento de tela/janela.
 * quality: 720 | 1080 | 1440
 * Retorna o MediaStream da tela ou lança Error com mensagem amigável.
 */
export async function startScreenShare(quality = 1080) {
    if (!ctx || !localStream) {
        throw new Error("Entre na call antes de compartilhar a tela.");
    }
    if (!canGetDisplayMedia()) {
        const isAndroid = /Android/i.test(navigator.userAgent || "");
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
        if (isAndroid || isIOS) {
            throw new Error("Neste celular o navegador não permite compartilhar tela. No PC (Chrome/Edge) funciona. No APK dá para usar captura nativa (MediaProjection).");
        }
        throw new Error("Seu navegador não suporta compartilhar tela. Use Chrome ou Edge em HTTPS.");
    }

    // Para share anterior se houver
    if (screenStream) {
        try { await stopScreenShare(); } catch {}
    }

    const q = parseInt(quality, 10) || 1080;
    screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
            width: { ideal: q === 720 ? 1280 : q === 1440 ? 2560 : 1920 },
            height: { ideal: q },
            frameRate: { ideal: 30 }
        },
        audio: false
    });

    const screenTrack = screenStream.getVideoTracks()[0];
    if (!screenTrack) {
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
        throw new Error("Não foi possível obter a track de vídeo da tela.");
    }

    // Guarda a track de câmera atual (se existir)
    const currentCam = localStream.getVideoTracks()[0];
    if (currentCam && currentCam !== screenTrack) {
        cameraVideoTrack = currentCam;
        // remove da localStream mas não stop ainda (podemos voltar)
        localStream.removeTrack(currentCam);
    }

    localStream.addTrack(screenTrack);
    await replaceVideoTrackForPeers(screenTrack);

    // Atualiza tile local
    addVideoTile(ctx.uid, `${ctx.displayName || "Você"} (tela)`, localStream, true);

    screenTrack.onended = () => {
        stopScreenShare().catch(() => {});
    };

    return screenStream;
}

export async function stopScreenShare() {
    if (!screenStream && !cameraVideoTrack) return;

    const screenTracks = screenStream ? screenStream.getVideoTracks() : [];
    screenTracks.forEach(t => {
        try { localStream?.removeTrack(t); } catch {}
        try { t.stop(); } catch {}
    });
    if (screenStream) {
        screenStream.getTracks().forEach(t => { try { t.stop(); } catch {} });
    }
    screenStream = null;

    // Restaura câmera se estava ligada
    if (cameraVideoTrack && cameraVideoTrack.readyState === "live") {
        localStream?.addTrack(cameraVideoTrack);
        await replaceVideoTrackForPeers(cameraVideoTrack);
        cameraVideoTrack = null;
        if (ctx) addVideoTile(ctx.uid, `${ctx.displayName || "Você"} (você)`, localStream, true);
    } else {
        cameraVideoTrack = null;
        // sem vídeo: envia null ou deixa sem track
        await replaceVideoTrackForPeers(null);
        if (ctx) addVideoTile(ctx.uid, `${ctx.displayName || "Você"} (você)`, localStream, true);
    }
}

export function isSharingScreen() {
    return !!(screenStream && screenStream.getVideoTracks().some(t => t.readyState === "live"));
}

export async function enableCamera() {
    if (!localStream || !ctx) throw new Error("Fora da call.");
    if (isSharingScreen()) throw new Error("Pare o compartilhamento de tela antes de ligar a câmera.");
    if (localStream.getVideoTracks().some(t => t.readyState === "live" && t.enabled)) {
        camOn = true;
        return true;
    }
    const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    const track = camStream.getVideoTracks()[0];
    if (!track) throw new Error("Câmera indisponível.");
    localStream.addTrack(track);
    await replaceVideoTrackForPeers(track);
    camOn = true;
    addVideoTile(ctx.uid, `${ctx.displayName || "Você"} (você)`, localStream, true);
    return true;
}

export async function disableCamera() {
    if (!localStream) return false;
    localStream.getVideoTracks().forEach(t => {
        try { localStream.removeTrack(t); } catch {}
        try { t.stop(); } catch {}
    });
    await replaceVideoTrackForPeers(null);
    camOn = false;
    if (ctx) addVideoTile(ctx.uid, `${ctx.displayName || "Você"} (você)`, localStream, true);
    return false;
}

// Export toggles também (além do window.*)
export function toggleMic() {
    return window.devcordToggleMic();
}

export async function toggleCam() {
    if (camOn) return disableCamera();
    return enableCamera();
}

