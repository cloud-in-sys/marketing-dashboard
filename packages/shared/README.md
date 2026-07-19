# @pkg/shared

frontend / backend で共有する定数・型・純粋ロジックの置き場。

frontend からは `@pkg/shared/*` の alias で import する
(`vite.config.js` の `resolve.alias` と `tsconfig.json` の `compilerOptions.paths` の両方に定義)。

## backend は実行時に読めない

`backend/Dockerfile` が `COPY src ./src`、`deploy/deploy.sh` が `--source backend` で、
ビルドコンテキストが `backend/` だけのため、`packages/` はコンテナに入らない。

- **型** (コンパイル時のみ) は共有できる。コンテナに入る必要がないため。
- **実行時の値**を共有したくなったら、Dockerfile とデプロイ経路の変更が要る。

そのため現状 backend は写しを持ち、ズレは `frontend/test/perms.test.mjs` が機械検査する。

## ここに置くファイルの制約

**import を持たないこと。** node のテストが frontend / backend 双方の定義を直接 import して
実値で突き合わせられるのは、双方が依存ゼロだから。import を足すと (alias が node で
解決できず) 検査が書けなくなる。

## 中身

- `src/perms.ts` — 権限定義の正 (`PERM_GROUPS` ほか)。詳しくはファイル冒頭のコメント。
