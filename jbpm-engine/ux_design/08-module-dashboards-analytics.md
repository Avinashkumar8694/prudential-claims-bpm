# Module: Dashboards & Analytics

The single biggest "backend already built, zero UI" gap in the whole codebase. `QueryApiService`
(`app/src/app/core/api/query-api.service.ts`) already implements `queryUsers`, `userTasks`,
`userTasksCompleted`, `groupTasks`, `processDefinitions`, `processSignals`, `analyticsSummary`,
`analyticsTasks`, `analyticsProcesses` against a fully-built backend (`server/src/modules/
queries/` + the `/query/*` routes) — and **no component in the app calls any of it**. This module
gives that backend its front door.

## Home (`/`, NEW landing page — replaces the `/projects` redirect as the default route)

```
┌ Home ────────────────────────────────────────────────────────────┐
│  Active Instances    Open Tasks     Deployments      Errors (24h) │
│       128                34               6               2      │
├────────────────────────────────────────────────────────────────┤
│ My open tasks (top 5)          │  Recent activity                │
│  • Review claim #4021 (2h)     │  • Deployment "prod" v12 ✓ 5m   │
│  • Approve refund #398 (due)   │  • Instance #1092 failed  12m   │
│  ...                            │  • New project "Onboarding" 1h  │
├────────────────────────────────────────────────────────────────┤
│ Quick actions: [+ New Project]  [Import jBPM]  [View Reports →]  │
└────────────────────────────────────────────────────────────────┘
```

- **KPI tiles** sourced directly from `Summary` (`instances.total/byStatus`,
  `tasks.total/byStatus`, `deployments.total/active`, `jobs.scheduled/fired`) via
  `analyticsSummary()` — literally already modeled, just needs rendering.
- **My open tasks** — `userTasks(currentUser)`, top N by due date/priority, click-through to Tasks.
- **Recent activity** — feeds from the same event stream backing
  [Audit Log](./07-module-admin-iam.md) and [Notifications](./09-notifications-and-realtime.md);
  this widget is a *filtered, small* view of that same data, not a separate concept.
- **Content adapts to permission**: a user with only `task:manage` (no `workflow:view`) sees "My
  open tasks" and nothing else; an admin/builder sees the full board. Same computed-signal gating
  pattern the side-nav already uses.
- Replaces `/` → `/projects` redirect; `/projects` stays reachable via nav, just isn't the forced
  landing page anymore (a process owner logging in wants the dashboard, not a project grid — the
  IA in [02-information-architecture.md](./02-information-architecture.md) reflects this).

## Reports & Analytics (`/reports`, NEW)

Two tabs, matching jBPM's own Process & Task Dashboard split (research §8), but backed by
`analyticsProcesses()`/`analyticsTasks()` instead of jBPM's 14 raw SQL data providers — same
*shape* of insight, our own query layer instead of Dashbuilder:

### Processes tab
- **Throughput over time** — instance start/completion counts by day/week (from
  `ProcessAnalytics.byStatus` + a time bucket, small addition to the existing aggregate if not
  already bucketed).
- **Duration by process** — `DurStats` (count/avgMs/minMs/maxMs) per process, rendered as a sorted
  bar list — directly what `analyticsProcesses().byProcess` already returns.
- **Status breakdown** — donut/bar of active/completed/aborted/failed/suspended, from
  `byStatus`.
- Filter bar: process definition, date range (same shared component as every other list screen —
  filters aren't just for tables, they scope charts too).

### Tasks tab
- **Duration by task name** and **by assignee** — `TaskAnalytics.byTask`/`byAssignee`, both
  already `DurStats`-shaped.
- **Open tasks by status** — `openByStatus`, a live snapshot (not historical).
- **Workload distribution** — who has how many open tasks right now — directly answers the
  "is anyone overloaded" question a process owner persona actually has, and is a natural rendering
  of `userTasks`/`groupTasks` aggregated by user, not a new backend concept.

### What's explicitly not being built here

- **Dashbuilder-style drag-and-drop custom dashboard authoring** — jBPM's generic BAM tool is a
  large, separate product surface (arbitrary data-source wiring, saved custom widgets). Not worth
  building a generic dashboard *authoring* tool before the fixed, purpose-built Processes/Tasks
  reports above even exist. If a real need for ad hoc custom dashboards shows up later, revisit —
  don't build it speculatively now (matches the project's stated engineering values).
- **Data Sets admin screen** — no equivalent need without a Dashbuilder-style pluggable data-
  source layer.

### Export

A **Export CSV** action on each chart/table (reuses the existing `Version`/`Deployment` export
pattern already in the codebase — download-a-blob, no new export pipeline needed) — the minimum
viable version of jBPM's implicit "reports are for taking to a meeting" job, without building a
scheduled-report/emailed-PDF system nobody's asked for yet.

## Roadmap note

Because the backend for this entire module already exists, it's disproportionately cheap relative
to its value — flagged prominently in
[11-feature-matrix-and-roadmap.md](./11-feature-matrix-and-roadmap.md) as a strong P0/P1 candidate
precisely *because* it's mostly frontend work against APIs that already work today.
