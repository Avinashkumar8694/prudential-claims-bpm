# Data Object — properties

**data object** — A process data object (typed scratch variable). Lives on EngineProcess.data[].

## JSON schema (what you author)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineData (EngineProcess.data[])",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "type": {
      "type": "string",
      "description": "primitive or a declared type name"
    },
    "collection": {
      "type": "boolean"
    }
  },
  "required": [
    "name"
  ]
}
```

## Example
```json
{
  "process-level": true,
  "data": [
    {
      "name": "Document",
      "type": "object",
      "collection": false
    }
  ]
}
```

> This is the **engine (nodejs) model** you author. `fromEngine` converts it to the jBPM node (see
> `node.json` for the produced jBPM model), `serializeProcess` emits BPMN, and `toEngine` recovers it.
> Every node type round-trips — see `../../../bpmn-sdk/test/engine-nodes.test.mjs`.
