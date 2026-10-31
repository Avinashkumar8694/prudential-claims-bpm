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
* Counters, the request gates and queues are **per pod** (in memory); with N pods the effective request limits are ×N. Usage counters live in the `usage` collection (Postgres).
* Edits take effect within ~2 s on the process that serves the request (immediately on the process that made the edit).
* Existing databases are topped up on start-up: stored plans gain any limit key they lack, admin-edited values are never overwritten, the old 14-day trial becomes 7 days.

## Not enforced yet — candidates for plans
Feature entitlements (booleans): SSO/OIDC login, custom roles, Java script dialect, outbound HTTP tasks, white-label branding, audit-log export, API access.
Capacity: API payload size, script memory/timeout, outbound HTTP calls per month, file/asset storage, execution history retention (days), audit retention, webhooks/WebSocket connections.
Commercial: price, billing period, overage behaviour (block vs. bill), SLA / support tier. See the discussion in the project notes before adding any of these — add them to
`modules/plans/plan-limits.ts` together with their enforcement and a test (the rule is: no limit without enforcement).
