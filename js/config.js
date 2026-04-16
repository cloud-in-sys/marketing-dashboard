// Per-company config. Replace values at deploy time.
// Firebase Console -> Project settings -> General -> "Your apps" -> SDK snippet.
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
export const APP_CHECK_SITE_KEY = window.__APP_CONFIG__?.appCheckSiteKey
  || '6Lc517csAAAAAHZWV6QwFoZTCWv92rMdXH8QjyNt';

// 各社で差し替え可能なブランド設定。assets/ にロゴ画像を置いて、ここで参照する。
// runtime 上書きは window.__APP_CONFIG__.brand = { ... } で可能。
export const BRAND = Object.assign({
  logoUrl: 'assets/logo.png',  // 画像ファイルのパス。差し替えるならこのファイルを置き換え
  appName: 'SHIFT AI',         // ロゴの代替テキスト & ログイン画面タイトル
}, window.__APP_CONFIG__?.brand || {});
