# Guided Score Card — usage guide

**Author** `scorecards: [{ fact, score, baseline?, characteristics }]` on your `EngineProject`
([scenarios.md §0](scenarios.md)); `fromEngineProject` generates the `.scgd`. Score at runtime with
`examples/functions/scorecard.mjs` (`evaluateScorecard` → baseline + matched bins → the score field).
The `.scgd` XML is best-effort; a DRL ruleset (a rule per bin adding to the score) is the guaranteed-
executable path.

## 1. Details
Extension `.scgd`, SDK asset `kind: "scoreCard"`. An additive scoring model (characteristics/attributes → partial scores).

## 2. Usage
Writes a numeric field (e.g. `riskScore`).

## 3. How / when to use
- Parse an existing file: `parseAsset("f.scgd", text)` → `{ kind:"scoreCard", model:{ xml } }`.
- Edit/generate: walk & mutate `model.xml` (a generic element tree), or build one from scratch.
- Serialize: `buildAsset(asset)` → `.scgd` text; place in `descriptor.files` for `writeProject`.
- Author the canonical file once in Business Central to learn the shape, then generate variants.
