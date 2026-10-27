# Guided Rule — usage guide

**Author** `guidedRules: [{ name, when, then }]` on your `EngineProject`
([scenarios.md §0](scenarios.md)) — the same `when`/`then` as a DRL ruleset rule; `fromEngineProject`
generates the `.rdrl`. Execute it at runtime with the existing rule engine
(`examples/functions/rule-engine.mjs`, wrapped as a one-rule ruleset). The `.rdrl` XML is best-effort;
a DRL ruleset (`../drl`) is the guaranteed-executable alternative.

## 1. Details
Extension `.rdrl`, SDK asset `kind: "guidedRule"`. A single rule authored in BC's guided editor.

## 2. Usage
Same runtime effect as a DRL rule.

## 3. How / when to use
- Parse an existing file: `parseAsset("f.rdrl", text)` → `{ kind:"guidedRule", model:{ xml } }`.
- Edit/generate: walk & mutate `model.xml` (a generic element tree), or build one from scratch.
- Serialize: `buildAsset(asset)` → `.rdrl` text; place in `descriptor.files` for `writeProject`.
- Author the canonical file once in Business Central to learn the shape, then generate variants.
