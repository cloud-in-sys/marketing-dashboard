// Firebase SDK loaded from CDN. No bundler needed.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  getToken as getAppCheckToken,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app-check.js';
import { FIREBASE_CONFIG, APP_CHECK_SITE_KEY } from './config.js';

const app = initializeApp(FIREBASE_CONFIG);

// App Check: Firebase サービス呼び出しに X-Firebase-AppCheck トークンを付ける
let appCheck = null;
try {
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
} catch (e) {
  console.warn('[appcheck] init failed', e);
}

export async function getAppCheckHeader() {
  if (!appCheck) return null;
  try {
    const { token } = await getAppCheckToken(appCheck, /* forceRefresh */ false);
    return token || null;
  } catch (e) {
    return null;
  }
}

export const firebaseAuth = getAuth(app);

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(firebaseAuth, provider);
  return cred.user;
}

export async function signInWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
  // 未確認ユーザーには確認メールを送ってサインアウトし、呼び出し元に通知
  if (!cred.user.emailVerified) {
    try { await sendEmailVerification(cred.user); } catch (e) { /* best effort */ }
    await fbSignOut(firebaseAuth);
    const err = new Error('メールアドレス確認のメールを送信しました。受信メールのリンクをクリックしてから再ログインしてください。');
    err.code = 'auth/email-not-verified';
    throw err;
  }
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
