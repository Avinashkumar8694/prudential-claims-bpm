# Configuration Reference

Configuration lives in two layers: **environment variables** (deployment-time, read once at boot —
`server/src/infra/config.ts`) and **System Settings** (runtime, per-tenant, editable in the UI or via
`PATCH /api/settings/system` without a restart — `server/src/modules/settings/service.ts`).

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port the API server listens on |
| `DATA_DIR` | `./.data` | Where the file store persists (one JSON file per entity type) — irrelevant if `STORE=pg` |
| `STORE` | `file` | `file` or `pg` — see [Getting started](01-getting-started.md) for running against Postgres |
| `PG_URL` | `postgresql://jbpm:jbpm@localhost:5433/jbpm` | Postgres connection string, only read when `STORE=pg` |
| `JWT_SECRET` | `dev-insecure-secret-change-me` | HS256 signing key for auth tokens — **set a real value in any non-dev environment** |
| `ADMIN_INITIAL_PASSWORD` | `admin-change-me` | Password for the one-time seeded `admin` user (only used if no users exist yet at boot) |
| `INTEGRATION_BASE_URL` / per-deployment `INTEGRATION_LAYER_URL` | `http://localhost:3000` | Base URL an HTTP service task's *relative* `url` is appended to — see the [HTTP / Service Task](nodes/http-service.md) node doc. Deployment-level `env.INTEGRATION_LAYER_URL` (set at deploy time) overrides the global default per environment |
| `SCRIPT_TIMEOUT_MS` | `2000` | Wall-clock budget for a `js` script task/condition before it fails with `SCRIPT_TIMEOUT` |
| `SCRIPT_OVERFLOW_MODE` | `queue` | What happens when a workspace already has its **effective concurrency** of scripts running: `queue` = the caller waits in a bounded FIFO queue; `reject` = refused immediately with `QUOTA_EXCEEDED` (no waiting, no queue slot). A workspace can override it with the Settings → System field `scriptOverflowMode` (`queue`/`reject`; unset = this value) |
| `SCRIPT_POOL_DEFAULT_SIZE` | `4` | Script concurrency for a workspace that has no `maxConcurrentScripts` set |
| `SCRIPT_POOL_MAX_SIZE` | `16` | Upper bound on any workspace's script concurrency. **Effective concurrency = `min(maxConcurrentScripts \|\| SCRIPT_POOL_DEFAULT_SIZE, SCRIPT_POOL_MAX_SIZE)`** — so a `maxConcurrentScripts` of 50 only gives 50 if this is ≥ 50 (it is also the exact `reject` threshold). Worst-case memory per workspace = effective concurrency × 64 MB isolate cap. `GET /settings/system` returns `effectiveScriptConcurrency` / `effectiveScriptOverflowMode` so you can see what is really applied |
| `SCRIPT_MAX_ISOLATES` | `max(8, 2×CPU cores)` | Global ceiling on live isolates across all workspaces — keep it ≥ the sum of the busy workspaces' effective concurrency, otherwise the ceiling (not the per-workspace limit) is what bites (in `reject` mode: `server script capacity exhausted`). At the ceiling, waiting workspaces are served round-robin and may reclaim another workspace's *idle* isolate |
| `SCRIPT_QUEUE_MAX` | `1000` | `queue` mode only: max executions waiting per workspace when all its isolates are busy; one more → `QUOTA_EXCEEDED` |
| `SCRIPT_QUEUE_TIMEOUT_MS` | `5000` | `queue` mode only: max time an execution may wait in the queue before failing with `QUOTA_EXCEEDED` (does not count toward `SCRIPT_TIMEOUT_MS`) |
| `SCRIPT_ISOLATE_IDLE_MS` | `60000` | An idle isolate is disposed after this long (the pool shrinks to zero when a workspace goes quiet) |
| `SCRIPT_ISOLATE_MAX_RUNS` | `1000` | An isolate is recycled after this many executions (also recycled after a timeout, OOM, or near-full heap) |

> **Single pod vs several.** Isolate pools, queues and the concurrency/overflow limits above are **per server process**. With N pods behind a load balancer a workspace's real limit is `limit × N` (and its worst-case script memory × N). Size `maxConcurrentScripts` and `SCRIPT_MAX_ISOLATES` per pod accordingly.

| `WS_PATH` | `/ws` | WebSocket path for live UI updates (node/task/instance events) |
| `DEFAULT_TENANT` | `default` | The workspace a request resolves to when it sends no `x-tenant-id` (the caller still has to be a member) |
| `OIDC_ISSUER` (alias `IDS_ISSUER_URL`) | *(unset = SSO off)* | Identity Server issuer, e.g. `https://ids.fabrixly.com/oidc` (discovery at `/.well-known/openid-configuration`). Must be https in production |
| `OIDC_CLIENT_ID` (alias `IDS_CLIENT_ID`) | *(unset)* | Registered client id (`zero-orkestr`) |
| `OIDC_CLIENT_SECRET` (alias `IDS_CLIENT_SECRET`) | *(unset = public client, PKCE only)* | Client secret, sent as `client_secret_basic`. **Secret — environment/secret store only, never committed** |
| `OIDC_REDIRECT_URI` | `http://localhost:$PORT/api/auth/oidc/callback` | Must be registered at the IdP (prod: `https://orkestr.fabrixly.com/api/auth/oidc/callback`; local: `http://localhost:4000/…` or `http://localhost:4200/…`) |
| `OIDC_AUDIENCE` | the client id | Comma-separated accepted `aud` values for bearer tokens |
| `OIDC_CLOCK_TOLERANCE_SEC` | `30` | Clock skew allowed when checking `exp`/`nbf` |
| `DASHBOARD_URL` | `APP_ORIGIN`, else `http://localhost:4200` | Where the SSO callback and logout send the browser (post-logout URI must be registered: `https://orkestr.fabrixly.com`, `http://localhost:4200`, `http://localhost:4000`) |
| `AUTH_REGISTRATION` | `true` | Self-service account creation (needs local login); the landing page's "Get started" goes to `/register` when on, else to sign-in |
| `AUTH_FORGOT_PASSWORD` | `true` | Forgot / reset password flow (needs local login) |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `false` | A registered account cannot sign in until it confirms its email |
| `AUTH_PASSWORD_MIN_LENGTH` | `8` | Minimum password length (never below 8); self-service passwords also need a letter and a digit and may not be common |
| `AUTH_MAX_FAILED_LOGINS` / `AUTH_LOCKOUT_MINUTES` | `5` / `15` | Account lockout after consecutive wrong passwords |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASSWORD` | *(unset)* | Real SMTP delivery (aliases `EMAIL_HOST/PORT/SECURE/USER/PASS` as in rules-manager) |
| `MAIL_FROM` | `no-reply@$DOMAIN` | From address |
| `MAIL_WEBHOOK_URL` | *(unset)* | Alternative to SMTP: JSON relay `{from,to,subject,text,html}`. With neither, mails are only logged in dev (never in production) and invitation links are returned to the inviter |
| `AUTH_LOCAL_LOGIN` | `true` | Set `false` to disable `POST /auth/login` and HS256 tokens once SSO is the only way in |
| `NODE_ENV` | — | `production` makes start-up refuse a default `JWT_SECRET`/`ADMIN_INITIAL_PASSWORD` and a non-https issuer |
| `JAVA_SIDECAR_CLASSPATH` | `<repo>/java-runtime/out` | Compiled classes for the Java script sidecar |
| `JAVA_SIDECAR_STARTUP_TIMEOUT_MS` | `10000` | How long to wait for the sidecar JVM to report ready at boot |
| `JAVA_SIDECAR_TIMEOUT_MS` | `10000` | Per-request timeout for a sidecar `/execute` call (the first call for a given script includes a real `javac` compile) |
| `OUTBOUND_ALLOWLIST` | *(empty)* | Comma-separated hostnames or `.suffix` domains an HTTP service task's **absolute** URL is allowed to reach even though it resolves to a private/link-local/loopback address — see [Security & quotas](10-security-and-quotas.md) |
| `APP_ORIGIN` | `*` (dev) | CORS origin allowed to call the API — **set this to your real app origin in any non-dev environment** |

## System Settings (runtime, no restart needed)

**Settings → System** in the UI, or `GET`/`PATCH /api/settings/system` (requires `admin:iam`). One row
per tenant; a missing row returns documented defaults, so there's no seed step.

### Process engine

| Field | Default | Meaning |
|---|---|---|
| Default items per page | `20` | Applies to Instances, Tasks, Errors, Jobs, Audit lists (`10`/`20`/`50`/`100`) |
| Instance history retention (days) | `90` | Completed/aborted instances older than this are eligible for pruning |
| Allow variable edits on running instances | `on` | When off, the Variables tab is read-only for everyone, even admins |

### Resource quotas — *see [Security & quotas](10-security-and-quotas.md) for full detail*

| Field | Default | Meaning |
|---|---|---|
| Max active instances | `0` (unlimited) | Top-level (root) process instances running/waiting at once, per tenant |
| Max active timers | `0` (unlimited) | Scheduled boundary/catch `TimerJob` rows at once, per tenant |
| Max concurrent scripts | `0` (unlimited) | Script-task/exit-script executions running at this instant, per tenant |

### Jobs & timers

| Field | Default | Meaning |
|---|---|---|
| Executor interval (seconds) | `5` | How often the durable timer poller checks for due jobs |
| Default job retries | `3` | Attempts before a job is marked failed and surfaced in Execution Errors |

### Notifications & email

| Field | Default | Meaning |
|---|---|---|
| SLA warning threshold | `80%` | When a task flips from on-track to at-risk (percent of time-to-due elapsed) |
| Email delivery | `off` | Needed for SLA-breach/reminder emails; in-app notifications work without it |
| From address / SMTP host / SMTP port | — | Only shown/used when email delivery is on |

### Security & session

| Field | Default | Meaning |
|---|---|---|
| Session timeout (hours) | `8` | How long a JWT stays valid after login |
| Audit retention (days) | `365` | Pruned by the same scheduled job as instance history |

## Precedence

Deployment-level `env` (set when you deploy — e.g. `INTEGRATION_LAYER_URL`) always overrides the
matching global environment variable for instances running on that deployment. System Settings never
override environment variables or deployment env — they're a distinct, runtime-editable layer for
operational limits and defaults, not secrets or connection strings.
