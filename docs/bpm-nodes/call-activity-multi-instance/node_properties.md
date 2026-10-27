# Call Activity Multi Instance — properties

**engine node `type: "forEach"`** — Multi-instance call activity: runs the child once per item in `over`.

## JSON schema (what you author)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineForEach",
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
      "const": "forEach"
    },
    "process": {
      "type": "string"
    },
    "over": {
      "type": "string",
      "description": "collection variable to iterate"
    },
    "as": {
      "type": "string",
      "description": "per-item variable"
    },
    "collectInto": {
      "type": "string"
    },
    "itemResult": {
      "type": "string"
    },
    "parallel": {
      "type": "boolean",
      "description": "true = parallel MI, false = sequential"
    },
    "pass": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "type",
    "process",
    "over"
  ]
}
```

## Example
```json
{
  "id": "_perPolicy",
  "name": "Assess each policy",
  "type": "forEach",
  "process": "com.acme.assess",
  "over": "applicablePolicies",
  "as": "currentPolicy",
  "collectInto": "claimResults",
  "itemResult": "claimResult",
  "parallel": true,
  "pass": [
    "caseId",
    "claimId"
  ]
}
```

> This is the **engine (nodejs) model** you author. `fromEngine` converts it to the jBPM node (see
> `node.json` for the produced jBPM model), `serializeProcess` emits BPMN, and `toEngine` recovers it.
> Every node type round-trips — see `../../../bpmn-sdk/test/engine-nodes.test.mjs`.
