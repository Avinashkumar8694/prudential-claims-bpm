# HTTP / Service Task

**Category**: Tasks · **Ports**: 1 in, 1 out · **Palette**: Service Task (REST)

## Purpose

Makes a real outbound HTTP call — the primary way a process talks to an external system.

## Fields

| Field | Widget | Notes |
|---|---|---|
| `method` | select | `GET`/`POST`/`PUT`/`DELETE`/`PATCH`/`HEAD`/`OPTIONS` |
| `url` | text | Relative (`/v1/claims`) or absolute (`http://...`) — see below |
| `headers` | keyval | Sent as-is |
| `body` | keyval, value = `$var` or literal | Sent as the JSON body (ignored for GET/HEAD) |
| `resultTo` (Map response → variable) | keyval, key = process var, value = JSONPath | e.g. `verifierId ← $.verifierId` |

Not shown in the palette schema but supported: `exitScript` (+ `lang`) — a jBPM-parity exit hook run
after the call, with `resPayload` (the raw response text) and every `resultTo`-mapped variable already
available — see [Script task](script.md) for the scripting model.

## Behavior

- **Relative `url`** — appended to the deployment's `INTEGRATION_LAYER_URL` (per-environment) or the
  global `INTEGRATION_BASE_URL` default. This is the intended, trusted path.
- **Absolute `url`** — used as-is, but SSRF-gated: blocked if it resolves to a private/link-local/
  loopback address (including the cloud-metadata IP), unless the host is on `OUTBOUND_ALLOWLIST` — see
  [Security & quotas](../10-security-and-quotas.md). A blocked call fails with `errorCode:
  'SSRF_BLOCKED'`.
- A non-2xx response, a network failure, or an `exitScript` throwing all raise `SERVICE_ERROR` (or
  `SCRIPT_ERROR` for the exit script specifically) — catchable via [Boundary](boundary.md).
- `exitScript` execution is subject to [`maxConcurrentScripts`](../10-security-and-quotas.md), same as
  a plain [Script task](script.md).

## Example

```json
{
  "id": "verify", "type": "http", "name": "Verify policy",
  "method": "POST", "url": "/v1/policies/verify",
  "body": { "policyNumber": "$policyNumber" },
  "resultTo": { "verified": "$.result.verified", "verifierId": "$.result.verifierId" }
}
```

## Gotchas

- `resultTo`'s JSONPath is a small dotted-path subset (`$.a.b.c`), not full JSONPath syntax — array
  indexing/filters aren't supported.
- A relative URL against `http://localhost:...` in dev is fine and intentionally never SSRF-gated —
  the guard only ever looks at an *absolute* URL, which is the author-controlled case.
