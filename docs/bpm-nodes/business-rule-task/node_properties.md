# Business Rule Task — properties

**engine node `type: "rule"`** — Business rule task: fires a DRL ruleflow-group OR evaluates a DMN decision.

## JSON schema (what you author)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineRule",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "description": "optional; autowired from flows if omitted"
    },
    "name": {
      "type": "string"
    },
    "type": {
      "const": "rule"
    },
    "ruleflowGroup": {
      "type": "string",
      "description": "fires a DRL ruleflow-group"
    },
    "dmn": {
      "type": "object",
      "properties": {
        "namespace": {
          "type": "string"
        },
        "model": {
          "type": "string"
        },
        "decision": {
          "type": "string"
        }
      },
      "required": [
        "namespace",
        "model",
        "decision"
      ],
      "description": "evaluate a DMN decision instead"
    }
  },
  "required": [
    "type"
  ]
}
```

## Example
```json
{
  "id": "_classify",
  "name": "Classify claim",
  "type": "rule",
  "ruleflowGroup": "classify"
}
```

> This is the **engine (nodejs) model** you author. `fromEngine` converts it to the jBPM node (see
> `node.json` for the produced jBPM model), `serializeProcess` emits BPMN, and `toEngine` recovers it.
> Every node type round-trips — see `../../../bpmn-sdk/test/engine-nodes.test.mjs`.
