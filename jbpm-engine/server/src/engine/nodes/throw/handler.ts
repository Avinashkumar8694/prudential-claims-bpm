// Intermediate throw — a compensation throw runs the recorded compensation handlers (optionally for a
// single activity via event.ref); otherwise broadcasts a signal/message/escalation, then continues.
import type { NodeHandler } from '../types.ts';
export const handler: NodeHandler = async (c) => {
  const ev = c.node.event || {};
  if (ev.compensation || ev.compensate) return { vars: await c.compensate(ev.ref), outcome: 'compensated' };
  const name = ev.signal || ev.message || ev.escalation;
  // event.correlationKey: a $var reference — narrows delivery to only the instance(s) whose OWN
  // correlationKey matches, instead of every instance waiting on this name (see broadcast()'s doc).
  const correlationValue = typeof ev.correlationKey === 'string' && ev.correlationKey.startsWith('$')
    ? (c.inst.variables[ev.correlationKey.slice(1)] as string | undefined) : undefined;
  if (name) await c.broadcast(name, correlationValue);
  return { outcome: name ? `threw:${name}` : 'throw' };
};
