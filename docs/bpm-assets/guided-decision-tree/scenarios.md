# Guided Decision Tree — every scenario (engine tree → jBPM `.gdt`)

A guided decision tree is a **tree of field tests → action leaves** over one fact: start at the root,
follow the first branch whose condition holds, and either branch deeper or reach a leaf that sets
fields. Business Central compiles it to DRL (each root-to-leaf path becomes a rule).

> **Verification note:** the engine model + **runtime evaluator** are fully tested. The generated
> `.gdt` XML is **best-effort** — the SDK verifies it's well-formed, not that Business Central loads it
> (no public `.gdt` sample to validate against). Since a tree compiles to DRL, the executable path is
> also a DRL **ruleset** (`../drl/scenarios.md`) — prefer that when you need guaranteed execution.

## Two layers — which one to write
1. **Engine tree (nodejs-native)** — §0 below. A recursive `{ field, branches:[{ op, value, then }] }`.
   **This is what you author** (and what the runtime evaluator executes).
2. **`GuidedDecisionTree` XML (jBPM-side)** — [model.md](model.md). The XStream file the SDK produces.

Everything here is tested in [`../../../bpmn-sdk/test/decision-tree.test.mjs`](../../../bpmn-sdk/test/decision-tree.test.mjs).

---

## 0. Engine tree — the simple form (what you write)
```jsonc
// an EngineProject holds: { "types": [ … ], "decisionTrees": [ <tree> ], "processes": [ … ] }
{
  "types": [
    { "name": "Claim", "fields": [
      { "name": "amount", "type": "double" }, { "name": "region", "type": "string" },
      { "name": "priority", "type": "string" } ] }
  ],
  "decisionTrees": [{
    "name": "Claim triage",
    "fact": "Claim",                 // the fact the tree walks (its fields are the tests/actions)
    "root": {
      "field": "amount",             // a NODE: test this field
      "branches": [                  // first matching branch wins
        { "op": "gt", "value": 100000, "then": [ { "set": "priority", "value": "HIGH" } ] },   // leaf: set fields
        { "op": "lte", "value": 100000, "then": {                                              // or branch deeper
          "field": "region",
          "branches": [
            { "op": "eq", "value": "US", "then": [ { "set": "priority", "value": "STANDARD" } ] },
            { "op": "eq", "value": "EU", "then": [ { "set": "priority", "value": "REVIEW" } ] }
          ]
        } }
      ]
    }
  }]
}
```
Reads as: *amount > 100000 → HIGH; else (≤100000) if region US → STANDARD, if EU → REVIEW.*

### Complete field reference
```jsonc
{
  "name":    "Claim triage",   // required. tree name (+ default .gdt file name)
  "package": "com.acme.rules", // optional. default <process package>.rules
  "path":    "…/Claim_triage.gdt", // optional. default derived
  "fact":    "Claim",          // required. the data type the tree walks (a declared type)
  "root":    { "field": "…", "branches": [ … ] }  // the root NODE
}
```
| Shape | Meaning |
|-------|---------|
| **node** `{ field, branches[] }` | test one `field`; try `branches` top-to-bottom |
| **branch** `{ op, value, then }` | if `fact[field] <op> value`, take this branch |
| **branch.then** = `GdtAction[]` | a **leaf**: set fact fields (`{ set, value }` each) |
| **branch.then** = node | go **deeper** into a nested node |

### `op` — branch operators
`eq` `==` · `ne` `!=` · `gt` `>` · `gte` `>=` · `lt` `<` · `lte` `<=`.

### How a Node engine evaluates this on data (runtime)
Walk from the root: at each node, take the **first** branch whose `fact[field] <op> value` holds; if
its `then` is a leaf, apply the `set` actions and stop; if it's a node, recurse. First-match per node =
exclusive branches. Reference helper:
[`../../../bpmn-sdk/examples/functions/decision-tree.mjs`](../../../bpmn-sdk/examples/functions/decision-tree.mjs)
(`evaluateDecisionTree(tree, fact)` → the updated fact + the path taken).

---

The jBPM-side `.gdt` XML is in [model.json](model.json) / [model.md](model.md); the tested example is
`../../../bpmn-sdk/examples/guided/`.
