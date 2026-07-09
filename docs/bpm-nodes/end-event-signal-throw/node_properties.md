# End Event Signal Throw — properties

**engine node `type: "end"`** — Ends a path. `result:"terminate"` kills the whole instance; `throw` raises a signal/error/escalation/message.

## JSON schema (what you author)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineEnd",
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
      "const": "end"
    },
    "result": {
      "const": "terminate",
      "description": "terminate the whole instance"
    },
    "throw": {
      "type": "object",
      "description": "throw signal/error/escalation/message on end",
      "properties": {
        "signal": {
          "type": "string"
        },
        "message": {
          "type": "string"
        },
        "error": {
          "type": "string"
        },
        "escalation": {
          "type": "string"
        },
        "condition": {
          "type": "string"
        },
        "lang": {
          "enum": [
            "js",
            "java",
            "mvel"
          ],
          "description": "script/expression dialect"
        },
        "timer": {
          "type": [
            "object",
            "string"
          ],
          "description": "ISO-8601 duration/date or a cycle",
          "properties": {
            "duration": {
              "type": "string"
            },
            "cycle": {
              "type": "string"
            },
            "date": {
              "type": "string"
            }
          }
        }
      }
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
  "id": "_end",
  "name": "Trigger payment",
  "type": "end",
  "throw": {
    "signal": "PaymentProcess"
  }
}
```

> This is the **engine (nodejs) model** you author. `fromEngine` converts it to the jBPM node (see
> `node.json` for the produced jBPM model), `serializeProcess` emits BPMN, and `toEngine` recovers it.
> Every node type round-trips — see `../../../bpmn-sdk/test/engine-nodes.test.mjs`.
