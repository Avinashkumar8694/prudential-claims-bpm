# Script Task

**Category**: Tasks · **Ports**: 1 in, 1 out · **Palette**: Script Task

## Purpose

Runs a script against the instance's variables — JavaScript natively, or (for a script authored/
imported from real jBPM) real compiled Java via a sidecar process.

## Fields

| Field | Widget | Notes |
|---|---|---|
| `code` (Script body) | code | The script; `lang` defaults to `js` |

## Behavior — three equivalent ways to read/write a process variable

1. **`kcontext.getVariable(name)` / `.setVariable(name, v)`** — real jBPM's own API, always available.
2. **A bare name** (`caseId`) — matches real jBPM's own convention: every declared process variable is
   bound as a bare global, in both scripts and flow conditions.
3. **`vars.caseId` / `vars.caseId = v`** — this engine's own, simpler, Node-idiomatic addition. `vars`
   is literally the same object `kcontext.setVariable` mutates — no proxying, no separate write-back
   step.

Also available: `kcontext.getProcessInstance()`/`.getNodeInstance()`/`.getKieRuntime()` (mirroring real
jBPM's API surface, including `signalEvent`/`abortProcessInstance`), and this engine's own additive
sugar `instance`/`node` (plain properties, this engine's own status vocabulary, verb-methods like
`instance.signal(type, payload)` — not jBPM concepts, but exported with a preamble so a script using
them still runs unmodified on a real KIE server).

`console.log(...)` output is captured into the node's history entry, visible in the instance's
[Logs tab](../06-running-and-monitoring-instances.md).

Runs in a `node:vm` sandbox — no `require`/`process`/`fs`/network — with a wall-clock timeout
(`SCRIPT_TIMEOUT_MS`, default 2s) and, if [`maxConcurrentScripts`](../10-security-and-quotas.md) is
set, a per-tenant concurrency cap. See [Security & quotas](../10-security-and-quotas.md) for the
sandbox's known limitations.

## Example

```json
{
  "id": "compute", "type": "script", "lang": "js",
  "code": "vars.total = vars.unitPrice * vars.quantity; kcontext.setVariable('computedAt', new Date().toISOString());"
}
```

## Gotchas

- Failure raises `SCRIPT_ERROR` (catchable — see [Boundary](boundary.md)); a timeout raises
  `SCRIPT_TIMEOUT`.
- A script imported from real jBPM with `lang: 'java'` is never transpiled — it's compiled and run as
  real Java in the sidecar. If it references a class not in the sidecar's classpath, it fails at
  runtime exactly as it would on a KIE server missing that jar — see
  [Importing real jBPM](../11-importing-and-exporting-jbpm.md).
- `mvel` and other dialects are preserved on export but never evaluated.
