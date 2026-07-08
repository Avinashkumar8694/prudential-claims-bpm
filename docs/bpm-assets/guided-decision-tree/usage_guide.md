# Guided Decision Tree — usage guide

## 1. Details
Extension `.gdt`, SDK asset `kind: "guidedDecisionTree"`. Rules authored as a decision tree.

## 2. Usage
Compiled to rules at build.

## 3. How / when to use
- Parse an existing file: `parseAsset("f.gdt", text)` → `{ kind:"guidedDecisionTree", model:{ xml } }`.
- Edit/generate: walk & mutate `model.xml` (a generic element tree), or build one from scratch.
- Serialize: `buildAsset(asset)` → `.gdt` text; place in `descriptor.files` for `writeProject`.
- Author the canonical file once in Business Central to learn the shape, then generate variants.
