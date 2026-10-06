// Embedded sub-process — runs its own nodes/flows as a nested child instance of a synthetic composite
// process, sharing the parent's FULL variable scope both ways (every child variable merges back, not
// just a declared subset — contrast with Call Activity's isolated, declared-outputs-only mapping).
// The event sub-process idiom (on.error set) is the SAME shape, floating/unconnected, triggered by the
// error router instead of a normal sequence flow — see execution-engine.ts's raiseError.
import type { NodeHandler } from '../types.ts';
import type { Instance } from '../../../domain.ts';

export function mapChildOutputs(_n: any, child: Instance): Record<string, unknown> {
  return { ...child.variables };
}

export const handler: NodeHandler = async (c) => {
  const n = c.node as any;
  const token = c.inst.tokens.find((t) => t.nodeId === n.id)!;
  const processId = `${c.proc.id}::${n.id}`;
  const syntheticDep = {
    ...c.dep,
    engine: { ...c.dep.engine, processes: [{ id: processId, name: n.name || n.id, package: c.proc.package, vars: [], nodes: n.nodes || [], flows: n.flows || [] }] },
  } as typeof c.dep;
  const child = await c.startChild(syntheticDep, processId, { ...c.inst.variables }, token.id);
  if (child.status === 'completed' && (child as any).terminateAll) return { end: 'terminate', terminateAll: true, outcome: `sub:${child.id}` };
  if (child.status === 'completed') return { vars: mapChildOutputs(n, child), outcome: `sub:${child.id}` };
  if (child.status === 'aborted' || child.status === 'failed') return { error: `sub-process ${child.status}`, errorCode: 'SUBPROCESS_ERROR', outcome: `sub:${child.id}` };
  return { wait: { kind: 'child', ref: child.id }, outcome: `sub:${child.id}` };
};
