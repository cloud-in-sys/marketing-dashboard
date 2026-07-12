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

  // App Check (reCAPTCHA v3) サイトキー。コードに含めて公開してOK。
  // appCheckSiteKey: 'REPLACE_ME',

  // ロゴ・タイトル・ヘッダー色などのブランディングは、デプロイ後に
  // 管理者設定 > ブランディング 画面から設定する (Firestore に保存)。

  // 機能フラグ。
  // useBackendAggregate: true でメトリクス集計を Cloud Run に委譲 (描画はブラウザ)。
  //   false (デフォルト) は従来通りブラウザで集計。
  features: {
    useBackendAggregate: false,
  },
};
