# Guided Rule — every scenario (engine rule → jBPM `.rdrl`)

A guided rule is **one rule** authored in Business Central's guided editor — it compiles to a single
DRL rule. So in the engine model it's authored with the **exact same vocabulary as a DRL ruleset rule**
(`when` / `then`), executed by the **same rule engine**, and just emitted as `.rdrl` (guided editor)
instead of `.drl`.

> **Verification note:** the engine model + **runtime** (the existing rule engine) are fully tested.
> The generated `.rdrl` XML is **best-effort** — well-formed, but BC-load isn't verified (no public
> `.rdrl` sample). Since a guided rule *is* a DRL rule, emitting it as a **DRL ruleset**
> (`../drl/scenarios.md`) is the guaranteed-executable path; `.rdrl` is only for a Business-Central-
> editable copy.

## Two layers — which one to write
1. **Engine guided rule (nodejs-native)** — §0 below. `{ name, when, then }` — identical to one DRL
   ruleset rule. **This is what you author.**
2. **`RuleModel` XML (jBPM-side)** — [model.md](model.md). The `.rdrl` XStream file the SDK produces.

Everything here is tested in [`../../../bpmn-sdk/test/guided-rule.test.mjs`](../../../bpmn-sdk/test/guided-rule.test.mjs).

---

## 0. Engine guided rule — the simple form (what you write)
```jsonc
// an EngineProject holds: { "types": [ … ], "guidedRules": [ <rule> ], "processes": [ … ] }
{
  "guidedRules": [{
    "name": "High value open claim",
    "when": [                        // ← identical to a DRL ruleset rule's `when` (see ../drl §0)
      { "fact": "Claim", "as": "c", "where": { "amount": { "gt": 100000 }, "status": "OPEN" } }
    ],
    "then": [                        // ← identical to a DRL ruleset rule's `then`
      { "set": "c", "fields": { "priority": "HIGH" } }
    ]
  }]
}
```
generates `src/main/resources/<pkg>/High_value_open_claim.rdrl` (a `RuleModel`: fact patterns with
field constraints + set-field actions) — the same logic a DRL rule would express.

### Complete field reference
```jsonc
{
  "name":     "High value open claim", // required. rule name (+ default .rdrl file name)
  "package":  "com.acme.rules",        // optional. default <process package>.rules
  "path":     "…/High_value_open_claim.rdrl", // optional. default derived
  "priority": 10,                      // optional. -> salience attribute
  "noLoop":   true,                    // optional. -> no-loop attribute
  "when":     [ /* EngineWhen[]  — same as a DRL ruleset rule */ ],
  "then":     [ /* EngineThen[]  — same as a DRL ruleset rule */ ]
}
```
`when` / `then` use **the DRL ruleset grammar verbatim** — see **[../drl/scenarios.md §0](../drl/scenarios.md)**:
- `when[]`: `{ fact, as?, where: { field: value | {op:value} | {ref} }, exists? }` — condition operators
  `eq/ne/gt/gte/lt/lte/in/notIn/contains/notContains/matches/memberOf`, joins via `{ ref }`.
- `then[]`: `{ set, fields }` / `{ insert, fields? }` / `{ delete }` / `{ call, args? }`.
- Field/value types are **derived** from the declared `fact` type.

### How it runs / executes
- **Runtime**: it's a rule — the reference **rule engine** runs it directly. Wrap it as a one-rule
  ruleset and call `run(...)` from
  [`../../../bpmn-sdk/examples/functions/rule-engine.mjs`](../../../bpmn-sdk/examples/functions/rule-engine.mjs)
  (the same engine that executes DRL rulesets).
- **jBPM**: `fromEngineProject` emits the `.rdrl`; Business Central compiles it to DRL. (Or emit a DRL
  ruleset directly for a guaranteed-executable rule — same authored `when`/`then`.)

---

The jBPM-side `.rdrl` XML is in [model.json](model.json) / [model.md](model.md); the tested example is
`../../../bpmn-sdk/examples/guided/`.
