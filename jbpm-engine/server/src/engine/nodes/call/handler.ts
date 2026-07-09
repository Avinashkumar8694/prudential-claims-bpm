// Call activity — starts a child instance of the called process, maps inputs in; on completion maps
// outputs back; if the child waits, the parent token waits for it (resumed on child completion).
import type { NodeHandler } from '../types.ts';

export const handler: NodeHandler = async (c) => {
  const n = c.node;
  if (!c.resolveCalled || !n.process) return {};
  const resolved = await c.resolveCalled(n.process);
  if (!resolved) return { outcome: 'called-process-not-deployed' };
  const token = c.inst.tokens.find((t) => t.nodeId === n.id)!;
  const childVars: Record<string, unknown> = {};
  for (const [cv, spec] of Object.entries(n.inputs || {})) {
    childVars[cv] = typeof spec === 'string' && spec.startsWith('$') ? c.inst.variables[spec.slice(1)] : spec;
  }
  const child = await c.startChild(resolved.dep, resolved.processId, childVars, token.id);
  if (child.status === 'completed') {
    const vars: Record<string, unknown> = {};
    for (const [pv, cv] of Object.entries(n.outputs || {})) vars[pv] = child.variables[cv as string];
    return { vars, outcome: `called:${child.id}` };
  }
  return { wait: { kind: 'child', ref: child.id }, outcome: `called:${child.id}` };
};
