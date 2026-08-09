# Decision Tables (Guided Tables)

**Key**: `guidedTables` · **Name field**: `name` · **Exports as**: `.gdst` (Business Central "Guided
Decision Table" format, compiles to DRL)

## Purpose

A tabular ruleset over **one fact type**: condition columns (`fact.field <op> ?`), action columns
(`set fact.field = ?`), and rows supplying the per-row values — the spreadsheet-shaped alternative to
hand-written [DRL rules](rulesets-drl.md) for a single-fact ruleset.

## Shape

```json
{ "name": "PremiumTable", "fact": "", "conditions": [], "actions": [], "rows": [] }
```

| Property | Notes |
|---|---|
| `fact` | The fact/variable type this table operates on |
| `bind` | Optional binding name for that fact |
| `conditions` | `{ field, op, type? }` — `op` is `eq`/`ne`/`gt`/`gte`/`lt`/`lte` |
| `actions` | `{ field, type? }` — the field each row's action column sets |
| `rows` | `{ when: { <conditionField>: value }, then: { <actionField>: value } }` — one row = one compiled DRL rule |

## Example

```json
{
  "name": "PremiumTable", "fact": "Policy",
  "conditions": [{ "field": "riskTier", "op": "eq" }],
  "actions": [{ "field": "premiumMultiplier" }],
  "rows": [
    { "when": { "riskTier": "high" }, "then": { "premiumMultiplier": 1.5 } },
    { "when": { "riskTier": "standard" }, "then": { "premiumMultiplier": 1.0 } }
  ]
}
```

## Gotchas

- This asset kind is not currently referenced from the [Business Rule task](../nodes/rule.md)'s own
  fields the way DRL/DMN/decision-tree/scorecard are — it's authored and exported for downstream
  Business Central/KIE-server compatibility. If you need it evaluated *by this engine* at runtime,
  model the same logic as [DRL rules](rulesets-drl.md) instead.
- Rows are matched **top to bottom, every matching row fires** in real Drools compilation — same
  "every match fires" semantics as a normal DRL ruleset, not first-match-wins.
