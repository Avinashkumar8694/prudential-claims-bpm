# Test Scenario — every scenario (engine tests → jBPM `.scesim`)

A test scenario is a **table of test cases** for a decision (DMN) or rule set (DRL): each case gives
inputs and asserts the expected outputs. It's the "JUnit for rules/decisions" — it runs at build time
to catch regressions, **not** at process runtime.

The nodejs-native form is just a list of `{ given, expect }` cases — and for a Node engine this is the
**best-fit asset of all**: the same cases both (a) **run in Node** against the reference evaluators
(real pass/fail — this *is* your test harness) and (b) generate the jBPM `.scesim` artifact.

> **Verification note:** the engine model + the **case runner** are fully tested and genuinely execute.
> The generated `.scesim` XML is **best-effort** — well-formed, BC-load not verified (no public sample).
> Test scenarios verify a **decision/rule**, not the process **flow** (that needs a process test).

## Two layers — which one to write
1. **Engine tests (nodejs-native)** — §0 below. `{ target, cases: [{ given, expect }] }`. **This is what
   you author** — and run, in Node.
2. **`ScenarioSimulationModel` XML (jBPM-side)** — [model.md](model.md). The `.scesim` the SDK produces.

Everything here is tested in [`../../../bpmn-sdk/test/test-scenario.test.mjs`](../../../bpmn-sdk/test/test-scenario.test.mjs).

---

## 0. Engine tests — the simple form (what you write)
```jsonc
// an EngineProject holds: { "decisions": [ … ], "tests": [ <suite> ], "processes": [ … ] }
{
  "tests": [{
    "name": "Eligibility",
    "target": "Eligibility",       // the decision (or ruleset) under test, by name
    "cases": [
      { "given": { "amount": 250000, "region": "US" }, "expect": { "tier": "HIGH" } },
      { "given": { "amount": 3000,   "region": "US" }, "expect": { "tier": "STANDARD" } },
      { "given": { "amount": 0 },                       "expect": { "tier": "NONE" } }   // edge case
    ]
  }]
}
```
Each case **pins** the inputs (`given`) and asserts the outputs (`expect`). Generates
`src/test/resources/<name>.scesim` (jBPM runs it at `mvn test`).

### Complete field reference
```jsonc
{
  "name":   "Eligibility",      // required. suite name (+ default .scesim file name)
  "path":   "…/Eligibility.scesim", // optional. default src/test/resources/<name>.scesim
  "target": "Eligibility",      // required. the decision/ruleset under test (by name)
  "cases": [{
    "name":   "high value US",  // optional. case label
    "given":  { "amount": 250000, "region": "US" },  // input field -> pinned value
    "expect": { "tier": "HIGH" }                      // output field -> expected value
  }]
}
```
| Field | Meaning |
|-------|---------|
| `target` | the decision/ruleset the cases exercise (by name) |
| `cases[].given` | the inputs, pinned to fixed values (a GIVEN column per key) |
| `cases[].expect` | the expected outputs (an EXPECT column per key); only these fields are checked |

Pick cases to cover **each branch/rule + boundaries** (e.g. `amount` exactly at a threshold) — not the
infinite space of real values. The logic is deterministic, so a pinned case certifies its whole range.

### How a Node engine runs these (the real value)
The cases execute directly against any evaluator — the same reference evaluators the SDK ships:
[`../../../bpmn-sdk/examples/functions/test-scenario.mjs`](../../../bpmn-sdk/examples/functions/test-scenario.mjs)
- `runScenarios(cases, evaluate)` → `[{ name, pass, failures }]`, where `evaluate(given)` is e.g.
  `(g) => evaluateDecision(decision, g)` (DMN) or a rule-engine wrapper (DRL);
- `assertScenarios(cases, evaluate)` → throws on any failure (drop straight into a `node:test`).

So your `.scesim` cases *are* runnable Node tests — author once, run in CI in Node, and also emit the
jBPM `.scesim` for the Maven build.

---

The jBPM-side `.scesim` XML is in [model.json](model.json) / [model.md](model.md); the tested example is
`../../../bpmn-sdk/examples/`.
