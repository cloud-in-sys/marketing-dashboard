// Per-deployment config. Copy to app-config.js and fill in the values from
// Firebase Console > Project settings > General > "Your apps" > SDK snippet.
// When served via Firebase Hosting, set `apiBase` to '' (same-origin).
window.__APP_CONFIG__ = {
  firebase: {
    apiKey: 'REPLACE_ME',
    authDomain: 'REPLACE_ME.firebaseapp.com',
    projectId: 'REPLACE_ME',
    appId: 'REPLACE_ME',
  },
  apiBase: '',
};
