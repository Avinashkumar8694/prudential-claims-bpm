# Start Event None — properties

**engine node `type: "start"`** — Begins a process instance. Omit `on` for a none-start; set `on.signal/message/timer/condition` for a triggered start.

## JSON schema (what you author)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineStart",
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
      "const": "start"
    },
    "on": {
      "type": "object",
      "description": "optional trigger; omit for a plain (none) start",
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
  "id": "_start",
  "name": "Claim started",
  "type": "start"
}
```

> This is the **engine (nodejs) model** you author. `fromEngine` converts it to the jBPM node (see
> `node.json` for the produced jBPM model), `serializeProcess` emits BPMN, and `toEngine` recovers it.
> Every node type round-trips — see `../../../bpmn-sdk/test/engine-nodes.test.mjs`.
