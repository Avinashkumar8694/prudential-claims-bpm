// Gateway — exclusive/parallel/inclusive/event/complex branching + join.
// KNOWN LIMITATION: a converging parallel/inclusive join counts arrivals via inst.history (how many
// tokens have EVER reached this node id), which is correct for a join visited once per instance but is
// NOT loop-safe — a parallel fork/join sitting inside a cycle would under-count on the 2nd+ iteration
// (history from the 1st round never resets). The `joins` map threaded through HandlerCtx exists for a
// future per-round tracking fix; it isn't load-bearing yet. Fine for the common (non-looped) case.
import type { NodeHandler, HandlerResult } from '../types.ts';
import { evalCondition } from '../../sandbox.ts';
import { varTypesOf, kcontextInfoOf, onActionOf } from '../kcontext-info.ts';

async function filterAsync<T>(items: T[], pred: (item: T) => Promise<boolean>): Promise<T[]> {
  const out: T[] = [];
  for (const item of items) if (await pred(item)) out.push(item);
  return out;
}
async function findAsync<T>(items: T[], pred: (item: T) => Promise<boolean>): Promise<T | undefined> {
  for (const item of items) if (await pred(item)) return item;
  return undefined;
}

export const handler: NodeHandler = async (c): Promise<HandlerResult> => {
  const node = c.node as any;
  const outs = c.outgoing(node.id);
  const ins = c.incoming(node.id);
  const converging = ins.length > 1 && outs.length <= 1;
  const varTypes = varTypesOf(c);
  const condCtx = { ...kcontextInfoOf(c), onAction: onActionOf(c) };

  if (converging && (node.mode === 'parallel' || node.mode === 'inclusive')) {
    const arrived = c.inst.history.filter((h) => h.nodeId === node.id).length;
    if (arrived < ins.length) return { consume: true, outcome: `join ${arrived}/${ins.length}` };
    c.joins[node.id] = new Set();
    return { next: outs.map((f) => f.to), outcome: 'join-complete' };
  }

  switch (node.mode) {
    case 'parallel': return { next: outs.map((f) => f.to), outcome: 'fork' };
    case 'inclusive': {
      const matched = await filterAsync(outs, async (f) => !!f.when && evalCondition(f.when, f.lang, c.inst.variables, undefined, varTypes, condCtx));
      const chosen = matched.length ? matched : outs.filter((f) => f.id === node.default || !f.when);
      return { next: chosen.map((f) => f.to), outcome: matched.length ? 'inclusive' : 'default' };
    }
    case 'event': return { next: outs.map((f) => f.to), outcome: 'event-gateway-fork' };
    case 'complex':
    case 'exclusive':
    default: {
      const match = await findAsync(outs, async (f) => !!f.when && evalCondition(f.when, f.lang, c.inst.variables, undefined, varTypes, condCtx));
      const def = outs.find((f) => f.id === node.default) || outs.find((f) => !f.when);
      const chosen = match || def;
      return { next: chosen ? [chosen.to] : [], outcome: match ? 'conditional' : 'default' };
    }
  }
};
