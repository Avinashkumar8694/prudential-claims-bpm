// Send task — sends a message (broadcast to waiting instances in the tenant), then continues.
import type { NodeHandler } from '../types.ts';
export const handler: NodeHandler = async (c) => {
  if (c.node.message) await c.broadcast(c.node.message);
  return { outcome: c.node.message ? `sent:${c.node.message}` : 'send' };
};
