// Multi-instance (forEach) — runs the child process once per item in `over` (v1: sequential,
// synchronous children), passing pass-through vars + the item; collects each `itemResult` into
// `collectInto`. Children link to the parent (visible via related()). Per-item human tasks: follow-up.
import type { NodeHandler } from '../types.ts';

export const handler: NodeHandler = async (c) => {
  const n = c.node;
  if (!c.resolveCalled || !n.process) return {};
  const resolved = await c.resolveCalled(n.process);
  if (!resolved) return { outcome: 'mi-process-not-deployed' };
  const items = Array.isArray(c.inst.variables[n.over]) ? (c.inst.variables[n.over] as any[]) : [];
  const parentToken = c.inst.tokens.find((t) => t.nodeId === n.id)!;
  const results: unknown[] = [];
  for (const item of items) {
    const childVars: Record<string, unknown> = {};
    for (const v of (n.pass || [])) childVars[v] = c.inst.variables[v];
    if (n.as) childVars[n.as] = item;
    const child = await c.startChild(resolved.dep, resolved.processId, childVars, parentToken.id);
    if (child.status === 'completed' && n.itemResult) results.push(child.variables[n.itemResult]);
  }
  return { vars: n.collectInto ? { [n.collectInto]: results } : {}, outcome: `multiInstance:${items.length}` };
};
