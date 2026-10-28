# Guided Rule Template — usage guide

**Author** `guidedRuleTemplates: [{ name, when, then, rows }]` on your `EngineProject`
([scenarios.md §0](scenarios.md)) — a rule skeleton with `{param}` values + rows; `fromEngineProject`
generates the `.template`. Execute it by expanding (`examples/functions/rule-template.mjs`
`expandTemplate` → the rule engine). The `.template` XML is best-effort; a DMN/guided decision table
(`../dmn`, `../guided-decision-table`) or DRL ruleset (`../drl`) is the guaranteed-executable path.

## 1. Details
Extension `.template`, SDK asset `kind: "guidedRuleTemplate"`. A guided rule with placeholders (`@{param}`) + a data table; generates many rules.

## 2. Usage
One template row → one rule at build.

## 3. How / when to use
- Parse an existing file: `parseAsset("f.template", text)` → `{ kind:"guidedRuleTemplate", model:{ xml } }`.
- Edit/generate: walk & mutate `model.xml` (a generic element tree), or build one from scratch.
- Serialize: `buildAsset(asset)` → `.template` text; place in `descriptor.files` for `writeProject`.
- Author the canonical file once in Business Central to learn the shape, then generate variants.
