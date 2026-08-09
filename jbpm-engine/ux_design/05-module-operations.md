# Module: Operations

Covers: Deployments, Process Instances, Execution Errors (new), Jobs & Timers (new).

## Deployments (`deployments.component.ts`, KEEP shape, small enrichments)

Current: list grouped by environment with status badges, project filter, detail pane (definitions,
tags, deployedAt/By, Activate/Undeploy/Archive/Rollback). This already models jBPM's Execution
Servers concept correctly for a **logical-environment** deployment model (we don't have a physical
KIE-Server-fleet concept, and shouldn't invent one — see [02](./02-information-architecture.md)).

**Enrich**:
- Row-level **health chip** — active instance count + error count for that deployment, computed
  from Instances/Execution Errors, so an operator can spot "this deployment has 4 failing
  instances" without leaving the page (jBPM's Process Instances list rolls up errors per-row the
  same way, research §7).
- **Compare/diff two deployments** — the domain model already has `GET /versions/:a/diff/:b`; the
  Deployments detail pane should expose "Compare to another deployment in this environment" using
  that existing endpoint rather than requiring a new one. P1.
- **Duplicate-tag warning** — jBPM's duplicate-GAV detection has no equivalent need here (no Maven
  layer), but tag collisions across active deployments in the same environment are worth a soft
  warning (e.g. two `active` deployments both tagged `stable`) — P2, cosmetic.

## Process Instances (`instances.component.ts`, ENRICH heavily — restructured like Tasks)

Current: status-filtered list + 4-tab detail (Details/Variables/Logs/Diagram) in a single split-pane
screen, realtime redraw via `instance:<id>` WS topic. This redesign changes the *shape* the same way
[Tasks](./06-module-tasks.md) changed: **Instances becomes a list-only screen** with a **persistent
left filter rail** (not a flyout — jBPM's Filters/Advanced Filters/Saved Filters live in popovers;
this puts the same content always-visible in a ~260px left column, since an operations persona lives
on this screen and re-opening a filter flyout repeatedly is friction worth removing), and clicking a
row **navigates to a dedicated instance page** (own route, `/instances/:id`) with its own header,
quick-link actions, and tab bar — mirroring [Project Overview](./04-module-projects-and-designer.md)
and the [Task detail page](./06-module-tasks.md) pattern rather than a third bespoke shape.

### List: left filter rail (persistent, full jBPM filter set)

```
┌ Filters ──────┐┌ ✓ 1 selected  Suspend Resume Abort         ⚏ Columns ┐
│ State          ││ ID    Process   Status  Initiator  Started  ...      │
│ ☑ Active       ││ #1092 Claim...  failed  avinash    2h ago            │
│ ☐ Waiting      ││ #1091 Claim...  running avinash    2h 14m            │
│ ☑ Failed       ││ ...                                                  │
│ Has errors ☐   │└──────────────────────────────────────────────────────┘
│ SLA compliance │
│ [Met][At risk] │
│ [Violated][NA] │
│ Process ▾      │
│ Deployment ▾   │
│ Id / Initiator │
│ / Correlation  │
│ / Parent id    │
│ Start date     │
│ [7d][30d]...   │
│ + Advanced     │
│ ★ Saved        │
└────────────────┘
```

- **State**: checkboxes running/waiting/completed/aborted/failed/suspended (multi-select, not a
  single dropdown).
- **SLA Compliance**: Met/At risk/Violated/N-A chips (jBPM's own filter value set, research §7),
  once SLA lands (roadmap P2) — ships as inert chips before that, functional after.
- **Process / Definition** and **Deployment/Environment** pickers, **Id/Initiator/Correlation
  key/Parent Process ID** text filters (exact jBPM "Filter By" set), **Start date** quick-range
  chips (Today/7d/30d/Custom).
- **+ Advanced filter**: opens the `field/operator/value` predicate builder
  ([03-design-system.md](./03-design-system.md) §1) for anything not covered above (any process
  variable, once filtered to one definition).
- **★ Saved filters**: per-user list at the bottom of the rail, one markable default.
- **Column picker** (`⚏ Columns`, top-right of the table) and **Bulk actions bar** (Suspend/Resume/
  Abort, appears on selection) stay with the table, not the filter rail — filters scope *what's in*
  the list, columns/bulk-actions act *on* it, different jobs.

### Instance page (dedicated, per-instance — NEW shape)

Header shared across all 5 tabs: breadcrumb `← Instances`, title + status badge + SLA badge, meta
line (initiator, started, correlation key, deployment), and three **quick-link actions** the old
split-pane never had room for: **View Process →** (jumps to the process definition's canvas,
[project-workspace.html](./mockups/project-workspace.html)), **View Tasks →** (Tasks scoped to this
instance), **View Errors →** (Execution Errors scoped to this instance) — this is what actually
answers "show me this instance's tasks and its errors" directly from the instance itself, not just
via a generic cross-instance list. Below that, the same lifecycle buttons (Signal/Suspend/Abort).

### Detail tabs — enrichments

| Tab | Today | Add |
|---|---|---|
| Details | (was folded into a header) | Own tab, first/default: status, current activity, initiator, started/updated, correlation key, deployment link, **Related** panel (parent link, child instances, open tasks on this instance, errors on this instance — each a real link) |
| Diagram | ✓ (active/visited highlighting, parent/child nav, signal/retry/suspend/resume/abort) | **Modern canvas treatment**: curved gradient connectors with arrowheads (not straight lines), port dots on every node edge, category-colored icon chips, a real minimap with mini node rectangles + viewport box, zoom pill — same visual system as the [process builder canvas](./04-module-projects-and-designer.md), not a separate look |
| Variables | ✓ (view) | Inline **edit** with a confirm modal (jBPM allows editing running-instance variables directly) + **per-variable history** (requires a variable-change audit trail — roadmap P2, ties into Audit Log module) |
| Logs | ✓ | Filter checkboxes by **Event Node Type** / **Event Type** + a **Reset** button (exact jBPM shape, research §7) — today's log tab is unfiltered per the audit |
| Documents | *(none)* | **NEW** — only rendered if the instance has a Document-typed variable (once Form Builder's Document field type ships, [04](./04-module-projects-and-designer.md)); list + download, matches jBPM exactly. Depends on file-storage roadmap item (P2) |

### Bulk actions (list)

Multi-select rows → **Bulk Abort**, **Bulk Suspend/Resume** (jBPM doesn't document bulk instance
actions explicitly, but it's a direct, low-risk extension of the existing per-row actions, and the
Tasks screen already needs the same bulk-action bar component — reuse it here for consistency
rather than building instances-specific bulk logic).

## Execution Errors (NEW screen — no UI, no backend model today)

The single clearest "jBPM has this, we don't, and it matters for an ops persona" gap. List+detail,
same shape as every other operational screen:

```
┌ Execution Errors ───────────────────────────────────────────────┐
│ [Type: Task/Process/Job ▾] [Acknowledged: No ▾] [Date range ▾]  │
├───────────────────────────────────────────────────────────────┤
│ ID   Type     Instance   Message                    When   [Ack]│
│ 41   Task     #1092      "Script node threw..."      2m    ○   │
│ 40   Process  #1088      "Unhandled signal..."        1h    ✓   │
└───────────────────────────────────────────────────────────────┘
```

- **Filters**: Type (Task/Process/Job — DB-level errors don't apply, we don't have a separate DB
  tier the UI needs to surface), Instance Id, Acknowledged yes/no, Date range (quick presets: Last
  hour/Today/7 days/30 days/Custom — exact jBPM shape, research §7).
- **Row → detail**: full stack/message, node/task context, **Acknowledge** button (records
  acknowledging user + timestamp — needs an `acknowledgedBy`/`acknowledgedAt` pair, small addition
  wherever errors get persisted), **Go to Instance** (always — we don't have jBPM's separate
  "Go to Task" vs. instance distinction since a task error *is* an instance error in our model).
- **Backend dependency**: today an instance's `error?: {nodeId, message, at}` is a single field on
  `Instance`, not a queryable error log — this screen needs errors promoted to their own persisted,
  listable record (one row per error occurrence, not just "the most recent error"). Roadmap P1 —
  this is real backend work, not just a new page.
- **Realtime**: new errors push via `RealtimeService` (a new `errors` topic) so the list updates
  live, matching the "watch things break in real time" job an ops persona actually has.

## Jobs & Timers (NEW screen — backend partially exists: `TimerJob` in `server/src/domain.ts`)

jBPM's Jobs screen (Deploy → Jobs) is thinly documented beyond its creation dialog (research §6) —
this redesign doesn't copy its generic "any executor command" model verbatim (we don't have a
Java-executor-command concept), it instead surfaces what our engine actually schedules:
`TimerJob` kinds `duration` / `cycle` / `date` / `start`.

```
┌ Jobs & Timers ────────────────────────────────────────────────┐
│ [Kind: all ▾] [Status: scheduled/fired ▾]                     │
├────────────────────────────────────────────────────────────────┤
│ Process        Node/Kind        Next fire        Status         │
│ Claim Review   Timer(cycle)     in 3h 12m         scheduled      │
│ Onboarding     start-timer      daily @ 02:00     scheduled      │
└──────────────────────────────────────────────────────────────┘
```

- **List**: process/instance context, kind, next-fire countdown (live via realtime, not a static
  timestamp — the countdown is the whole point of this screen existing), status
  (scheduled/fired/cancelled).
- **Row actions**: **Cancel** (for cancellable timers), **Trigger now** (manual fire, useful for
  testing/ops override — jBPM's admin API exposes an equivalent "update timer relative to current
  time"/"trigger node" operation, research §7).
- A `start`-kind job is a scheduled *process launch*, not a resumed token (per `docs/08-execution-
  engine.md`'s existing semantics) — the UI must label these distinctly ("starts a new instance")
  so an operator doesn't mistake a recurring-start schedule for a stuck running instance.
- **Backend dependency**: `TimerJob` already models this; needs a list/query endpoint
  (`GET /jobs` with kind/status filters) — small, additive, no schema change. Roadmap P1.
