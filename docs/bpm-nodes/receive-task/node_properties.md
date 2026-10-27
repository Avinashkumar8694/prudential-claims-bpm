# Receive Task — properties

**engine node `type: "receive"`** — Waits for a message.

## JSON schema (what you author)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineReceive",
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
      "const": "receive"
    },
    "message": {
      "type": "string"
    },
    "implementation": {
      "type": "string"
    }
  },
  "required": [
    "type",
    "message"
  ]
}
```

## Example
```json
{
  "id": "_await",
  "name": "Await acknowledgement",
  "type": "receive",
  "message": "Ack",
  "implementation": "##WebService"
}
```

> This is the **engine (nodejs) model** you author. `fromEngine` converts it to the jBPM node (see
> `node.json` for the produced jBPM model), `serializeProcess` emits BPMN, and `toEngine` recovers it.
> Every node type round-trips — see `../../../bpmn-sdk/test/engine-nodes.test.mjs`.
