# Test Scenario (new) — usage guide

**Author** `tests: [{ name, target, cases: [{ given, expect }] }]` on your `EngineProject`
([scenarios.md §0](scenarios.md)); `fromEngineProject` emits `src/test/resources/<name>.scesim` (jBPM
runs it at `mvn test`). **Run the cases in Node** with `examples/functions/test-scenario.mjs`
(`runScenarios(cases, evaluate)` / `assertScenarios(...)`) against the target's evaluator — this is your
Node test harness. Tests verify a decision/rule, not the process flow.

## 1. Details
Extension `.scesim`, SDK asset `kind: "testScenario"`. Given/expect tests for rules & DMN (`.scesim`).

## 2. Usage
Run by the Test Scenario runner at build/CI.

## 3. How / when to use
- Parse an existing file: `parseAsset("f.scesim", text)` → `{ kind:"testScenario", model:{ xml } }`.
- Edit/generate: walk & mutate `model.xml` (a generic element tree), or build one from scratch.
- Serialize: `buildAsset(asset)` → `.scesim` text; place in `descriptor.files` for `writeProject`.
- Author the canonical file once in Business Central to learn the shape, then generate variants.
