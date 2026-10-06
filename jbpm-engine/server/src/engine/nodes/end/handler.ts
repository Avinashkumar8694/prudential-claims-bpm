// End event — completes the path; terminate ends the current (sub)process scope (`terminateAll`
// escalates that all the way to the root); error-throw raises an error; a signal throw broadcasts to
// every waiting listener process-wide, a message throw delivers to exactly one (point-to-point); an
// escalation throw propagates through this SAME instance's own boundary/event-sub-process scope chain
// (see execution-engine.ts's raiseEscalation — NOT a cross-instance broadcast); a compensation end
// event runs the recorded compensation handlers before completing.
import type { NodeHandler } from '../types.ts';
export const handler: NodeHandler = async (c) => {
  const n = c.node as any;
  if (n.result === 'terminate') return { end: 'terminate', terminateAll: n.terminateAll === true };
  // Presence check, not truthiness: the properties panel writes `throw: { error: '' }` the instant
  // "error" is picked from the dropdown, before a code is typed in.
  if (n.throw && 'error' in n.throw) return { end: 'error', outcome: 'error-throw' };
  if (n.throw?.compensation) return { vars: await c.compensate(n.throw?.ref), end: 'complete', outcome: 'compensated' };
  if (n.throw?.escalation) {
    await c.escalate(n.throw.escalation);
    return { end: 'complete', outcome: `escalated:${n.throw.escalation}` };
  }
  const kind: 'signal' | 'message' | undefined = n.throw?.signal ? 'signal' : n.throw?.message ? 'message' : undefined;
  const name = n.throw?.signal || n.throw?.message;
  if (kind && name) {
    await c.broadcast(name, kind, n.throw?.correlationKey);
    return { end: 'complete', outcome: `threw:${name}` };
  }
  return { end: 'complete' };
};
