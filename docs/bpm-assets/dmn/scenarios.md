# DMN — every scenario (engine JSON → jBPM DMN)

## Two layers — which one to write
1. **Engine decision model (nodejs-native)** — §0 below. A decision **table**: `inputs`/`outputs` are
   columns, `rules` are rows (`when` cells + `then` cells, keyed by column name). **No FEEL, no DMN
   XML, no namespaces.** Your Node engine evaluates it directly, and the SDK (`decisionToDmn` /
   `fromEngineProject`) synthesizes the DMN 1.2 file. **This is what you author.**
2. **DMN XML tree (jBPM-side)** — see [model.md](model.md). The lossless generic XML tree
   (`{ xml: ElementNode }`) the SDK **produces**, and the **escape hatch** for hand-authored DMN
   (DRD graphs, boxed expressions, contexts, FEEL functions) the simple table doesn't cover.

Everything here is tested in [`../../../bpmn-sdk/test/dmn.test.mjs`](../../../bpmn-sdk/test/dmn.test.mjs).
For a FEEL construct the table can't express, a `{ "feel": "…" }` escape exists on any cell.

---

## 0. Engine decision table — the simple form (what you write)
Read it like a spreadsheet. Columns = `inputs` + `outputs`; rows = `rules`.

```jsonc
// an EngineProject holds: { "decisions": [ <model> ], "processes": [ … ] }
{
  "name": "ClaimDecisions",                 // the .dmn file / DMN model name
  "decisions": [{
    "name": "Eligibility",                  // one decision (a table)
    "hitPolicy": "UNIQUE",                  // optional (default UNIQUE)
    "inputs":  [ { "name": "amount", "type": "number" }, { "name": "region", "type": "string" } ],
    "outputs": [ { "name": "approved", "type": "boolean" }, { "name": "tier", "type": "string" } ],
    "rules": [
      { "when": { "amount": { "gt": 100000 }, "region": "US" }, "then": { "approved": true,  "tier": "HIGH" } },
      { "when": { "amount": { "between": [1, 100000] } },       "then": { "approved": true,  "tier": "STANDARD" } },
      { "when": { "amount": { "lt": 1 } },                       "then": { "approved": false, "tier": "NONE" } }
    ]
  }]
}
```
compiles to a DMN decision table:

| # | amount (number) | region (string) | approved (boolean) | tier (string) |
|---|-----------------|-----------------|--------------------|---------------|
| 1 | `> 100000` | `"US"` | `true` | `"HIGH"` |
| 2 | `[1..100000]` | `-` | `true` | `"STANDARD"` |
| 3 | `< 1` | `-` | `false` | `"NONE"` |

(hit policy `UNIQUE`). A `when` that omits an input → `-` (any). Cells become **FEEL**; the SDK adds
`inputData`, `informationRequirement`, `typeRef`s, ids, and the `namespace`.

### Complete field reference (every property)
```jsonc
{
  "name":      "ClaimDecisions",     // required. DMN model name (+ default .dmn file name)
  "namespace": "https://…",          // optional. default https://<process package>/dmn/<name>
  "path":      "src/main/resources/ClaimDecisions.dmn",  // optional. default src/main/resources/<name>.dmn
  "decisions": [{
    "name":        "Eligibility",    // required. -> <decision> + <decisionTable>
    "hitPolicy":   "UNIQUE",         // optional. see hit-policy table
    "aggregation": "SUM",            // optional. only with hitPolicy COLLECT (SUM|MIN|MAX|COUNT)
    "inputs":  [ { "name": "amount", "type": "number" } ],   // columns read
    "outputs": [ { "name": "tier",   "type": "string" } ],   // columns produced
    "rules":   [ { "when": { <input>: <InputTest> }, "then": { <output>: <OutputResult> } } ]
  }]
}
```
`type` is optional (untyped if omitted). A rule's `when`/`then` are keyed by column **name** (order
doesn't matter; the SDK lays cells out in column order). `then` fields not listed emit an empty cell.

### `InputTest` — every cell condition and its FEEL
| JSON form | Meaning | FEEL |
|-----------|---------|------|
| `"US"` / `5` / `true` | equals a literal | `"US"` / `5` / `true` |
| `"-"` or `{ "any": true }` or omitted | matches anything | `-` |
| `["A","B"]` or `{ "in": ["A","B"] }` | in a set (disjunction) | `"A", "B"` |
| `{ "gt": 100000 }` | greater than | `> 100000` |
| `{ "gte": 1 }` / `{ "lt": 50 }` / `{ "lte": 50 }` | comparisons | `>= 1` / `< 50` / `<= 50` |
| `{ "between": [1, 10] }` | inclusive range | `[1..10]` |
| `{ "not": "US" }` / `{ "not": ["A","B"] }` | negation | `not("US")` / `not("A", "B")` |
| `{ "feel": "> date(\"2026-01-01\")" }` | raw FEEL escape hatch | *(verbatim)* |

### `OutputResult` — every cell result
| JSON form | FEEL |
|-----------|------|
| `"HIGH"` / `42` / `true` | `"HIGH"` / `42` / `true` |
| `{ "feel": "amount * 0.1" }` | `amount * 0.1` (expression) |

### `hitPolicy` — all values (how multiple matching rows resolve)
| `hitPolicy` | Meaning | Evaluator returns |
|-------------|---------|-------------------|
| `UNIQUE` (default) | at most one row matches | one output object |
| `FIRST` | first matching row (by order) | one output object |
| `ANY` | multiple may match but all give the same output | one output object |
| `PRIORITY` | highest-priority matching output | one output object |
| `COLLECT` | all matching rows | array of output objects |
| `COLLECT` + `aggregation` | aggregate one output over matches | `{ <output>: SUM/MIN/MAX/COUNT }` |
| `RULE ORDER` | all matches in rule order | array |
| `OUTPUT ORDER` | all matches in output-priority order | array |

### `type` → FEEL `typeRef`
`number` (also `int`/`double`/`float`) → `number` · `string` → `string` · `boolean`/`bool` →
`boolean` · `date` → `date` · `time` → `time` · `dateTime` → `date and time` · `any`/omitted → untyped.

### Firing it from a process
A `rule` node bound to the decision fires it (jBPM `businessRuleTask`, DMN implementation):
```jsonc
{ "type": "rule", "name": "Eligibility",
  "dmn": { "namespace": "https://com/acme/dmn/ClaimDecisions", "model": "ClaimDecisions", "decision": "Eligibility" } }
```

### How a Node engine evaluates this on data (runtime)
`inputs`/`outputs` are columns; a fact/context object supplies the input values. The engine:
1. **match** each rule — every input cell's `InputTest` must hold for the input value (missing = any);
2. **resolve** by `hitPolicy` — UNIQUE/FIRST/ANY/PRIORITY → one row; COLLECT/RULE ORDER/OUTPUT ORDER →
   all matches (COLLECT+aggregation → a single aggregate);
3. **produce** the `then` cells as the output object(s).

Reference evaluator + trace: [`../../../bpmn-sdk/examples/functions/dmn-engine.mjs`](../../../bpmn-sdk/examples/functions/dmn-engine.mjs)
(structured tests are executed; a raw `{ feel }` cell is treated as a wildcard — no FEEL parser shipped).

---

Comprehensive worked example (all input forms + a COLLECT table) and the jBPM-side XML tree live in
[model.json](model.json) / [model.md](model.md); the tested example is
`../../../bpmn-sdk/examples/decisions/`.
