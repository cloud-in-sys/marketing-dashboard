# 新テナント セットアップ手順
---

## 事前準備

### 必要なもの
- Google Cloud アカウント（新規プロジェクト作成権限）
- クレジットカード（Blaze プランに必要、無料枠内なら課金されない）
- 管理者メールアドレス（この環境を管理する人のアカウント）
- 会社ロゴ画像（`logo.png`、80x80 推奨）

### 使う変数
以下を決めてから始めると作業が早い。本ドキュメント内の `{{VAR}}` を全て置き換えて使う。

| 変数 | 例 | 説明 |
|---|---|---|
| `{{PROJECT_ID}}` | `acme-dashboard` | プロジェクトID（全世界でユニーク、英数字とハイフン） |
| `{{PROJECT_NAME}}` | `ACME Dashboard` | 表示名 |
| `{{REGION}}` | `asia-northeast1` | リージョン（東京） |
| `{{ADMIN_EMAIL}}` | `admin@acme.com` | 管理者メール |
| `{{APP_NAME}}` | `ACME` | ブランド名（ログイン画面などに表示） |

`{{PROJECT_NUMBER}}` と `{{APP_ID}}` はプロジェクト作成後にGCPから取得する。

---

## Step 1: CLI インストール

ローカル開発マシンで（macOS想定）:

```bash
brew install --cask google-cloud-sdk
echo 'export PATH="/opt/homebrew/share/google-cloud-sdk/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
gcloud auth login

npm install -g firebase-tools --prefix ~/.npm-global --cache /tmp/npm-cache
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
firebase login
```

## Step 2: GCP プロジェクト作成

```bash
gcloud projects create {{PROJECT_ID}} --name="{{PROJECT_NAME}}"
gcloud config set project {{PROJECT_ID}}
```

**課金アカウント紐付け**（ブラウザ）:
1. <https://console.cloud.google.com/billing/linkedaccount?project={{PROJECT_ID}}>
2. 「課金アカウントをリンク」→ 既存 or 新規作成（Blaze 有料プラン）

プロジェクト番号を取得:
```bash
gcloud projects describe {{PROJECT_ID}} --format="value(projectNumber)"
# → {{PROJECT_NUMBER}} として以降で使う
```

## Step 3: 必要な API 有効化

```bash
gcloud services enable \
  firestore.googleapis.com firebase.googleapis.com \
  identitytoolkit.googleapis.com firebasehosting.googleapis.com \
  firebaserules.googleapis.com run.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com sheets.googleapis.com \
  drive.googleapis.com bigquery.googleapis.com \
  iamcredentials.googleapis.com orgpolicy.googleapis.com \
  storage.googleapis.com \
  --project={{PROJECT_ID}}
```

## Step 4: Firebase プロジェクトとして有効化

```bash
firebase projects:addfirebase {{PROJECT_ID}}
```

Web アプリ登録:
```bash
firebase apps:create WEB {{PROJECT_ID}}-web --project={{PROJECT_ID}}
# 出力された App ID をメモ: 1:{{PROJECT_NUMBER}}:web:xxxxx
# → {{APP_ID}} として使う

firebase apps:sdkconfig WEB {{APP_ID}} --project={{PROJECT_ID}}
# 出力された設定をメモ (apiKey, authDomain 等)
```

## Step 5: Firestore 作成

```bash
gcloud firestore databases create --location={{REGION}} --type=firestore-native --project={{PROJECT_ID}}
```

## Step 6: Cloud Storage バケット作成

スナップショット保存用:
```bash
gsutil mb -p {{PROJECT_ID}} -l {{REGION}} -b on gs://{{PROJECT_ID}}-snapshots/
```

## Step 7: Artifact Registry 作成

```bash
gcloud artifacts repositories create cloud-run-source-deploy \
  --repository-format=docker --location={{REGION}} --project={{PROJECT_ID}}
```

## Step 8: サービスアカウント作成と権限

**Cloud Run ランタイム用**:
```bash
gcloud iam service-accounts create dashboard-backend \
  --display-name="Dashboard Backend Runtime" --project={{PROJECT_ID}}

SA="dashboard-backend@{{PROJECT_ID}}.iam.gserviceaccount.com"
for role in \
  roles/datastore.user \
  roles/firebaseauth.admin \
  roles/secretmanager.secretAccessor \
  roles/storage.objectAdmin; do
  gcloud projects add-iam-policy-binding {{PROJECT_ID}} \
    --member="serviceAccount:${SA}" --role="${role}"
done
```

**Cloud Build 用**:
```bash
CB_SA="{{PROJECT_NUMBER}}-compute@developer.gserviceaccount.com"
for role in \
  roles/storage.objectUser \
  roles/logging.logWriter \
  roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding {{PROJECT_ID}} \
    --member="serviceAccount:${CB_SA}" --role="${role}"
done
```

## Step 9: OAuth 2.0 クライアント ID 作成（ブラウザ）

1. <https://console.cloud.google.com/apis/credentials?project={{PROJECT_ID}}>
2. 「認証情報を作成」→「OAuth クライアント ID」
3. 同意画面未設定なら先に設定（内部 or 外部）
4. タイプ: ウェブアプリケーション
5. 名前: `Dashboard Backend`
6. 承認済みリダイレクトURI:
   `https://dashboard-backend-{{PROJECT_NUMBER}}.{{REGION}}.run.app/api/google/auth/callback`
7. クライアントIDとシークレットをメモ

## Step 10: Secret Manager にシークレット登録

```bash
echo -n "GOCSPX-xxxx-あなたのクライアントシークレット" | \
  gcloud secrets create google-oauth-client-secret --data-file=- --project={{PROJECT_ID}}
```

## Step 11: Firebase Auth プロバイダ有効化（ブラウザ）

1. <https://console.firebase.google.com/project/{{PROJECT_ID}}/authentication/providers>
2. **Google** 有効化（サポートメール: `{{ADMIN_EMAIL}}`）
3. **メール/パスワード** 有効化

## Step 12: テナント定義を作成

> **重要**: フォルダの複製（旧 `cp -R`）はもう不要。1つのコードベースから複数テナントへ
> 撃ち分ける方式に移行済み。テナントごとの差は `deploy/tenants/<tenant>.env` に集約され、
> `app-config.js` / `.firebaserc` / backend env は `deploy/deploy.sh` が自動生成する。
> 詳細は [deploy/README.md](deploy/README.md) を参照。

### 12-1. テナント定義ファイルを作成

```bash
cp deploy/tenants/_example.env deploy/tenants/{{TENANT}}.env
```

`{{TENANT}}.env` を編集し、Step 4 で取得した値を記入する:

```sh
TENANT={{TENANT}}
PROJECT_ID={{PROJECT_ID}}
PROJECT_NUMBER={{PROJECT_NUMBER}}
REGION={{REGION}}
API_KEY=xxx                              # Step 4 の apiKey
APP_ID={{APP_ID}}
APP_NAME={{PROJECT_NAME}}
APP_CHECK_SITE_KEY=                       # App Check 未使用なら空
GOOGLE_OAUTH_CLIENT_ID=xxx.apps.googleusercontent.com
USE_BACKEND_AGGREGATE=true
```

`{{TENANT}}.env`（実値）は gitignore される。`_example.env` テンプレのみコミットされる。

### 12-2. （参考）生成内容の確認

`firebase.json` の `rewrites` 内 `serviceId` は `dashboard-backend` のまま変更不要。
`app-config.js` / `.firebaserc` は `deploy.sh` 実行時に上記 `.env` から生成されるため、手で作成しない。
内容を事前に確認したい場合:

```bash
./deploy/deploy.sh {{TENANT}} all --dry-run
```

> 注: フロントの Firebase 設定は `app-config.js`（`window.__APP_CONFIG__`）に集約されている。
> `js/config.js` はそれを読むだけなので直接編集は不要。

### 12-3. ブランディング（ロゴ・アプリ名・テーマ色）
ブランディングは **Firestore 動的管理に移行済み**。コードや静的ファイル（旧 `assets/logo.png` /
`js/config.js` の `BRAND`）の編集は不要で、デプロイ後に画面から設定する。

- 設定場所: アプリにログイン → **管理者設定 > ブランディング**
- 保存先: Firestore `config/branding`（ロゴ・タイトル・テーマ色）
- 反映: 保存後にリロードで全テナント横断ではなく当該テナントのみに適用される

### 12-4. 初期管理者設定
後で Firestore に直接作成する（Step 15）。

## Step 13-14: デプロイ（firestore / hosting / backend）

`deploy.sh` がテナント定義から `app-config.js` / `.firebaserc` を生成し、`firestore` ルール・
`hosting`・`backend`（Cloud Run）を該当プロジェクトへデプロイする。全コマンドに `--project` が
明示されるため誤プロジェクトへの誤爆を防げる。

```bash
# まず dry-run で生成物と実行コマンドを確認（何もデプロイしない）
./deploy/deploy.sh {{TENANT}} all --dry-run

# hosting だけ先に出して表示・ログインを確認
./deploy/deploy.sh {{TENANT}} hosting

# 問題なければ firestore と backend も
./deploy/deploy.sh {{TENANT}} firestore
./deploy/deploy.sh {{TENANT}} backend
# あるいは一括
./deploy/deploy.sh {{TENANT}} all
```

> backend デプロイには `GOOGLE_OAUTH_CLIENT_ID` が必要（`{{TENANT}}.env` に記入）。
> 個別 target やフラグの詳細は [deploy/README.md](deploy/README.md) を参照。

## Step 15: 初期管理者ユーザーを Firestore に作成

Firebase Console → Authentication で管理者アカウントを作成（Step 11で有効化済みのプロバイダ経由）。取得した UID を使って Firestore コンソールで手動追加:

1. <https://console.firebase.google.com/project/{{PROJECT_ID}}/firestore/data>
2. コレクション `users` を作成
3. ドキュメントID = UID
4. フィールド（**全て必須**。`createdAt` 等が欠けるとバックエンドの `users` 一覧API が `orderBy('createdAt')` で除外し、ユーザー管理画面に表示されない）:
   ```
   uid: "{{UID}}" (string, ドキュメントIDと同じ値)
   email: "{{ADMIN_EMAIL}}" (string)
   name: "{{管理者名}}" (string)
   photoURL: "" (string, 空でOK)
   isAdmin: true (boolean)
   perms: {} (map, 空でOK ※isAdmin=true なら全権限扱い)
   createdAt: "2026-01-01T00:00:00.000Z" (string, ISO8601 形式の現在時刻)
   ```

   コンソール画面での型指定:
   - `uid`, `email`, `name`, `photoURL`, `createdAt` → `string`
   - `isAdmin` → `boolean`
   - `perms` → `map`

## Step 16: フロントエンドデプロイ

```bash
firebase deploy --only hosting --project={{PROJECT_ID}}
```

## Step 17: 動作確認

1. `https://{{PROJECT_ID}}.web.app` にアクセス
2. 管理者アカウントでログイン
3. データソース追加 → Google連携 → データ取得

## トラブルシューティング

### `allUsers` が IAM に付与できない
組織ポリシー `iam.allowedPolicyMemberDomains` がドメイン制限。プロジェクト単位で上書き:

```yaml
# /tmp/allow-all-domains.yaml
name: projects/{{PROJECT_ID}}/policies/iam.allowedPolicyMemberDomains
spec:
  rules:
  - allowAll: true
```
```bash
gcloud org-policies set-policy /tmp/allow-all-domains.yaml --project={{PROJECT_ID}}
# 伝播に1〜2分かかる
```

### バックエンドが 404 / CORS エラー
- `firebase.json` の rewrites が `dashboard-backend` を指しているか確認
- Cloud Run のサービス名が `dashboard-backend` か確認（違う名前でデプロイするとリライトが効かない）

### `invalid_grant` エラー
Google Workspace の再認証ポリシー（RAPT）。Google連携を解除→再接続。

### ログ確認
```bash
gcloud run services logs read dashboard-backend --region={{REGION}} --project={{PROJECT_ID}} --limit=50
```

## 日常運用

### フロント更新
```bash
firebase deploy --only hosting --project={{PROJECT_ID}}
```

### バックエンド更新
```bash
cd backend
gcloud run deploy dashboard-backend --source . --region {{REGION}} --project {{PROJECT_ID}}
```

**重要**: サービス名は必ず `dashboard-backend`。`dashboard` にすると別サービスが作られてFirebase Hostingのリライトが効かない。

### データバックアップ
Firestore エクスポート:
```bash
gcloud firestore export gs://{{PROJECT_ID}}-backups/$(date +%Y%m%d) --project={{PROJECT_ID}}
```

## コスト

小規模運用（〜10名、〜10万行）なら**ほぼ無料枠内**で収まる:
- Cloud Run: 200万リクエスト/月まで無料
- Firestore: 読み50k/日、書き20k/日まで無料
- Cloud Storage: 5GB まで無料
- Firebase Hosting: 10GB転送/月まで無料
- Cloud Build: 120分/日まで無料

Blaze プラン必須（Spark プランでは Cloud Functions/Cloud Run が使えない）だが、無料枠を超えなければ請求は0円。
