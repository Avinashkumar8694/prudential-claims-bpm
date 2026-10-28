# Parallel Gateway (AND) — usage guide

## 1. Details
BPMN element: `<bpmn2:parallelGateway>`. A gateway controls flow; it performs no work.

## 2. Usage
- **Diverging** (`gatewayDirection="Diverging"`): activates **all** outgoing flows simultaneously (fork).
- **Converging** (`gatewayDirection="Converging"`): waits for **all** incoming flows before continuing (join).

## 3. How / when to use
- Put it between the nodes whose flow must split/join.
- Conditions (if any) live on the **outgoing sequence flows**, not the gateway.
- SDK type: `parallelGateway` — fields `id`, `name`, `gatewayDirection`, `incoming[]`, `outgoing[]`.
