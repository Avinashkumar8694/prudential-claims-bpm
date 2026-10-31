// Express app assembly: shared store, per-request context, routes, error handler.
import express from 'express';
import type { Store } from './store/repository.ts';
import { FileStore } from './store/file-store.ts';
import { PgStore } from './store/pg-store.ts';
import { config } from './infra/config.ts';
import { makeContext } from './context.ts';
import { buildRoutes } from './http/routes.ts';
import { buildAuthRoutes } from './http/auth-routes.ts';
import { buildPlatformRoutes, requirePlatformAdmin } from './http/platform-routes.ts';
import { buildPublicTenantRoutes, buildTenantRoutes } from './http/tenant-routes.ts';
import { TenantService } from './modules/tenants/service.ts';
import { requireAuth, requireWorkspaceAccess } from './http/auth-middleware.ts';
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

  // CORS for the Angular dev origin, including x-tenant-id
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-tenant-id');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // minimal security headers (docs/07-security.md §8)
  app.use((req, res, next) => {
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('Referrer-Policy', 'no-referrer');
    if (req.path !== '/api/docs') res.header('Content-Security-Policy', "default-src 'none'");
    next();
  });

  // per-request AppContext: resolves tenant from x-tenant-id header, falling back to config.defaultTenant
  app.use((req, _res, next) => {
    const tenantHeader = (req.headers['x-tenant-id'] as string | undefined)?.trim();
    const tenantId = tenantHeader || config.defaultTenant;
    (req as any).ctx = makeContext({ store: theStore, tenantId });
    next();
  });

  // Seed default workspace and public plans asynchronously at boot
  const seedCtx = makeContext({ store: theStore, tenantId: config.defaultTenant });
  new TenantService(seedCtx).seedDefaultsIfEmpty().catch(() => {});

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'jbpm-engine-server', version: '0.1.0' }));
  app.use('/api', buildPublicTenantRoutes()); // public: /api/public/plans, /api/tenants/check/:slug, /api/tenants/signup
  app.use('/api/auth', buildAuthRoutes());   // login only — must stay reachable without a token
  app.use('/api', buildTenantRoutes());       // authenticated tenant endpoints: /api/me/tenants, /api/me/profile, etc.
  app.use('/api/platform', requireAuth, requirePlatformAdmin, buildPlatformRoutes()); // platform admin only, no workspace scope
  app.use('/api', requireAuth, requireWorkspaceAccess, buildRoutes());
  app.use(errorMiddleware);
  return { app, store: theStore };
}
