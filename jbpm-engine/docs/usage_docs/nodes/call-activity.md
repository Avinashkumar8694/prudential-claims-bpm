# Call Activity

**Category**: Sub-process · **Ports**: 1 in, 1 out · **Palette**: Call Activity

## Purpose

Invokes another **deployed** process as an independent child instance — isolated variable scope
(unlike [Sub-process](subprocess.md)'s shared scope), with explicit input/output mapping.

## Fields

| Field | Widget | Notes |
|---|---|---|
| `process` | processRef | Target process id/key — any process behind a currently active deployment, in this project or another |
| `inputs` | keyval, key = called process's variable, value = `$ownVar` or literal | childVar ← parentVar |
| `outputs` | keyval, key = own variable, value = called process's variable | parentVar ← childVar, only after the child completes |
| `independent` | bool | Fire-and-forget — see below |

## Behavior

- Starts a real child `Instance` (`startChild`), mapping `inputs` in.
- **Default (dependent)**: the parent token waits for the child. If the child finishes synchronously
  (no wait inside it), outputs map back immediately; otherwise the parent parks (`wait: { kind: 'child'
  }`) and resumes when the child later completes. A child that aborts/fails raises `CALL_ERROR` on the
  parent (catchable).
- **`independent: true`**: fire-and-forget. The parent continues immediately regardless of the child's
  state, and the child's lifecycle is fully decoupled — it keeps running standalone even past this
  parent's own completion or abort. Outputs only map back if the child happened to complete
  synchronously within the same call; there's no later resume to pick them up otherwise.
- Only **declared `outputs`** cross back into the parent — everything else in the child's variable
  scope stays isolated (contrast with [Sub-process](subprocess.md)'s full shared-scope merge).

## Example

```json
{
  "id": "runCredit", "type": "call", "process": "credit-check.process",
  "inputs": { "applicantId": "$applicantId", "amount": "$requestedAmount" },
  "outputs": { "creditScore": "score", "approved": "approved" }
}
```

Fire-and-forget audit trail:

```json
{ "id": "logAudit", "type": "call", "process": "audit-trail.process", "independent": true,
  "inputs": { "event": "$eventName" } }
```

## Gotchas

- The target process must be behind an **active** deployment when the call activity actually runs —
  not necessarily when you author it. `resolveCalled` checks every active deployment in the tenant at
  call time.
- If the target process id doesn't resolve to any active deployment, the node returns
  `outcome: 'called-process-not-deployed'` without erroring the parent — deploy the target and retry
  (or trigger a fresh run) rather than expecting an error catch to fire.
