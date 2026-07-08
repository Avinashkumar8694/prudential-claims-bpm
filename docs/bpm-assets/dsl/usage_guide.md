# DSL definition — usage guide

## 1. Details
Extension `.dsl`, SDK asset `kind: "dsl"`. Maps natural-language phrases to DRL (used by `.rdslr`).

## 2. Usage
Lets business users write rules in NL that expand to DRL.

## 3. How / when to use
`parseAsset("c.dsl", text)` → `{ entries: [{ scope, nl, mapping }] }`; `buildAsset` writes `[scope]nl=mapping`.
