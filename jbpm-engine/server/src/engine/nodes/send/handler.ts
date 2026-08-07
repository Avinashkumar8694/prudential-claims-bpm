// Send task — sends a message (broadcast to waiting instances in the tenant), then continues.
import type { NodeHandler } from '../types.ts';
export const handler: NodeHandler = async (c) => {
  const n = c.node;
  const correlationValue = typeof n.correlationKey === 'string' && n.correlationKey.startsWith('$')
    ? (c.inst.variables[n.correlationKey.slice(1)] as string | undefined) : undefined;
  if (n.message) await c.broadcast(n.message, correlationValue);
  return { outcome: n.message ? `sent:${n.message}` : 'send' };
};
