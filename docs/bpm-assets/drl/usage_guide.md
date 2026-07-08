# DRL rules — usage guide

## 1. Details
Extension `.drl`, SDK asset `kind: "drl"`. Drools rules (`when … then …`). Best-effort structured
model (package, imports, globals, rules).

## 2. Usage
Fired by a `businessRuleTask` whose `ruleFlowGroup` matches a rule's `ruleflow-group`.

## 3. How / when to use
- `parseAsset("x.drl", text)` → `{ kind:"drl", model:{ package, imports, globals, rules } }`.
- Generate rules from your engine's model; `buildAsset` writes valid DRL.
- Best-effort: complex LHS (accumulate/eval) may not fully model — keep those verbatim.
