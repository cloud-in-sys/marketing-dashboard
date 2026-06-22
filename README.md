# Dashboard

データ分析ダッシュボード。**1つのコードベースから複数のテナント（GCP プロジェクト）へ撃ち分けてデプロイ**するマルチテナント構成。

## アーキテクチャ

| レイヤー | 技術 | 配置 |
|---|---|---|
| フロントエンド | 静的 SPA（`index.html` + `js/` + `styles/`） | Firebase Hosting |
| バックエンド | Hono（`backend/src/`） | Cloud Run（`/api/**` に rewrite） |
| データ / 認証 / ブランディング | Firestore + Firebase Auth | 各テナントの GCP プロジェクト |

テナント間で変わる値（プロジェクトID・鍵・OAuth 等）はすべて `deploy/tenants/<tenant>.env`（gitignore）に集約され、`app-config.js` / `.firebaserc` / backend env は `deploy/deploy.sh` が生成する。**新テナントは定義ファイルを1つ足すだけ。**

## ディレクトリ構成

```
index.html              フロントのエントリ
app-config.js           テナント設定（deploy.sh が生成・gitignore）
js/                     フロントのモジュール（main.js から読み込み）
styles/                 CSS
backend/                Cloud Run バックエンド（src/server.js がエントリ）
deploy/                 マルチテナント・デプロイ機構（deploy.sh + tenants/）
docs/                   ドキュメント
firebase.json           Hosting / rewrite / Firestore 設定
firestore.rules         Firestore セキュリティルール
firestore.indexes.json  Firestore インデックス
```

## デプロイ

```bash
./deploy/deploy.sh <tenant> [hosting|firestore|backend|all]
```

```bash
# 例: dry-run で確認 → hosting だけ → 全部
./deploy/deploy.sh <tenant> all --dry-run
./deploy/deploy.sh <tenant> hosting
./deploy/deploy.sh <tenant> all
```

詳しい運用・フラグは [deploy/README.md](deploy/README.md) を参照。

## ドキュメント

- [新テナントのセットアップ](docs/setup-new-tenant.md) — GCP プロジェクト初期構築〜初回デプロイの手順
- [デプロイ運用](deploy/README.md) — `deploy.sh` の使い方・テナント定義ファイル
