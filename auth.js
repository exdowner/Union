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
  const submitBtn = loginForm.querySelector('button[type="submit"]');
  errorEl.textContent = "";
  submitBtn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errorEl.textContent = traduzErro(err.code) || err.message || "Ocorreu um erro. Tente novamente.";
  } finally {
    submitBtn.disabled = false;
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("register-name").value.trim();
  const email = document.getElementById("register-email").value.trim();
  const password = document.getElementById("register-password").value;
  const errorEl = document.getElementById("register-error");
  const submitBtn = registerForm.querySelector('button[type="submit"]');
  errorEl.textContent = "";

  if (!name || name.length < 2) {
    errorEl.textContent = "Por favor informe um nome de exibição válido.";
    return;
  }

  submitBtn.disabled = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    try {
      await updateProfile(cred.user, { displayName: name });
    } catch (upErr) {
      // não fatal — continuamos para gravar o documento
      console.warn("updateProfile failed:", upErr);
    }

    const userRef = ref(rtdb, `users/${cred.user.uid}`);
    await set(userRef, {
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

    // limpar formulário para evitar re-submits
    registerForm.reset();
  } catch (err) {
    errorEl.textContent = traduzErro(err.code) || err.message || "Ocorreu um erro. Tente novamente.";
  } finally {
    submitBtn.disabled = false;
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
    "auth/network-request-failed": "Falha de rede. Verifique sua conexão.",
  };
  return map[code];
}

// Garante que o perfil existe (para contas antigas/edge cases)
export async function ensureUserDoc(user) {
  try {
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
  } catch (err) {
    console.error("ensureUserDoc error:", err);
    throw err;
  }
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      await ensureUserDoc(user);
    } catch (err) {
      // não bloqueamos a UI caso a escrita falhe — logamos e continuamos
      console.warn("Failed to ensure user doc:", err);
    }
    authScreen.classList.add("hidden");
    appRoot.classList.remove("hidden");
    window.dispatchEvent(new CustomEvent("devcord:signed-in", { detail: user }));
  } else {
    appRoot.classList.add("hidden");
    authScreen.classList.remove("hidden");
  }
});
