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

  // simple CORS for the Angular dev origin
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
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
  app.use('/api/auth', buildAuthRoutes());   // login only — must stay reachable without a token
  app.use('/api', requireAuth, buildRoutes());
  app.use(errorMiddleware);
  return { app, store: theStore };
}
