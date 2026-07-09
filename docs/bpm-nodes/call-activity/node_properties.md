# Call Activity — properties

**engine node `type: "call"`** — Calls a reusable sub-process; maps inputs/outputs to process variables.

## JSON schema (what you author)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineCall",
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
      "const": "call"
    },
    "process": {
      "type": "string",
      "description": "called process id"
    },
    "inputs": {
      "type": "object"
    },
    "outputs": {
      "type": "object"
    }
  },
  "required": [
    "type",
    "process"
  ]
}
```

## Example
```json
{
  "id": "_child",
  "name": "Run sub-claim",
  "type": "call",
  "process": "com.acme.child",
  "inputs": {
    "caseId": "$caseId"
  },
  "outputs": {
    "result": "result"
  }
}
```

> This is the **engine (nodejs) model** you author. `fromEngine` converts it to the jBPM node (see
> `node.json` for the produced jBPM model), `serializeProcess` emits BPMN, and `toEngine` recovers it.
> Every node type round-trips — see `../../../bpmn-sdk/test/engine-nodes.test.mjs`.
