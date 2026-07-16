// Google OAuth トークン (users/{uid}/tokens/google) の共通操作。
//
// Firestore は親 doc を消してもサブコレクションを消さないため、users/{uid} を
// 削除しただけではトークンが残り続ける。残ったトークンは
//   - refreshAll() の createdBy 経路
//   - findAnyConnectedUser() のフォールバック
// に拾われ、退職者・契約終了した代理店の資格情報で自動更新が回り続けてしまう。
// ユーザー削除と「連携解除」の両方からここを通すこと。
import { OAuth2Client } from 'google-auth-library';
import { db } from '../firebase.js';
import { getSecret } from './secrets.js';

export function googleTokenDoc(uid) {
  return db.collection('users').doc(uid).collection('tokens').doc('google');
}

async function oauthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = await getSecret('google-oauth-client-secret');
  const redirectUri = process.env.OAUTH_REDIRECT_URI;
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

// Google 側で token を revoke してから doc を削除する。
// revoke の成否に関わらず doc は必ず消す。revoke が失敗しても doc を残すと
// 「Google 側では生きている + こちらでも使える」という最悪の状態になるため。
// (doc さえ消せば、少なくともこのシステムからは二度と使われない)
// 戻り値: { existed, revoked }
export async function revokeAndDeleteGoogleToken(uid, context = {}) {
  const ref = googleTokenDoc(uid);
  const snap = await ref.get();
  if (!snap.exists) return { existed: false, revoked: false };
  const { refreshToken, accessToken } = snap.data() || {};
  let revoked = false;
  try {
    const oauth = await oauthClient();
    // refresh token を revoke すると紐づく access token も無効になる
    if (refreshToken) { await oauth.revokeToken(refreshToken); revoked = true; }
    else if (accessToken) { await oauth.revokeToken(accessToken); revoked = true; }
  } catch (e) {
    // revoke 失敗は握りつぶさず必ず記録する (Google 側にトークンが残る = 要手動失効)
    console.log(JSON.stringify({
      severity: 'ERROR',
      message: 'google token revoke failed',
      uid,
      ...context,
      error: e.message,
    }));
  }
  await ref.delete();
  return { existed: true, revoked };
}
