# Generic XML asset — usage guide

## 1. Details
Extension `.xml`, SDK asset `kind: "xml"`. Any other XML asset not otherwise typed.

## 2. Usage
Carried structurally so you can edit/generate it.

## 3. How / when to use
- Parse an existing file: `parseAsset("f.xml", text)` → `{ kind:"xml", model:{ xml } }`.
- Edit/generate: walk & mutate `model.xml` (a generic element tree), or build one from scratch.
- Serialize: `buildAsset(asset)` → `.xml` text; place in `descriptor.files` for `writeProject`.
- Author the canonical file once in Business Central to learn the shape, then generate variants.
