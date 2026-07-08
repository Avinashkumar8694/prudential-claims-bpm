# Inclusive Gateway (OR) — properties

| Property | XML | Notes |
|----------|-----|-------|
| id / name | attrs | |
| gatewayDirection | `@gatewayDirection` | Unspecified / Converging / Diverging / Mixed |
| incoming / outgoing | elements | per direction |
| default | `@default` | fallback outgoing flow id |

## Input / output mapping
None — routing only.

## SDK
`{ "type": "inclusiveGateway", "gatewayDirection": "Diverging" }` → `<bpmn2:inclusiveGateway …>`.
