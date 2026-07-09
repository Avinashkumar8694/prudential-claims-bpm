# Event Conditional — properties

**engine node `type: "catch"`** — Intermediate catch — waits for a timer/message/signal/conditional event.

## JSON schema (what you author)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineCatch",
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
      "const": "catch"
    },
    "event": {
      "type": "object",
      "description": "the event to wait for",
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
    "type",
    "event"
  ]
}
```

## Example
```json
{
  "type": "catch",
  "event": {
    "condition": "return flag != null && flag;",
    "lang": "java"
  }
}
```

> This is the **engine (nodejs) model** you author. `fromEngine` converts it to the jBPM node (see
> `node.json` for the produced jBPM model), `serializeProcess` emits BPMN, and `toEngine` recovers it.
> Every node type round-trips — see `../../../bpmn-sdk/test/engine-nodes.test.mjs`.
