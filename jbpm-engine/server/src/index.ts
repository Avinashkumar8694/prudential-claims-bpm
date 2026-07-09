// Boot: HTTP server + WebSocket hub.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { config } from './infra/config.js';
import { hub } from './infra/ws-hub.js';
import { logger } from './infra/logger.js';

const { app } = createApp();
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: config.wsPath });
wss.on('connection', (ws) => hub.add(ws));

server.listen(config.port, () => {
  logger.info('jbpm-engine server up', { port: config.port, ws: config.wsPath, store: config.store, dataDir: config.dataDir });
});
