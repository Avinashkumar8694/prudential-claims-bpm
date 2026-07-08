# Event-Based Gateway — properties

| Property | XML | Notes |
|----------|-----|-------|
| id / name | attrs | |
| gatewayDirection | `@gatewayDirection` | Unspecified / Converging / Diverging / Mixed |
| incoming / outgoing | elements | per direction |
| eventGatewayType | `@eventGatewayType` | Exclusive / Parallel |
| instantiate | `@instantiate` | true starts a new instance |

## Input / output mapping
None — routing only.

## SDK
`{ "type": "eventBasedGateway", "gatewayDirection": "Diverging" }` → `<bpmn2:eventBasedGateway …>`.
