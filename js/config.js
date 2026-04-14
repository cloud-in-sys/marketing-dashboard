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
