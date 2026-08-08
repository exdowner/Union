// auth.js — Sistema de autenticação (Login/Registro) com Firebase.
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { app } from "./firebase-config.js";

const auth = getAuth(app);

export function loginUser(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function registerUser(email, password, displayName) {
  return createUserWithEmailAndPassword(auth, email, password).then((userCredential) => {
    if (displayName) {
      return updateProfile(userCredential.user, { displayName }).then(() => userCredential);
    }
    return userCredential;
  });
}

export function logoutUser() {
  return signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export function getCurrentUser() {
  return auth.currentUser;
}
