# Scorecards

**Key**: `scorecards` · **Name field**: `name` · **Exports as**: `.scgd` · **Used by**: [Business Rule](../nodes/rule.md)'s `scorecard`

## Purpose

Additive scoring over a set of characteristics — a credit-score-style model: start from a baseline,
add or subtract each characteristic's matching band, write the total to a target variable.

## Shape

```json
{ "name": "CreditScore", "fact": "", "baseline": 0, "target": "score", "characteristics": [] }
```

| Property | Notes |
|---|---|
| `fact` | Optional variable holding the object to test fields against; blank tests the whole variable map |
| `baseline` | Starting score |
| `target` | Variable name the final score is written to (default `score` if unset) |
| `characteristics` | `{ field, attributes: [{ match, points, reason? }] }` |

For each characteristic, the **first** attribute whose `match` passes contributes its `points` to the
running total; `reason` (if present) is collected into `<target>Reasons` (an array) — useful for
showing *why* a score came out the way it did.

## Example

```json
{
  "name": "CreditScore", "fact": "", "baseline": 600, "target": "creditScore",
  "characteristics": [
    { "field": "paymentHistory", "attributes": [
      { "match": "excellent", "points": 80, "reason": "Excellent payment history" },
      { "match": "poor", "points": -100, "reason": "Poor payment history" }
    ]},
    { "field": "utilization", "attributes": [
      { "match": { "lt": 0.3 }, "points": 40 },
      { "match": { "any": true }, "points": -20 }
    ]}
  ]
}
```

Result: `creditScore` = `600 + points from the first matching band per characteristic`, plus
`creditScoreReasons` listing any matched band's `reason`.

## Gotchas

- Only the **first** matching attribute per characteristic counts — order attributes from most to
  least specific if you have overlapping `match` conditions.
- Failure (scorecard not found by name) raises `RULE_ERROR` on the hosting [Business Rule task](../nodes/rule.md).
