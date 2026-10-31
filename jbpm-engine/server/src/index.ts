// Boot: HTTP server + WebSocket hub.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createApp } from './app.ts';
import { config } from './infra/config.ts';
import { hub } from './infra/ws-hub.ts';
import { logger } from './infra/logger.ts';
import { makeContext } from './context.ts';
import { TimerService } from './modules/timers/service.ts';
import { TaskService } from './modules/tasks/service.ts';
import { IamService } from './modules/iam/service.ts';
import { SettingsService } from './modules/settings/service.ts';
import { authenticateWsUpgrade } from './infra/ws-auth.ts';

const { app, store } = createApp();
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: config.wsPath });
wss.on('connection', (ws, req) => {
  if (!authenticateWsUpgrade(req)) { ws.close(4001, 'unauthorized'); return; }
  hub.add(ws);
});

// durable timer scheduler — fires due catch/boundary timers (default tenant)
// Enabled in 'all' or 'worker' roles; disabled in 'api' role (Option A: dedicated worker replica).
// Uses non-overlapping chained setTimeout (Option B: self-throttling + advisory lock across replicas).
const isWorkerEnabled = config.role === 'all' || config.role === 'worker';
if (isWorkerEnabled) {
  const timerCtx = makeContext({ store, tenantId: config.defaultTenant });
  const timers = new TimerService(timerCtx, hub.engineEmit);
  const tasks = new TaskService(timerCtx, hub.engineEmit);
  let stopped = false;
  const runTick = async () => {
    if (stopped) return;
    let nextIntervalMs = config.timerTickIntervalMs;
    try {
      const settings = await new SettingsService(timerCtx).get().catch(() => null);
      if (settings?.executorIntervalSeconds && settings.executorIntervalSeconds > 0) {
        nextIntervalMs = settings.executorIntervalSeconds * 1000;
      }
      const batchSize = settings?.timerBatchSize || config.timerBatchSize;
      await timers.tick(new Date().toISOString(), batchSize);
      if (settings?.autoReleaseClaimedTaskHours && settings.autoReleaseClaimedTaskHours > 0) {
        await tasks.autoReleaseIdle(settings.autoReleaseClaimedTaskHours);
      }
    } catch (e) {
      logger.error('timer tick failed', { err: (e as Error).message });
    } finally {
      if (!stopped) setTimeout(runTick, nextIntervalMs);
    }
  };
  setTimeout(runTick, config.timerTickIntervalMs);
  logger.info('timer worker scheduler enabled', { role: config.role, intervalMs: config.timerTickIntervalMs, batchSize: config.timerBatchSize });
} else {
  logger.info('timer worker scheduler disabled (stateless API role)', { role: config.role });
}

const iamCtx = makeContext({ store, tenantId: config.defaultTenant });
new IamService(iamCtx).ensureSeeded(config.adminInitialPassword).then(({ seededAdmin }) => {
  if (seededAdmin) logger.info('seeded initial admin user', { username: 'admin', note: 'set ADMIN_INITIAL_PASSWORD before first boot in anything but local dev' });
  server.listen(config.port, () => {
    logger.info('jbpm-engine server up', { port: config.port, ws: config.wsPath, store: config.store, role: config.role, dataDir: config.dataDir });
  });
}).catch((e) => { logger.error('IAM seeding failed — refusing to start', { err: (e as Error).message }); process.exit(1); });
