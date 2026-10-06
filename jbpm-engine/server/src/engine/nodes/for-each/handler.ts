// Multi-instance (forEach) — runs the child process once per item in `over`, passing pass-through
// vars + the item; collects each `itemResult` into `collectInto`. `parallel:true` starts all items at
// once; sequential starts only the first here and execution-engine.ts's tryResumeParent starts each
// next item as the previous one actually finishes (which may be later, if it waits).
import type { NodeHandler, HandlerResult } from '../types.ts';
import type { Instance } from '../../../domain.ts';

export function buildMultiInstanceResult(children: Instance[], total: number, n: any): HandlerResult {
  const failed = children.find((child) => child.status === 'failed' || child.status === 'aborted');
  if (failed) return { error: `multi-instance item did not complete (${failed.status}): ${failed.id}`, errorCode: 'MULTIINSTANCE_ERROR', outcome: `multiInstance:${total}` };
  if (children.length < total || children.some((child) => child.status !== 'completed')) return { wait: { kind: 'multiInstance' }, outcome: `multiInstance:${children.length}/${total}` };
  const terminator = children.find((child) => (child as any).terminateAll);
  if (terminator) return { end: 'terminate', terminateAll: true, outcome: `multiInstance:${total}` };
  const results = n.itemResult ? children.map((child) => child.variables[n.itemResult]) : [];
  return { vars: n.collectInto ? { [n.collectInto]: results } : {}, outcome: `multiInstance:${total}` };
}

export const handler: NodeHandler = async (c) => {
  const n = c.node as any;
  if (!c.resolveCalled || !n.process) return {};
  const resolved = await c.resolveCalled(n.process, n.workflowId);
  if (!resolved) return { outcome: 'mi-process-not-deployed' };
  const items = Array.isArray(c.inst.variables[n.over]) ? (c.inst.variables[n.over] as any[]) : [];
  if (!items.length) return { vars: n.collectInto ? { [n.collectInto]: [] } : {}, outcome: 'multiInstance:0' };
  const parentToken = c.inst.tokens.find((t) => t.nodeId === n.id)!;
  const runOne = (item: unknown) => {
    const childVars: Record<string, unknown> = {};
    for (const v of (n.pass || [])) childVars[v] = c.inst.variables[v];
    if (n.as) childVars[n.as] = item;
    return c.startChild(resolved.dep, resolved.processId, childVars, parentToken.id);
  };
  if (n.parallel) return buildMultiInstanceResult(await Promise.all(items.map(runOne)), items.length, n);
  const started: Instance[] = [];
  for (const item of items) {
    started.push(await runOne(item));
    if (started.at(-1)!.status !== 'completed') break;
  }
  return buildMultiInstanceResult(started, items.length, n);
};
