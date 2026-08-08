// giphy.js — integração GIPHY (GIFs + stickers). Chave central em GIPHY_API_KEY.
// Endpoints usados:
//   https://api.giphy.com/v1/gifs/search   ?api_key&q&limit&offset&rating
//   https://api.giphy.com/v1/gifs/trending ?api_key&limit&offset&rating
//   https://api.giphy.com/v1/gifs/random   ?api_key&tag&rating
//   https://api.giphy.com/v1/stickers/search
//   https://api.giphy.com/v1/stickers/trending
// Random endpoints included as well.
// Recents ficam em localStorage; favoritos são armazenáveis via callback (o app decide se usa RTDB em users/{uid}/favorites).

export const GIPHY_API_KEY = "4oiQw1BQJm2AnCaYb8IX57wCt5sz5eBQ"; // fallback public key
const BASE = "https://api.giphy.com/v1";

const LS_RECENT = "devcord-giphy-recents"; // array de itens {id, kind, title, url, full, preview, width, height}
const LS_KEY = "devcord-giphy-key"; // override key in localStorage

function lsGet(key, def) { try { return JSON.parse(localStorage.getItem(key)) || def; } catch { return def; } }
function lsSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

export function setGiphyKey(key) {
  try {
    if (!key) localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, key.trim());
  } catch {}
}
export function getGiphyKey() {
  try {
    const k = localStorage.getItem(LS_KEY);
    if (k) return k;
  } catch {}
  return GIPHY_API_KEY;
}

async function giphyFetch(url) {
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 429) throw new Error("Muitas requisições ao GIPHY. Tente novamente em instantes.");
    if (res.status === 403 || res.status === 401) throw new Error("Chave do GIPHY inválida ou sem permissão.");
    throw new Error(`Erro ao acessar o GIPHY (${res.status}).`);
  }
  return res.json();
}

function pickPreview(images) {
  // tenta várias versões de preview pequenas
  return images?.fixed_width_small?.url || images?.preview_gif?.url || images?.fixed_width_downsampled?.url || images?.fixed_height_small_still?.url || images?.fixed_width?.url || images?.original?.url || "";
}

function normalizeGif(g) {
  const images = g.images || {};
  return {
    provider: "giphy",
    type: "gif",
    gifId: g.id,
    id: g.id,
    title: g.title || "",
    url: (images.original && images.original.url) || g.url || "",
    full: (images.original && images.original.url) || g.url || "",
    preview: pickPreview(images),
    width: parseInt(images.original?.width || images.fixed_width?.width || 0, 10) || 0,
    height: parseInt(images.original?.height || images.fixed_width?.height || 0, 10) || 0,
    giphyUrl: g.url || "",
  };
}

function normalizeSticker(g) {
  const images = g.images || {};
  return {
    provider: "giphy",
    type: "sticker",
    gifId: g.id,
    id: g.id,
    title: g.title || "",
    url: (images.original && images.original.url) || g.url || "",
    full: (images.original && images.original.url) || g.url || "",
    preview: pickPreview(images),
    width: parseInt(images.original?.width || images.fixed_width?.width || 0, 10) || 0,
    height: parseInt(images.original?.height || images.fixed_width?.height || 0, 10) || 0,
    giphyUrl: g.url || "",
  };
}

function normalizeArray(data, kind) {
  if (!Array.isArray(data)) return [];
  if (kind === "sticker") return data.map(normalizeSticker);
  return data.map(normalizeGif);
}

function buildUrl(path, params = {}) {
  const apiKey = getGiphyKey();
  const url = new URL(BASE + path);
  url.searchParams.set("api_key", apiKey);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null) url.searchParams.set(k, v); });
  return url.toString();
}

export async function searchGifs(term, offset = 0, limit = 24) {
  const q = term || "";
  const url = buildUrl('/gifs/search', { q, limit, offset, rating: 'g', lang: 'pt' });
  const json = await giphyFetch(url);
  return { items: normalizeArray(json.data, "gif"), pagination: json.pagination || {} };
}

export async function trendingGifs(offset = 0, limit = 24) {
  const url = buildUrl('/gifs/trending', { limit, offset, rating: 'g' });
  const json = await giphyFetch(url);
  return { items: normalizeArray(json.data, "gif"), pagination: json.pagination || {} };
}

export async function randomGif(tag = "") {
  const url = buildUrl('/gifs/random', { tag, rating: 'g' });
  const json = await giphyFetch(url);
  const g = json.data;
  if (!g) return null;
  return normalizeGif(g);
}

export async function searchStickers(term, offset = 0, limit = 24) {
  const q = term || "";
  const url = buildUrl('/stickers/search', { q, limit, offset, rating: 'g' });
  const json = await giphyFetch(url);
  return { items: normalizeArray(json.data, "sticker"), pagination: json.pagination || {} };
}

export async function trendingStickers(offset = 0, limit = 24) {
  const url = buildUrl('/stickers/trending', { limit, offset, rating: 'g' });
  const json = await giphyFetch(url);
  return { items: normalizeArray(json.data, "sticker"), pagination: json.pagination || {} };
}

export async function randomSticker(tag = "") {
  const url = buildUrl('/stickers/random', { tag, rating: 'g' });
  const json = await giphyFetch(url);
  const g = json.data;
  if (!g) return null;
  return normalizeSticker(g);
}

export function getRecentGifs() { return lsGet(LS_RECENT, []).slice(0, 30); }
export function addRecentGif(g) {
  try {
    const r = getRecentGifs().filter((x) => x.id !== g.id);
    r.unshift(g);
    lsSet(LS_RECENT, r.slice(0, 30));
  } catch {}
}

// Renderiza o picker do GIPHY.
// opts: { onPick(item), getFavs(), toggleFav(item), isFav(item) }
export function renderGiphyPicker(root, opts) {
  root.innerHTML = "";
  let kind = "gif"; // gif | sticker | recentes | favoritos
  let query = "";
  let offset = 0;
  let loading = false;
  let done = false;

  const header = document.createElement("div");
  header.className = "picker-header";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "🔎 Pesquisar GIF...";
  search.setAttribute("aria-label", "Buscar no GIPHY");
  header.appendChild(search);
  root.appendChild(header);

  const tabs = document.createElement("div");
  tabs.className = "picker-tabs";
  tabs.innerHTML = `
    <button data-k="gif" class="active">Trending</button>
    <button data-k="sticker">Stickers</button>
    <button data-k="recentes">Recentes</button>
    <button data-k="favoritos">Favoritos</button>`;
  tabs.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      tabs.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const key = b.dataset.k;
      if (key === 'gif') { kind = 'gif'; query = ''; }
      else if (key === 'sticker') { kind = 'sticker'; query = ''; }
      else kind = key;
      body.innerHTML = "";
      done = false; offset = 0;
      if (kind === "recentes") paintRecents();
      else if (kind === "favoritos") paintFavs();
      else load();
    });
  });
  root.appendChild(tabs);

  const body = document.createElement("div");
  body.className = "picker-body";
  root.appendChild(body);

  let debounce = null;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      query = search.value.trim();
      body.innerHTML = "";
      done = false; offset = 0;
      if (kind === "recentes") paintRecents();
      else if (kind === "favoritos") paintFavs();
      else load();
    }, 300);
  });

  function makeItemBtn(item) {
    const b = document.createElement("button");
    b.setAttribute("aria-label", `Enviar ${item.type === "sticker" ? "figurinha" : "GIF"} ${item.title}`);
    const img = document.createElement('img');
    img.src = item.preview || item.url;
    img.alt = item.title.replace(/"/g, "") || "GIF";
    img.loading = 'lazy';
    b.appendChild(img);
    b.addEventListener("click", () => {
      opts.onPick(item);
      addRecentGif(item);
    });
    b.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      opts.toggleFav?.(item);
      toastSmall(opts.isFav?.(item) ? "Adicionado aos favoritos" : "Removido dos favoritos");
    });
    return b;
  }

  function paintRecents() {
    body.innerHTML = "";
    const recents = getRecentGifs();
    if (!recents.length) { body.innerHTML = emptyHTML("Sem recentes ainda."); return; }
    body.innerHTML = `<div class="picker-section-title">Recentes</div>`;
    const grid = document.createElement("div");
    grid.className = "gif-grid";
    recents.forEach((r) => grid.appendChild(makeItemBtn(r)));
    body.appendChild(grid);
  }

  function paintFavs() {
    body.innerHTML = "";
    const favs = opts.getFavs?.() || [];
    if (!favs.length) { body.innerHTML = emptyHTML("Nenhum favorito. Clique com o botão direito num GIF para favoritar."); return; }
    body.innerHTML = `<div class="picker-section-title">Favoritos</div>`;
    const grid = document.createElement("div");
    grid.className = "gif-grid";
    favs.forEach((r) => grid.appendChild(makeItemBtn(r)));
    body.appendChild(grid);
  }

  function emptyHTML(msg) { return `<div class="empty-state"><p>${msg}</p></div>`; }

  async function load() {
    if (loading || done) return;
    loading = true;
    if (offset === 0) body.innerHTML = `<div class="loading-wrap"><div class="spinner"></div><span>Carregando...</span></div>`;
    try {
      let data;
      if (kind === 'sticker') {
        if (query) data = await searchStickers(query, offset);
        else data = await trendingStickers(offset);
      } else { // gif
        if (query) data = await searchGifs(query, offset);
        else data = await trendingGifs(offset);
      }
      if (offset === 0) body.innerHTML = "";
      const grid = document.createElement("div");
      grid.className = "gif-grid";
      data.items.forEach((it) => grid.appendChild(makeItemBtn(it)));
      body.appendChild(grid);
      offset += data.items.length;
      if (!data.items.length || offset >= (data.pagination?.total_count ?? Infinity)) done = true;
      else done = false;
    } catch (err) {
      // se for erro de chave inválida oferecemos config rápida
      if (err && err.message && err.message.includes('Chave do GIPHY')) {
        body.innerHTML = `<div class="error-state"><h3>Falha ao carregar</h3><p>Chave do GIPHY inválida ou sem permissão.</p><div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-primary" id="giphy-config">Configurar chave</button><button class="btn btn-secondary" id="giphy-retry">Tentar novamente</button></div></div>`;
        body.querySelector('#giphy-config')?.addEventListener('click', () => {
          try {
            const k = window.prompt('Cole sua GIPHY API Key:');
            if (!k) return;
            setGiphyKey(k);
            done = false; offset = 0; body.innerHTML = ''; load();
          } catch (e) {}
        });
        body.querySelector('#giphy-retry')?.addEventListener('click', () => { done = false; load(); });
      } else {
        body.innerHTML = `<div class="error-state"><h3>Falha ao carregar</h3><p>${escErr(err)}</p><button class="btn btn-secondary btn-sm" id="giphy-retry">Tentar novamente</button></div>`;
        body.querySelector("#giphy-retry")?.addEventListener("click", () => { done = false; load(); });
      }
    } finally {
      loading = false;
    }
  }

  body.addEventListener("scroll", () => {
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 80) load();
  }, { passive: true });

  // footer with attribution (GIPHY requirement)
  const footer = document.createElement('div');
  footer.className = 'picker-footer';
  footer.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><img src="https://developers.giphy.com/static/img/dev-logo-lg.7404c00322a8.gif" alt="GIPHY" style="height:20px;opacity:.9"/> <small style="color:var(--text-2);font-size:12px">Powered by GIPHY</small></div>`;
  root.appendChild(footer);

  load();
  return { close: () => {} };
}

function escErr(err) {
  try { return String(err.message || err || 'Erro desconhecido'); } catch { return 'Erro desconhecido'; }
}

function toastSmall(msg) {
  window.dispatchEvent(new CustomEvent("devcord:toast", { detail: { msg, type: "info" } }));
}
