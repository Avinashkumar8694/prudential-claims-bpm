// Multi-instance (forEach) — runs the child process once per item in `over` (each child is run
// SYNCHRONOUSLY to completion — a per-item human task/wait is a known gap, see below), passing
// pass-through vars + the item; collects each `itemResult` into `collectInto`. Children link to the
// parent (visible via related()). `parallel:true` runs all items concurrently instead of one at a
// time; either way, any item that doesn't complete fails the whole node (real MI default semantics)
// instead of silently dropping that item's result.
//
// Known gap, not fixed here: because startChild() only returns once the child instance itself
// reaches quiescence, an item whose child process WAITS (e.g. a per-item user task) is treated
// exactly like a failure below (child.status is 'waiting', not 'completed') rather than actually
// being linked up for later resume — there is no mechanism today for a multi-instance activity to
// park until N per-item human tasks are each completed independently.
import type { NodeHandler } from '../types.ts';
import type { Instance } from '../../../domain.ts';

async function runSequential(items: unknown[], run: (item: unknown) => Promise<Instance>): Promise<Instance[]> {
  const out: Instance[] = [];
  for (const item of items) {
    const child = await run(item);
    out.push(child);
    if (child.status !== 'completed') break;   // fail fast — don't start further items once one fails
  }
  return out;
}

export const handler: NodeHandler = async (c) => {
  const n = c.node;
  if (!c.resolveCalled || !n.process) return {};
  const resolved = await c.resolveCalled(n.process);
  if (!resolved) return { outcome: 'mi-process-not-deployed' };
  const items = Array.isArray(c.inst.variables[n.over]) ? (c.inst.variables[n.over] as any[]) : [];
  const parentToken = c.inst.tokens.find((t) => t.nodeId === n.id)!;
  const runOne = (item: unknown) => {
    const childVars: Record<string, unknown> = {};
    for (const v of (n.pass || [])) childVars[v] = c.inst.variables[v];
    if (n.as) childVars[n.as] = item;
    return c.startChild(resolved.dep, resolved.processId, childVars, parentToken.id);
  };
  const children = n.parallel ? await Promise.all(items.map(runOne)) : await runSequential(items, runOne);
  const failed = children.find((child) => child.status !== 'completed');
  if (failed) return { error: `multi-instance item did not complete (${failed.status}): ${failed.id}`, errorCode: 'MULTIINSTANCE_ERROR', outcome: `multiInstance:${items.length}` };
  const results = n.itemResult ? children.map((child) => child.variables[n.itemResult]) : [];
  return { vars: n.collectInto ? { [n.collectInto]: results } : {}, outcome: `multiInstance:${items.length}` };
};
