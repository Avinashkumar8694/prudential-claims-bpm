# Plans and limits

Every limit below is **enforced by the server** (there are no decorative limits). `-1` = unlimited. The platform
administrator edits plans (`PUT /api/platform/plans/:key`) and moves workspaces between plans
(`PUT /api/platform/workspaces/:id/plan`); every member can read their own usage at `GET /api/plan/usage` (screen: **Plan & usage**).

## The free trial (seed)
7 days from workspace creation, no card. After it ends the workspace is **read-only for new work** (HTTP 402 `PLAN_EXPIRED`):
workflows, history and data stay readable; starting instances, creating workflows, deploying and inviting are paused until a plan is chosen
(or the platform admin extends the trial: `{ "plan": "trial", "extendDays": 7 }`).

| Limit | Free trial | Starter | Pro | Enterprise / custom | Enforced where |
|---|---|---|---|---|---|
| `concurrentRequests` | **50** | 100 | 250 | ∞ | request gate (429 + `Retry-After: 1`) |
| `requestsPerMinute` | 600 | 3 000 | 15 000 | ∞ | request gate, per-minute window (429 + `Retry-After`) |
| `concurrentScripts` | 2 | 4 | 8 | ∞ | script pool size cap |
| `instancesPerDay` | **200** | 2 000 | 20 000 | ∞ | process start, UTC day |
| `instancesPerWeek` | **1 000** | 10 000 | 100 000 | ∞ | process start, ISO week (Mon–Sun, UTC) |
| `instancesPerMonth` | **3 000** | 30 000 | 300 000 | ∞ | process start, UTC month |
| `maxActiveInstances` | 50 | 500 | 5 000 | ∞ | process start (root instances running/waiting) |
| `maxActiveTimers` | 100 | 1 000 | 10 000 | ∞ | timer scheduling |
| `maxWorkflows` | 10 | 50 | 500 | ∞ | workflow create (archived ones excluded) |
| `maxTeamMembers` | 5 | 15 | 100 | ∞ | invitation (members + pending, platform admin excluded) |
| `maxDeployments` | 20 | 100 | 1 000 | ∞ | deploy (archived ones excluded) |

The trial row shown on the landing page is read from the stored plan, so changing it changes what visitors see. Only the **trial** and **custom**
plans are public; any other plan the platform admin creates is hidden from the pricing page and assignable only by them.

## How refusals look
* Per-period budget / resource cap → **429** `QUOTA_EXCEEDED`, with `details: { quota, limit, used, resetsAt, plan }` and a human message.
* Request gates → **429** `RATE_LIMITED` + `Retry-After`.
* Expired trial/plan → **402** `PLAN_EXPIRED`, `details: { plan, expiredAt }`.
* Refused starts are **not** counted against the budget; counters are incremented atomically per workspace (30 parallel starts against a limit of 10 admit exactly 10).
* The **platform administrator** is exempt in every workspace (not limited, not metered).

## How plan limits combine with the platform limits
The plan is one more cap layer: effective = min(platform global cap, per-workspace platform override, **plan**, the workspace's own setting). A workspace admin can only go
lower; `concurrentScripts`, `maxActiveInstances` and `maxActiveTimers` appear to them as caps in Settings → System.

## Operating notes
* With `REDIS_URL` set, request gates, script pools and queues are enforced **across all replicas** (next section); without it they are per process. Usage counters live in the `usage` collection (Postgres) and are updated under a cluster-wide lock.
* Edits are stored in the shared database, so every replica sees them within ~2 s (the limit caches) and re-applies them to its live pools within `CLUSTER_HEARTBEAT_MS` (5 s) — an admin can change a limit on any replica and all of them follow, no restart.
* Existing databases are topped up on start-up: stored plans gain any limit key they lack, admin-edited values are never overwritten, the old 14-day trial becomes 7 days.

## Running several replicas
Set `REDIS_URL` and every limit above holds **whatever the number of replicas**. How each one is kept:

| Limit | Mechanism |
|---|---|
| `concurrentRequests` | a shared set of in-flight *leases* per workspace (one Lua script: expire dead, admit if below the limit). A request that dies with its pod frees its slot when the lease expires (`CLUSTER_LEASE_TTL_MS`, renewed while the request lives). |
| `requestsPerMinute` | one shared fixed-window counter per workspace |
| `instancesPerDay/Week/Month` | read-modify-write of the usage counters under a cluster-wide lock, so no update is lost between pods |
| `concurrentScripts` / queue | the workspace's pool is **split exactly** over the replicas holding the workspace (rank-based: 8 over 3 replicas = 3 + 3 + 2). When more replicas hold a workspace than it has slots, each run also takes a shared slot. After a replica joins or leaves the others re-balance within one heartbeat (≤ 5 s of transient over/under-allowance). |
| **`maxReplicas`** | the workspace's *placement*: at most N replicas may hold a live lease for it. A replica asks on the first request (and again every heartbeat while busy, every second while refused); a replica that is not a holder answers **503 `REPLICA_NOT_ASSIGNED` + `Retry-After: 1`** and the load balancer retries another. A replica that stops seeing traffic for a workspace lets its lease lapse, so the slot moves to a replica that is getting it; a crashed replica's slot frees after the lease TTL; a graceful shutdown releases at once. Lowering N evicts the lexicographically-last replica names, so all replicas agree who stays. |
| timers | only a replica allowed to serve the workspace works its timers, and each job is claimed by exactly one replica — a timer fires once with 10 pods |

`maxReplicas` is the strictest of the **plan**'s `maxReplicas`, the per-workspace **platform override** `maxReplicasCap` and the global `maxReplicasCap` (0 = no limit). The platform administrator sees live placement at
`GET /api/platform/cluster` (replicas alive, holders per workspace, in-flight requests); every response carries `X-Served-By: <replica>`.

**Load balancer.** Because refused replicas answer 503, retry on 503: NGINX `proxy_next_upstream error timeout http_503 non_idempotent; proxy_next_upstream_tries <replicas>;`
(Envoy: `retry_on: 503`). To avoid retries for a workspace limited to 1 replica, route by tenant instead — NGINX Ingress
`nginx.ingress.kubernetes.io/upstream-hash-by: "$http_x_tenant_id"` (WebSocket: `$arg_tenant`). A larger `maxReplicas` therefore trades some retry traffic for capacity.

**If Redis is unreachable** the replica logs an error and enforces the limits per replica until it is back (the API stays up). In production a configured-but-unreachable Redis stops the boot rather than silently running unshared.
Redis holds only short-lived leases and counters — no business data — so it needs no persistence.

**Not shared yet:** the WebSocket hub (a client sees live events produced by the replica it is connected to, so use sticky routing for `/ws`) and the per-IP login/signup rate limiters.

## Not enforced yet — candidates for plans
Feature entitlements (booleans): SSO/OIDC login, custom roles, Java script dialect, outbound HTTP tasks, white-label branding, audit-log export, API access.
Capacity: API payload size, script memory/timeout, outbound HTTP calls per month, file/asset storage, execution history retention (days), audit retention, webhooks/WebSocket connections.
Commercial: price, billing period, overage behaviour (block vs. bill), SLA / support tier. See the discussion in the project notes before adding any of these — add them to
`modules/plans/plan-limits.ts` together with their enforcement and a test (the rule is: no limit without enforcement).
