# Transaction Sub-Process — properties

| Property | XML | Notes |
|----------|-----|-------|
| id / name | attrs | emitted as `<bpmn2:transaction>` |
| nodes / flows (SDK) | children | recursive |
| cancel boundary | `boundaryEvent` + `cancelEventDefinition` | rollback trigger |

## SDK
`{ "type":"subProcess", "subtype":"transaction", "nodes":[…], "flows":[…] }`
