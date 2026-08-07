// firebase-config.js
// Inicializa o Firebase e exporta as instâncias usadas no resto do app.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getDatabase,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

// Suas chaves (chaves de config do Firebase Web são públicas por natureza;
// a segurança real vem das Regras do Realtime Database — veja database.rules.json)
const firebaseConfig = {
  apiKey: "AIzaSyD6mo_rK6_4-RtaR8Wzg9UxWy7HaqnKNE8",
  authDomain: "devcord-4dcf6.firebaseapp.com",
  databaseURL: "https://devcord-4dcf6-default-rtdb.firebaseio.com",
  projectId: "devcord-4dcf6",
  storageBucket: "devcord-4dcf6.firebasestorage.app",
  messagingSenderId: "168388878048",
  appId: "1:168388878048:web:c4b9628253e4b46c077a85",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const rtdb = getDatabase(app);
export {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  serverTimestamp,
};
