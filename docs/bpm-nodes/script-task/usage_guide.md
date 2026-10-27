# Script Task — usage guide

## 1. Details
BPMN element: `<bpmn2:scriptTask scriptFormat="http://www.java.com/java">` with a `<bpmn2:script>`
CDATA body. Runs synchronous Java (MVEL also supported) inside the engine thread using `kcontext`.

## 2. Usage
Reads/writes process variables via `kcontext.getVariable(...)` / `kcontext.setVariable(...)`.
Examples here: `Script_Bootstrap` resolves `baseUrl` from `INTEGRATION_LAYER_URL`;
`Resolve Decision` defaults `verificationDecision`; the MRX-check script parses `resPayload`
and sets `mrxDiscrepancyFlag`.

## 3. How / when to use
- Use for cheap in-memory logic: variable defaulting, JSON build/parse, small aggregations.
- Do NOT do blocking I/O here (no HTTP) — use a REST service task (call activity to rest-executor).
- Keep idempotent; scripts run on the engine thread and block the instance.
