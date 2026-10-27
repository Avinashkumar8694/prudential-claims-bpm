# Score Card — every scenario (engine scorecard → jBPM `.scgd`)

A score card computes an **additive score** for a fact: start from a baseline, then each *characteristic*
(a field) adds points based on which **band** the field's value falls in. The total is written to a
score field. Business Central compiles it to DRL (rules that accumulate the score).

> **Verification note:** the engine model + **runtime scorer** are fully tested. The generated `.scgd`
> XML is **best-effort** — well-formed, BC-load not verified (no public sample). Since a scorecard is
> additive scoring, the same total is also expressible as a DRL **ruleset** (a rule per band that adds
> to the score) — the guaranteed-executable path.

## Two layers — which one to write
1. **Engine scorecard (nodejs-native)** — §0 below. `{ fact, score, baseline?, characteristics }`.
   **This is what you author** (and what the runtime scorer executes).
2. **`ScoreCardModel` XML (jBPM-side)** — [model.md](model.md). The `.scgd` XStream file the SDK produces.

Everything here is tested in [`../../../bpmn-sdk/test/scorecard.test.mjs`](../../../bpmn-sdk/test/scorecard.test.mjs).

---

## 0. Engine scorecard — the simple form (what you write)
```jsonc
// an EngineProject holds: { "types": [ … ], "scorecards": [ <sc> ], "processes": [ … ] }
{
  "scorecards": [{
    "name": "Claim risk",
    "fact": "Claim",
    "score": "riskScore",          // field the total is written to
    "baseline": 100,               // starting score (optional, default 0)
    "characteristics": [           // each field adds points from its first matching band
      { "field": "amount", "bands": [
        { "when": { "lt": 1000 },           "points": 0 },
        { "when": { "between": [1000, 100000] }, "points": 10 },
        { "when": { "gte": 100000 },        "points": 30 }
      ] },
      { "field": "region", "bands": [
        { "when": "US",       "points": 5 },
        { "when": "BLOCKED",  "points": 50 },
        { "points": 20 }             // no `when` = catch-all (any other region) — put it last
      ] }
    ]
  }]
}
```
For a `Claim{ amount: 250000, region: "US" }`: `100 (baseline) + 30 (amount ≥ 100000) + 5 (region US)`
= **`riskScore` 135**. Generates `src/main/resources/<pkg>/Claim_risk.scgd`.

### Complete field reference
```jsonc
{
  "name":     "Claim risk",     // required. scorecard name (+ default .scgd file name)
  "package":  "com.acme.rules", // optional. default <process package>.rules
  "path":     "…/Claim_risk.scgd", // optional. default derived
  "fact":     "Claim",          // required. the fact being scored (a declared type)
  "score":    "riskScore",      // required. the fact field the total score is written to
  "baseline": 100,              // optional. starting score (default 0)
  "characteristics": [ { "field": "<f>", "bands": [ { "when": <condition>, "points": <n> } ] } ]
}
```
**A `band`** is `{ when?: <condition>, points }`. The **first** band whose `when` holds (per
characteristic) contributes its `points`. `when` uses the **same condition grammar as everywhere else**
(DRL `where`, decision-table cells):

| `when` form | Matches when | jBPM `.scgd` attribute (operator/value) |
|-------------|--------------|------------------------------------------|
| `"US"` / `5` / `true` (bare literal) | `field === value` | `=` `US` |
| `{ "eq": "US" }` | `field === "US"` | `=` `US` |
| `{ "ne": "X" }` | `field !== "X"` | `!=` `X` |
| `{ "gt": 100000 }` | `field > 100000` | `>` `100000` |
| `{ "gte": 100000 }` | `field >= 100000` | `>=` `100000` |
| `{ "lt": 1000 }` | `field < 1000` | `<` `1000` |
| `{ "lte": 1000 }` | `field <= 1000` | `<=` `1000` |
| `{ "between": [1000, 100000] }` | `1000 <= field <= 100000` (inclusive) | `in` `1000..100000` |
| *(omitted)* | **catch-all** — always matches | *(empty operator)* |

That's the full operator set for a scorecard (`eq` `ne` `gt` `gte` `lt` `lte` `between`, plus the
catch-all). `total = baseline + Σ (first matching band's points, per characteristic)`, written to
`fact[score]`. Field types are derived from the declared `fact`.

### How a Node engine scores this at runtime
For each characteristic, find the **first** band whose `when` holds for the field value and add its
points; sum with the baseline; write to the `score` field. Reference helper:
[`../../../bpmn-sdk/examples/functions/scorecard.mjs`](../../../bpmn-sdk/examples/functions/scorecard.mjs)
(`evaluateScorecard(sc, fact)` → the updated fact + total + per-field contributions).

---

The jBPM-side `.scgd` XML is in [model.json](model.json) / [model.md](model.md); the tested example is
`../../../bpmn-sdk/examples/guided/`.
