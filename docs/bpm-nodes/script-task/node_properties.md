# Script Task — properties

**engine node `type: "script"`** — Runs inline code (`kcontext` API). `lang` js|java|mvel.

## JSON schema (what you author)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineScript",
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
      "const": "script"
    },
    "lang": {
      "enum": [
        "js",
        "java",
        "mvel"
      ],
      "description": "script/expression dialect",
      "default": "java"
    },
    "code": {
      "type": "string"
    }
  },
  "required": [
    "type",
    "code"
  ]
}
```

## Example
```json
{
  "id": "_boot",
  "name": "Bootstrap base URL",
  "type": "script",
  "lang": "java",
  "code": "String u = System.getProperty(\"INTEGRATION_LAYER_URL\");\nif (u == null || u.isEmpty()) u = \"http://localhost:3000\";\nkcontext.setVariable(\"baseUrl\", u);"
}
```

> This is the **engine (nodejs) model** you author. `fromEngine` converts it to the jBPM node (see
> `node.json` for the produced jBPM model), `serializeProcess` emits BPMN, and `toEngine` recovers it.
> Every node type round-trips — see `../../../bpmn-sdk/test/engine-nodes.test.mjs`.
