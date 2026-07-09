// Intermediate throw — broadcasts a signal/message/escalation to waiting instances, then continues.
import type { NodeHandler } from '../types.ts';
export const handler: NodeHandler = async (c) => {
  const ev = c.node.event || {};
  const name = ev.signal || ev.message || ev.escalation;
  if (name) await c.broadcast(name);
  return { outcome: name ? `threw:${name}` : 'throw' };
};
