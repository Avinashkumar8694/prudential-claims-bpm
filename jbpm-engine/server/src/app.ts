// Express app assembly: shared store, per-request context, routes, error handler.
import express from 'express';
import type { Store } from './store/repository.ts';
import { FileStore } from './store/file-store.ts';
import { PgStore } from './store/pg-store.ts';
import { config } from './infra/config.ts';
import { makeContext } from './context.ts';
import { buildRoutes } from './http/routes.ts';
import { buildAuthRoutes } from './http/auth-routes.ts';
import { requireAuth } from './http/auth-middleware.ts';
import { getEphemeralPublicKey } from './infra/crypto.ts';
import { errorMiddleware } from './infra/errors.ts';

/** STORE=pg switches from the file-per-entity dev store to a real Postgres-backed one (see
 *  store/pg-store.ts) — same Repository<T> contract either way, no call-site changes needed. */
function resolveStore(): Store {
  if (config.store === 'pg') {
    if (!config.pgUrl) throw new Error('STORE=pg requires PG_URL to be set');
    return new PgStore(config.pgUrl);
  }
  return new FileStore(config.dataDir);
}

export function createApp(store?: Store) {
  const app = express();
  const theStore: Store = store || resolveStore();
  app.use(express.json({ limit: '4mb' }));

  // CORS configuration (docs/07-security.md, SEC-06)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const isProd = process.env.NODE_ENV === 'production';
    const appOrigin = process.env.APP_ORIGIN;

    if (appOrigin) {
      const allowedOrigins = appOrigin.split(',').map((o) => o.trim());
      if (origin && allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Vary', 'Origin');
      } else if (!origin && allowedOrigins.length === 1) {
        res.header('Access-Control-Allow-Origin', allowedOrigins[0]);
      } else if (allowedOrigins.includes('*')) {
        res.header('Access-Control-Allow-Origin', '*');
      }
    } else if (!isProd) {
      // In development mode, reflect request origin or allow wildcard
      res.header('Access-Control-Allow-Origin', origin || '*');
      if (origin) res.header('Vary', 'Origin');
    } else if (origin) {
      // In production mode without explicit APP_ORIGIN, restrict wildcard and only allow same-host / local calls
      const host = req.headers.host;
      try {
        const originUrl = new URL(origin);
        if (host && (originUrl.host === host || originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1')) {
          res.header('Access-Control-Allow-Origin', origin);
          res.header('Vary', 'Origin');
        }
      } catch {
        // invalid URL origin, do not set Access-Control-Allow-Origin
      }
    }

    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // minimal security headers (docs/07-security.md §8) — this API returns JSON only, never HTML
  // (aside from /api/docs' own Swagger UI page, which needs its CDN scripts/styles left alone), so
  // there's no templating/XSS surface a real CSP is protecting beyond stopping a browser from ever
  // being tricked into rendering a JSON response as something else.
  app.use((req, res, next) => {
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('Referrer-Policy', 'no-referrer');
    if (req.path !== '/api/docs') res.header('Content-Security-Policy', "default-src 'none'");
    next();
  });

  // per-request AppContext (single default tenant — see the "skip multi-tenancy" note in
  // docs/07-security.md). The actor identity itself now comes from a verified JWT (requireAuth,
  // mounted below), not a trust-any X-User header.
  app.use((req, _res, next) => {
    (req as any).ctx = makeContext({ store: theStore, tenantId: config.defaultTenant });
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'jbpm-engine-server', version: '0.1.0' }));
  app.get('/api/crypto/public-key', (_req, res) => res.json({
    publicKey: getEphemeralPublicKey(),
    algorithm: 'RSA-OAEP',
    hash: 'SHA-256'
  }));
  app.use('/api/auth', buildAuthRoutes());   // login only — must stay reachable without a token
  app.use('/api', requireAuth, buildRoutes());
  app.use(errorMiddleware);
  return { app, store: theStore };
}
