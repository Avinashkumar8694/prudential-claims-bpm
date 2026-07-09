// Express app assembly: shared store, per-request context, routes, error handler.
import express from 'express';
import type { Store } from './store/repository.js';
import { FileStore } from './store/file-store.js';
import { config } from './infra/config.js';
import { makeContext } from './context.js';
import { buildRoutes } from './http/routes.js';
import { errorMiddleware } from './infra/errors.js';

export function createApp(store?: Store) {
  const app = express();
  const theStore: Store = store || new FileStore(config.dataDir);
  app.use(express.json({ limit: '4mb' }));

  // simple CORS for the Angular dev origin
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // per-request AppContext (v1: single default tenant; actor from X-User header). AuthZ lands in Phase 6.
  app.use((req, _res, next) => {
    (req as any).ctx = makeContext({ store: theStore, tenantId: config.defaultTenant });
    (req as any).actor = (req.header('x-user') || 'system').toString();
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'jbpm-engine-server', version: '0.1.0' }));
  app.use('/api', buildRoutes());
  app.use(errorMiddleware);
  return { app, store: theStore };
}
