# Guided Rule Template — every scenario (engine template → jBPM `.template`)

A guided rule template is a **rule skeleton with `{placeholders}` + a data table**: one rule shape whose
values are parameters, plus rows that fill them — Business Central expands it into **N DRL rules** (one
per row). It's the "one skeleton, many rows" pattern — semantically a decision table expressed as a
parameterized rule.

> **Verification note:** the engine model + **runtime** (expand → run with the existing rule engine)
> are fully tested. The generated `.template` XML is **best-effort** — well-formed, BC-load not verified
> (no public sample). Since it expands to DRL, a DMN/guided **decision table** or a DRL **ruleset** is
> the guaranteed-executable path; `.template` is for a Business-Central-editable copy.

## Two layers — which one to write
1. **Engine template (nodejs-native)** — §0 below. A rule (`when`/`then`) with `{param}` values + `rows`.
   **This is what you author** (and what the runtime expands + executes).
2. **`TemplateModel` XML (jBPM-side)** — [model.md](model.md). The `.template` XStream file the SDK produces.

Everything here is tested in [`../../../bpmn-sdk/test/guided-rule-template.test.mjs`](../../../bpmn-sdk/test/guided-rule-template.test.mjs).

---

## 0. Engine template — the simple form (what you write)
```jsonc
// an EngineProject holds: { "types": [ … ], "guidedRuleTemplates": [ <tmpl> ], "processes": [ … ] }
{
  "guidedRuleTemplates": [{
    "name": "Tier pricing",
    "when": [                        // same shape as a DRL ruleset rule — but values can be {params}
      { "fact": "Claim", "as": "c", "where": { "amount": { "gte": "{min}" }, "region": "{region}" } }
    ],
    "then": [
      { "set": "c", "fields": { "tier": "{tier}" } }
    ],
    "rows": [                        // one row = one generated rule; keys are the {param} names
      { "min": 5000,   "region": "US", "tier": "STANDARD" },
      { "min": 100000, "region": "US", "tier": "HIGH" }
    ]
  }]
}
```
expands to **two** rules:
- `Tier pricing_1`: `Claim( amount >= 5000, region == "US" )` → `c.tier = "STANDARD"`
- `Tier pricing_2`: `Claim( amount >= 100000, region == "US" )` → `c.tier = "HIGH"`

and generates `src/main/resources/<pkg>/Tier_pricing.template` (a `TemplateModel`: the rule skeleton +
the parameter columns + the rows).

> **Overlapping rows:** the generated rules all fire independently (they're rules, not an exclusive
> table); a later matching rule overrides earlier `set`s. So put the **more specific** row **last**
> (HIGH last) — a $250k claim matches both rows and ends `HIGH`. Or make the rows mutually exclusive.

### Complete field reference
```jsonc
{
  "name":     "Tier pricing",   // required. template name (+ default .template file name)
  "package":  "com.acme.rules", // optional. default <process package>.rules
  "path":     "…/Tier_pricing.template", // optional. default derived
  "priority": 10,               // optional. -> salience on every generated rule
  "noLoop":   true,             // optional
  "when":     [ /* EngineWhen[] — like a DRL ruleset rule; values may be "{param}" placeholders */ ],
  "then":     [ /* EngineThen[] — likewise */ ],
  "rows":     [ { "<param>": <value> } ]  // one object per generated rule; keys = the {param} names
}
```
- **`when`/`then`** use the DRL-ruleset grammar (see **[../drl/scenarios.md §0](../drl/scenarios.md)**);
  any string value of the form `"{name}"` is a **template parameter**.
- **`rows`** — each object supplies a value per parameter; the SDK/engine substitutes `{name}` → the
  row's value (type preserved: `{min}` → the number `100000`). One row → one rule.
- A parameter can appear in a `where` value **or** a `then` field value.

### How it runs / executes
- **Runtime**: **expand** the template — substitute each row's values into the `when`/`then` skeleton to
  get N concrete rules — then run them with the reference **rule engine**. Helper:
  [`../../../bpmn-sdk/examples/functions/rule-template.mjs`](../../../bpmn-sdk/examples/functions/rule-template.mjs)
  (`expandTemplate(tmpl)` → a ruleset the same engine executes).
- **jBPM**: `fromEngineProject` emits the `.template`; Business Central expands it to DRL. (Or emit a
  DMN/guided decision table for a guaranteed-executable table — same rows.)

---

The jBPM-side `.template` XML is in [model.json](model.json) / [model.md](model.md); the tested example
is `../../../bpmn-sdk/examples/guided/`.
