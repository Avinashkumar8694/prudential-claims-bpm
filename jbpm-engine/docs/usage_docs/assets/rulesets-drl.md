# DRL Rules (Rulesets)

**Key**: `rulesets` · **Name field**: `group` · **Exports as**: `.drl` · **Used by**: [Business Rule](../nodes/rule.md)'s `ruleflowGroup`

## Purpose

A named group of rules — this engine's native equivalent of a Drools ruleflow-group — evaluated by a
[Business Rule task](../nodes/rule.md) against the instance's variables.

## Shape

```json
{ "group": "risk-classification", "rules": [] }
```

Each rule:

```ts
{
  name: string;
  priority?: number;     // higher runs first
  noLoop?: boolean;
  when: [ { fact?: string, as?: string, where?: {...}, exists?: boolean, not?: boolean } ],
  then: [ { set?: string, fields?: {...} } | { insert?: string, fields?: {...} } ]
}
```

- **`fact`** (in `when`) — a variable name holding an object to test, OR **blank/omitted** — meaning
  "test the whole variable map directly" (this engine's own convenience; not a real Drools concept).
  `not: true` (or `exists: false`) negates the match.
- **`where`** — per-field tests: a bare literal (equals), an array (in-list), `{gt/gte/lt/lte}`,
  `{between: [a,b]}`, `{in: [...]}`, or `{not: ...}`.
- **`set`** (in `then`) — a variable name to mutate's `fields`, or blank to mutate the whole variable
  map directly (same convenience as `fact`).
- **`insert`** — creates a new variable holding `fields` as an object.

Rules run **priority-first** (highest first), every matching rule fires (not "first match wins" —
that's [Decision trees](decision-trees.md)/[Guided tables](guided-tables.md), not this).

## Example

```json
{
  "group": "risk-classification",
  "rules": [
    {
      "name": "High value claim",
      "priority": 10,
      "when": [{ "where": { "amount": { "gt": 10000 } } }],
      "then": [{ "set": "", "fields": { "riskTier": "high" } }]
    },
    {
      "name": "Default tier",
      "when": [{ "where": { "riskTier": { "not": "high" } } }],
      "then": [{ "set": "", "fields": { "riskTier": "standard" } }]
    }
  ]
}
```

## Gotchas

- Blank `fact`/`set` (whole variable map) is this engine's own convenience over real Drools — it
  exports to real DRL correctly, but authors coming from real jBPM/Drools should know it's an
  addition, not a 1:1 mirror of what they're used to.
- Failure inside rule evaluation raises `RULE_ERROR` on the hosting [Business Rule task](../nodes/rule.md).
