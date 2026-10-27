# Inclusive Gateway (OR) — usage guide

## 1. Details
BPMN element: `<bpmn2:inclusiveGateway>`. A gateway controls flow; it performs no work.

## 2. Usage
- **Diverging** (`gatewayDirection="Diverging"`): activates **every** outgoing flow whose condition is true.
- **Converging** (`gatewayDirection="Converging"`): waits for all **active** incoming flows.

## 3. How / when to use
- Put it between the nodes whose flow must split/join.
- Conditions (if any) live on the **outgoing sequence flows**, not the gateway.
- SDK type: `inclusiveGateway` — fields `id`, `name`, `gatewayDirection`, `incoming[]`, `outgoing[]`.
