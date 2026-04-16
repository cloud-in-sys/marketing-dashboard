// Batch endpoints - invoked by Cloud Scheduler. Protected via OIDC header from GCP.
import { Hono } from 'hono';
import { OAuth2Client } from 'google-auth-library';
import { refreshAll } from './snapshots.js';

const app = new Hono();
const oidcVerifier = new OAuth2Client();

// Scheduler calls this with an OIDC token; we verify the JWT came from GCP.
app.use('*', async (c, next) => {
  const header = c.req.header('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(header);
  if (!m) return c.json({ error: 'Missing token' }, 401);
  try {
    // Verify the token was issued by Google and signed for our service URL
    const audience = process.env.CLOUD_RUN_URL; // set via env var
    const ticket = await oidcVerifier.verifyIdToken({ idToken: m[1], audience });
    const payload = ticket.getPayload();
    // Extra check: must be the scheduler service account
    const expectedEmail = process.env.SCHEDULER_SA_EMAIL;
    if (expectedEmail && payload.email !== expectedEmail) {
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
