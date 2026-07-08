# DMN Decision — usage guide

## 1. Details
Extension `.dmn`, SDK asset `kind: "dmn"`. A DMN decision model (inputs → decisions via boxed expressions).

## 2. Usage
Invoked by a `businessRuleTask` (DMN implementation + namespace/model/decision).

## 3. How / when to use
- Parse an existing file: `parseAsset("f.dmn", text)` → `{ kind:"dmn", model:{ xml } }`.
- Edit/generate: walk & mutate `model.xml` (a generic element tree), or build one from scratch.
- Serialize: `buildAsset(asset)` → `.dmn` text; place in `descriptor.files` for `writeProject`.
- Author the canonical file once in Business Central to learn the shape, then generate variants.
