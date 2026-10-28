# Event Subprocess — properties

**engine node `type: "subprocess"`** — Embedded/transaction/event sub-process containing its own nodes + flows.

## JSON schema (what you author)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineSubprocess",
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
      "const": "subprocess"
    },
    "transaction": {
      "type": "boolean"
    },
    "on": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      },
      "description": "error -> event sub-process"
    },
    "nodes": {
      "type": "array",
      "description": "child EngineNode[]"
    },
    "flows": {
      "type": "array",
      "description": "child EngineFlow[]"
    }
  },
  "required": [
    "type",
    "nodes",
    "flows"
  ]
}
```

## Example
```json
{
  "id": "_handler",
  "name": "On terminate",
  "type": "subprocess",
  "on": {
    "error": "TERMINATE_CASE"
  },
  "nodes": [
    {
      "id": "h_s",
      "type": "start"
    },
    {
      "id": "h_log",
      "type": "script",
      "lang": "java",
      "code": "System.out.println(\"cleanup\");"
    },
    {
      "id": "h_e",
      "type": "end"
    }
  ],
  "flows": [
    {
      "from": "h_s",
      "to": "h_log"
    },
    {
      "from": "h_log",
      "to": "h_e"
    }
  ]
}
```

> This is the **engine (nodejs) model** you author. `fromEngine` converts it to the jBPM node (see
> `node.json` for the produced jBPM model), `serializeProcess` emits BPMN, and `toEngine` recovers it.
> Every node type round-trips — see `../../../bpmn-sdk/test/engine-nodes.test.mjs`.
