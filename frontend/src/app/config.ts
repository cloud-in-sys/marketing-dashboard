// Per-company config. Replace values at deploy time.
// Firebase Console -> Project settings -> General -> "Your apps" -> SDK snippet.
// window.__APP_CONFIG__ の型は frontend/src/types/globals.d.ts にある。
export const FIREBASE_CONFIG = {
  apiKey: window.__APP_CONFIG__?.firebase?.apiKey || 'REPLACE_ME',
  authDomain: window.__APP_CONFIG__?.firebase?.authDomain || 'REPLACE_ME.firebaseapp.com',
  projectId: window.__APP_CONFIG__?.firebase?.projectId || 'REPLACE_ME',
  appId: window.__APP_CONFIG__?.firebase?.appId || 'REPLACE_ME',
};

// API base. When served behind Firebase Hosting rewrites, use '' (same-origin).
// When running frontend on a different origin (e.g. GitHub Pages), set to the
// Cloud Run URL.
export const API_BASE = window.__APP_CONFIG__?.apiBase ?? '';

// App Check (reCAPTCHA v3 site key). Public - safe to ship in client.
// 環境ごとの値なので app-config.js (git 管理外) から供給する。
// 未設定なら App Check は無効にする。既定のキーにフォールバックすると、
// そのキーでは検証が通らず、原因の分かりにくい認証エラーになるだけ。
export const APP_CHECK_SITE_KEY = window.__APP_CONFIG__?.appCheckSiteKey || '';

interface Features {
  useBackendAggregate: boolean;
  /** true で console.debug('[debug] ...') を出す */
  debugLog: boolean;
  [key: string]: boolean;
}

// 機能フラグ。
export const FEATURES: Features = Object.assign({
  useBackendAggregate: false,
  debugLog: false,  // true で console.debug('[debug] ...') を出す
}, window.__APP_CONFIG__?.features || {});

// デバッグログ (FEATURES.debugLog=true でのみ出力)。本番でうるさい時はフラグで黙らせる。
export function dlog(...args: unknown[]) {
  if (FEATURES.debugLog) console.debug('[dashboard]', ...args);
}
