// auth.js — cadastro, login, logout e criação do perfil no Realtime Database
import {
  auth, rtdb,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  serverTimestamp,
} from "./firebase-config.js";
import { ref, set, get } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const authScreen = document.getElementById("auth-screen");
const appRoot = document.getElementById("app");

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

loginForm.addEventListener("submit", async (e) => {
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

registerForm.addEventListener("submit", async (e) => {
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
      accentColor: "#5ee6c4",
      nameFont: "Inter",
      socialLinks: "",
      customStatus: "Online",
      presence: "online",
      badges: ["inicio"],
      friendCode: Math.random().toString(36).slice(2, 6).toUpperCase(),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    errorEl.textContent = traduzErro(err.code);
  }
});

function traduzErro(code) {
  const map = {
    "auth/email-already-in-use": "Esse email já está cadastrado.",
    "auth/invalid-email": "Email inválido.",
    "auth/weak-password": "Senha muito fraca (mínimo 6 caracteres).",
    "auth/invalid-credential": "Email ou senha incorretos.",
    "auth/user-not-found": "Usuário não encontrado.",
    "auth/wrong-password": "Senha incorreta.",
  };
  return map[code] || "Ocorreu um erro. Tente novamente.";
}

// Garante que o perfil existe (para contas antigas/edge cases)
export async function ensureUserDoc(user) {
  const uRef = ref(rtdb, `users/${user.uid}`);
  const snap = await get(uRef);
  if (!snap.exists()) {
    await set(uRef, {
      displayName: user.displayName || "Novo usuário",
      email: user.email,
      photoURL: user.photoURL || "",
      bannerURL: "",
      bio: "",
      accentColor: "#5ee6c4",
      nameFont: "Inter",
      socialLinks: "",
      customStatus: "Online",
      presence: "online",
      badges: ["inicio"],
      friendCode: Math.random().toString(36).slice(2, 6).toUpperCase(),
      createdAt: serverTimestamp(),
    });
  }
  return (await get(uRef)).val();
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    await ensureUserDoc(user);
    authScreen.classList.add("hidden");
    appRoot.classList.remove("hidden");
    window.dispatchEvent(new CustomEvent("devcord:signed-in", { detail: user }));
  } else {
    appRoot.classList.add("hidden");
    authScreen.classList.remove("hidden");
  }
});
