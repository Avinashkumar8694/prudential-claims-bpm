// Intermediate throw — a compensation throw runs the recorded compensation handlers (optionally for a
// single activity via event.ref); a signal broadcasts to every waiting listener process-wide
// (optionally narrowed by correlationKey); a message delivers to exactly one (point-to-point); an
// escalation propagates through THIS SAME instance's own boundary/event-sub-process scope chain.
// Either way this node then continues (unlike an End's throw, which ends the path).
import type { NodeHandler } from '../types.ts';
export const handler: NodeHandler = async (c) => {
  const ev = (c.node as any).event || {};
  if (ev.compensation) return { vars: await c.compensate(ev.ref), outcome: 'compensated' };
  if (ev.escalation) {
    await c.escalate(ev.escalation);
    return { outcome: `escalated:${ev.escalation}` };
  }
  const kind: 'signal' | 'message' | undefined = ev.signal ? 'signal' : ev.message ? 'message' : undefined;
  const name = ev.signal || ev.message;
  if (kind && name) await c.broadcast(name, kind, ev.correlationKey);
  return { outcome: name ? `threw:${name}` : 'throw' };
};
