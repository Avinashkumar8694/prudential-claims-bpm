# Boundary Event Error — properties

**engine node `type: "boundary"`** — Boundary event on a task/subprocess (error/timer/message/signal/conditional/escalation). Interrupting cancels the host.

## JSON schema (what you author)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineBoundary",
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
      "const": "boundary"
    },
    "on": {
      "type": "string",
      "description": "host node id the event attaches to"
    },
    "event": {
      "type": "object",
      "description": "exactly one trigger kind",
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
    },
    "interrupting": {
      "type": "boolean",
      "default": true
    }
  },
  "required": [
    "type",
    "on",
    "event"
  ]
}
```

## Example
```json
{
  "type": "boundary",
  "on": "_validate",
  "event": {
    "error": "CALL_ERR"
  },
  "interrupting": true
}
```

> This is the **engine (nodejs) model** you author. `fromEngine` converts it to the jBPM node (see
> `node.json` for the produced jBPM model), `serializeProcess` emits BPMN, and `toEngine` recovers it.
> Every node type round-trips — see `../../../bpmn-sdk/test/engine-nodes.test.mjs`.
