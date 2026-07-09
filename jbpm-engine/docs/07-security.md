# 07 — Security

## 1. Threat model (STRIDE, summarized)

| Threat | Surface | Mitigation |
|--------|---------|-----------|
| **Spoofing** | API/WS auth | JWT (short-lived) + refresh; WS token handshake; no anonymous mutating routes |
| **Tampering** | Versions/deployments | Immutable published versions & deployment snapshots; optimistic locks; audit |
| **Repudiation** | Any action | Append-only audit with actor, time, before/after (redacted) |
| **Information disclosure** | Variables, secrets, payloads | Tenant isolation on every query; secrets never in engine JSON; payload redaction in logs/audit |
| **Denial of service** | Script tasks, HTTP tasks, timers | Sandbox CPU/time budget; per-tenant rate limits; timer/instance quotas; outbound allowlist |
| **Elevation of privilege** | RBAC | Deny-by-default; role checks server-side on every route; no client-trust |

## 2. AuthN / AuthZ

- **AuthN**: email/password → JWT (`sub`, `tenantId`, `roles`, `exp`). Pluggable to OIDC/SAML later.
- **AuthZ**: RBAC with roles `admin`, `release`, `operator`, `worker`, `author`, `viewer`. Every route
  declares required permission; a central `authorize(action, resource)` guard enforces it. Workflow
  permissions (`WorkflowPermission[]`) add per-workflow grants layered on top of roles.
- **Task-level**: a worker may only view/claim/complete tasks for their groups or assigned to them.
- **Deny by default**: unknown/absent permission → 403.

## 3. Multi-tenancy

- Every entity carries `tenantId`; the store enforces it (no cross-tenant reads even by id).
- JWT binds the caller to one tenant; admin cross-tenant actions require a platform-admin scope + audit.
- File store partitions by tenant directory; Postgres uses `tenantId` + row-level checks.

## 4. Script & expression sandboxing

- Only `js` runs. Executed in an isolated context (`node:vm` with a frozen shim, or `isolated-vm` in
  prod) exposing **only** `kcontext` (get/setVariable) and a safe stdlib subset. **No** `require`,
  `process`, `fs`, network, globals, or prototype escape.
- **Limits**: wall-clock timeout (e.g. 2 s), memory cap, no async I/O from scripts. Timeout → node
  fails with `SCRIPT_TIMEOUT` (retryable).
- `java`/`mvel` are never evaluated (no engine) — preserved verbatim for export only.

## 5. Outbound (HTTP service tasks)

- Base URL comes from the **deployment env** (`INTEGRATION_LAYER_URL`), not author-controlled arbitrary
  hosts. An **allowlist** of hosts/ports per tenant restricts outbound calls (SSRF protection):
  block link-local/metadata IPs (169.254.169.254), private ranges unless explicitly allowed.
- Secrets referenced by name (`{{secret:NAME}}`) are injected at call time from the secret store;
  never stored in engine JSON, never logged.

## 6. Secrets management

- `secrets` collection stores references/ciphertext, not plaintext (file store: encrypted-at-rest with
  a KMS/master key; prod: use a real secret manager). API returns only names/metadata, never values.
- Rotation supported; usages resolve by name at run time.

## 7. Input validation & output encoding

- All request bodies validated with zod DTOs; reject unknown fields on sensitive routes.
- Engine JSON validated via SDK `validateModel` before persist/deploy/run.
- API returns JSON only; Angular escapes by default (avoid `[innerHTML]`; sanitize any rich text).
- File/zip import: size limits, path traversal guards, only expected asset extensions; scan for zip
  bombs (entry count/uncompressed size caps).

## 8. Transport & headers

- TLS everywhere (terminate at proxy). HSTS, secure cookies if used.
- CORS locked to the app origin(s). Security headers (CSP, X-Content-Type-Options, frame-ancestors).
- CSRF: token auth in `Authorization` header (not cookies) avoids CSRF; if cookies used, add CSRF token.

## 9. Rate limiting & quotas

- Per-principal + per-tenant rate limits on auth, start-instance, deploy, import.
- Quotas: max active instances, max timers, max concurrent scripts per tenant.

## 10. Audit & observability

- Append-only `audit` for auth, authz denials, version publish, deploy/activate/rollback, instance
  lifecycle, task actions, admin/secret changes. Redact variable payloads to configured fields.
- Structured logs with correlation ids; no secrets/PII in logs.

## 11. Dependency & supply chain

- Pin versions; `npm audit` in CI; lockfile committed; minimal deps; SDK is first-party.

## 12. Data protection

- Encrypt sensitive variables at rest if flagged; TTL/retention for completed instances & audit;
  export/delete per-subject (GDPR) via admin tooling (P2).
