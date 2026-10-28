# Service Task Rest — properties

**engine node `type: "http"`** — A REST call (via the pru-rest-executor). SDK builds reqPayload / parses resPayload.

## JSON schema (what you author)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineHttp",
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
      "const": "http"
    },
    "method": {
      "enum": [
        "GET",
        "POST",
        "PUT",
        "DELETE",
        "PATCH",
        "HEAD",
        "OPTIONS"
      ],
      "default": "POST"
    },
    "url": {
      "type": "string",
      "description": "appended to #{baseUrl}"
    },
    "headers": {
      "type": "object",
      "additionalProperties": {
        "type": "string"
      }
    },
    "body": {
      "type": "object",
      "description": "constants or \"$var\" refs -> request payload"
    },
    "resultTo": {
      "type": "object",
      "additionalProperties": {
        "type": "string"
      },
      "description": "JSONPath-ish -> process var"
    }
  },
  "required": [
    "type",
    "url"
  ]
}
```

## Example
```json
{
  "id": "_status",
  "name": "Set claim status",
  "type": "http",
  "method": "POST",
  "url": "/v1/claims/status",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "status": "FOR_VERIFICATION",
    "caseId": "$caseId"
  },
  "resultTo": {
    "verifierId": "$.verifierId"
  }
}
```

> This is the **engine (nodejs) model** you author. `fromEngine` converts it to the jBPM node (see
> `node.json` for the produced jBPM model), `serializeProcess` emits BPMN, and `toEngine` recovers it.
> Every node type round-trips — see `../../../bpmn-sdk/test/engine-nodes.test.mjs`.
