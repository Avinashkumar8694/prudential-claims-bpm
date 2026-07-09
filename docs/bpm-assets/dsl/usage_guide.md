# DSL definition — usage guide

**Author** engine `dsl: [{ scope, nl, mapping }]` on your `EngineProject` ([scenarios.md §0](scenarios.md));
`fromEngineProject` emits `src/main/resources/dsl/definitions.dsl`. For engine-authored rules write DRL
directly via a ruleset (`../drl`); DSL is sugar for guided rules.

## 1. Details
Extension `.dsl`, SDK asset `kind: "dsl"`. Maps natural-language phrases to DRL (used by `.rdslr`).

## 2. Usage
Lets business users write rules in NL that expand to DRL.

## 3. How / when to use
`parseAsset("c.dsl", text)` → `{ entries: [{ scope, nl, mapping }] }`; `buildAsset` writes `[scope]nl=mapping`.
