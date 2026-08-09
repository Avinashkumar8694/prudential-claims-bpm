# Work Item

**Category**: Tasks · **Ports**: 1 in, 1 out · **Palette**: Email, SMS, DB Task, Compute, Log

## Purpose

Runs a named "operation" handler — this engine's equivalent of a real jBPM custom
`WorkItemHandler` — with a small set of built-in handlers for common side effects, without writing a
custom script.

## Fields

| Field | Widget | Notes |
|---|---|---|
| `handler` | select: `Email`, `SMS`, `DBQuery`, `Compute`, `Log` | Which built-in handler to run |
| `params` | keyval, value = `$var` or literal | Passed to the handler |
| `resultTo` (Map result → variable) | keyval, key = process var, value = result field name | e.g. `sent ← sent` |

## Behavior, per handler

| Handler | Behavior |
|---|---|
| `Email` | POSTs `params` to `env.EMAIL_SERVICE_URL` if the deployment sets one; otherwise **simulates** — returns `{ sent: true, simulated: true, to: params.to }` without a real send |
| `SMS` | Same pattern, `env.SMS_SERVICE_URL` |
| `DBQuery` | POSTs to `env.DB_SERVICE_URL` if set; otherwise simulates with `{ rows: [], simulated: true }` |
| `Compute` | Evaluates `params.expression` as a JS expression (`params` fields in scope), returns `{ result }` — its own small `node:vm` sandbox, 1s timeout |
| `Log` | Pure record — returns `{ logged: true, message: params.message }`, no external effect |

Because Email/SMS/DB **simulate by default**, a process using them runs end-to-end in dev/test without
any real credentials configured — set the matching `*_SERVICE_URL` in the deployment's `env` when you
want the real side effect.

## Example

```json
{
  "id": "sendConfirm", "type": "workItem", "handler": "Email",
  "params": { "to": "$applicantEmail", "subject": "Claim received", "body": "$confirmationText" },
  "resultTo": { "emailSent": "sent" }
}
```

```json
{
  "id": "calcFee", "type": "workItem", "handler": "Compute",
  "params": { "expression": "base * multiplier" },
  "resultTo": { "fee": "result" }
}
```

## Gotchas

- Failure (the external service returning non-2xx, or a `Compute` expression throwing) raises
  `SERVICE_ERROR` — catchable.
- `DBQuery`'s "query" is opaque to this engine — it's whatever `params` your configured
  `DB_SERVICE_URL` expects to receive; there's no SQL execution built in.
