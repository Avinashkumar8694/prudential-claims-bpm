// Send task — always point-to-point (resolves the single oldest waiter), never broadcast to every
// listener; optionally narrowed to instances whose own correlationKey matches.
import type { NodeHandler } from '../types.ts';

function resolveRef(spec: unknown, vars: Record<string, unknown>): string | undefined {
  if (typeof spec !== 'string' || !spec) return undefined;
  const v = spec.startsWith('$') ? vars[spec.slice(1)] : spec;
  return v == null ? undefined : String(v);
}

export const handler: NodeHandler = async (c) => {
  const n = c.node as any;
  if (n.message) await c.broadcast(n.message, 'message', resolveRef(n.correlationKey, c.inst.variables));
  return { outcome: n.message ? `sent:${n.message}` : 'send' };
};
