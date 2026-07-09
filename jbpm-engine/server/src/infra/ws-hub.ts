// Realtime hub: clients subscribe to topics; engine/domain events are broadcast to matching sockets.
import type { WebSocket } from 'ws';
import type { EngineEvent } from '../engine/execution-engine.js';

interface Sub { ws: WebSocket; topics: Set<string>; }

export class WsHub {
  private subs = new Set<Sub>();

  add(ws: WebSocket): Sub {
    const sub: Sub = { ws, topics: new Set() };
    this.subs.add(sub);
    ws.on('close', () => this.subs.delete(sub));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.op === 'sub' && Array.isArray(msg.topics)) for (const t of msg.topics) sub.topics.add(t);
        if (msg.op === 'unsub' && Array.isArray(msg.topics)) for (const t of msg.topics) sub.topics.delete(t);
      } catch { /* ignore malformed */ }
    });
    return sub;
  }

  publish(topic: string, kind: string, data: Record<string, unknown>) {
    const payload = JSON.stringify({ topic, kind, at: new Date().toISOString(), data });
    for (const s of this.subs) if (s.topics.has(topic)) { try { s.ws.send(payload); } catch { /* dropped */ } }
  }

  /** Forward an engine event onto instance/workflow topics for the live UI. */
  engineEmit = (e: EngineEvent) => {
    const iid = (e as any).instanceId as string | undefined;
    if (iid) this.publish(`instance:${iid}`, e.kind, { ...e });
  };
}

export const hub = new WsHub();
