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

// 各社で差し替え可能なブランド設定。assets/ にロゴ・アイコン画像を置いて、ここで参照する。
// runtime 上書きは window.__APP_CONFIG__.brand = { ... } で可能。
export const BRAND = Object.assign({
  logoUrl: 'assets/logo.png',          // ヘッダー/ログイン画面のロゴ画像
  faviconUrl: 'assets/favicon.png',    // ブラウザタブ/Apple Touch Icon
  appName: 'logo',                     // ロゴ画像の alt 属性 (画像が読めない時の代替テキスト)
}, window.__APP_CONFIG__?.brand || {});

// テーマ(色)。CSS カスタムプロパティとして DOM に流し込まれる。
// runtime 上書きは window.__APP_CONFIG__.theme = { ... } で可能。
export const THEME = Object.assign({
  headerGradient: 'linear-gradient(135deg, #1a0b2e 20%, #5b1e8b 30%, #c2185b 100%)',
}, window.__APP_CONFIG__?.theme || {});
