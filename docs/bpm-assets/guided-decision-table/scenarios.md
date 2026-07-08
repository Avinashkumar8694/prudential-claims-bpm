# Guided Decision Table — every scenario (engine table → jBPM `.gdst`)

A guided decision table is a Business Central **editor** format that **compiles to DRL rules** (one row
= one rule, row order = rule order). It operates on **one fact**: *condition columns* test the fact's
fields, *action columns* set the fact's fields, and each *row* supplies the per-cell values.

> Because it compiles to DRL, its logic is also expressible as a DRL **ruleset**
> (`../drl/scenarios.md`) or a DMN **decision table** (`../dmn/scenarios.md`) — those are the
> *executable* targets. Use a guided table when you specifically want a **Business-Central-editable**
> table. (The SDK can only verify the XML is well-formed, not that Business Central will load it.)

## Two layers — which one to write
1. **Engine guided table (nodejs-native)** — §0 below. A tabular ruleset: `fact`, `conditions`
   columns, `actions` columns, `rows`. No XStream XML, no column plumbing. **This is what you author.**
2. **`decision-table52` XML tree (jBPM-side)** — [model.md](model.md). The lossless `{ xml }` the SDK
   **produces**; the escape hatch for hand-authored guided tables.

Everything here is tested in [`../../../bpmn-sdk/test/guided-table.test.mjs`](../../../bpmn-sdk/test/guided-table.test.mjs).

---

## 0. Engine guided table — the simple form (what you write)
The `fact` is a declared **type** (defined once in the project's `types`, exactly like DRL/DMN); the
table references it by name and its fields become the columns — so columns need only `field` + `op`,
and each column's `type` is **derived** from the declared type.

```jsonc
// an EngineProject holds: { "types": [ … ], "guidedTables": [ <table> ], "processes": [ … ] }
{
  "types": [                       // Claim is defined ONCE here (same as DRL/DMN)
    { "name": "Claim", "fields": [
      { "name": "amount", "type": "double" }, { "name": "region", "type": "string" },
      { "name": "status", "type": "string" }, { "name": "priority", "type": "string" } ] }
  ],
  "guidedTables": [{
    "name": "Claim classification",
    "fact": "Claim",               // references the type above; its fields are the columns
    "conditions": [                // condition COLUMNS: fact.field <op> — type derived from Claim
      { "field": "amount", "op": "gt" },
      { "field": "region", "op": "eq" }
    ],
    "actions": [                   // action COLUMNS: set fact.field
      { "field": "status" },
      { "field": "priority" }
    ],
    "rows": [                      // one row = one rule; `when`=condition cell values, `then`=action cell values
      { "when": { "amount": 5000 },                    "then": { "status": "STANDARD", "priority": "P3" } },
      { "when": { "amount": 100000, "region": "US" }, "then": { "status": "HIGH",     "priority": "P1" } }
    ]
  }]
}
```
(Column `type` can still be set explicitly to override the derived one — handy for a standalone table
whose fact isn't a declared engine type.)
compiles to a `decision-table52` (EXTENDED_ENTRY) that reads:

| # | Claim: amount `>` | region `==` | set status | set priority |
|---|-------------------|-------------|------------|--------------|
| 1 | `5000` | *(any)* | `STANDARD` | `P3` |
| 2 | `100000` | `US` | `HIGH` | `P1` |

i.e. DRL like `rule "Row 2" when $c: Claim(amount > 100000, region == "US") then $c.setStatus("HIGH"); $c.setPriority("P1"); update($c); end`. The **operator lives on the column**; the **value lives in the
row** — a cell left out of `when` means "no constraint" for that column. Rows fire top-to-bottom and a
**later matching row overrides** earlier action cells, so the more specific row (HIGH) goes **last** to
win when it applies (a $250k US claim matches both rows → ends `HIGH`). Or make rows mutually exclusive.

### Complete field reference
```jsonc
{
  "name":    "Claim classification",  // required. table name (+ default .gdst file name)
  "package": "com.acme.rules",        // optional. default <process package>.rules
  "path":    "src/main/resources/com/acme/rules/Claim_classification.gdst",  // optional. default derived
  "fact":    "Claim",                 // required. the data type the table reads/writes (a declared type)
  "bind":    "c",                     // optional & rarely needed. internal rule var name (c -> $c); you
                                      //   never reference it — omit it (defaults to lowercased fact)
  "conditions": [ { "field": "amount", "op": "gt", "type": "number" } ],  // condition columns (type optional — derived from `fact`)
  "actions":    [ { "field": "status", "type": "string" } ],             // action columns (type optional — derived from `fact`)
  "rows":       [ { "when": { <condField>: value }, "then": { <actField>: value } } ]
}
```
| Element | Meaning | Maps to |
|---------|---------|---------|
| `conditions[].field` + `op` + `type` | a condition column | `condition-column52` (factField/operator/fieldType) |
| `actions[].field` + `type` | a set-field column | `action-set-field-column52` (factField/type) |
| `rows[i].when[field]` | condition cell value in row i | a `<value>` in the row's `<list>` |
| `rows[i].then[field]` | action cell value in row i | a `<value>` in the row's `<list>` |

### `op` — condition operators
| `op` | GDST operator |
|------|---------------|
| `eq` | `==` |
| `ne` | `!=` |
| `gt` | `>` |
| `gte` | `>=` |
| `lt` | `<` |
| `lte` | `<=` |

### `type` → Java `fieldType` / GDST `dataType`
| engine `type` | Java fieldType | GDST dataType |
|---------------|----------------|---------------|
| `string` | `String` | `STRING` |
| `number` / `double` / `float` | `Double` | `NUMERIC_DOUBLE` |
| `int` / `integer` / `long` | `Integer`/`Long` | `NUMERIC_INTEGER` |
| `bool` / `boolean` | `Boolean` | `BOOLEAN` |
| `date` | `java.util.Date` | `DATE` |

### Firing it from a process
Rows compile to DRL rules in a `ruleflow-group` (Business Central sets the group from the table); a
`rule` node bound to that group fires them — same as a DRL ruleset (`../drl/scenarios.md` §0).

### How a Node engine evaluates this on data (runtime)
A guided table is a **tabular ruleset**. For a fact object, the engine checks each row: every condition
column's `fact[field] <op> rowValue` must hold; matching rows apply their action `set`s (row order;
default policy = all matching rows fire). Reference helper:
[`../../../bpmn-sdk/examples/functions/guided-table.mjs`](../../../bpmn-sdk/examples/functions/guided-table.mjs)
(`evaluateGuidedTable(table, fact)` returns the updated fact + which rows fired).

---

The jBPM-side XML tree this produces is in [model.json](model.json) / [model.md](model.md); the tested
example is `../../../bpmn-sdk/examples/guided/`.
