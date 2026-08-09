# Module: Tasks

Covers: Task Inbox scope tabs, task detail tabs, bulk actions, reassignment/escalation, SLA.

## Task Inbox (`task-inbox.component.ts`, ENRICH — restructured to list-only + a dedicated task page)

Current: 3 client-side scope tabs (My Tasks / Available / All), list+detail split, inputs read-only
+ generic key-value output editor for completion, Claim/Release/Skip. This redesign changes the
*shape*, not the scope tabs: Task Inbox becomes a **list-only** screen (full-width table, filter
bar, bulk-action bar — no side detail pane always occupying half the screen), and clicking a task
row **navigates to a dedicated task page** (its own route, `/tasks/:id`) rather than populating an
inline pane. This is a deliberate departure from the list+detail split used elsewhere
(Deployments/Instances/Users/Roles/Groups) — justified because a task's Work tab is a full
*rendered form* (once [Form Builder](./04-module-projects-and-designer.md) ships), not a handful of
fields; a 380px side pane is too cramped for that, the same way a Process Instance's Diagram tab
already gets a full-width area rather than being squeezed into a side panel. Reuse the shape from
[Project Overview](./04-module-projects-and-designer.md) (a dedicated page you land on after
clicking into an item from a list) rather than inventing a third pattern.

Scope tabs (My Tasks / Available / All) still gate what's *in* the list, matching jBPM's
`Manage → Tasks` (admin) vs. `Track → Task Inbox` (personal) split collapsed into one screen —
research §7 confirms those are *the same underlying screen* in jBPM anyway, so keeping one screen
with scope tabs (now feeding a list-only view) is still the right call.

**Rename "All" tab visibility**: gate it explicitly on a permission (e.g. `task:manage:all` or
reuse `admin:iam`) rather than showing it to everyone who can reach `/tasks` — mirrors jBPM's own
rule that only `process-admin` sees the true all-tasks view (research §7); today's client-side-
only scoping is advisory (server re-checks), which is fine for data safety but the *tab itself*
showing to non-admins is a clarity gap worth closing.

### List enrichments — same filter-bar component as Instances

- **Filters**: Status (multi-select: created/ready/reserved/inprogress/completed/skipped/error —
  our actual `Task.status` union, not jBPM's longer list since we don't model
  suspended/exited/obsolete as distinct states today), Process, Assignee/Group, Created-on quick
  ranges (Last hour/Today/7 days/30 days/Custom), **SLA** (once due-date SLA lands, see below).
- **Advanced filter + Saved filters + Column picker**: identical shared component from
  [03-design-system.md](./03-design-system.md); task-variable-as-column once filtered to one task
  name (exact jBPM pattern).
- **Bulk actions bar**: Bulk Claim, Bulk Release, Bulk Reassign (opens a small dialog: target user
  + confirm) — direct port of jBPM's bulk-action set (research §7), each row reporting its own
  success/skip rather than one aggregate result.

### Task detail page — expand from 2 implicit sections to jBPM's full tab set, minus what doesn't apply

Each tab below is its own route (`/tasks/:id`, `/tasks/:id/details`, `/tasks/:id/assignments`, …)
sharing one header (task name, SLA badge, breadcrumb back to Tasks, "View instance →" link) — the
same "shared shell, real child routes" pattern already used for `ProjectShellComponent` and
`AdminShellComponent`, not a `tab = signal()` + `@switch` fake-tab. This is what makes "all tabs
working" true rather than aspirational: every tab is a real navigable page, not a static pill.

| Tab | Status | Notes |
|---|---|---|
| **Work** | Keep, rename | Today's "inputs read-only + output editor" *is* the Work tab; once [Form Builder](./04-module-projects-and-designer.md) ships, this renders the task's actual designed form instead of a generic key-value editor — Claim/Release/Start/Complete stay here |
| **Details** | NEW | Description, Priority, **Due Date** (date+time picker, feeds SLA), an **Update** button — small, mostly UI, `Task` already has `priority`/`dueAt` fields |
| **Assignments** | NEW | Current actual owner + potential owners (group/actor list already on the task); a **Delegate** control (pick a user, hand off) — needs a `delegate` action added to `TaskApiService`/backend, small addition alongside existing claim/release/complete/skip |
| **Comments** | NEW | Shared comment-thread component ([03](./03-design-system.md) §5); needs a `comments` sub-collection on `Task` or a lightweight `TaskComment` entity — backend addition, P1 |
| **Admin** | NEW, gated | Visible only to business-admins (`businessAdmin` field already exists on `Task`): potential-owner list, **Forward** (hand to a specific different user, distinct from Delegate which the current owner initiates), **Send reminder** to the actual owner (ties into [09-notifications-and-realtime.md](./09-notifications-and-realtime.md) rather than real email infra initially) |
| **Logs** | NEW | Task lifecycle audit (created/claimed/started/completed/reassigned, with timestamps) — surfaces from the same audit trail as [Admin's Audit Log](./07-module-admin-iam.md), filtered to this task |

### Reassignment & Notification rules (authoring-time, lands on the User Task node — see 04)

jBPM lets a User Task carry **time-based reassignment** ("not started within 4h → reassign to
manager") and **notification** rules authored on the node itself, evaluated by the engine, not
manually triggered by an operator. This is a real engine feature gap, not just a UI gap — flagged
here because it changes what the Task detail's Admin tab can show (a "scheduled reassignment
pending" indicator) once it exists. Roadmap P2 (engine work) — the Admin tab's Forward/reminder
actions above are the manual equivalent and should ship first since they need no engine changes.

### SLA

`Task.dueAt` already exists on the domain model but has no UI treatment today. Add:
- SLA badge ([03-design-system.md](./03-design-system.md) §3) on every task row and in the detail
  header, computed from `dueAt` vs. now.
- Instance-level SLA rollup (shown on the Instances list, [05-module-operations.md](./05-module-operations.md))
  — "at risk" if any open task/subprocess within the instance is at risk.
- **SLA Compliance** as a first-class filter value (Met/Pending/At-risk/Breached — jBPM's own
  "SLA Compliance" filter on Process Instances, research §7) once enough of this exists to compute
  it reliably. Roadmap P2.

## What's deliberately not carried over from jBPM here

- **Skippable-only-if-flagged** — keep exactly as-is, no change needed.
- jBPM's longer task-status vocabulary (Suspended/Exited/Obsolete) — not modeled today and not
  worth adding speculatively; if a real workflow needs "suspend a task," add the state then, not
  ahead of need (per the project's own "don't design for hypothetical future requirements" stance).
- A separate physical "Manage → Tasks" page — explicitly rejected above; one screen with scope
  tabs and a permission-gated "All" tab is strictly simpler and loses nothing.
