// Gateway — exclusive/parallel/inclusive/event/complex branching + join.
import type { NodeHandler, HandlerResult } from '../types.ts';
import { evalCondition } from '../../sandbox.ts';

export const handler: NodeHandler = (c): HandlerResult => {
  const node = c.node;
  const outs = c.outgoing(node.id);
  const ins = c.incoming(node.id);
  const converging = ins.length > 1 && outs.length <= 1;

  if (converging && (node.mode === 'parallel' || node.mode === 'inclusive')) {
    // join: wait until a token has arrived via each incoming flow
    const arrived = c.inst.history.filter((h) => h.nodeId === node.id).length;
    if (arrived < ins.length) return { consume: true, outcome: `join ${arrived}/${ins.length}` };
    c.joins[node.id] = new Set();
    return { next: outs.map((f) => f.to), outcome: 'join-complete' };
  }

  switch (node.mode) {
    case 'parallel': return { next: outs.map((f) => f.to), outcome: 'fork' };
    case 'inclusive': {
      const taken = outs.filter((f) => (f.id && f.id === node.default) || evalCondition(f.when, f.lang, c.inst.variables));
      const chosen = taken.length ? taken : outs.filter((f) => f.id === node.default);
      return { next: chosen.map((f) => f.to), outcome: 'inclusive' };
    }
    case 'event': return { consume: true, outcome: 'event-gateway-wait' };  // downstream catches carry the wait
    case 'complex':
    case 'exclusive':
    default: {
      const match = outs.find((f) => f.when && evalCondition(f.when, f.lang, c.inst.variables));
      const def = outs.find((f) => f.id === node.default) || outs.find((f) => !f.when);
      const chosen = match || def;
      return { next: chosen ? [chosen.to] : [], outcome: match ? 'conditional' : 'default' };
    }
  }
};
