// Firebase SDK loaded from CDN. No bundler needed.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { FIREBASE_CONFIG } from './config.js';

const app = initializeApp(FIREBASE_CONFIG);
export const firebaseAuth = getAuth(app);

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(firebaseAuth, provider);
  return cred.user;
}

export async function signInWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
  return cred.user;
}

export async function sendPasswordReset(email) {
  await sendPasswordResetEmail(firebaseAuth, email);
}

export async function signOutUser() {
  await fbSignOut(firebaseAuth);
}

export function onAuthChange(cb) {
  return onAuthStateChanged(firebaseAuth, cb);
}

export async function getIdToken() {
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}
