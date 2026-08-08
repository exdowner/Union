// giphy.js — integração GIPHY (GIFs + stickers). Chave central em GIPHY_API_KEY.
// Endpoints usados:
//   https://api.giphy.com/v1/gifs/search   ?api_key&q&limit&offset&rating
//   https://api.giphy.com/v1/gifs/trending ?api_key&limit&offset&rating
//   https://api.giphy.com/v1/stickers/search
// Recents ficam em localStorage; favoritos são referências (id + url) no Firebase.

export const GIPHY_API_KEY = "4oiQw1BQJm2AnCaYb8IX57wCt5sz5eBQ";
const BASE = "https://api.giphy.com/v1";

const LS_RECENT = "devcord-giphy-recents";

function lsGet(key, def) { try { return JSON.parse(localStorage.getItem(key)) || def; } catch { return def; } }
function lsSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

async function giphyFetch(url) {
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 429) throw new Error("Muitas requisições ao GIPHY. Tente novamente em instantes.");
    if (res.status === 403 || res.status === 401) throw new Error("Chave do GIPHY inválida ou sem permissão.");
    throw new Error(`Erro ao acessar o GIPHY (${res.status}).`);
  }
  return res.json();
}

function normalize(data, kind) {
  return (data || []).map((g) => ({
    id: g.id,
    kind,
    title: g.title || "",
    url: (g.images && (g.images.fixed_height_downsampled || g.images.fixed_width || g.images.original)?.url) || "",
    full: (g.images && g.images.original?.url) || g.url || "",
    width: g.images?.fixed_width?.width || "200",
    height: g.images?.fixed_width?.height || "200",
    giphyUrl: g.url || "",
  }));
}

export async function searchGifs(term, offset = 0, limit = 24) {
  const url = `${BASE}/gifs/search?api_key=${encodeURIComponent(GIPHY_API_KEY)}&q=${encodeURIComponent(term)}&limit=${limit}&offset=${offset}&rating=g&lang=pt`;
  const json = await giphyFetch(url);
  return { items: normalize(json.data, "gif"), pagination: json.pagination || {} };
}

export async function trendingGifs(offset = 0, limit = 24) {
  const url = `${BASE}/gifs/trending?api_key=${encodeURIComponent(GIPHY_API_KEY)}&limit=${limit}&offset=${offset}&rating=g`;
  const json = await giphyFetch(url);
  return { items: normalize(json.data, "gif"), pagination: json.pagination || {} };
}

export async function searchStickers(term, offset = 0, limit = 24) {
  const url = `${BASE}/stickers/search?api_key=${encodeURIComponent(GIPHY_API_KEY)}&q=${encodeURIComponent(term)}&limit=${limit}&offset=${offset}&rating=g`;
  const json = await giphyFetch(url);
  return { items: normalize(json.data, "sticker"), pagination: json.pagination || {} };
}

export function getRecentGifs() { return lsGet(LS_RECENT, []).slice(0, 30); }
export function addRecentGif(g) {
  const r = getRecentGifs().filter((x) => x.id !== g.id);
  r.unshift(g);
  lsSet(LS_RECENT, r.slice(0, 30));
}

// Renderiza o picker do GIPHY.
// opts: { onPick(item), getFavs(), toggleFav(id) }
export function renderGiphyPicker(root, opts) {
  root.innerHTML = "";
  let kind = "gif";
  let query = "";
  let offset = 0;
  let loading = false;
  let done = false;
  let lastType = "trending";

  const header = document.createElement("div");
  header.className = "picker-header";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Buscar GIFs e figurinhas...";
  search.setAttribute("aria-label", "Buscar no GIPHY");
  header.appendChild(search);
  root.appendChild(header);

  const tabs = document.createElement("div");
  tabs.className = "picker-tabs";
  tabs.innerHTML = `
    <button data-k="gif" class="active">GIFs</button>
    <button data-k="sticker">Stickers</button>
    <button data-k="recentes">Recentes</button>
    <button data-k="favoritos">Favoritos</button>`;
  tabs.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      tabs.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      kind = b.dataset.k;
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
    b.setAttribute("aria-label", `Enviar ${item.kind === "sticker" ? "figurinha" : "GIF"} ${item.title}`);
    b.innerHTML = `<img src="${item.url}" alt="${item.title.replace(/"/g, "")}" loading="lazy" />`;
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
      if (query) {
        data = kind === "sticker" ? await searchStickers(query, offset) : await searchGifs(query, offset);
      } else {
        data = kind === "sticker" ? await searchStickers("", offset) : await trendingGifs(offset);
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
      body.innerHTML = `<div class="error-state"><h3>Falha ao carregar</h3><p>${err.message}</p><button class="btn btn-secondary btn-sm" id="giphy-retry">Tentar novamente</button></div>`;
      body.querySelector("#giphy-retry")?.addEventListener("click", () => { done = false; load(); });
    } finally {
      loading = false;
    }
  }

  body.addEventListener("scroll", () => {
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 80) load();
  }, { passive: true });

  load();
  return { close: () => {} };
}

function toastSmall(msg) {
  window.dispatchEvent(new CustomEvent("devcord:toast", { detail: { msg, type: "info" } }));
}
