// Firebase SDK loaded from CDN. No bundler needed.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  getToken as getAppCheckToken,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app-check.js';
import { FIREBASE_CONFIG, APP_CHECK_SITE_KEY } from './config.ts';

const app = initializeApp(FIREBASE_CONFIG);

// App Check: Firebase サービス呼び出しに X-Firebase-AppCheck トークンを付ける
// site key が無い環境 (app-config.js に appCheckSiteKey が無い) では初期化しない。
// getAppCheckHeader が null を返し、ヘッダを付けずに動く。
let appCheck = null;
if (APP_CHECK_SITE_KEY) {
  try {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    console.warn('[appcheck] init failed', e);
  }
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
  try {
    const cred = await signInWithPopup(firebaseAuth, provider);
    return cred.user;
  } catch (e) {
    // モバイル等でポップアップがブロックされた場合はリダイレクト方式にフォールバック
    if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(firebaseAuth, provider);
      return null; // ページが遷移するのでここには戻らない
    }
    throw e;
  }
}

// リダイレクトから戻ってきた時の結果を取得（ブート時に呼ぶ）。
// リダイレクト方式でのサインイン後、onAuthStateChanged も発火するが、
// ここで呼んでおくと redirect 途中で起きたエラーを捕捉できる。
export async function consumeGoogleRedirectResult() {
  try {
    const result = await getRedirectResult(firebaseAuth);
    return result?.user || null;
  } catch (e) {
    // 呼び出し元でエラー表示
    throw e;
  }
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
