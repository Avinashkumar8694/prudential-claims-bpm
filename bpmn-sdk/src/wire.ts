import type { ProcessModel, Node, Flow } from './types.js';

function wireContainer(nodes: Node[], flows: Flow[]): void {
  for (const n of nodes) {
    // boundary events attach to a host and only carry an outgoing path
    if (n.type !== 'boundaryEvent') n.incoming = flows.filter((f) => f.targetRef === n.id).map((f) => f.id);
    n.outgoing = flows.filter((f) => f.sourceRef === n.id).map((f) => f.id);
    if (n.nodes && n.flows) wireContainer(n.nodes, n.flows); // recurse embedded/transaction/event sub-process
  }
}

/**
 * Derive every node's `incoming`/`outgoing` from the process's `flows` (recursing sub-processes),
 * so authors only declare flows. Mutates and returns the process.
 */
export function autowire(p: ProcessModel): ProcessModel {
  wireContainer(p.nodes || [], p.flows || []);
  return p;
}
