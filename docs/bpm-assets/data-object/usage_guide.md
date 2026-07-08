# Data Object (Java POJO) — usage guide

## 1. Details
Extension `.java`, SDK asset `kind: "dataObject"`. A fact/data type. Best-effort field model.

## 2. Usage
Referenced as a process-variable `type` (FQN) and as a rule fact.

## 3. How / when to use
- `parseAsset("Claim.java", src)` → `{ package, className, fields:[{name,type}] }`.
- `buildAsset` regenerates a POJO with getters/setters from the fields.
- Best-effort: methods/annotations aren't modeled — keep hand-written classes verbatim.
