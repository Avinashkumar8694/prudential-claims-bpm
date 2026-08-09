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
| `WS_PATH` | `/ws` | WebSocket path for live UI updates (node/task/instance events) |
| `DEFAULT_TENANT` | `default` | The one tenant every request resolves to — see [Security & quotas](10-security-and-quotas.md) for why multi-tenancy is deliberately not built out further |
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
