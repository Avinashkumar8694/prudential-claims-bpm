# Guided Rule — usage guide

## 1. Details
Extension `.rdrl`, SDK asset `kind: "guidedRule"`. A single rule authored in BC's guided editor.

## 2. Usage
Same runtime effect as a DRL rule.

## 3. How / when to use
- Parse an existing file: `parseAsset("f.rdrl", text)` → `{ kind:"guidedRule", model:{ xml } }`.
- Edit/generate: walk & mutate `model.xml` (a generic element tree), or build one from scratch.
- Serialize: `buildAsset(asset)` → `.rdrl` text; place in `descriptor.files` for `writeProject`.
- Author the canonical file once in Business Central to learn the shape, then generate variants.
