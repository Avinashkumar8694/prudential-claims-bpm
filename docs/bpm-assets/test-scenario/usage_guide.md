# Test Scenario (new) — usage guide

## 1. Details
Extension `.scesim`, SDK asset `kind: "testScenario"`. Given/expect tests for rules & DMN (`.scesim`).

## 2. Usage
Run by the Test Scenario runner at build/CI.

## 3. How / when to use
- Parse an existing file: `parseAsset("f.scesim", text)` → `{ kind:"testScenario", model:{ xml } }`.
- Edit/generate: walk & mutate `model.xml` (a generic element tree), or build one from scratch.
- Serialize: `buildAsset(asset)` → `.scesim` text; place in `descriptor.files` for `writeProject`.
- Author the canonical file once in Business Central to learn the shape, then generate variants.
