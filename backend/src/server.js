import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';

import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/error.js';
import { appCheck } from './firebase.js';

import meRoutes from './routes/me.js';
import usersRoutes from './routes/users.js';
import sourcesRoutes from './routes/sources.js';
import configRoutes from './routes/config.js';
import presetsRoutes from './routes/presets.js';
import googleRoutes, { oauthCallback } from './routes/google.js';
import snapshotsRoutes from './routes/snapshots.js';
import batchRoutes from './routes/batch.js';
import groupsRoutes from './routes/groups.js';

const app = new Hono();

// Middleware
// 構造化ログ: Cloud Logging が JSON stdout を自動パースする
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const latencyMs = Date.now() - start;
  const status = c.res.status;
  const severity = status >= 500 ? 'ERROR' : status >= 400 ? 'WARNING' : 'INFO';
  const uid = c.get('uid') || null;
  // Cloud Logging の httpRequest / severity フィールドで構造化
  const entry = {
    severity,
    message: `${c.req.method} ${c.req.path} ${status} ${latencyMs}ms`,
    httpRequest: {
      requestMethod: c.req.method,
      requestUrl: c.req.path,
      status,
      latency: `${(latencyMs / 1000).toFixed(3)}s`,
      userAgent: c.req.header('user-agent') || '',
    },
    labels: { uid: uid || 'anonymous' },
  };
  console.log(JSON.stringify(entry));
});
app.use('*', secureHeaders());
app.use('*', compress());

// Request body size limit: 10MB (content-length ヘッダと実体の両方を検証)
app.use('*', bodyLimit({
  maxSize: 10 * 1024 * 1024,
  onError: (c) => c.json({ error: 'Request body too large (max 10MB)' }, 413),
}));

// CORS: only needed if frontend is served from a different origin.
// When using Firebase Hosting rewrites to Cloud Run, same-origin, so CORS is a no-op.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
if (allowedOrigins.length) {
  app.use('*', cors({
    origin: allowedOrigins,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['Authorization', 'Content-Type'],
  }));
}

// Public
app.get('/api/health', c => c.json({ ok: true, service: 'dashboard-backend' }));

// OAuth callback must be public (Google redirects the browser here without
// our auth header). The callback route itself verifies a signed `state`.
app.get('/api/google/auth/callback', oauthCallback);

// Batch endpoints: OIDC-authenticated (Cloud Scheduler), not Firebase ID token.
app.route('/api/batch', batchRoutes);

// App Check: 段階ロールアウト用
// APP_CHECK_ENFORCE=true で強制(トークン無し/無効なら 401)。
// それ以外はログのみ(Enforce モードに切替前の様子見期間用)。
const APP_CHECK_ENFORCE = process.env.APP_CHECK_ENFORCE === 'true';
app.use('/api/*', async (c, next) => {
  // OAuth callback / batch は authMiddleware より前にマウント済みなので対象外
  const token = c.req.header('X-Firebase-AppCheck');
  if (!token) {
    if (APP_CHECK_ENFORCE) return c.json({ error: 'App Check token missing' }, 401);
    console.log(JSON.stringify({ severity: 'WARNING', message: 'AppCheck token missing', path: c.req.path }));
    await next();
    return;
  }
  try {
    await appCheck.verifyToken(token);
  } catch (e) {
    if (APP_CHECK_ENFORCE) return c.json({ error: 'App Check token invalid' }, 401);
    console.log(JSON.stringify({ severity: 'WARNING', message: 'AppCheck token invalid', path: c.req.path, error: e.message }));
  }
  await next();
});

// Auth required below
app.use('/api/*', authMiddleware);

// Routes
app.route('/api/me', meRoutes);
app.route('/api/users', usersRoutes);
app.route('/api/sources', sourcesRoutes);
app.route('/api/config', configRoutes);
app.route('/api/presets', presetsRoutes);
app.route('/api/google', googleRoutes);
app.route('/api/snapshots', snapshotsRoutes);
app.route('/api/groups', groupsRoutes);

// Error handler
app.onError(errorHandler);

const port = Number(process.env.PORT) || 8080;
serve({ fetch: app.fetch, port }, info => {
  console.log(`dashboard-backend listening on :${info.port}`);
});
