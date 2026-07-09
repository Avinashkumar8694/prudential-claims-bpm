// Embedded / transaction sub-process — runs the node's own nodes/flows as a nested instance that
// SHARES the parent's variable scope. The composite process id "<parentProcess>::<nodeId>" is resolved
// by the engine's pick() into a synthetic process. If the nested graph waits (user task/timer), the
// parent token waits for the child and resumes (merging all child vars back) on completion.
import type { NodeHandler } from '../types.ts';

export const handler: NodeHandler = async (c) => {
  const n = c.node;
  if (!Array.isArray(n.nodes) || n.nodes.length === 0) return {};   // empty sub-process → pass through
  const token = c.inst.tokens.find((t) => t.nodeId === n.id)!;
  const composite = `${c.proc.id}::${n.id}`;
  const child = await c.startChild(c.dep, composite, { ...c.inst.variables }, token.id);
  if (child.status === 'completed') return { vars: { ...child.variables }, outcome: `sub:${child.id}` };
  if (child.status === 'aborted' || child.status === 'failed') return { error: 'sub-process failed', errorCode: 'SUBPROCESS_ERROR', outcome: `sub:${child.id}` };
  return { wait: { kind: 'child', ref: child.id }, outcome: `sub:${child.id}` };
};
