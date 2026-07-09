// Intermediate throw — a compensation throw runs the recorded compensation handlers (optionally for a
// single activity via event.ref); otherwise broadcasts a signal/message/escalation, then continues.
import type { NodeHandler } from '../types.ts';
export const handler: NodeHandler = async (c) => {
  const ev = c.node.event || {};
  if (ev.compensation || ev.compensate) return { vars: await c.compensate(ev.ref), outcome: 'compensated' };
  const name = ev.signal || ev.message || ev.escalation;
  if (name) await c.broadcast(name);
  return { outcome: name ? `threw:${name}` : 'throw' };
};
