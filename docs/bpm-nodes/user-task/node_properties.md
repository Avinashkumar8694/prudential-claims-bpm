# User Task — properties

**engine node `type: "userTask"`** — Human task; assigned to a group or user, optionally bound to a form.

## JSON schema (what you author)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineUserTask",
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
      "const": "userTask"
    },
    "group": {
      "type": "string",
      "description": "owning role/queue"
    },
    "assignee": {
      "type": "string",
      "description": "specific user (alt to group)"
    },
    "form": {
      "type": "string",
      "description": "form name (TaskName)"
    },
    "skippable": {
      "type": "boolean",
      "default": true
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
  "id": "_review",
  "name": "Review claim",
  "type": "userTask",
  "group": "Verifier",
  "form": "review",
  "skippable": false
}
```

> This is the **engine (nodejs) model** you author. `fromEngine` converts it to the jBPM node (see
> `node.json` for the produced jBPM model), `serializeProcess` emits BPMN, and `toEngine` recovers it.
> Every node type round-trips — see `../../../bpmn-sdk/test/engine-nodes.test.mjs`.
