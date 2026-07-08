# DMN Decision — usage guide

## 1. Details
Extension `.dmn`, SDK asset `kind: "dmn"`. A DMN 1.2 decision model. Two representations, like DRL:
- **Engine decision table** (nodejs-native) — columns (`inputs`/`outputs`) + rows (`rules` with
  `when`/`then`). No FEEL, no XML. **This is what you author.** See **[scenarios.md §0](scenarios.md)**.
- **DMN XML tree** (jBPM-side) — the lossless `{ xml: ElementNode }` the SDK produces, and the escape
  hatch for hand-authored DMN (DRD, boxed expressions, contexts). See **[model.md](model.md)**.

## 2. Usage
Invoked by a `businessRuleTask` (DMN implementation + Namespace/Model/Decision metadata) — an engine
`rule` node with `dmn: { namespace, model, decision }` (see `../../bpm-nodes/business-rule-task/`).

## 3. How / when to use
**Author the engine decision table** (recommended): put `decisions: [{ name, decisions:[{ name,
hitPolicy?, inputs, outputs, rules }] }]` on your `EngineProject`; `fromEngineProject` runs
`decisionToDmn` to synthesize the DMN file (FEEL cells, typeRefs, inputData/decisionTable, hitPolicy,
namespace) and write it into the kjar. Helpers: `decisionToDmn(model)`, `feelTest`, `feelResult`.

- `parseAsset("f.dmn", text)` → `{ kind:"dmn", model:{ xml } }` (round-trip stable).
- `buildAsset({ kind:"dmn", model:{ xml } })` → `.dmn` text. Drop to this XML-tree form only for DMN
  features the table doesn't express.

## 4. Tested
`../../../bpmn-sdk/test/dmn.test.mjs` (every FEEL mapping, hit policies, round-trip, xmllint) and
`../../../bpmn-sdk/test/dmn-runtime.test.mjs` (the reference evaluator). Examples:
`../../../bpmn-sdk/examples/decisions/`.
