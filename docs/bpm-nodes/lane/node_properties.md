# Lane — properties

**lane** — A swimlane grouping nodes by role. Lives on EngineProcess.lanes[].

## JSON schema (what you author)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineLane (EngineProcess.lanes[])",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "nodes": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "node ids in this lane"
    }
  },
  "required": [
    "name",
    "nodes"
  ]
}
```

## Example
```json
{
  "process-level": true,
  "lanes": [
    {
      "name": "Ops",
      "nodes": [
        "_pg",
        "_br"
      ]
    }
  ]
}
```

> This is the **engine (nodejs) model** you author. `fromEngine` converts it to the jBPM node (see
> `node.json` for the produced jBPM model), `serializeProcess` emits BPMN, and `toEngine` recovers it.
> Every node type round-trips — see `../../../bpmn-sdk/test/engine-nodes.test.mjs`.
