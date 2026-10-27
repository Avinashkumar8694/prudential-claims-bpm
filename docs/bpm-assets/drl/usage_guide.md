# DRL rules — usage guide

## 1. Details
Extension `.drl`, SDK asset `kind: "drl"`. Drools Rule Language: a file of `package` / `import` /
`global` / `function` / `declare` / `query` / `rule "…" when … then … end`. **Every** DRL construct is
representable in the engine JSON model — structurally (so a Node engine can execute it) or via a `raw`
escape hatch — and compiles to valid DRL text. See **[scenarios.md](scenarios.md)** for the full,
tested catalogue (one example per construct) and **[model.md](model.md)** for the type reference.

## 2. Usage
Fired by a `businessRuleTask` whose `ruleFlowGroup` matches a rule's `ruleflow-group` (see
`../../bpm-nodes/business-rule-task/` and `../../bpm-project/rules-drl-and-dmn.md`).

## 3. How / when to use
**Author the simple engine ruleset** (recommended) — see [scenarios.md §0](scenarios.md). Put
`rulesets: [{ group, rules:[{ name, when:[{fact,as,where}], then:[{set|insert|delete|call}] }] }]` on
your `EngineProject`; `fromEngineProject` calls `rulesToDrl` to synthesize package, imports (fact
names → FQNs from `types`), `ruleflow-group`, and DRL syntax, and writes the `.drl` into the kjar. No
jBPM concepts in your JSON. Drop to the jBPM-side `DrlModel` (below) only for features the simple form
doesn't cover.

- `parseAsset("x.drl", text)` → `{ kind:"drl", model }` (structured rules; functions/declares/queries
  captured as raw blocks — round-trip stable).
- `buildAsset({ kind:"drl", model })` → valid DRL text. `when`/`then` may be raw strings **or**
  structured (`LhsElement[]` / `RuleAction[]`) — both compile identically.
- Helpers: `compileConstraint`, `compilePattern`, `compileLhs`, `compileAction`, `compileFunction`,
  `compileDeclare`, `compileQuery` (all exported) turn a single node of the model into its DRL text.
- Anything the structured model can't express, drop into a `{ raw: "…" }` at that level.

## 4. Tested
`../../../bpmn-sdk/test/drl.test.mjs` exercises every scenario in `scenarios.md` (constraints, patterns,
conditional elements, RHS actions, attributes, functions/declares/queries, parse + round-trip).
