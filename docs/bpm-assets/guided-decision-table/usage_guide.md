# Guided Decision Table — usage guide

## 1. Details
Extension `.gdst`, SDK asset `kind: "guidedDecisionTable"`. Rules authored as a table (conditions →
actions per row); a Business Central editor format that **compiles to DRL**. Two representations:
- **Engine guided table** (nodejs-native) — a tabular ruleset: `fact`, `conditions`, `actions`, `rows`.
  **This is what you author.** See **[scenarios.md §0](scenarios.md)**.
- **`decision-table52` XML tree** (jBPM-side) — the lossless `{ xml }` the SDK produces. See **[model.md](model.md)**.

## 2. Usage
Compiled to rules at build; fired like a DRL ruleset (a `ruleflow-group` a `rule` node targets).
Because it compiles to DRL, the same logic is also expressible as a DRL ruleset (`../drl`) or DMN
table (`../dmn`) — those are the *executable* targets; use a guided table for a Business-Central-editable one.

## 3. How / when to use
**Author the engine table** (recommended): put `guidedTables: [{ name, fact, conditions, actions,
rows }]` on your `EngineProject`. `fromEngineProject` runs `decisionTableToGdst` to synthesize the
`decision-table52` (EXTENDED_ENTRY) XML — condition/action columns, operator/type mappings, per-row
`<data>` cells — and writes it into the kjar (default `<pkg>/<name>.gdst`).

- `parseAsset("f.gdst", text)` → `{ kind:"guidedDecisionTable", model:{ xml } }` (round-trip stable).
- `buildAsset({ kind:"guidedDecisionTable", model:{ xml } })` → `.gdst`. Use the XML-tree form only
  for a guided table carried verbatim.
- **Runtime**: `../../../bpmn-sdk/examples/functions/guided-table.mjs` —
  `evaluateGuidedTable(table, fact)` (match rows, apply set-actions; later matching row overrides).

> The SDK verifies the XML is well-formed, not that Business Central will load it.

## 4. Tested
`../../../bpmn-sdk/test/guided-table.test.mjs` (columns, operators, types, rows, round-trip, xmllint,
generation) + `../../../bpmn-sdk/test/guided-table-runtime.test.mjs`. Example: `../../../bpmn-sdk/examples/guided/`.
