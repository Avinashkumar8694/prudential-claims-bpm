# Parallel Gateway (AND) — properties

| Property | XML | Notes |
|----------|-----|-------|
| id / name | attrs | |
| gatewayDirection | `@gatewayDirection` | Unspecified / Converging / Diverging / Mixed |
| incoming / outgoing | elements | per direction |


## Input / output mapping
None — routing only.

## SDK
`{ "type": "parallelGateway", "gatewayDirection": "Diverging" }` → `<bpmn2:parallelGateway …>`.
