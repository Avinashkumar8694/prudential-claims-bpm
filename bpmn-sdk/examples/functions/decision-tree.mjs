// functions/decision-tree.mjs — reusable runtime for an engine GUIDED DECISION TREE. Walk from the
// root: at each node, take the FIRST branch whose `fact[field] <op> value` holds; if its `then` is a
// leaf (actions) apply the sets and stop, else recurse into the nested node. First-match per node =
// exclusive branches. Pure JS, no SDK dependency.

const OPS = { eq: (a, b) => a === b, ne: (a, b) => a !== b, gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b };

// evaluate the tree against a fact. Returns { fact: <updated copy>, path: [<branch descriptions>] }.
export function evaluateDecisionTree(tree, fact) {
  const out = { ...fact };
  const path = [];
  const walk = (node) => {
    for (const b of node.branches) {
      if (OPS[b.op] && OPS[b.op](out[node.field], b.value)) {
        path.push(`${node.field} ${b.op} ${JSON.stringify(b.value)}`);
        if (Array.isArray(b.then)) { for (const a of b.then) out[a.set] = a.value; return true; }  // leaf
        return walk(b.then);                                                                        // nested node
      }
    }
    return false;   // no branch matched at this node
  };
  walk(tree.root);
  return { fact: out, path };
}
