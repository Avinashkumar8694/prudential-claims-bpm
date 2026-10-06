// Call activity — starts a child instance of the called process, maps inputs in; on completion maps
// outputs back; if the child waits, the parent token waits for it — unless `independent: true`, in
// which case the parent never waits.
import type { NodeHandler } from '../types.ts';
import type { Instance } from '../../../domain.ts';

/** Isolated-scope output mapping: only the DECLARED `outputs` cross back into the parent, unlike a
 *  subprocess's full shared-scope merge. Exported so BOTH completion paths (this handler's own sync
 *  branch, and execution-engine.ts's tryResumeParent for the async/already-parked path) use the
 *  identical logic. */
export function mapChildOutputs(n: any, child: Instance): Record<string, unknown> {
  const vars: Record<string, unknown> = {};
  for (const [pv, cv] of Object.entries(n.outputs || {})) vars[pv] = child.variables[cv as string];
  return vars;
}

export const handler: NodeHandler = async (c) => {
  const n = c.node as any;
  if (!c.resolveCalled || !n.process) return {};
  const resolved = await c.resolveCalled(n.process, n.workflowId);
  if (!resolved) return { outcome: 'called-process-not-deployed' };
  const token = c.inst.tokens.find((t) => t.nodeId === n.id)!;
  const childVars: Record<string, unknown> = {};
  for (const [cv, spec] of Object.entries(n.inputs || {})) {
    childVars[cv] = typeof spec === 'string' && spec.startsWith('$') ? c.inst.variables[spec.slice(1)] : spec;
  }
  const independent = n.independent === true;
  const child = await c.startChild(resolved.dep, resolved.processId, childVars, token.id, independent);
  if (independent) return { vars: child.status === 'completed' ? mapChildOutputs(n, child) : {}, outcome: `called:${child.id}` };
  if (child.status === 'completed' && (child as any).terminateAll) return { end: 'terminate', terminateAll: true, outcome: `called:${child.id}` };
  if (child.status === 'completed') return { vars: mapChildOutputs(n, child), outcome: `called:${child.id}` };
  if (child.status === 'aborted' || child.status === 'failed') return { error: `called process ${child.status}`, errorCode: 'CALL_ERROR', outcome: `called:${child.id}` };
  return { wait: { kind: 'child', ref: child.id }, outcome: `called:${child.id}` };
};
