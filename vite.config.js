import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// frontend ビルド設定。
// - ソースは frontend/ 配下 (index.html / src/ / styles/ / public/)
// - 出力は frontend/dist/ (Firebase Hosting の public もここを指す)
// - Firebase SDK は app/firebaseClient.js が gstatic CDN から https:// で import しており、
//   Rollup が自動的に external 化して出力にそのまま残す (バンドルしない)。
// - app-config.js は frontend/public/ に置く → dist/ 直下へ verbatim コピーされ、実行時グローバル
//   window.__APP_CONFIG__ をロードする (per-tenant の秘匿値なので gitignore)。
const r = p => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: 'frontend',
  base: '/',
  resolve: {
    // tsconfig.json の compilerOptions.paths と必ず同じ内容に保つこと。
    // 片方だけ足すと「エディタでは解決するがビルドで落ちる」(またはその逆) になる。
    alias: {
      '@app': r('./frontend/src/app'),
      '@api': r('./frontend/src/api'),
      '@aggregate': r('./frontend/src/aggregate'),
      '@features': r('./frontend/src/features'),
      '@filters': r('./frontend/src/filters'),
      '@shared': r('./frontend/src/shared'),
      '@pkg/shared': r('./packages/shared/src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
