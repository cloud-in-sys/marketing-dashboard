import { defineConfig } from 'vite';

// frontend ビルド設定。
// - ソースは frontend/ 配下 (index.html / src/ / styles/ / public/)
// - 出力は frontend/dist/ (Firebase Hosting の public もここを指す)
// - Firebase SDK は app/firebaseClient.js が gstatic CDN から https:// で import しており、
//   Rollup が自動的に external 化して出力にそのまま残す (バンドルしない)。
// - app-config.js は frontend/public/ に置く → dist/ 直下へ verbatim コピーされ、実行時グローバル
//   window.__APP_CONFIG__ をロードする (per-tenant の秘匿値なので gitignore)。
export default defineConfig({
  root: 'frontend',
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
