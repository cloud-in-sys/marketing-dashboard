// 実行時グローバルの型宣言。
//
// window.__APP_CONFIG__ は frontend/public/app-config.js が定義する
// (テナントごとの値なので git 管理外。vite.config.js のコメント参照)。
// バンドルには含まれず index.html から別途読み込まれるため、型はここで手で宣言する。
//
// すべて optional。app-config.js が無い / 項目が欠けている環境でも
// app/config.js がフォールバックして動くようにしてあるため。

export {};

declare global {
  interface Window {
    __APP_CONFIG__?: {
      firebase?: {
        apiKey?: string;
        authDomain?: string;
        projectId?: string;
        appId?: string;
      };
      /** Firebase Hosting の rewrite 越しなら '' (同一オリジン) */
      apiBase?: string;
      /** App Check (reCAPTCHA v3) のサイトキー。空なら App Check を無効にする */
      appCheckSiteKey?: string;
      features?: Record<string, boolean>;
    };
  }
}
