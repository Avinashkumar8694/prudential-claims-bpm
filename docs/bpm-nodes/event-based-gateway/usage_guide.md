# Event-Based Gateway — usage guide

## 1. Details
BPMN element: `<bpmn2:eventBasedGateway>`. A gateway controls flow; it performs no work.

## 2. Usage
- **Diverging** (`gatewayDirection="Diverging"`): routes to whichever of the following **catch events** fires first (race).
- **Converging** (`gatewayDirection="Converging"`): n/a (diverging only).

## 3. How / when to use
- Put it between the nodes whose flow must split/join.
- Conditions (if any) live on the **outgoing sequence flows**, not the gateway.
- SDK type: `eventBasedGateway` — fields `id`, `name`, `gatewayDirection`, `incoming[]`, `outgoing[]`.
