# 07 — Security

## 1. Threat model (STRIDE, summarized)

| Threat | Surface | Mitigation |
|--------|---------|-----------|
| **Spoofing** | API/WS auth | JWT implemented for the REST API (`requireAuth`, no anonymous mutating routes) — refresh tokens and a WS token handshake are not built; the WebSocket hub itself has no auth today |
| **Tampering** | Versions/deployments | Immutable published versions & deployment snapshots; optimistic locks; audit |
| **Repudiation** | Any action | Append-only audit with actor, time, before/after (redacted) |
| **Information disclosure** | Variables, secrets, payloads | Tenant isolation on every query; secrets never in engine JSON; Dual-Tier RSA encryption (ephemeral in-transit + persistent at-rest); payload redaction in logs/audit |
| **Denial of service** | Script tasks, HTTP tasks, timers | Sandbox CPU/time budget; per-tenant rate limits — **implemented**; timer/instance/script quotas — **implemented**; outbound allowlist — **implemented** |
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

- **JavaScript (`js`)**: Runs in an isolated `node:vm` context with a frozen shim exposing **only** `kcontext`
  (get/setVariable, node/instance context) and a safe stdlib subset. **No** `require`, `process`, `fs`,
  network, globals, or prototype escape.
  - **Limits**: wall-clock timeout (`SCRIPT_TIMEOUT_MS`, default 2s), memory cap, no async I/O from scripts.
    Timeout → node fails with `SCRIPT_TIMEOUT` (retryable).
- **Java (`java`)**: Real Java execution supported via the JVM Sidecar process (`jbpm-engine/java-runtime/`).
  - **Static denylist** (`java-compat.ts`): Scanned prior to execution for prohibited reflection,
    `System.exit`, thread creation, and socket operations.
  - **Compiler wrapper**: Scripts and conditions compile as typed methods against a synthetic `kcontext`
    wrapper with declared process variable types.
  - **Build-stage pre-compilation**: Validated at publish time via `java-support` rule; bytecode cache is
    pre-warmed for instant zero-compile runtime execution.
- `mvel` dialect is not executed (recorded as skipped with advisory warning, preserved for export).

## 5. Outbound (HTTP service tasks) — allowlist **implemented**, secrets integrated

- Base URL comes from the **deployment env** (`INTEGRATION_LAYER_URL`), not author-controlled arbitrary
  hosts — a *relative* `url` is always appended to it and is never gated. An **absolute** `url` (an
  author can put anything there) IS gated: `infra/outbound-guard.ts`'s `assertOutboundAllowed` blocks
  it if the hostname (or its resolved IP, for a real DNS name) falls in a private/link-local/loopback
  range — this includes the classic cloud-metadata SSRF target, 169.254.169.254, via the same
  link-local rule, no special case needed. Override per-deployment via the `OUTBOUND_ALLOWLIST` env
  var (comma-separated hostnames or `.suffix` domains). A blocked call fails the node with
  `errorCode: 'SSRF_BLOCKED'`, catchable by an Error Catch like any other node failure.
- Secrets referenced by name (`{{secret:NAME}}`) are injected at call time from the encrypted secret store;
  never stored in engine JSON, never logged.

## 6. Secrets management & Dual-Tier RSA Cryptography — **implemented**

The platform implements an enterprise **Dual-Tier RSA Cryptographic Architecture** (`server/src/infra/crypto.ts` + `app/src/app/core/crypto/crypto.service.ts`):

```
┌────────────────────────────────────────────────────────┐
│ UI / Browser Client                                    │
│  - Fetches ephemeral public key from /api/crypto/public-key
│  - Encrypts password/secrets with Web Crypto (RSA-OAEP)│
└───────────────────────────┬────────────────────────────┘
                            │ Wire In-Transit (rsa:v1:...)
                            ▼
┌────────────────────────────────────────────────────────┐
│ Backend API Gateway                                    │
│  - Decrypts with Ephemeral Private Key in-memory      │
│  - Encrypts with Persistent RSA Key for DB storage     │
└───────────────────────────┬────────────────────────────┘
                            │ At-Rest (rsa:at-rest:...)
                            ▼
┌────────────────────────────────────────────────────────┐
│ Database / Persistent Store (kv_store / Postgres)     │
│  - Zero plaintext secrets at rest                     │
│  - Decrypted only when executed (HTTP/Script calls)   │
└────────────────────────────────────────────────────────┘
```

- **Tier 1: In-Transit Cryptography (Ephemeral RSA 2048)**:
  - An ephemeral 2048-bit RSA key pair is generated on every server startup in memory.
  - The public key is exposed via unauthenticated endpoint `GET /api/crypto/public-key`.
  - Frontend encrypts sensitive fields (login passwords, secret values) using native Web Crypto
    `window.crypto.subtle` with RSA-OAEP SHA-256 before wire transmission.
  - Ephemeral private key is never written to disk and is regenerated every time the server restarts
    (guaranteeing forward secrecy across server lifecycles).
  - Payloads prefixed with `rsa:v1:` are automatically decrypted in memory by `decryptInTransit()`.

- **Tier 2: At-Rest Cryptography (Persistent RSA 2048)**:
  - Secrets stored in the database or settings collection (`SettingsService.setSecrets`) are encrypted
    using a persistent RSA key (`encryptAtRest`).
  - Key configuration: Configured via environment variables `SECRETS_ENCRYPTION_PRIVATE_KEY` and
    `SECRETS_ENCRYPTION_PUBLIC_KEY`, with automatic generation and persistence to `.secrets_rsa_key`
    in the server data directory if unspecified.
  - Ciphertext is prefixed with `rsa:at-rest:`.
  - Secrets are **never** returned in API responses (values are masked as `********`).
  - Decryption happens exclusively in-memory when a secret is actively needed (e.g., injecting
    headers into HTTP service tasks or providing credentials to script runners).

## 7. Input validation & output encoding

- All request bodies validated with zod DTOs; reject unknown fields on sensitive routes.
- Engine JSON validated via SDK `validateModel` before persist/deploy/run.
- API returns JSON only; Angular escapes by default (avoid `[innerHTML]`; sanitize any rich text).
- File/zip import: size limits, path traversal guards, only expected asset extensions; scan for zip
  bombs (entry count/uncompressed size caps).

## 8. Transport & headers — partial

- TLS everywhere (terminate at proxy). HSTS, secure cookies if used. — **not built** (proxy's job; no
  proxy config lives in this repo).
- CORS: locked to `APP_ORIGIN` when set; defaults to `*` in dev if unset — **set `APP_ORIGIN` in any
  non-dev environment**, this is not enforced automatically.
- Security headers — **implemented** (`app.ts`): `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Content-Security-Policy: default-src
  'none'` on every JSON API response (the one HTML response, `/api/docs`'s Swagger UI, is exempted so
  its CDN-hosted assets keep working).
- CSRF: token auth in `Authorization` header (not cookies) avoids CSRF; if cookies used, add CSRF token.

## 9. Rate limiting & quotas — **implemented**

- Per-principal (JWT `sub`) rate limits, in-memory/single-process (`http/rate-limit.ts`): login is
  limited per-IP (no user yet at that point); start-instance, deploy, and import are limited per-user.
  A caller over the limit gets `429 RATE_LIMITED`. Not a distributed limiter — if this server is ever
  run multi-instance behind a load balancer, this needs to move to a shared store.
- Per-tenant quotas on `SystemSettings` (configured via the existing System Settings API/UI —
  `PATCH /settings`, "Resource quotas" card): `maxActiveInstances` (top-level instances
  running/waiting), `maxActiveTimers` (scheduled boundary/catch TimerJobs), `maxConcurrentScripts`
  (script-task/exit-script executions running at this instant, tracked in-memory per tenant —
  `infra/quotas.ts`). All three default to `0` (unlimited) so existing tenants are unaffected until an
  admin opts in. A breach raises `429 QUOTA_EXCEEDED` at the API layer, or — for a quota hit mid-flow
  (a timer that couldn't be scheduled) — a catchable `errorCode: 'QUOTA_EXCEEDED'` node failure, same
  as any other engine error.

## 10. Audit & observability

- Append-only `audit` for auth, authz denials, version publish, deploy/activate/rollback, instance
  lifecycle, task actions, admin/secret changes. Redact variable payloads to configured fields.
- Structured logs with correlation ids; no secrets/PII in logs.

## 11. Dependency & supply chain

- Pin versions; `npm audit` in CI; lockfile committed; minimal deps; SDK is first-party.

## 12. Data protection

- Encrypt sensitive variables at rest if flagged; TTL/retention for completed instances & audit;
  export/delete per-subject (GDPR) via admin tooling (P2).
