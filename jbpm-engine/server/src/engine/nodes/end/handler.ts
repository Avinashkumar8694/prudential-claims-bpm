// End event — completes the path; terminate ends the whole instance; error-throw raises an error.
import type { NodeHandler } from '../types.ts';
export const handler: NodeHandler = (c) => {
  if (c.node.result === 'terminate') return { end: 'terminate' };
  if (c.node.throw?.error) return { end: 'error', outcome: 'error-throw' };
  return { end: 'complete' };
};
