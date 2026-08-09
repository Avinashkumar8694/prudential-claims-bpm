# Decision Trees

**Key**: `decisionTrees` · **Name field**: `name` · **Exports as**: `.gdt` · **Used by**: [Business Rule](../nodes/rule.md)'s `decisionTree`

## Purpose

A tree of branch-on-a-field decisions — walk down from the root, following the first branch whose
test passes, collecting output values along the way.

## Shape

```json
{ "name": "TriageTree", "fact": "", "root": null }
```

A `TreeNode`:

```ts
{
  test?: { field: string },
  branches?: [ { match: InputTest, then: TreeNode } ],
  output?: { [variableName]: value }
}
```

- `fact` (optional) — a variable holding the object to test fields against; blank tests the whole
  variable map.
- Walking: at each node, if it has `output`, those values are applied immediately (not only at the
  leaf) — a deeper node's output can override a shallower one's. Then, if `test.field` and `branches`
  exist, the first branch whose `match` passes is descended into; otherwise the walk stops there.
- `match` uses the same test grammar as a [DMN](decisions-dmn.md) `InputTest` cell.

## Example

```json
{
  "name": "TriageTree", "fact": "",
  "root": {
    "test": { "field": "severity" },
    "branches": [
      { "match": "critical", "then": { "output": { "queue": "urgent", "slaHours": 1 } } },
      { "match": { "any": true }, "then": { "output": { "queue": "standard", "slaHours": 24 } } }
    ]
  }
}
```

## Gotchas

- There's a hard traversal cap (1000 steps) to guard against an accidentally cyclic tree — a
  well-formed tree never gets close to this.
- Failure (tree not found by name) raises `RULE_ERROR` on the hosting [Business Rule task](../nodes/rule.md).
