// links.js — detecção de URLs e previews seguros dentro das mensagens.
// Suporta: YouTube, TikTok, Reddit, imagens diretas, vídeos diretos e sites
// genéricos. NUNCA executa HTML/JS externo: tudo é montado com textContent.

const URL_RE = /https?:\/\/[^\s<>"'\\)\]]+/g;
const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|avif|bmp)(\?.*)?$/i;
const VID_EXT_RE = /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i;
const KNOWN_IMG_HOSTS = /(i\.imgur\.com|i\.redd\.it|i\.ytimg\.com|media\.giphy\.com|images\.unsplash\.com|res\.cloudinary\.com|pbs\.twimg\.com|cdn\.discordapp\.com)/i;
const YT_RE = /(?:youtube\.com\/(?:watch\?.*v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,15})/;

const cache = new Map();

export function extractUrls(text) {
  return (text || "").match(URL_RE) || [];
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function isDirectImage(url) {
  if (IMG_EXT_RE.test(url)) return true;
  try {
    const h = new URL(url).hostname;
    if (KNOWN_IMG_HOSTS.test(h)) return true;
  } catch {}
  return false;
}
function isDirectVideo(url) { return VID_EXT_RE.test(url); }

function ytIdOf(url) { const m = url.match(YT_RE); return m ? m[1] : null; }

async function fetchOEmbed(endpoint, url) {
  try {
    const res = await fetch(endpoint + "?format=json&url=" + encodeURIComponent(url), { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Retorna um preview seguro (strings, nunca HTML).
export async function getLinkPreview(url) {
  if (cache.has(url)) return cache.get(url);

  let preview = null;
  const host = hostOf(url);

  if (isDirectVideo(url)) {
    preview = { type: "video", url, host, title: host };
  } else if (isDirectImage(url)) {
    preview = { type: "image", url, host, title: host };
  } else {
    const ytId = ytIdOf(url);
    if (ytId) {
      const o = await fetchOEmbed("https://www.youtube.com/oembed", url);
      preview = {
        type: "youtube", url, host: "YouTube",
        title: o?.title || "Vídeo no YouTube",
        author: o?.author_name || "",
        thumb: `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`,
      };
    } else if (host.includes("tiktok.com")) {
      const o = await fetchOEmbed("https://www.tiktok.com/oembed", url);
      preview = {
        type: "tiktok", url, host: "TikTok",
        title: o?.title || "Vídeo no TikTok",
        author: (o?.author_name ? "@" + o.author_name : "") || "@",
        thumb: o?.thumbnail_url || "",
      };
    } else if (host.includes("reddit.com")) {
      const o = await fetchOEmbed("https://www.reddit.com/oembed", url);
      preview = {
        type: "reddit", url, host: "Reddit",
        title: o?.title || "Post no Reddit",
        author: o?.author_name || "",
        thumb: o?.thumbnail_url || "",
      };
    } else if (host.includes("instagram.com")) {
      const o = await fetchOEmbed("https://www.instagram.com/oembed", url);
      preview = {
        type: "instagram", url, host: "Instagram",
        title: o?.title || "Post no Instagram",
        author: (o?.author_name ? "@" + o.author_name : "") || "@",
        thumb: o?.thumbnail_url || "",
      };
    } else if (host.includes("x.com") || host.includes("twitter.com")) {
      preview = {
        type: "generic", url, host: "X / Twitter",
        title: "Post no X / Twitter",
        author: "", thumb: "",
      };
    } else {
      preview = { type: "generic", url, host, title: host, author: "", thumb: "" };
    }
  }

  cache.set(url, preview);
  return preview;
}

// Monta cards de preview para as URLs do texto e anexa no container.
// container: elemento no qual os cards serão inseridos (cria-se depois do texto).
export async function appendLinkCards(container, text) {
  const urls = [...new Set(extractUrls(text))];
  if (!urls.length) return;
  for (const url of urls.slice(0, 4)) {
    const card = document.createElement("a");
    card.className = "link-card";
    card.href = url;
    card.target = "_blank";
    card.rel = "noopener noreferrer nofollow";
    card.setAttribute("aria-label", "Abrir link externo em nova aba");

    const p = await getLinkPreview(url);
    
    if (p.type === "image") {
      const mediaWrap = document.createElement("div");
      mediaWrap.className = "lc-media";
      const img = document.createElement("img");
      img.src = p.url;
      img.loading = "lazy";
      img.alt = "";
      img.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        openLightbox(p.url, "img");
      });
      mediaWrap.appendChild(img);
      card.appendChild(mediaWrap);
    } else if (p.type === "video") {
      const mediaWrap = document.createElement("div");
      mediaWrap.className = "lc-media";
      const vid = document.createElement("video");
      vid.src = p.url;
      vid.controls = true;
      vid.playsInline = true;
      vid.preload = "metadata";
      mediaWrap.appendChild(vid);
      card.appendChild(mediaWrap);
    } else if (p.thumb) {
      const mediaWrap = document.createElement("div");
      mediaWrap.className = "lc-media";
      const img = document.createElement("img");
      img.src = p.thumb;
      img.loading = "lazy";
      img.alt = "";
      mediaWrap.appendChild(img);

      const playDiv = document.createElement("div");
      playDiv.className = "lc-play";
      const playBadge = document.createElement("div");
      playBadge.className = "play-badge";
      playBadge.setAttribute("aria-hidden", "true");
      playBadge.innerHTML = '<svg class="svg-icon" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      playDiv.appendChild(playBadge);
      mediaWrap.appendChild(playDiv);

      card.appendChild(mediaWrap);
    }

    const body = document.createElement("div");
    body.className = "lc-body";
    
    const t = document.createElement("div");
    t.className = "lc-title";
    t.textContent = p.title || p.host;
    
    const d = document.createElement("div");
    d.className = "lc-desc";
    d.textContent = p.author ? `${p.author} · Clique para abrir o link` : "Clique para abrir o link";
    
    const site = document.createElement("div");
    site.className = "lc-site";
    site.innerHTML = '<svg class="svg-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';
    site.appendChild(document.createTextNode(p.host));
    
    body.appendChild(t);
    body.appendChild(d);
    body.appendChild(site);
    card.appendChild(body);
    
    container.appendChild(card);
  }
}

let lightbox = null;
export function openLightbox(src, kind) {
  closeLightbox();
  lightbox = document.createElement("div");
  lightbox.className = "lightbox";
  lightbox.setAttribute("role", "dialog");
  lightbox.setAttribute("aria-modal", "true");
  
  const media = kind === "video" ? document.createElement("video") : document.createElement("img");
  if (kind === "video") { media.controls = true; media.autoplay = true; }
  media.src = src;
  media.alt = "";
  
  const close = document.createElement("button");
  close.className = "icon-btn lb-close";
  close.setAttribute("aria-label", "Fechar visualização");
  close.innerHTML = '<svg class="svg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  close.addEventListener("click", closeLightbox);
  
  lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener("keydown", escClose, { once: true });
  
  lightbox.appendChild(close);
  lightbox.appendChild(media);
  document.body.appendChild(lightbox);
}

function escClose(e) { if (e.key === "Escape") closeLightbox(); }

export function closeLightbox() {
  if (lightbox) { lightbox.remove(); lightbox = null; }
}