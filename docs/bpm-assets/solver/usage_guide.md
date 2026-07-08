# Solver Configuration — usage guide

## 1. Details
Extension `*.solver.xml`, SDK asset `kind: "solver"`. An OptaPlanner solver config (solution/entity classes, score DRL, termination).

## 2. Usage
Used by OptaPlanner for optimization problems.

## 3. How / when to use
- Parse an existing file: `parseAsset("f*.solver.xml", text)` → `{ kind:"solver", model:{ xml } }`.
- Edit/generate: walk & mutate `model.xml` (a generic element tree), or build one from scratch.
- Serialize: `buildAsset(asset)` → `*.solver.xml` text; place in `descriptor.files` for `writeProject`.
- Author the canonical file once in Business Central to learn the shape, then generate variants.
