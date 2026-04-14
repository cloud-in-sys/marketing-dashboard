# GCP セットアップ操作記録

`marketing-493303` プロジェクトに対して実施した操作と現在の構成。再構築・障害復旧時の参照用。

## プロジェクト基本情報

| 項目 | 値 |
|---|---|
| プロジェクト名 | marketing-dashboard |
| プロジェクト ID | `marketing-493303` |
| プロジェクト番号 | `519497398571` |
| 親組織 ID | `817502184387` |
| 課金アカウント | `01A248-E54302-A01A4E` |
| Firebase プラン | Blaze (従量課金) |
| ロケーション | `asia-northeast1` (東京) |
| 管理アカウント | `system@cloud-inc.biz` |

## 公開エンドポイント

| 種別 | URL |
|---|---|
| フロントエンド | <https://marketing-493303.web.app> |
| API (直接) | <https://dashboard-backend-519497398571.asia-northeast1.run.app> |
| API (Hosting経由) | `https://marketing-493303.web.app/api/*` |

## 実施した手順

### 1. CLI インストール

```bash
brew install --cask google-cloud-sdk
echo 'export PATH="/opt/homebrew/share/google-cloud-sdk/bin:$PATH"' >> ~/.zshrc
gcloud auth login
gcloud config set project marketing-493303

npm install -g firebase-tools --prefix ~/.npm-global --cache /tmp/npm-cache
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
firebase login
```

### 2. 必要な API 有効化

```bash
gcloud services enable \
  firestore.googleapis.com firebase.googleapis.com \
  identitytoolkit.googleapis.com firebasehosting.googleapis.com \
  firebaserules.googleapis.com run.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com sheets.googleapis.com \
  drive.googleapis.com bigquery.googleapis.com \
  iamcredentials.googleapis.com orgpolicy.googleapis.com \
  --project=marketing-493303
```

注: `firebaseauth.googleapis.com` は内部サービスのため CLI から enable 不可（Firebase コンソール経由で自動有効化）。

### 3. Firebase 紐付け（既に紐付け済みだった）

```bash
firebase projects:addfirebase marketing-493303
# → 409 ALREADY_EXISTS = 既に紐付け済み
```

### 4. Web アプリ登録

```bash
firebase apps:create WEB dashboard-web --project=marketing-493303
# App ID: 1:519497398571:web:f4bf318e6efd1832bf6d6e
firebase apps:sdkconfig WEB 1:519497398571:web:f4bf318e6efd1832bf6d6e --project=marketing-493303
```

設定値は `app-config.js` に書き込み（ローカルのみ、コミット禁止）。

### 5. Firestore (Native mode, 東京) 作成

```bash
gcloud firestore databases create --location=asia-northeast1 --type=firestore-native --project=marketing-493303
```

セキュリティルール（クライアント直アクセス完全拒否）:
```bash
firebase deploy --only firestore:rules --project=marketing-493303
```

### 6. Artifact Registry 作成

```bash
gcloud artifacts repositories create dashboard \
  --repository-format=docker --location=asia-northeast1 --project=marketing-493303
```

### 7. サービスアカウント作成と権限付与

**Cloud Run ランタイム用 SA**:
```bash
gcloud iam service-accounts create dashboard-backend \
  --display-name="Dashboard Backend Runtime" --project=marketing-493303

SA="dashboard-backend@marketing-493303.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding marketing-493303 --member="serviceAccount:${SA}" --role="roles/datastore.user"
gcloud projects add-iam-policy-binding marketing-493303 --member="serviceAccount:${SA}" --role="roles/firebaseauth.admin"
gcloud projects add-iam-policy-binding marketing-493303 --member="serviceAccount:${SA}" --role="roles/secretmanager.secretAccessor"
```

**Cloud Build デフォルト SA に追加権限**:
```bash
PROJECT_NUM=519497398571
gcloud projects add-iam-policy-binding marketing-493303 --member="serviceAccount:${PROJECT_NUM}-compute@developer.gserviceaccount.com" --role="roles/storage.objectUser"
gcloud projects add-iam-policy-binding marketing-493303 --member="serviceAccount:${PROJECT_NUM}-compute@developer.gserviceaccount.com" --role="roles/logging.logWriter"
gcloud projects add-iam-policy-binding marketing-493303 --member="serviceAccount:${PROJECT_NUM}-compute@developer.gserviceaccount.com" --role="roles/artifactregistry.writer"
```

### 8. 組織ポリシー上書き（重要）

組織レベルで `iam.allowedPolicyMemberDomains` がドメイン制限されており、`allUsers` を IAM に付与できなかった。プロジェクト単位で上書き:

```yaml
# /tmp/allow-all-domains.yaml
name: projects/marketing-493303/policies/iam.allowedPolicyMemberDomains
spec:
  rules:
  - allowAll: true
```

```bash
gcloud org-policies set-policy /tmp/allow-all-domains.yaml --project=marketing-493303
```

注: 伝播に1〜2分かかる。

### 9. OAuth 2.0 クライアント ID 作成

ブラウザ操作（CLI 不可）:
1. <https://console.cloud.google.com/auth/clients?project=marketing-493303>
2. 「+ クライアントを作成」→ ウェブアプリケーション
3. 名前: `Dashboard Backend`
4. 承認済みリダイレクト URI: `https://dashboard-backend-519497398571.asia-northeast1.run.app/api/google/auth/callback`

取得値:
- クライアント ID: `519497398571-4o32kfu8fimgdt6gm815at4bpvf50el4.apps.googleusercontent.com`
- クライアントシークレット: Secret Manager に保管

### 10. Secret Manager にシークレット登録

```bash
echo -n "GOCSPX-..." | gcloud secrets create google-oauth-client-secret --data-file=- --project=marketing-493303
```

### 11. Firebase Auth プロバイダ有効化

ブラウザ操作:
- <https://console.firebase.google.com/project/marketing-493303/authentication/providers>
- **Google** を有効化（サポートメール選択）
- **メール / パスワード** を有効化

### 12. バックエンド初回ビルド & デプロイ

```bash
cd /Users/kame./Desktop/dashboard/backend

gcloud builds submit \
  --tag asia-northeast1-docker.pkg.dev/marketing-493303/dashboard/dashboard-backend:v1 \
  --project=marketing-493303

gcloud run deploy dashboard-backend \
  --image asia-northeast1-docker.pkg.dev/marketing-493303/dashboard/dashboard-backend:v1 \
  --region asia-northeast1 \
  --project marketing-493303 \
  --allow-unauthenticated \
  --service-account "dashboard-backend@marketing-493303.iam.gserviceaccount.com" \
  --set-env-vars "GCP_PROJECT_ID=marketing-493303,GOOGLE_OAUTH_CLIENT_ID=519497398571-4o32kfu8fimgdt6gm815at4bpvf50el4.apps.googleusercontent.com,OAUTH_REDIRECT_URI=https://dashboard-backend-519497398571.asia-northeast1.run.app/api/google/auth/callback,NODE_ENV=production"
```

### 13. Cloud Run を公開（allUsers 許可）

組織ポリシー上書きを待ってから:
```bash
gcloud run services add-iam-policy-binding dashboard-backend \
  --region=asia-northeast1 --project=marketing-493303 \
  --member="allUsers" --role="roles/run.invoker"
```

### 14. フロントエンドデプロイ

```bash
firebase deploy --only hosting --project=marketing-493303
```

## 現在の構成図

```
[ブラウザ] https://marketing-493303.web.app
    ├─ 静的ファイル → Firebase Hosting
    └─ /api/* → rewrite → Cloud Run
                              ├─ Firebase Admin SDK → Firestore (users, sources, config, presets, tokens)
                              ├─ Secret Manager (OAuth client secret)
                              └─ Google APIs (Sheets, Drive, BigQuery)
```

## デプロイ作業（日常）

### フロントだけ更新
```bash
firebase deploy --only hosting --project=marketing-493303
```

### バックエンド更新
```bash
cd /Users/kame./Desktop/dashboard/backend

# 次のバージョン番号 (vN+1) を指定
TAG=v5  # 適宜変更
gcloud builds submit --tag asia-northeast1-docker.pkg.dev/marketing-493303/dashboard/dashboard-backend:${TAG} --project=marketing-493303
gcloud run deploy dashboard-backend --image asia-northeast1-docker.pkg.dev/marketing-493303/dashboard/dashboard-backend:${TAG} --region asia-northeast1 --project marketing-493303 --quiet
```

### Firestore ルール更新
```bash
firebase deploy --only firestore:rules --project=marketing-493303
```

## トラブルシューティング

### Cloud Run ログ確認
```bash
gcloud run services logs read dashboard-backend --region=asia-northeast1 --project=marketing-493303 --limit=50
```

または: <https://console.cloud.google.com/run/detail/asia-northeast1/dashboard-backend/logs?project=marketing-493303>

### Firestore データ確認
<https://console.firebase.google.com/project/marketing-493303/firestore/data>

### Firebase Auth ユーザー一覧
<https://console.firebase.google.com/project/marketing-493303/authentication/users>

### Cloud Build 履歴
<https://console.cloud.google.com/cloud-build/builds?project=marketing-493303>

### ロールバック（Cloud Run の特定リビジョンに戻す）
```bash
gcloud run services list-revisions --service=dashboard-backend --region=asia-northeast1 --project=marketing-493303
gcloud run services update-traffic dashboard-backend --to-revisions=REVISION_NAME=100 --region=asia-northeast1 --project=marketing-493303
```

## 環境変数 (Cloud Run)

| 変数 | 値 |
|---|---|
| `GCP_PROJECT_ID` | `marketing-493303` |
| `GOOGLE_OAUTH_CLIENT_ID` | `519497398571-4o32....apps.googleusercontent.com` |
| `OAUTH_REDIRECT_URI` | `https://dashboard-backend-519497398571.asia-northeast1.run.app/api/google/auth/callback` |
| `NODE_ENV` | `production` |

## Secret Manager に保管

| シークレット名 | 内容 |
|---|---|
| `google-oauth-client-secret` | OAuth クライアントシークレット |

## ローカルファイル（Git 対象外）

| ファイル | 内容 | 復元方法 |
|---|---|---|
| `app-config.js` | Firebase Web SDK 設定 | `firebase apps:sdkconfig WEB 1:519497398571:web:f4bf318e6efd1832bf6d6e --project=marketing-493303` |
| `.firebaserc` | Firebase プロジェクト ID | 中身は `{"projects":{"default":"marketing-493303"}}` |

## やってないこと（任意の追加施策）

- 予算アラート設定 (Billing Budgets)
- Cloud Logging への監査ログ送信
- Firebase App Check (API 直叩き防止)
- 古いコンテナイメージの自動削除
- カスタムドメイン (現在は `*.web.app` のみ)
- GitHub Actions による自動デプロイ（ワークフローファイルは作成済み、Secret 未設定）
