// emoji.js — dados de emoji + picker (pesquisa, categorias, recentes, favoritos).
// Emojis continuam permitidos dentro de mensagens e reações; a interface usa SVG.

const EMOJI_CATS = [
  {
    id: "smileys", label: "Smileys", icon: "smile", emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃",
      "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜",
      "🤪", "🤨", "🧐", "🤓", "😎", "🥸", "🤩", "🥳", "😏", "😒", "😞", "😔",
      "😟", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤",
      "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓",
      "🤗", "🤔", "🤭", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦",
      "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵", "🤐", "🥴", "🤢", "🤮",
      "🤧", "😷", "🤒", "🤕", "🤑", "🤠", "😈", "👿", "👹", "👺", "🤡", "💩",
      "👻", "💀", "👽", "👾", "🤖", "🎃", "😺", "😸", "😹", "😻", "😼", "😽",
      "🙀", "😿", "😾", "👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "🤙", "👈",
      "👉", "👆", "👇", "☝️", "✋", "🤚", "🖐", "🖖", "👋", "🤌", "🫶", "🤝",
      "🙏", "✍️", "💪", "🦾", "🖕", "🤲", "🫰", "👏",
    ],
  },
  {
    id: "people", label: "Pessoas", icon: "users", emojis: [
      "👶", "👧", "🧒", "👦", "👩", "🧑", "👨", "👵", "🧓", "👴", "👲", "👳",
      "🧕", "👮", "🕵️", "💂", "👷", "🤴", "👸", "👳‍♂️", "👳‍♀️", "👼", "🎅", "🤶",
      "🦸", "🦹", "🧙", "🧚", "🧛", "🧜", "🧝", "🧞", "🧟", "💆", "💇", "🚶",
      "🏃", "💃", "🕺", "🕴️", "👯", "🧖", "🧗", "🤺", "🏇", "⛷️", "🏂", "🏌️",
      "🏄", "🚣", "🏊", "⛹️", "🏋️", "🚴", "🚵", "🤸", "🤼", "🤽", "🤾", "🤹",
      "🧘", "🛀", "🛌", "👭", "👫", "👬", "💏", "💑", "👪", "🗣️", "👤", "👥",
    ],
  },
  {
    id: "animals", label: "Animais", icon: "users", emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮",
      "🐷", "🐸", "🐵", "🙈", "🙉", "🙊", "🐒", "🐔", "🐧", "🐦", "🐤", "🐣",
      "🐥", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🪱", "🐛",
      "🦋", "🐌", "🐞", "🐜", "🪰", "🪲", "🦟", "🦗", "🕷️", "🦂", "🐢", "🐍",
      "🦎", "🦖", "🦕", "🐙", "🦑", "🦐", "🦞", "🦀", "🐡", "🐠", "🐟", "🐬",
      "🐳", "🐋", "🦈", "🐊", "🐅", "🐆", "🦓", "🦍", "🦧", "🦣", "🐘", "🦛",
      "🦏", "🐪", "🐫", "🦒", "🦘", "🦬", "🐃", "🐂", "🐄", "🐎", "🐖", "🐏",
      "🐑", "🦙", "🐐", "🦌", "🐕", "🐩", "🦮", "🐈", "🪶", "🐓", "🦃", "🦤",
      "🦚", "🦜", "🦢", "🦩", "🕊️", "🐇", "🦝", "🦨", "🦡", "🦫", "🦦", "🦥",
      "🐁", "🐀", "🐿️", "🦔",
    ],
  },
  {
    id: "food", label: "Comida", icon: "sparkles", emojis: [
      "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒",
      "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆", "🥑", "🥦", "🥬", "🥒", "🌶️",
      "🫑", "🌽", "🥕", "🫒", "🧄", "🧅", "🥔", "🍠", "🥐", "🥯", "🍞", "🥖",
      "🥨", "🧀", "🥚", "🍳", "🧈", "🥞", "🧇", "🥓", "🥩", "🍗", "🍖", "🌭",
      "🍔", "🍟", "🍕", "🫓", "🥪", "🥙", "🧆", "🌮", "🌯", "🫔", "🥗", "🥘",
      "🫕", "🥫", "🍝", "🍜", "🍲", "🍛", "🍣", "🍱", "🥟", "🦪", "🍤", "🍙",
      "🍚", "🍘", "🍥", "🥠", "🥮", "🍢", "🍡", "🍧", "🍨", "🍦", "🥧", "🧁",
      "🍰", "🎂", "🍮", "🍭", "🍬", "🍫", "🍿", "🍩", "🍪", "🌰", "🥜", "🍯",
      "🥛", "🍼", "🫖", "☕", "🍵", "🧃", "🥤", "🧋", "🍶", "🍺", "🍻", "🥂",
      "🍷", "🥃", "🍸", "🍹", "🧉", "🍾", "🧊",
    ],
  },
  {
    id: "activity", label: "Atividades", icon: "zap", emojis: [
      "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱", "🪀", "🏓",
      "🏸", "🏒", "🏑", "🥍", "🏏", "🪃", "🥅", "⛳", "🪁", "🏹", "🎣", "🤿",
      "🥊", "🥋", "🎽", "🛹", "🛼", "🛷", "⛸️", "🥌", "🎿", "⛑️", "🎯", "🎮",
      "🎲", "♟️", "🀄", "🎴", "🃏", "🎭", "🎨", "🎬", "🎤", "🎧", "🎼", "🎹",
      "🥁", "🪘", "🎷", "🎺", "🪗", "🎸", "🪕", "🎻", "🪈", "🎙️", "📻", "🎚️",
      "🎛️", "🧮", "🚲", "🛴", "🛵", "🏍️", "🛺", "🚗", "🚕", "🚙", "🚌", "🚎",
      "🏎️", "🚓", "🚑", "🚒", "🚐", "🛻", "🚚", "🚛", "🚜", "🦯", "🦽", "🦼",
      "🛴",
    ],
  },
  {
    id: "travel", label: "Viagens", icon: "map-pin", emojis: [
      "🌍", "🌎", "🌏", "🗺️", "🧭", "🏔️", "⛰️", "🌋", "🗻", "🏕️", "🏖️", "🏜️",
      "🏝️", "🏞️", "🏟️", "🏛️", "🏗️", "🧱", "🪨", "🪵", "🛖", "🏘️", "🏚️", "🏠",
      "🏡", "🏢", "🏬", "🏣", "🏤", "🏥", "🏦", "🏨", "🏪", "🏫", "🏩", "💒",
      "🏛️", "⛪", "🕌", "🕍", "🛕", "🕋", "⛩️", "🛤️", "🛣️", "🗾", "🎑", "🏞️",
      "🌅", "🌄", "🌠", "🎇", "🎆", "🌇", "🌆", "🏙️", "🌃", "🌌", "🌉", "🌁",
    ],
  },
  {
    id: "objects", label: "Objetos", icon: "grid", emojis: [
      "⌚", "📱", "📲", "💻", "⌨️", "🖥️", "🖨️", "🖱️", "🖲️", "🕹️", "🗜️", "💽",
      "💾", "💿", "📀", "📼", "📷", "📸", "📹", "🎥", "📽️", "🎞️", "📞", "☎️",
      "📟", "📠", "📺", "📻", "🎙️", "🧭", "⏱️", "⏲️", "⏰", "🕰️", "⌛", "⏳",
      "📡", "🔋", "🪫", "🔌", "💡", "🔦", "🕯️", "🪔", "🧯", "🛢️", "💸", "💵",
      "💴", "💶", "💷", "🪙", "💰", "💳", "💎", "⚖️", "🪜", "🧰", "🪛", "🔧",
      "🔨", "⚒️", "🛠️", "⛏️", "🪚", "🔩", "⚙️", "🪤", "🧲", "🔫", "💣", "🧨",
      "🪓", "🔪", "🗡️", "⚔️", "🛡️", "🚬", "⚰️", "🪦", "⚱️", "🏺", "🔮", "📿",
      "🧿", "💈", "⚗️", "🔭", "🔬", "🕳️", "🩹", "🩺", "🩻", "🩼", "🩸", "💊",
      "💉", "🩷", "🩵", "🩶", "🫀", "🫁", "🧬", "🦠", "🧪", "🧫", "🧴", "🧷",
    ],
  },
  {
    id: "symbols", label: "Símbolos", icon: "badge", emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕",
      "💞", "💓", "💗", "💖", "💘", "💝", "💟", "☮️", "✝️", "☪️", "🕉️", "☸️",
      "✡️", "🔯", "🕎", "☯️", "☦️", "🛐", "⛎", "♈", "♉", "♊", "♋", "♌",
      "♍", "♎", "♏", "♐", "♑", "♒", "♓", "🆔", "⚛️", "🉑", "☢️", "☣️",
      "📴", "📳", "🈶", "🈚", "🈸", "🈺", "🈷️", "✴️", "🆚", "💮", "🉐", "㊙️",
      "㊗️", "🈴", "🈵", "🈹", "🈲", "🅰️", "🅱️", "🆎", "🆑", "🅾️", "🆘", "❌",
      "⭕", "🛑", "⛔", "📛", "🚫", "💯", "💢", "♨️", "🚷", "🚯", "🚳", "🚱",
      "🔞", "📵", "🚭", "❗", "❕", "❓", "❔", "‼️", "⁉️", "🔅", "🔆", "〽️",
      "⚠️", "🚸", "🔱", "⚜️", "🔰", "♻️", "✅", "🈯", "💹", "❇️", "✳️", "❎",
      "🌐", "💠", "Ⓜ️", "🌀", "💤", "🏧", "🚾", "♿", "🅿️", "🛗", "🈳", "🈂️",
      "🛂", "🛃", "🛄", "🛅", "🚹", "🚺", "🚼", "⚧", "🚻", "🚮", "🎦", "📶",
      "🈁", "🔣", "ℹ️", "🔤", "🔡", "🔠", "🔢", "🔣", "🔤", "🆕", "🆙", "🆒",
      "🆓", "🆖", "🆗", "🆙", "🆚", "🎵", "🎶", "➰", "➿", "✖️", "➕", "➖",
      "➗", "♾️", "💲", "💱", "™️", "©️", "®️", "👁️", "🗨️", "🔚", "🔙", "🔛",
      "🔝", "🔜", "🫰",
    ],
  },
];

const EMOJI_MAP = {};
EMOJI_CATS.forEach((c) => c.emojis.forEach((e) => { if (!EMOJI_MAP[e]) EMOJI_MAP[e] = c.label; }));

const EMOJI_SEARCH_KEY = new Map();
EMOJI_CATS.forEach((c) => c.emojis.forEach((e) => EMOJI_SEARCH_KEY.set(e, e)));

const EMOJI_INDEX = (() => {
  const names = {
    "😀": "rosto sorridente sorriso", "😂": "risada lágrimas", "🤣": "rolar rir", "😅": "suor aliviado",
    "😊": "sorridente olhos", "😍": "apaixonado coração olhos", "🥰": "amor corações", "😎": "legal óculos",
    "😭": "choro lágrimas", "😢": "triste chorar", "😡": "raiva bravo", "❤️": "coração vermelho amor",
    "🔥": "fogo quente", "🎉": "festa celebração", "👍": "joinha positivo gostei", "👎": "deslike negativo",
    "💀": "caveira morte", "🤔": "pensando dúvida", "🤯": "explodiu cabeça", "🥳": "festa comemoração",
    "😴": "dormindo sono", "🤮": "vômito nojo", "🤢": "enjoo doente", "👻": "fantasma",
    "💯": "cem pontos perfeito", "🙏": "por favor oração agradecer", "🙌": "celebrar mãos para cima",
    "👏": "aplausos palmas", "🤝": "aperto de mãos", "💪": "força músculo", "🤗": "abraço",
    "🙈": "não ver vergonha", "🙉": "não ouvir", "🙊": "não falar", "🐶": "cachorro cão",
    "🐱": "gato", "🦊": "raposa", "🐼": "panda", "🦁": "leão", "🐯": "tigre",
    "🍕": "pizza", "🍔": "hambúrguer", "🍟": "batata frita", "🍺": "cerveja", "☕": "café",
    "⚽": "futebol bola", "🎮": "videogame jogo", "🎤": "microfone cantar", "🎧": "fone ouvido música",
    "🌍": "terra planeta mundo", "📱": "celular telefone", "💻": "notebook computador",
    "📷": "câmera foto", "📸": "flash câmera", "💡": "lâmpada ideia", "💰": "dinheiro saco",
    "💎": "diamante joia", "🔮": "bola cristal", "🎁": "presente", "✨": "brilho estrelas",
    "⭐": "estrela", "🌟": "estrela brilhante", "✅": "check correto", "❌": "x errado",
    "⚠️": "aviso atenção", "🚀": "foguete lançar", "✌️": "paz vitória", "👌": "ok perfeito",
    "👋": "tchau acenar oi", "🫶": "coração com mãos", "🥺": "suplicante triste", "😳": "surpreso corado",
  };
  return names;
})();

function searchEmojis(q) {
  const term = (q || "").toLowerCase().trim();
  const out = [];
  for (const c of EMOJI_CATS) {
    for (const e of c.emojis) {
      const hay = ((EMOJI_INDEX[e] || "") + " " + (EMOJI_MAP[e] || "")).toLowerCase();
      if (!term || hay.includes(term)) out.push(e);
      if (out.length >= 80) return out;
    }
  }
  return out;
}

const LS_RECENT = "devcord-emoji-recents";
const LS_FAV = "devcord-emoji-favs";

function lsGet(key, def) { try { return JSON.parse(localStorage.getItem(key)) || def; } catch { return def; } }
function lsSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

export function getRecentEmojis() { return lsGet(LS_RECENT, []).slice(0, 24); }
export function getFavEmojis() { return lsGet(LS_FAV, []).slice(0, 24); }
export function addRecentEmoji(e) {
  const r = getRecentEmojis().filter((x) => x !== e);
  r.unshift(e);
  lsSet(LS_RECENT, r.slice(0, 24));
}
export function toggleFavEmoji(e) {
  const f = getFavEmojis();
  if (f.includes(e)) lsSet(LS_FAV, f.filter((x) => x !== e));
  else lsSet(LS_FAV, [e, ...f].slice(0, 24));
}
export function isFavEmoji(e) { return getFavEmojis().includes(e); }

// Renderiza o picker de emoji no container fornecido.
// opts: { onPick(emoji), onFav(emoji), categoryEl? }
export function renderEmojiPicker(root, opts) {
  root.innerHTML = "";
  let current = "recentes";

  const header = document.createElement("div");
  header.className = "picker-header";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Buscar emoji...";
  search.setAttribute("aria-label", "Buscar emoji");
  header.appendChild(search);
  root.appendChild(header);

  const cats = document.createElement("div");
  cats.className = "emoji-cats";
  cats.setAttribute("role", "tablist");
  const catButtons = {};
  [
    { id: "recentes", label: "🕘" },
    { id: "favoritos", label: "⭐" },
    ...EMOJI_CATS.map((c) => ({ id: c.id, label: c.emojis[0] })),
  ].forEach((c) => {
    const b = document.createElement("button");
    b.textContent = c.label;
    b.title = c.id === "recentes" ? "Recentes" : c.id === "favoritos" ? "Favoritos" : c.label;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-label", b.title);
    b.dataset.cat = c.id;
    b.addEventListener("click", () => {
      current = c.id;
      Object.values(catButtons).forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      paint();
    });
    catButtons[c.id] = b;
    cats.appendChild(b);
  });
  root.appendChild(cats);

  const body = document.createElement("div");
  body.className = "picker-body";
  root.appendChild(body);

  function emojiButton(e) {
    const b = document.createElement("button");
    b.textContent = e;
    b.title = e;
    b.setAttribute("aria-label", `Emoji ${e}`);
    b.addEventListener("click", () => opts.onPick(e));
    b.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      opts.onFav?.(e);
      b.classList.add("active");
      toastSmall(isFavEmoji(e) ? "Emoji favoritado ⭐" : "Emoji removido dos favoritos");
    });
    if (isFavEmoji(e)) b.classList.add("active");
    return b;
  }

  function paint() {
    body.innerHTML = "";
    let list;
    if (current === "recentes") list = getRecentEmojis();
    else if (current === "favoritos") list = getFavEmojis();
    else list = EMOJI_CATS.find((c) => c.id === current)?.emojis || [];
    if (!list.length) {
      body.innerHTML = `<div class="empty-state"><p>Nada por aqui ainda.</p></div>`;
      return;
    }
    const grid = document.createElement("div");
    grid.className = "picker-grid";
    list.forEach((e) => grid.appendChild(emojiButton(e)));
    body.appendChild(grid);
  }

  let debounce = null;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const q = search.value.trim();
      body.innerHTML = "";
      const results = searchEmojis(q);
      if (!results.length) {
        body.innerHTML = `<div class="empty-state"><p>Nenhum emoji encontrado.</p></div>`;
        return;
      }
      const grid = document.createElement("div");
      grid.className = "picker-grid";
      results.forEach((e) => grid.appendChild(emojiButton(e)));
      body.appendChild(grid);
    }, 120);
  });

  paint();
  return { close: () => {} };
}

function toastSmall(msg) {
  window.dispatchEvent(new CustomEvent("devcord:toast", { detail: { msg, type: "info" } }));
}
