# Guided Decision Table — usage guide

## 1. Details
Extension `.gdst`, SDK asset `kind: "guidedDecisionTable"`. Rules authored as a table (conditions → actions per row).

## 2. Usage
Compiled to rules at build; fired like DRL rules.

## 3. How / when to use
- Parse an existing file: `parseAsset("f.gdst", text)` → `{ kind:"guidedDecisionTable", model:{ xml } }`.
- Edit/generate: walk & mutate `model.xml` (a generic element tree), or build one from scratch.
- Serialize: `buildAsset(asset)` → `.gdst` text; place in `descriptor.files` for `writeProject`.
- Author the canonical file once in Business Central to learn the shape, then generate variants.
