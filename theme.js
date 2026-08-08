// theme.js — gerenciador de temas (dark, light, AMOLED) com persistência local.
// Respeita prefers-color-scheme e prefers-reduced-motion.

const THEME_KEY = "devcord-theme";

export const THEMES = [
  { id: "dark", label: "Escuro", icon: "moon" },
  { id: "light", label: "Claro", icon: "sun" },
  { id: "amoled", label: "AMOLED", icon: "monitor" },
];

export function getTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved && THEMES.some((t) => t.id === saved)) return saved;
  } catch {}
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

export function setTheme(id) {
  if (!THEMES.some((t) => t.id === id)) return;
  document.documentElement.setAttribute("data-theme", id);
  try { localStorage.setItem(THEME_KEY, id); } catch {}
  window.dispatchEvent(new CustomEvent("devcord:theme", { detail: id }));
}

export function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function initTheme() {
  setTheme(getTheme());
}
