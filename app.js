"Imagem enviada";
    img.addEventListener("click", () => openLightbox(m.imageBase64, "img"));
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
  }

  const actions = document.createElement("div");
  actions.className = "msg-actions";

  // Botões de ação da mensagem
  const reactBtn = iconButton("smile", { size: 14, tooltip: "Adicionar reação" });
  reactBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openReactionMenu(m, reactBtn, dmMode);
  });
  actions.appendChild(reactBtn);

  if (m.uid === currentUser.uid) {
    const editBtn = iconButton("edit-2", { size: 14, tooltip: "Editar" });
    editBtn.addEventListener("click", () => openEditMessage(m, dmMode));
    actions.appendChild(editBtn);

    const delBtn = iconButton("trash", { size: 14, tooltip: "Apagar", className: "danger-icon" });
    delBtn.addEventListener("click", () => deleteMessage(m, dmMode));
    actions.appendChild(delBtn);
  }

  // Renderizar reações existentes (Se existirem)
  const reactionsWrap = document.createElement("div");
  reactionsWrap.className = "msg-reactions-wrap";
  if (m.reactions) {
    Object.entries(m.reactions).forEach(([emoji, users]) => {
      const userIds = Object.keys(users);
      if (userIds.length === 0) return;
      
      const rBtn = document.createElement("button");
      rBtn.className = "reaction-badge" + (userIds.includes(currentUser.uid) ? " active" : "");
      rBtn.innerHTML = `${emoji} <span class="reaction-count">${userIds.length}</span>`;
      rBtn.addEventListener("click", () => toggleReaction(m, emoji, dmMode));
      reactionsWrap.appendChild(rBtn);
    });
  }

  el.appendChild(avatarWrap);
  body.appendChild(reactionsWrap); // Reações ficam abaixo do conteúdo
  el.appendChild(body);
  el.appendChild(actions);
  container.appendChild(el);
}

// ===================== AÇÕES DE MENSAGENS =====================
async function toggleReaction(m, emoji, dmMode) {
  const basePath = dmMode 
    ? `dms/${dmOpenPair}/${m.id}/reactions/${emoji}/${currentUser.uid}` 
    : `messages/${currentServerId}/${currentChannelId}/${m.id}/reactions/${emoji}/${currentUser.uid}`;
  
  const hasReacted = m.reactions && m.reactions[emoji] && m.reactions[emoji][currentUser.uid];
  
  if (hasReacted) {
    await remove(ref(rtdb, basePath));
  } else {
    await set(ref(rtdb, basePath), true);
  }
}

function openReactionMenu(m, btnEl, dmMode) {
  // Uma versão super simples de emojis rápidos para reação (Sprint 2)
  const emojis = ["👍", "❤️", "😂", "🔥", "😭", "🎉"];
  
  // Remove menus abertos
  document.querySelectorAll(".quick-react-menu").forEach(el => el.remove());

  const menu = document.createElement("div");
  menu.className = "quick-react-menu";
  
  emojis.forEach(e => {
    const b = document.createElement("button");
    b.textContent = e;
    b.addEventListener("click", () => {
      toggleReaction(m, e, dmMode);
      menu.remove();
    });
    menu.appendChild(b);
  });

  const rect = btnEl.getBoundingClientRect();
  menu.style.position = "absolute";
  menu.style.top = (rect.top - 40) + "px";
  menu.style.left = rect.left + "px";
  
  document.body.appendChild(menu);

  // Fecha o menu se clicar fora
  setTimeout(() => {
    const closeFn = (evt) => {
      if (!menu.contains(evt.target)) {
        menu.remove();
        document.removeEventListener("click", closeFn);
      }
    };
    document.addEventListener("click", closeFn);
  }, 10);
}

function openEditMessage(m, dmMode) {
  const newText = prompt("Editar mensagem:", m.text || "");
  if (newText === null) return; 
  if (newText.trim() === "") {
    deleteMessage(m, dmMode);
    return;
  }
  
  const path = dmMode 
    ? `dms/${dmOpenPair}/${m.id}`
    : `messages/${currentServerId}/${currentChannelId}/${m.id}`;
    
  update(ref(rtdb, path), { text: newText.trim(), edited: true });
}

function deleteMessage(m, dmMode) {
  if (!confirm("Apagar esta mensagem para todos?")) return;
  const path = dmMode 
    ? `dms/${dmOpenPair}/${m.id}`
    : `messages/${currentServerId}/${currentChannelId}/${m.id}`;
  remove(ref(rtdb, path));
}

// ===================== INDICADOR DE DIGITAÇÃO =====================
function listenTyping() {
  const tRef = ref(rtdb, `typing/${currentServerId}/${currentChannelId}`);
  if (unsubTyping) off(ref(rtdb, unsubTyping.path), "value", unsubTyping.cb);
  
  const cb = onValue(tRef, (snap) => {
    const val = snap.val() || {};
    const typers = [];
    
    // Filtra usuários que estão digitando agora (ignora usuários muito antigos ou a si mesmo)
    const now = Date.now();
    Object.entries(val).forEach(([uid, data]) => {
      if (uid !== currentUser.uid && (now - data.timestamp < 4000)) {
        typers.push(data.name);
      }
    });

    const wrap = $("typing-indicator");
    if (typers.length === 0) {
      wrap.innerHTML = "";
      wrap.classList.add("hidden");
    } else {
      wrap.classList.remove("hidden");
      if (typers.length === 1) {
        wrap.innerHTML = `<span class="typing-dot"></span> <strong>${esc(typers[0])}</strong> está digitando...`;
      } else if (typers.length === 2) {
        wrap.innerHTML = `<span class="typing-dot"></span> <strong>${esc(typers[0])}</strong> e <strong>${esc(typers[1])}</strong> estão digitando...`;
      } else {
        wrap.innerHTML = `<span class="typing-dot"></span> Várias pessoas estão digitando...`;
      }
    }
  });
  
  unsubTyping = { path: `typing/${currentServerId}/${currentChannelId}`, cb };
}

function notifyTyping(isDm = false) {
  if (!currentUser || !userProfile) return;
  const path = isDm 
    ? `typing/dms/${dmOpenPair}/${currentUser.uid}`
    : `typing/${currentServerId}/${currentChannelId}/${currentUser.uid}`;
  
  // Envia status e define TTL de 3 segundos para se limpar caso desconecte
  set(ref(rtdb, path), {
    name: userProfile.displayName,
    timestamp: serverTimestamp() // O Firebase ignora o TTL no serverTimestamp puro aqui, usamos client-side timeout também.
  });
}

// ===================== COMPOSER DE MENSAGENS =====================
const composerInput = $("composer-input");

// Debounce para notificar que está digitando (Item 15)
const handleTypingInput = debounce(() => {
  if (currentChannelId) notifyTyping(false);
  else if (dmOpenPair) notifyTyping(true);
}, 1000);

composerInput.addEventListener("input", () => {
  handleTypingInput();
  
  // Auto-expand textarea
  composerInput.style.height = "auto";
  const scHeight = composerInput.scrollHeight;
  composerInput.style.height = (scHeight < 150 ? scHeight : 150) + "px";
});

composerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

$("composer-send-btn").addEventListener("click", sendMessage);

async function sendMessage() {
  const text = composerInput.value.trim();
  const fileToUpload = pendingFile;
  const gifToSend = pendingGif;
  
  if (!text && !fileToUpload && !gifToSend) return;
  if (text.length > MAX_MSG) {
    toast(`Mensagem muito longa (max ${MAX_MSG} caracteres)`, "error");
    return;
  }

  // Se a velocidade de envio for menor que 1s (Rate limit simples)
  const now = Date.now();
  if (now - (lastSentAt[currentUser.uid] || 0) < 1000) {
    toast("Aguarde um momento antes de enviar outra mensagem.", "warning");
    return;
  }
  lastSentAt[currentUser.uid] = now;

  const msgData = {
    uid: currentUser.uid,
    authorName: userProfile.displayName || "Usuário",
    authorPhoto: userProfile.photoURL || userProfile.photoBase64 || "",
    authorColor: userProfile.nameColor || "var(--text-0)",
    createdAt: serverTimestamp(),
  };

  if (text) msgData.text = text;

  // 1. SISTEMA DE GIFS: Salva o tipo e a URL do Giphy (Item 1)
  if (gifToSend) {
    msgData.type = "gif";
    msgData.gifUrl = gifToSend.url;
    msgData.gifTitle = gifToSend.title;
    pendingGif = null;
    hideGifPreview();
  }

  // 13. COMPRESSÃO CANVAS E ARQUIVOS (Base64)
  if (fileToUpload) {
    if (fileToUpload.contentType.startsWith("image/")) {
      try {
        const compressedBase64 = await compressImageToBase64(fileToUpload.dataUrl, 800, 0.7);
        // Validar tamanho após compressão (ex: 200KB)
        const sizeEstimate = compressedBase64.length * 0.75;
        if (sizeEstimate > MAX_UPLOAD) {
           toast(`Imagem ainda está muito pesada após compressão. Máx: ${humanFileSize(MAX_UPLOAD)}`, "error");
           return;
        }
        msgData.imageBase64 = compressedBase64;
        msgData.type = "image";
      } catch (e) {
        toast("Erro ao processar a imagem.", "error");
        return;
      }
    } else {
       toast("Apenas imagens são suportadas nesse modo.", "warning");
       return;
    }
    clearPendingFile();
  }

  // Reset do input
  composerInput.value = "";
  composerInput.style.height = "auto";
  composerInput.focus();

  // Enviar para o banco
  try {
    const path = currentChannelId 
      ? `messages/${currentServerId}/${currentChannelId}`
      : `dms/${dmOpenPair}`;
      
    await push(ref(rtdb, path), msgData);
    
    // Toca o toast (Item 24)
    toast("Mensagem enviada", "success", 1500);

    // Apaga indicador de digitação imediatamente
    if (currentChannelId) remove(ref(rtdb, `typing/${currentServerId}/${currentChannelId}/${currentUser.uid}`));
    
  } catch (err) {
    toast("Erro ao enviar mensagem.", "error");
  }
}

// ===================== SISTEMA DE GIFS (Item 1 e 2) =====================
$("composer-gif-btn").addEventListener("click", () => {
  openDrawer("drawer-giphy");
  renderGiphyPicker(); // Essa função está no seu giphy.js e precisará ser atualizada lá!
});

// Listener global para receber o GIF do picker
window.addEventListener("devcord:gif-selected", (e) => {
  pendingGif = e.detail; 
  closeDrawers();
  showGifPreview();
  composerInput.focus();
});

function showGifPreview() {
  const previewBox = $("composer-preview"); // Garanta que existe essa div acima do seu input!
  previewBox.innerHTML = `
    <div class="pending-media">
      <img src="${pendingGif.url}" alt="GIF Selecionado" />
      <button class="remove-media" onclick="clearPendingGif()">×</button>
    </div>
  `;
  previewBox.classList.remove("hidden");
}

window.clearPendingGif = function() {
  pendingGif = null;
  $("composer-preview").innerHTML = "";
  $("composer-preview").classList.add("hidden");
}

function hideGifPreview() {
  window.clearPendingGif();
}

// ===================== COMPRESSÃO DE IMAGEM CANVAS (Item 13 e 14) =====================
/**
 * Comprime uma imagem Base64 usando Canvas.
 * @param {string} dataUrl Base64 original
 * @param {number} maxWidth Largura máxima permitida (px)
 * @param {number} quality Qualidade (0.0 a 1.0)
 * @returns Promise com o novo Base64
 */
function compressImageToBase64(dataUrl, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // Mantém a proporção se for maior que o permitido
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      
      // Fundo branco caso seja um PNG transparente e o destino seja JPEG
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);
      
      ctx.drawImage(img, 0, 0, width, height);
      
      // Retorna em JPEG para economizar MUITO espaço (Base64)
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = dataUrl;
  });
}

// DRAG AND DROP BÁSICO
const dropZone = document.body;
dropZone.addEventListener("dragover", (e) => {
  if (!currentChannelId && !dmOpenPair) return; // Só permite se estiver num chat
  e.preventDefault();
  $("drag-overlay").classList.remove("hidden"); // Garanta que essa div existe no HTML!
});

dropZone.addEventListener("dragleave", (e) => {
  e.preventDefault();
  if (e.relatedTarget === null) {
    $("drag-overlay").classList.add("hidden");
  }
});

dropZone.addEventListener("drop", async (e) => {
  e.preventDefault();
  $("drag-overlay").classList.add("hidden");
  
  if (!currentChannelId && !dmOpenPair) return;

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      toast("Apenas arraste imagens por enquanto.", "warning");
      return;
    }
    
    try {
      pendingFile = await readFileAsDataURL(file);
      showFilePreview();
    } catch (err) {
      toast("Erro ao ler o arquivo.", "error");
    }
  }
});

$("composer-attach-btn").addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*"; // Restringindo para imagens devido ao limite do Base64
  input.onchange = async (e) => {
    if (e.target.files.length > 0) {
      try {
        pendingFile = await readFileAsDataURL(e.target.files[0]);
        showFilePreview();
      } catch (err) {
        toast("Erro ao ler arquivo", "error");
      }
    }
  };
  input.click();
});

function showFilePreview() {
  const previewBox = $("composer-preview");
  previewBox.innerHTML = `
    <div class="pending-media">
      <img src="${pendingFile.dataUrl}" alt="Anexo" />
      <span class="media-size">${humanFileSize(pendingFile.size)}</span>
      <button class="remove-media" onclick="clearPendingFile()">×</button>
    </div>
  `;
  previewBox.classList.remove("hidden");
}

window.clearPendingFile = function() {
  pendingFile = null;
  $("composer-preview").innerHTML = "";
  $("composer-preview").classList.add("hidden");
}