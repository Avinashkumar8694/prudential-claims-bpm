# Sequence Flow — properties

**sequence flow** — A sequence flow connecting two nodes; `when`+`lang` make it a conditional (gateway) branch.

## JSON schema (what you author)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineFlow (EngineProcess.flows[])",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string"
    },
    "from": {
      "type": "string"
    },
    "to": {
      "type": "string"
    },
    "when": {
      "type": "string",
      "description": "condition expression (on a gateway branch)"
    },
    "lang": {
      "enum": [
        "js",
        "java",
        "mvel"
      ],
      "description": "script/expression dialect"
    }
  },
  "required": [
    "from",
    "to"
  ]
}
```

## Example
```json
{
  "from": "_xg",
  "to": "_calc",
  "when": "return \"DEATH\".equals(claimType);",
  "lang": "java"
}
```

> This is the **engine (nodejs) model** you author. `fromEngine` converts it to the jBPM node (see
> `node.json` for the produced jBPM model), `serializeProcess` emits BPMN, and `toEngine` recovers it.
> Every node type round-trips — see `../../../bpmn-sdk/test/engine-nodes.test.mjs`.
