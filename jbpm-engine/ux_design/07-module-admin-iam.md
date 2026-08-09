# Module: Admin & IAM

Covers: Users/Groups/Roles (enriched), Audit Log (new), System Settings (new).

## Users / Roles / Groups (`admin/*-list.component.ts`, KEEP shape, small enrichments)

Current: list+detail split for all three, same pattern as everywhere else. Roles' fixed
`KNOWN_PERMISSIONS` checkbox (never freeform, since the backend does zero validation on permission
strings) is a deliberately good design decision — keep. Groups has no update endpoint server-side
(create/delete only) — keep as-is unless a real need for group-renaming shows up; don't add a
backend endpoint speculatively.

**Enrich**:
- **Users list**: add a **last login** column (needs `lastLoginAt` on `User` — small addition) and
  an **active workload** chip (open task count) — gives an admin a quick "is this person swamped"
  signal without leaving the page, same rollup idea as the Deployments health chip in
  [05-module-operations.md](./05-module-operations.md).
- **Roles list**: show a **usage count** ("assigned to 4 users") next to each role so deleting a
  role in active use is an informed decision, not a surprise 409 after the fact.
- **Group priority** (jBPM's group-priority-resolves-permission-conflicts model, research §9): not
  needed today since our permission model is role-based, not the additive per-resource-type
  exception model jBPM uses — explicitly **not** adopting this; it would be complexity with no
  corresponding problem in our simpler role/permission taxonomy. Flagged so a future reviewer
  knows it was considered and rejected, not missed.

## Audit Log (NEW screen — `AuditEvent` entity already exists server-side, zero UI)

Straightforward list+detail, the same shape as Execution Errors:

```
┌ Audit Log ──────────────────────────────────────────────────────┐
│ [Actor ▾] [Action ▾] [Entity type ▾] [Date range ▾]             │
├──────────────────────────────────────────────────────────────────┤
│ When         Actor      Action              Entity               │
│ 2m ago       avinash    workflow.deployed    Deployment #91       │
│ 1h ago       admin      role.updated         Role "analyst"       │
└──────────────────────────────────────────────────────────────────┘
```
- **Filters**: Actor (user picker), Action (grouped by entity type — workflow.*, deployment.*,
  instance.*, task.*, role.*/user.*/group.*), Date range (same quick presets used everywhere
  else). Advanced/Saved filters — same shared component, though likely lower-value here than on
  Instances/Tasks since audit browsing is usually "find one specific thing," not "watch a live
  operational view."
- **Row → detail**: before/after diff where applicable (e.g. role permission changes, workflow
  permission changes — directly useful once [Access](./04-module-projects-and-designer.md) ships,
  since permission changes are exactly the kind of thing that needs an audit trail).
- **Retention**: needs an explicit policy (jBPM's own `LogCleanupCommand` job exists precisely
  because unbounded audit logs are an operational problem, research §6) — surfaced as a System
  Settings option below, not hardcoded.
- **Backend dependency**: `AuditEvent` entity exists; needs a list/query endpoint
  (`GET /audit?actor=&action=&entityType=&from=&to=`) gated by `admin:iam`. Small, additive.
  Roadmap P1.

## System Settings (NEW screen — global config, distinct from per-project Settings)

Today the only "settings" screens are per-project (`project-settings.component.ts`) and per-
account (`settings.component.ts`) — there's no home for genuinely global/system-wide config. This
mirrors jBPM's gear-icon admin area minus everything that only makes sense with a Maven/JDBC/KIE-
Server layer we don't have (Data Sources, Data Sets, Artifacts, Archetypes — explicitly out of
scope, [02-information-architecture.md](./02-information-architecture.md)):

```
Admin › System Settings
┌ General ──────────────────────────────────────────────────────┐
│ Default page size            [25 ▾]                            │
│ Session timeout               [8h ▾]                            │
├ Audit ──────────────────────────────────────────────────────────┤
│ Retention                     [90 days ▾]                       │
├ Notifications ────────────────────────────────────────────────┤
│ SLA breach warning threshold  [80% of due time ▾]                │
│ Email delivery                [Not configured — Configure]      │
└──────────────────────────────────────────────────────────────┘
```
- **General**: default pagination (jBPM's own admin-configurable default applying across Process
  Definitions/Instances/Tasks/Errors/Jobs, research §10), session timeout.
- **Audit**: retention window (feeds a scheduled cleanup, the direct equivalent of jBPM's
  `LogCleanupCommand` — implemented as our own `TimerJob` kind rather than a generic executor
  command, consistent with [05](./05-module-operations.md)'s Jobs & Timers model).
- **Notifications**: SLA-warning threshold (used by the SLA badge's amber/red cutoff,
  [03-design-system.md](./03-design-system.md) §3), email delivery config (SMTP or provider —
  needed once [Notifications](./09-notifications-and-realtime.md)'s email/reminder hooks are real,
  not just in-app). Gated `admin:iam`, single page, no list+detail needed (it's config, not
  records) — same shape as `settings.component.ts` (account settings), just scoped globally and
  admin-gated instead of self-service.
