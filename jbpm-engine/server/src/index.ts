// Boot: HTTP server + WebSocket hub.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createApp } from './app.ts';
import { config } from './infra/config.ts';
import { hub } from './infra/ws-hub.ts';
import { logger } from './infra/logger.ts';
import { makeContext } from './context.ts';
import { TimerService } from './modules/timers/service.ts';
import { IamService } from './modules/iam/service.ts';
import { authenticateWsUpgrade } from './infra/ws-auth.ts';

const { app, store } = createApp();
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: config.wsPath });
wss.on('connection', (ws, req) => {
  if (!authenticateWsUpgrade(req)) { ws.close(4001, 'unauthorized'); return; }
  hub.add(ws);
});

// durable timer scheduler — fires due catch/boundary timers (default tenant)
const timerCtx = makeContext({ store, tenantId: config.defaultTenant });
const timers = new TimerService(timerCtx, hub.engineEmit);
setInterval(() => { timers.tick(new Date().toISOString()).catch((e) => logger.error('timer tick failed', { err: (e as Error).message })); }, 5000);

const iamCtx = makeContext({ store, tenantId: config.defaultTenant });
new IamService(iamCtx).ensureSeeded(config.adminInitialPassword).then(({ seededAdmin }) => {
  if (seededAdmin) logger.info('seeded initial admin user', { username: 'admin', note: 'set ADMIN_INITIAL_PASSWORD before first boot in anything but local dev' });
  server.listen(config.port, () => {
    logger.info('jbpm-engine server up', { port: config.port, ws: config.wsPath, store: config.store, dataDir: config.dataDir });
  });
}).catch((e) => { logger.error('IAM seeding failed — refusing to start', { err: (e as Error).message }); process.exit(1); });
