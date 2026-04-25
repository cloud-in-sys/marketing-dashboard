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

## Step 12: コードをコピーして設定変更

```bash
cp -R /path/to/original/dashboard /path/to/new/dashboard
cd /path/to/new/dashboard
```

### 12-1. `.firebaserc` 作成
```json
{"projects":{"default":"{{PROJECT_ID}}"}}
```

### 12-2. `firebase.json` 更新
`rewrites` 内の `serviceId` を確認（`dashboard-backend` のまま、変更不要）

### 12-3. `js/config.js` 更新
```javascript
export const FIREBASE_CONFIG = {
  apiKey: 'xxx',         // Step 4 で取得した値
  authDomain: '{{PROJECT_ID}}.firebaseapp.com',
  projectId: '{{PROJECT_ID}}',
  appId: '{{APP_ID}}',
};
export const API_BASE = '';
export const APP_CHECK_SITE_KEY = '';  // 必要なら設定
export const BRAND = {
  logoUrl: 'assets/logo.png',
  appName: '{{APP_NAME}}',
};
```

### 12-4. `backend/.env` 作成
```
GCP_PROJECT_ID={{PROJECT_ID}}
SNAPSHOT_BUCKET={{PROJECT_ID}}-snapshots
GOOGLE_OAUTH_CLIENT_ID=519497398571-xxx.apps.googleusercontent.com
OAUTH_REDIRECT_URI=https://dashboard-backend-{{PROJECT_NUMBER}}.{{REGION}}.run.app/api/google/auth/callback
```

### 12-5. ロゴ差し替え
ブランドロゴを会社ごとに差し替える。

**配置場所**: `assets/logo.png`（このファイル1つだけ置き換えればOK）

**推奨サイズ・形式**:
| 用途 | 推奨サイズ | 備考 |
|---|---|---|
| ヘッダー表示 | 36px 高さ（幅は比率維持、最大200px） | 横長OK |
| ログイン画面 | 80x80px | 正方形推奨 |
| ブラウザタブ（favicon） | 32x32px 以上 | 同ファイルが流用される |
| Apple Touch Icon | 180x180px 推奨 | iOS ホーム画面用 |

実装上は**どのサイズでも動く**（CSS で自動リサイズ）。1つの画像で全部の用途に使えるよう **正方形の透過PNG（256x256 程度）** が一番汎用的。

**差し替え手順**:
```bash
# 古いロゴをバックアップして新しいロゴを配置
cp assets/logo.png assets/logo.png.bak 2>/dev/null || true
cp /path/to/new-logo.png assets/logo.png
```

**フォールバック**: `assets/logo.png` が存在しない、または読み込み失敗時は「LOGO」というテキストが表示される。`js/config.js` の `BRAND.appName` がアプリ名として別途表示される（ログイン画面タイトル等）。

**適用箇所**（`index.html` で参照済み、コード修正不要）:
- ヘッダー左上（`<div class="logo" id="brand-logo">`）
- ログイン画面中央（`<div class="login-logo" id="login-brand-logo">`）
- favicon（`<link rel="icon" href="assets/logo.png">`）
- Apple touch icon（`<link rel="apple-touch-icon" href="assets/logo.png">`）

**キャッシュ注意**: ロゴ変更後もブラウザキャッシュで旧ロゴが残ることがある。シークレットウィンドウで確認 or スーパーリロード（Cmd+Shift+R）。

**ブランド名の変更**: `js/config.js` の `BRAND.appName` を書き換える（ログイン画面タイトル、ロゴ画像が無い時のフォールバック表示に使用）。

### 12-6. 初期管理者設定
後で Firestore に直接作成する（Step 15）。

## Step 13: Firestore セキュリティルール デプロイ

```bash
firebase deploy --only firestore:rules --project={{PROJECT_ID}}
```

## Step 14: バックエンド初回デプロイ

```bash
cd backend

gcloud run deploy dashboard-backend \
  --source . \
  --region {{REGION}} \
  --project {{PROJECT_ID}} \
  --allow-unauthenticated \
  --service-account "dashboard-backend@{{PROJECT_ID}}.iam.gserviceaccount.com" \
  --set-env-vars "GCP_PROJECT_ID={{PROJECT_ID}},SNAPSHOT_BUCKET={{PROJECT_ID}}-snapshots,GOOGLE_OAUTH_CLIENT_ID=xxx,OAUTH_REDIRECT_URI=https://dashboard-backend-{{PROJECT_NUMBER}}.{{REGION}}.run.app/api/google/auth/callback,NODE_ENV=production"
```

## Step 15: 初期管理者ユーザーを Firestore に作成

Firebase Console → Authentication で管理者アカウントを作成（Step 11で有効化済みのプロバイダ経由）。取得した UID を使って Firestore コンソールで手動追加:

1. <https://console.firebase.google.com/project/{{PROJECT_ID}}/firestore/data>
2. コレクション `users` を作成
3. ドキュメントID = UID
4. フィールド:
   ```
   name: "{{管理者名}}"
   email: "{{ADMIN_EMAIL}}"
   isAdmin: true (boolean)
   perms: {} (map, 空でOK)
   ```

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
