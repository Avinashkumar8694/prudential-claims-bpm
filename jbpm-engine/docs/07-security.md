# 07 — Security

## 1. Threat model (STRIDE, summarized)

| Threat | Surface | Mitigation |
|--------|---------|-----------|
| **Spoofing** | API/WS auth | JWT implemented for the REST API (`requireAuth`, no anonymous mutating routes) — refresh tokens and a WS token handshake are not built; the WebSocket hub itself has no auth today |
| **Tampering** | Versions/deployments | Immutable published versions & deployment snapshots; optimistic locks; audit |
| **Repudiation** | Any action | Append-only audit with actor, time, before/after (redacted) |
| **Information disclosure** | Variables, secrets, payloads | Tenant isolation on every query; secrets never in engine JSON; payload redaction in logs/audit |
| **Denial of service** | Script tasks, HTTP tasks, timers | Sandbox CPU/time budget; per-tenant rate limits; timer/instance quotas; outbound allowlist |
| **Elevation of privilege** | RBAC | Deny-by-default; role checks server-side on every route; no client-trust |

## 2. AuthN / AuthZ — **implemented**

- **AuthN**: `POST /auth/login` (username/password) → JWT (`sub`, `username`, `roles`, `groups`, 12h
  expiry, HS256 via `jsonwebtoken`). Passwords are scrypt-hashed (`infra/auth.ts`), never returned by
  any API. `requireAuth` (`http/auth-middleware.ts`) verifies the `Authorization: Bearer <token>` on
  every route except `/health` and `/auth/login` — there is no trust-any header anymore. OIDC/SAML
  remain a future pluggable AuthN source, not built.
- **AuthZ**: RBAC with roles `admin`, `author`, `release`, `operator`, `worker`, `viewer`, seeded on
  first boot (`modules/iam/service.ts`'s `DEFAULT_ROLES`) — each a named `Role` row carrying a
  `permissions: string[]` list (real, editable rows, not a hardcoded enum). Every route declares its
  required permission via `requirePermission(action)`; `admin`'s `'*'` grants everything, and
  `'ns:*'` namespace wildcards are supported. The permission taxonomy is coarser than one string per
  route (`workflow:view/edit/deploy/run`, `task:manage`, `query:read`, `admin:iam`) — deliberately, to
  keep the surface reviewable rather than 50+ near-duplicate strings.
  **Not yet wired**: `WorkflowPermission[]` (per-workflow grants layered on top of roles) is still
  only stored via `PUT /workflows/:id/permissions`, not read by any authorization check — role-based
  access is real, but a workflow's own bespoke grant list isn't consulted yet.
- **Task-level**: `TaskService.claim/complete/skip` enforce `excludedOwners` (segregation of duties)
  and, for any acting username that resolves to a real registered `User`, group membership against
  the task's `group` (or the existing assignee, or the task's `businessAdmin`, which always overrides
  both checks). This only activates for real IAM-provisioned accounts — an un-registered actor string
  is unaffected, so pre-IAM callers keep working exactly as before.
- **Deny by default**: unknown/absent permission → 403 (`FORBIDDEN`); missing/invalid/expired token →
  401 (`AUTH_REQUIRED`).
- **Bootstrap**: if no users exist at boot, one `admin` user is seeded from `ADMIN_INITIAL_PASSWORD`
  (default `admin-change-me` — set a real value outside local dev).

## 3. Multi-tenancy — **partial, and intentionally not pursued further**

- Every entity carries `tenantId`; the store enforces it (`FileStore`/`PgStore`/`MemoryStore` alike —
  no cross-tenant reads even by id). This part is real and exercised by every module.
- **Deliberately not built**: JWT-bound multi-tenancy (binding a caller's token to one tenant among
  many) and any tenant management API. Every request resolves to the single `config.defaultTenant`
  ('default') — there is currently no way to have more than one tenant in practice. This was an
  explicit scope decision (real multi-tenancy adds meaningful surface — tenant provisioning, JWT claim
  validation, cross-tenant admin actions — for no current need), not an oversight.

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
