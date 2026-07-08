# Test Scenario (legacy) — usage guide

## 1. Details
Extension `.scenario`, SDK asset `kind: "testScenarioLegacy"`. Legacy test scenarios (`.scenario`).

## 2. Usage
Run by the legacy scenario runner.

## 3. How / when to use
- Parse an existing file: `parseAsset("f.scenario", text)` → `{ kind:"testScenarioLegacy", model:{ xml } }`.
- Edit/generate: walk & mutate `model.xml` (a generic element tree), or build one from scratch.
- Serialize: `buildAsset(asset)` → `.scenario` text; place in `descriptor.files` for `writeProject`.
- Author the canonical file once in Business Central to learn the shape, then generate variants.
