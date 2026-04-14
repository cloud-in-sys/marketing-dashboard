# Backend Setup Guide

GCP + Firebase + Cloud Run + Firestore でデプロイする手順。

## アーキテクチャ

```
[Browser]
  ↓ HTTPS (Firebase Auth ID Token in Authorization header)
[Firebase Hosting: companyX.web.app]
  ↓ /api/* rewrite
[Cloud Run: dashboard-backend]
  ↓ Admin SDK
[Firestore]   [Secret Manager]   [Google Sheets / BigQuery APIs]
```

- **フロント**: Firebase Hosting に配信
- **API**: Cloud Run (Node.js + Hono)
- **認証**: Firebase Auth (Google SSO)
- **DB**: Firestore (Native mode)
- **OAuth トークン**: Firestore に保存 (client 側には一切出さない)
- **シークレット**: Secret Manager (OAuth client_secret)

---

## 1. GCP プロジェクト作成

会社ごとに 1 プロジェクト作る:

```bash
# プロジェクト作成
gcloud projects create my-company-dashboard --name="CompanyX Dashboard"

# 課金アカウント紐付け (無料枠内でも必須)
gcloud beta billing projects link my-company-dashboard \
  --billing-account=XXXXXX-XXXXXX-XXXXXX

# 必須 API 有効化
gcloud config set project my-company-dashboard
gcloud services enable \
  firestore.googleapis.com \
  firebase.googleapis.com \
  firebaseauth.googleapis.com \
  identitytoolkit.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  sheets.googleapis.com \
  drive.googleapis.com \
  bigquery.googleapis.com
```

## 2. Firebase プロジェクト紐付け

GCP プロジェクトを Firebase でラップする:

1. <https://console.firebase.google.com/> を開く
2. 「プロジェクトを追加」→「既存の GCP プロジェクトを選択」→ 先ほど作ったプロジェクト
3. Firebase プラン: **Blaze** (従量課金) を選択 — Cloud Run ルーティングに必須、無料枠内なら課金発生しない

## 3. Firebase Auth 設定

Firebase コンソール →「Authentication」→「始める」:

1. **Sign-in method** タブ → Google を有効化 → サポートメール選択 → 保存
2. **Settings** タブ →「承認済みドメイン」に以下を追加:
   - `<project-id>.web.app`
   - `<project-id>.firebaseapp.com`
   - 独自ドメインを使う場合はそのドメインも

## 4. Firestore 作成

Firebase コンソール →「Firestore Database」→「データベースの作成」:
- モード: **Native** (Datastore モードではない)
- ロケーション: **asia-northeast1 (Tokyo)** (重要: 後から変更不可)
- 「本番環境モード」で作成 (ルールは `firestore.rules` でデプロイ済み)

## 5. Artifact Registry リポジトリ作成

Cloud Run イメージ置き場:

```bash
gcloud artifacts repositories create dashboard \
  --repository-format=docker \
  --location=asia-northeast1 \
  --project=my-company-dashboard
```

## 6. OAuth 2.0 クライアントID 作成

Google API コンソール → APIs & Services → Credentials:

1. **OAuth 同意画面**を先に設定:
   - User Type: **Internal** (同じ Workspace 組織内のみ) または **External** (全 Google アカウント)
   - スコープに以下を追加:
     - `.../auth/spreadsheets.readonly`
     - `.../auth/drive.readonly`
     - `.../auth/bigquery`
     - `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid`
2. 「認証情報を作成」→「OAuth クライアント ID」→「ウェブアプリケーション」
3. 承認済みリダイレクト URI:
   - `https://<cloud-run-url>/api/google/auth/callback`
     (Cloud Run デプロイ後に URL がわかるので、最初は仮置き→後で更新)
4. 作成後の **クライアント ID** と **クライアントシークレット** をメモ

## 7. クライアントシークレットを Secret Manager に登録

```bash
echo -n "YOUR_OAUTH_CLIENT_SECRET" | \
  gcloud secrets create google-oauth-client-secret \
    --data-file=- \
    --project=my-company-dashboard
```

## 8. Cloud Run 用サービスアカウント作成

```bash
gcloud iam service-accounts create dashboard-backend \
  --display-name="Dashboard Backend Runtime" \
  --project=my-company-dashboard

SA="dashboard-backend@my-company-dashboard.iam.gserviceaccount.com"

# Firestore 読み書き
gcloud projects add-iam-policy-binding my-company-dashboard \
  --member="serviceAccount:${SA}" \
  --role="roles/datastore.user"

# Firebase Admin (Auth 検証)
gcloud projects add-iam-policy-binding my-company-dashboard \
  --member="serviceAccount:${SA}" \
  --role="roles/firebaseauth.admin"

# Secret Manager 読み取り
gcloud projects add-iam-policy-binding my-company-dashboard \
  --member="serviceAccount:${SA}" \
  --role="roles/secretmanager.secretAccessor"
```

## 9. 初回デプロイ (手動)

GitHub Actions を使う前に、ローカルから 1 度デプロイしてテスト:

```bash
cd backend

# イメージビルド & push
gcloud builds submit \
  --tag asia-northeast1-docker.pkg.dev/my-company-dashboard/dashboard/dashboard-backend:v1 \
  --project=my-company-dashboard

# デプロイ
gcloud run deploy dashboard-backend \
  --image asia-northeast1-docker.pkg.dev/my-company-dashboard/dashboard/dashboard-backend:v1 \
  --region asia-northeast1 \
  --project my-company-dashboard \
  --allow-unauthenticated \
  --service-account "dashboard-backend@my-company-dashboard.iam.gserviceaccount.com" \
  --set-env-vars "GCP_PROJECT_ID=my-company-dashboard,GOOGLE_OAUTH_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com,OAUTH_REDIRECT_URI=https://PLACEHOLDER/api/google/auth/callback,NODE_ENV=production"
```

デプロイ後に出る URL (例: `https://dashboard-backend-xxxxx.run.app`) を控えて:

1. **OAuth クライアント**の承認済みリダイレクト URI を `https://<その URL>/api/google/auth/callback` に更新
2. 環境変数 `OAUTH_REDIRECT_URI` を同じ URL に変更して再デプロイ

## 10. フロントエンド設定

### 10.1 `.firebaserc` 作成

```bash
cp .firebaserc.example .firebaserc
# `your-firebase-project-id` を実プロジェクト ID に置換
```

### 10.2 `app-config.js` 作成

Firebase コンソール → Project settings → General → "Your apps" → Web app を追加して SDK snippet を取得:

```bash
cp app-config.example.js app-config.js
# firebase.apiKey, authDomain, projectId, appId を実値に置換
```

### 10.3 Firestore ルールデプロイ

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules --project my-company-dashboard
```

### 10.4 Hosting デプロイ

```bash
firebase deploy --only hosting --project my-company-dashboard
```

デプロイ完了後、`https://my-company-dashboard.web.app` でアプリが公開される。

## 11. 動作確認

1. `https://my-company-dashboard.web.app` にアクセス
2. 「Google でログイン」→ 自分の Google アカウント
3. 初回ログインユーザーが自動的に管理者になる (ブートストラップ)
4. データソース → Google スプレッドシート → 「Google アカウントで連携」
5. 別ポップアップで Google OAuth 同意画面
6. URL + タブ名を入れて「取得」 → データが表示されればOK

## 12. GitHub Actions (CI/CD)

### 必要なシークレット

GitHub リポジトリ → Settings → Secrets and variables → Actions:

| Secret | 内容 |
|---|---|
| `GCP_PROJECT_ID` | GCP プロジェクト ID |
| `GCP_WIF_PROVIDER` | Workload Identity Federation プロバイダ名 |
| `GCP_DEPLOY_SA` | デプロイ用サービスアカウントメール |
| `CLOUD_RUN_SA` | Cloud Run ランタイム用サービスアカウント (上で作ったもの) |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth クライアント ID |
| `OAUTH_REDIRECT_URI` | `https://<cloud-run-url>/api/google/auth/callback` |
| `APP_CONFIG_JS` | `app-config.js` の内容全体 |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Hosting デプロイ用 SA の JSON 全文 |

### Workload Identity Federation 設定

省略可 (最初はサービスアカウントキー JSON で代用可能)。推奨は WIF。詳細は <https://github.com/google-github-actions/auth#setup> 参照。

## 既知の制約 / 将来の作業

- **CSV データ**: サーバー保存なし (セッションのみ、ブラウザメモリ)。大規模化時は Cloud Storage 検討
- **リアルタイム共有**: 設定変更は自分だけに反映 (マルチユーザー共有編集は未対応)
- **BigQuery プロジェクト一覧**: 手動入力のみ (ブラウザから API 叩かない方針のため)
- **OAuth 承認済みドメイン**: Firebase Auth 設定で手動追加必要

## 費用の目安 (1 社・少人数利用)

すべて無料枠内で収まる想定:

- Cloud Run: 180万リクエスト/月無料
- Firestore: 1GB / 50k reads / 20k writes / 20k deletes 無料
- Firebase Hosting: 10GB 保存 / 360MB/日転送 無料
- Secret Manager: 6 active secrets 無料
- Auth: 実質無料
- Sheets/Drive/BigQuery API: 別料金 (BQ はクエリスキャン量で課金)
