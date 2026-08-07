// End event — completes the path; terminate ends the whole instance; error-throw raises an error; a
// signal/message/escalation throw broadcasts to any waiting listener before completing (same delivery
// as an intermediate throw — see throw/handler.ts — but the path ends here instead of continuing); a
// compensation end event runs the recorded compensation handlers before completing the path.
import type { NodeHandler } from '../types.ts';
export const handler: NodeHandler = async (c) => {
  if (c.node.result === 'terminate') return { end: 'terminate' };
  if (c.node.throw?.error) return { end: 'error', outcome: 'error-throw' };
  if (c.node.event?.compensation || c.node.result === 'compensate') {
    return { vars: await c.compensate(c.node.event?.ref), end: 'complete', outcome: 'compensated' };
  }
  const name = c.node.throw?.signal || c.node.throw?.message || c.node.throw?.escalation;
  if (name) {
    const ck = c.node.throw?.correlationKey;
    const correlationValue = typeof ck === 'string' && ck.startsWith('$') ? (c.inst.variables[ck.slice(1)] as string | undefined) : undefined;
    await c.broadcast(name, correlationValue);
    return { end: 'complete', outcome: `threw:${name}` };
  }
  return { end: 'complete' };
};
