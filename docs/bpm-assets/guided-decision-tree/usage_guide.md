# Guided Decision Tree — usage guide

**Author** an engine tree `decisionTrees: [{ name, fact, root:{ field, branches } }]` on your
`EngineProject` ([scenarios.md §0](scenarios.md)); `fromEngineProject` generates the `.gdt`. Execute it
at runtime with `examples/functions/decision-tree.mjs` (`evaluateDecisionTree`). The `.gdt` XML is
best-effort (well-formed only); it compiles to DRL, so a DRL ruleset (`../drl`) is the guaranteed-
executable alternative.

## 1. Details
Extension `.gdt`, SDK asset `kind: "guidedDecisionTree"`. Rules authored as a decision tree.

## 2. Usage
Compiled to rules at build.

## 3. How / when to use
- Parse an existing file: `parseAsset("f.gdt", text)` → `{ kind:"guidedDecisionTree", model:{ xml } }`.
- Edit/generate: walk & mutate `model.xml` (a generic element tree), or build one from scratch.
- Serialize: `buildAsset(asset)` → `.gdt` text; place in `descriptor.files` for `writeProject`.
- Author the canonical file once in Business Central to learn the shape, then generate variants.
