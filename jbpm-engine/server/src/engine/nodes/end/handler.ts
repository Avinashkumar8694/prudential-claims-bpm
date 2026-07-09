// End event — completes the path; terminate ends the whole instance; error-throw raises an error;
// a compensation end event runs the recorded compensation handlers before completing the path.
import type { NodeHandler } from '../types.ts';
export const handler: NodeHandler = async (c) => {
  if (c.node.result === 'terminate') return { end: 'terminate' };
  if (c.node.throw?.error) return { end: 'error', outcome: 'error-throw' };
  if (c.node.event?.compensation || c.node.result === 'compensate') {
    return { vars: await c.compensate(c.node.event?.ref), end: 'complete', outcome: 'compensated' };
  }
  return { end: 'complete' };
};
