import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/error.js';

import meRoutes from './routes/me.js';
import usersRoutes from './routes/users.js';
import sourcesRoutes from './routes/sources.js';
import configRoutes from './routes/config.js';
import presetsRoutes from './routes/presets.js';
import googleRoutes, { oauthCallback } from './routes/google.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', secureHeaders());

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

// Auth required below
app.use('/api/*', authMiddleware);

// Routes
app.route('/api/me', meRoutes);
app.route('/api/users', usersRoutes);
app.route('/api/sources', sourcesRoutes);
app.route('/api/config', configRoutes);
app.route('/api/presets', presetsRoutes);
app.route('/api/google', googleRoutes);

// Error handler
app.onError(errorHandler);

const port = Number(process.env.PORT) || 8080;
serve({ fetch: app.fetch, port }, info => {
  console.log(`dashboard-backend listening on :${info.port}`);
});
