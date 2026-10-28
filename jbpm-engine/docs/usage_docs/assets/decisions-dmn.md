# DMN Decisions

**Key**: `decisions` · **Name field**: `name` · **Exports as**: `.dmn` · **Used by**: [Business Rule](../nodes/rule.md)'s `dmn.model`

## Purpose

A DMN decision table — inputs, outputs, and rules — authored without writing FEEL or DMN XML by hand;
the SDK synthesizes real DMN 1.2 XML on export.

## Shape

```json
{
  "name": "Eligibility", "namespace": "https://kie.org/dmn/eligibility",
  "decisions": [{ "name": "Eligibility", "hitPolicy": "UNIQUE", "inputs": [], "outputs": [], "rules": [] }]
}
```

Per decision:

| Property | Notes |
|---|---|
| `hitPolicy` | `UNIQUE`, `FIRST`, `ANY`, `PRIORITY`, `COLLECT`, `RULE ORDER`, `OUTPUT ORDER` |
| `aggregation` | Only with `hitPolicy: 'COLLECT'` — `SUM`/`MIN`/`MAX`/`COUNT` |
| `inputs` / `outputs` | `{ name, type? }` — `type` is a FEEL type: `number`/`string`/`boolean`/`date`/`time`/`dateTime`/`any` |
| `rules` | `{ when: { <inputName>: InputTest }, then: { <outputName>: OutputResult } }` |

An `InputTest` cell (no FEEL syntax needed): a literal (equals; `'-'` = any), an array (in-list),
`{gt}`/`{gte}`/`{lt}`/`{lte}`, `{between: [a,b]}`, `{in: [...]}`, `{not: ...}`, `{any: true}`, or a raw
`{feel: '...'}` escape hatch for anything the structured form can't express.

## Wiring to a Business Rule task

`dmn.namespace` + `dmn.model` name this asset; `dmn.decision` picks which decision inside the model —
blank defaults to the model's first decision (the real jBPM/PAM convention, since a `businessRuleTask`
passes namespace/model as literal values with no separate "decision" input).

## Example

```json
{
  "name": "Eligibility", "namespace": "https://acme/dmn",
  "decisions": [{
    "name": "Eligibility", "hitPolicy": "UNIQUE",
    "inputs": [{ "name": "amount", "type": "number" }],
    "outputs": [{ "name": "approved", "type": "boolean" }],
    "rules": [
      { "when": { "amount": { "gt": 1000 } }, "then": { "approved": true } },
      { "when": { "amount": "-" }, "then": { "approved": false } }
    ]
  }]
}
```

## Gotchas

- Only `decisionTable`-driven decisions evaluate at runtime — this asset kind IS a decision table by
  construction, so anything authored here always runs. The limitation only bites when **importing** a
  real jBPM `.dmn` file that uses `literalExpression`/Business Knowledge Models instead — see
  [Importing real jBPM](../11-importing-and-exporting-jbpm.md).
- A round-tripped decision (imported, then re-exported) is byte-identical XML — verified directly, not
  just "looks the same."
