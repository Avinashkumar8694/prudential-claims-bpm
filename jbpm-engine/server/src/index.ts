// Boot: HTTP server + WebSocket hub.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { config } from './infra/config.js';
import { hub } from './infra/ws-hub.js';
import { logger } from './infra/logger.js';
import { makeContext } from './context.js';
import { TimerService } from './modules/timers/service.js';

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
