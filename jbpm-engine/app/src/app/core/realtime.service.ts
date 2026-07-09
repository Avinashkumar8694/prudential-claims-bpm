// WebSocket client for live engine events (node.entered/exited, instance.updated, task.created, …).
// Subscribe to a topic (e.g. `instance:<id>`); the callback fires on every matching event so views can
// refresh in real time. Auto-reconnects; re-subscribes open topics on reconnect.
import { Injectable, NgZone, inject } from '@angular/core';

type Listener = (e: { topic: string; kind: string; data: any }) => void;

@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private zone = inject(NgZone);
  private ws?: WebSocket;
  private listeners = new Map<string, Set<Listener>>();

  private connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => { for (const t of this.listeners.keys()) this.send({ op: 'sub', topics: [t] }); };
    this.ws.onmessage = (m) => {
      let e: any; try { e = JSON.parse(String(m.data)); } catch { return; }
      const ls = this.listeners.get(e.topic); if (!ls) return;
      this.zone.run(() => ls.forEach((fn) => fn(e)));   // re-enter Angular so signals/CD update
    };
    this.ws.onclose = () => { this.ws = undefined; setTimeout(() => { if (this.listeners.size) this.connect(); }, 2000); };
  }
  private send(msg: unknown) { try { this.ws?.send(JSON.stringify(msg)); } catch { /* not open yet — flushed on open */ } }

  subscribe(topic: string, fn: Listener): () => void {
    this.connect();
    let set = this.listeners.get(topic);
    if (!set) { set = new Set(); this.listeners.set(topic, set); if (this.ws?.readyState === WebSocket.OPEN) this.send({ op: 'sub', topics: [topic] }); }
    set.add(fn);
    return () => { set!.delete(fn); if (!set!.size) { this.listeners.delete(topic); this.send({ op: 'unsub', topics: [topic] }); } };
  }
}
