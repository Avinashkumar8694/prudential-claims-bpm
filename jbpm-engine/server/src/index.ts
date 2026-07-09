// Boot: HTTP server + WebSocket hub.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createApp } from './app.ts';
import { config } from './infra/config.ts';
import { hub } from './infra/ws-hub.ts';
import { logger } from './infra/logger.ts';
import { makeContext } from './context.ts';
import { TimerService } from './modules/timers/service.ts';

const { app, store } = createApp();
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: config.wsPath });
wss.on('connection', (ws) => hub.add(ws));

// durable timer scheduler — fires due catch/boundary timers (default tenant)
const timerCtx = makeContext({ store, tenantId: config.defaultTenant });
const timers = new TimerService(timerCtx, hub.engineEmit);
setInterval(() => { timers.tick(new Date().toISOString()).catch((e) => logger.error('timer tick failed', { err: (e as Error).message })); }, 5000);

server.listen(config.port, () => {
  logger.info('jbpm-engine server up', { port: config.port, ws: config.wsPath, store: config.store, dataDir: config.dataDir });
});
