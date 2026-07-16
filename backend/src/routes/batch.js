// Batch endpoints - invoked by Cloud Scheduler. Protected via OIDC header from GCP.
import { Hono } from 'hono';
import { OAuth2Client } from 'google-auth-library';
import { refreshAll } from './snapshots.js';

const app = new Hono();
const oidcVerifier = new OAuth2Client();

// Scheduler calls this with an OIDC token; we verify the JWT came from GCP.
//
// fail-closed: CLOUD_RUN_URL / SCHEDULER_SA_EMAIL が未設定なら 503 で拒否する。
// 以前は両方とも「設定されていればチェックする」だったため、環境変数が抜けると
//   - audience が undefined → verifyIdToken が aud の検証をスキップ
//   - expectedEmail が空 → 発行元 SA の確認をスキップ
// となり、Google が発行した ID token でありさえすれば誰でもバッチを起動できた
// (Google アカウントを持つ第三者でも可)。設定漏れは通す理由にならないので落とす。
app.use('*', async (c, next) => {
  const audience = process.env.CLOUD_RUN_URL;
  const expectedEmail = process.env.SCHEDULER_SA_EMAIL;
  const missing = [
    !audience && 'CLOUD_RUN_URL',
    !expectedEmail && 'SCHEDULER_SA_EMAIL',
  ].filter(Boolean);
  if (missing.length) {
    console.log(JSON.stringify({
      severity: 'ERROR',
      message: 'batch auth not configured — refusing request (fail-closed)',
      missing,
    }));
    return c.json({ error: 'Batch endpoint is not configured' }, 503);
  }

  const header = c.req.header('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(header);
  if (!m) return c.json({ error: 'Missing token' }, 401);
  try {
    // Verify the token was issued by Google and signed for our service URL
    const ticket = await oidcVerifier.verifyIdToken({ idToken: m[1], audience });
    const payload = ticket.getPayload();
    // Extra check: must be the scheduler service account
    if (payload.email !== expectedEmail) {
      return c.json({ error: 'Unauthorized principal' }, 403);
    }
  } catch (e) {
    return c.json({ error: 'Invalid token: ' + e.message }, 401);
  }
  await next();
});

// POST /api/batch/refresh-all
app.post('/refresh-all', async c => {
  const results = await refreshAll();
  return c.json({ results });
});

export default app;
