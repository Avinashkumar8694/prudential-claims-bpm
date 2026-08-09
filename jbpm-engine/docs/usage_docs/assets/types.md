# Data Types

**Key**: `types` · **Name field**: `name` · **Exports as**: `.java` (a POJO)

## Purpose

A named fact/data-object shape — a reusable structure referenced by process variables, forms, and
rules, instead of every one of them redeclaring the same fields independently. This engine's
equivalent of a Business Central "Data Object."

## Shape

```json
{ "name": "Claim", "fields": [] }
```

Each field: `{ name, type }` — `type` can be a primitive (`String`, `Integer`, `Boolean`, `Double`,
`Date`, …) or another data type's name, for nested structures.

## Example

```json
{
  "name": "Claim",
  "fields": [
    { "name": "claimId", "type": "String" },
    { "name": "amount", "type": "Double" },
    { "name": "status", "type": "String" },
    { "name": "policy", "type": "Policy" }
  ]
}
```

## Wiring

A process variable's declared `type` can reference a data type's `name` (structured object variable,
not just a primitive) — [Script tasks](../nodes/script.md)' Java dialect and
[DRL rules](rulesets-drl.md) both bind declared variables using this type information.

## Gotchas

- This engine's own runtime is largely structurally-typed at the JSON level — declaring a type here
  primarily matters for **export accuracy** (a real `.java` POJO on the KIE-server side) and for
  giving [DRL](rulesets-drl.md)/[DMN](decisions-dmn.md) authors something concrete to reference by
  field name, not a hard runtime schema enforcement layer.
