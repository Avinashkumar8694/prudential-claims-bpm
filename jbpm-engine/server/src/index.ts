// Boot: HTTP server + WebSocket hub.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createApp } from './app.ts';
import { config, assertProductionConfig } from './infra/config.ts';
import { hub } from './infra/ws-hub.ts';
import { logger } from './infra/logger.ts';
import { makeContext } from './context.ts';
import { TimerService } from './modules/timers/service.ts';
import { IamService } from './modules/iam/service.ts';
import { TenantService } from './modules/tenants/service.ts';
import { authenticateWsUpgrade, authorizeWsTenant, canSubscribe } from './infra/ws-auth.ts';
import { Collections, type Tenant } from './domain.ts';
import { ensurePlatformAdmin } from './modules/tenants/identity.ts';

assertProductionConfig();   // refuse to boot in production on insecure defaults

const { app, store } = createApp();
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: config.wsPath });
wss.on('connection', async (ws, req) => {
  // Messages may arrive while the (async) token/tenant checks are still running — buffer them so none is lost.
  const queued: any[][] = [];
  const early = (...args: any[]) => { queued.push(args); };
  ws.on('message', early);
  try {
    const claims = await authenticateWsUpgrade(req);
    if (!claims) { ws.close(4001, 'unauthorized'); return; }
    const session = await authorizeWsTenant(store, claims, req);
    if (!session) { ws.close(4003, 'forbidden'); return; }
    ws.off('message', early);
    hub.add(ws, (topic) => canSubscribe(store, session, topic));
    for (const args of queued) ws.emit('message', ...args);
  } catch { ws.close(1011, 'error'); }
});

// durable timer scheduler — fires due catch/boundary timers for EVERY active workspace (each tick runs
// under that workspace's own context, so a timer never resumes a token under the wrong tenant)
let ticking = false;
setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    const now = new Date().toISOString();
    const tenants = await store.repo<Tenant>(Collections.tenants).query((t) => t.status === 'active');
    const ids = new Set([config.defaultTenant, ...tenants.map((t) => t.id)]);
    for (const tenantId of ids) {
      await new TimerService(makeContext({ store, tenantId }), hub.engineEmit).tick(now)
        .catch((e) => logger.error('timer tick failed', { tenantId, err: (e as Error).message }));
    }
  } finally { ticking = false; }
}, 5000);

const iamCtx = makeContext({ store, tenantId: config.defaultTenant });
new IamService(iamCtx).ensureSeeded(config.adminInitialPassword).then(async ({ seededAdmin }) => {
  await new TenantService(iamCtx).seedDefaultsIfEmpty();   // default workspace first, so the platform-admin bootstrap has somewhere to land
  await ensurePlatformAdmin(store, new Date().toISOString(), () => iamCtx.newId());
  if (seededAdmin) logger.info('seeded initial admin user', { username: 'admin', note: 'set ADMIN_INITIAL_PASSWORD before first boot in anything but local dev' });
  server.listen(config.port, () => {
    logger.info('jbpm-engine server up', { port: config.port, ws: config.wsPath, store: config.store, dataDir: config.dataDir, sso: !!config.oidc.issuer, localLogin: config.localLogin });
  });
}).catch((e) => { logger.error('IAM seeding failed — refusing to start', { err: (e as Error).message }); process.exit(1); });
