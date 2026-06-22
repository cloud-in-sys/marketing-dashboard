# deploy/ — マルチテナント・デプロイ

1つのコードベース（このリポジトリ）から、複数の GCP プロジェクト（テナント）へ撃ち分けてデプロイする仕組み。
テナント間で変わる値はすべて `deploy/tenants/<tenant>.env` に集約されている。**新テナントは .env を1つ足すだけ。**

## 使い方

```bash
./deploy/deploy.sh <tenant> [target] [flags]
```

| 引数 | 説明 |
|---|---|
| `<tenant>` | `deploy/tenants/<tenant>.env` のテナント名（例: `forpeple`, `marketing`） |
| `[target]` | `hosting` / `firestore` / `backend` / `all`（省略時 `all`） |
| `--dry-run` | 生成内容と実行予定コマンドを表示するだけで deploy しない |
| `--yes` / `-y` | 確認プロンプトをスキップ |

### 例

```bash
# まず dry-run で生成物とコマンドを確認（何もデプロイしない）
./deploy/deploy.sh forpeple all --dry-run

# hosting だけ先に出して動作確認
./deploy/deploy.sh forpeple hosting

# 問題なければ全部
./deploy/deploy.sh forpeple all
```

`deploy.sh` は実行時に、テナント定義からリポジトリルートの `app-config.js` と `.firebaserc` を**生成**してから、
`firebase` / `gcloud` の全コマンドに `--project <PROJECT_ID>` を明示してデプロイする（誤プロジェクトへの誤爆防止）。

## 新テナントの追加

GCP プロジェクト自体の初期構築（プロジェクト作成・API 有効化・IAM・Firestore 作成など）は
[../SETUP_NEW_TENANT.md](../SETUP_NEW_TENANT.md) の Step 1〜11 を参照。その後:

```bash
cp deploy/tenants/_example.env deploy/tenants/<新テナント名>.env
# エディタで値を記入（PROJECT_ID / PROJECT_NUMBER / API_KEY / APP_ID / GOOGLE_OAUTH_CLIENT_ID 等）
./deploy/deploy.sh <新テナント名> all --dry-run   # 確認
./deploy/deploy.sh <新テナント名> all
```

## テナント定義ファイルの項目

`deploy/tenants/_example.env` を参照。`<tenant>.env`（実値）は **gitignore** され、`_example.env` のみコミットされる。

| 変数 | 取得元 |
|---|---|
| `PROJECT_ID` | GCP プロジェクトID |
| `PROJECT_NUMBER` | `gcloud projects describe $PROJECT_ID --format='value(projectNumber)'` |
| `REGION` | デプロイ先（既存は `asia-northeast1`） |
| `API_KEY` / `APP_ID` | Firebase Console > プロジェクト設定 > マイアプリ > SDK snippet |
| `APP_NAME` | 表示名（任意） |
| `APP_CHECK_SITE_KEY` | App Check の reCAPTCHA v3 site key（未使用なら空） |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth 2.0 クライアントID（backend デプロイ時に必須） |
| `USE_BACKEND_AGGREGATE` | 集計を Cloud Run に委譲するか（既定 `true`） |

`GOOGLE_OAUTH_CLIENT_ID` が手元に無い場合、既存 Cloud Run から取得できる:

```bash
gcloud run services describe dashboard-backend \
  --project <PROJECT_ID> --region asia-northeast1 \
  --format='value(spec.template.spec.containers[0].env)'
```
