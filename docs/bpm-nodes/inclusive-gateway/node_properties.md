# Inclusive Gateway — properties

**engine node `type: "gateway"`** — Branch/merge. exclusive=one path, parallel=all, inclusive=all-matching, event=wait-for-event, complex=custom.

## JSON schema (what you author)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineGateway",
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
      "const": "gateway"
    },
    "mode": {
      "enum": [
        "exclusive",
        "parallel",
        "inclusive",
        "event",
        "complex"
      ]
    },
    "default": {
      "type": "string",
      "description": "flow id taken when no condition matches (exclusive/inclusive)"
    },
    "direction": {
      "enum": [
        "Diverging",
        "Converging"
      ]
    }
  },
  "required": [
    "type",
    "mode"
  ]
}
```

## Example
```json
{
  "type": "gateway",
  "mode": "inclusive",
  "default": "fDefault"
}
```

> This is the **engine (nodejs) model** you author. `fromEngine` converts it to the jBPM node (see
> `node.json` for the produced jBPM model), `serializeProcess` emits BPMN, and `toEngine` recovers it.
> Every node type round-trips — see `../../../bpmn-sdk/test/engine-nodes.test.mjs`.
