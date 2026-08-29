// auth.js — cadastro, login, logout e criação do perfil no Realtime Database
import {
  auth, rtdb,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  serverTimestamp,
  googleProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from "./firebase-config.js";
import { ref, set, get } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const authScreen = document.getElementById("auth-screen");
const appRoot = document.getElementById("app");

function killSplash() {
  const s = document.getElementById("splash-screen");
  if (!s) return;
  s.classList.add("hidden");
  s.style.cssText = "display:none!important;visibility:hidden;pointer-events:none;opacity:0;z-index:-1";
  try { s.remove(); } catch {}
}

const tabs = document.querySelectorAll(".auth-tab");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    if (tab.dataset.tab === "login") {
      loginForm.classList.remove("hidden");
      registerForm.classList.add("hidden");
    } else {
      registerForm.classList.remove("hidden");
      loginForm.classList.add("hidden");
    }
  });
});

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errorEl.textContent = traduzErro(err.code);
  }
});

registerForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("register-name").value.trim();
  const email = document.getElementById("register-email").value.trim();
  const password = document.getElementById("register-password").value;
  const errorEl = document.getElementById("register-error");
  errorEl.textContent = "";
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    await set(ref(rtdb, `users/${cred.user.uid}`), {
      displayName: name,
      email,
      photoURL: "",
      bannerURL: "",
      bio: "",
      accentColor: "#3dd68c",
      nameFont: "Inter",
      socialLinks: "",
      customStatus: "Online",
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    errorEl.textContent = traduzErro(err.code);
  }
});

async function ensureGoogleUser(u) {
  const snap = await get(ref(rtdb, `users/${u.uid}`));
  if (!snap.exists()) {
    await set(ref(rtdb, `users/${u.uid}`), {
      displayName: u.displayName || "Usuário",
      email: u.email || "",
      photoURL: u.photoURL || "",
      bannerURL: "",
      bio: "",
      accentColor: "#3dd68c",
      nameFont: "Inter",
      socialLinks: "",
      customStatus: "Online",
      createdAt: serverTimestamp(),
    });
  }
}

document.getElementById("google-login-btn")?.addEventListener("click", async () => {
  const errorEl = document.getElementById("login-error");
  if (errorEl) errorEl.textContent = "";
  try {
    const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    if (isMobile) {
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    const cred = await signInWithPopup(auth, googleProvider);
    await ensureGoogleUser(cred.user);
  } catch (err) {
    try {
      await signInWithRedirect(auth, googleProvider);
    } catch (e2) {
      if (errorEl) errorEl.textContent = traduzErro(err.code) || err.message || String(err);
    }
  }
});

getRedirectResult(auth).then(async (cred) => {
  if (cred?.user) await ensureGoogleUser(cred.user);
}).catch(() => {});

function traduzErro(code) {
  const map = {
    "auth/email-already-in-use": "Esse email já está cadastrado.",
    "auth/invalid-email": "Email inválido.",
    "auth/weak-password": "Senha muito fraca (mín. 6 caracteres).",
    "auth/user-not-found": "Conta não encontrada.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/invalid-credential": "Email ou senha incorretos.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco.",
    "auth/popup-closed-by-user": "Login cancelado.",
    "auth/popup-blocked": "Popup bloqueado. Tentando outro método…",
    "auth/unauthorized-domain": "Domínio não autorizado no Firebase (adicione o domínio do site).",
  };
  return map[code] || "Erro de autenticação.";
}

async function ensureUserDoc(user) {
  const uRef = ref(rtdb, `users/${user.uid}`);
  const snap = await get(uRef);
  if (!snap.exists()) {
    await set(uRef, {
      displayName: user.displayName || "Usuário",
      email: user.email || "",
      photoURL: user.photoURL || "",
      bannerURL: "",
      bio: "",
      accentColor: "#3dd68c",
      nameFont: "Inter",
      socialLinks: "",
      customStatus: "Online",
      createdAt: serverTimestamp(),
    });
  }
  return (await get(uRef)).val();
}

onAuthStateChanged(auth, async (user) => {
  killSplash();
  if (user) {
    try { await ensureUserDoc(user); } catch (e) { console.warn(e); }
    authScreen?.classList.add("hidden");
    appRoot?.classList.remove("hidden");
    window.dispatchEvent(new CustomEvent("devcord:signed-in", { detail: user }));
  } else {
    appRoot?.classList.add("hidden");
    authScreen?.classList.remove("hidden");
  }
});

setTimeout(killSplash, 400);
setTimeout(killSplash, 1500);
