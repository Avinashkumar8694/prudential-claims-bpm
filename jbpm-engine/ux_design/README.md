# jBPM Engine — UX Design (2026 rethink)

A ground-up UX pass over the whole product: every jBPM/Business Central screen researched, every
screen the current Angular app (`app/`) already ships, and the gap between them. This folder is the
**design gate before implementation** — the same role `docs/` played before the engine was built
(see [`../docs/README.md`](../docs/README.md)). Read it in order; [11-feature-matrix-and-roadmap.md](./11-feature-matrix-and-roadmap.md)
is what should actually drive build order.

This folder does **not** replace `../docs/`. It supersedes exactly one file there —
[`../docs/06-ui-spec.md`](../docs/06-ui-spec.md), which described an aspirational canvas
(`@foblex/flow`, minimap, dagre auto-layout) the app never actually adopted — and it fills a real
gap `../docs/13-projects-and-operations.md` left open (per-process cron scheduling, "planned",
never built). Everything else in `../docs/` (data model, API spec, execution engine, security,
validation rules) still stands; this folder is UI/UX only.

## Why this exists

The current app (branch `feat/engine`) is not a wireframe — it's a working, permission-gated,
realtime BPM console with a hand-rolled BPMN-like canvas, branching/versioning, deployments, an
execution engine, a task inbox, and IAM. It converged on good patterns (list+detail split,
shell+router-outlet, a real design-token system, permission-gated nav) documented in
[`../docs/13-projects-and-operations.md`](../docs/13-projects-and-operations.md). But it grew
screen-by-screen without ever comparing itself against the full breadth of what a mature BPM suite
(jBPM Business Central, and by extension Camunda/Flowable) actually covers. Two things came out of
that comparison, captured in [01-research-jbpm-and-competitors.md](./01-research-jbpm-and-competitors.md):

1. **Real gaps** — entire screens jBPM treats as first-class that we have zero UI for, even though
   the backend is sometimes already built for them: Execution Errors, Jobs/Timers, Dashboards &
   Analytics (`QueryApiService` is fully implemented and completely unused — see
   [08-module-dashboards-analytics.md](./08-module-dashboards-analytics.md)), Audit Log
   (`AuditEvent` entity exists, no viewer), per-project Access Control (`Workflow.permissions`
   round-trips through the API today with zero UI or enforcement reading it), a visual Form
   Builder (forms today are a name field, not a designed form), and richer task lifecycle
   (comments, delegation, business-admin actions, SLA).
2. **Real anti-patterns to deliberately avoid** — jBPM's own Design/Deploy/Manage/Track workbench
   is a single dense perspective-switching monolith. Camunda and Flowable both split the same
   capability into purpose-built apps per persona (Modeler vs. Tasklist vs. Cockpit/Operate vs.
   Admin) with much lighter, modern UX. Our current top-level nav (Projects / Deployments /
   Instances / Tasks / Admin) is *already* that persona split, not jBPM's grouping — this redesign
   extends that instinct rather than reverting to jBPM's five-menu shape.

## Design principles

1. **Persona-first navigation, not perspective-switching.** One nav item per job-to-be-done
   (build a process, watch it run, do my work, govern the system), not a mega-menu of nested
   perspectives. See [02-information-architecture.md](./02-information-architecture.md).
2. **One shape per job.** List+detail split for "browse many, act on one" (already the house
   style — Deployments/Instances/Tasks/Users/Roles/Groups). Filters → Advanced Filters → Saved
   Filters triad for any list that outgrows a status dropdown (jBPM's strongest, most consistently
   applied pattern — worth adopting outright). Don't invent a third shape.
3. **Never build a screen with no data behind it, and never leave data with no screen.** Every
   module doc below cross-checks against `server/src/domain.ts` and the API services in
   `app/src/app/core/api/` — flagging both "UI promises a field the backend doesn't have yet" and
   its mirror image, "the backend already computes this and nothing shows it."
4. **Same design tokens everywhere, extended not forked.** `app/src/styles.css`'s CSS custom
   properties (`--primary`, `--surface`, `--border`, status colors, `.btn`/`.card`/`.badge`/
   `.empty-state`/`.skeleton`) are the system. [03-design-system.md](./03-design-system.md) only
   adds new tokens/components where a genuinely new pattern is needed (filter bar, bulk-action
   bar, SLA badge, notification bell, comment thread) — it never introduces a parallel palette.
5. **Dark mode and permission-gating are not afterthoughts.** Every new screen in this design
   inherits `:root[data-theme="dark"]` token pairs and the existing `permissionGuard` +
   computed-signal side-nav filtering from day one, the same way Tasks/Admin already do.
6. **Don't design past what the engine can run.** Case Management (roles, milestones, ad-hoc
   stages) is real jBPM territory but the execution engine has zero case constructs today. It's
   fully spec'd in [10-case-management-future.md](./10-case-management-future.md) as an explicit
   *future* phase, not folded into the current IA as if it already works.

## Personas

| Persona | Primary jobs | Home screen |
|---|---|---|
| **Process builder / analyst** | Model processes, wire assets (forms, data objects, rules, decision tables), validate, build, deploy | Projects → a project's Processes workspace |
| **Business user / case worker** | Do assigned work, see what's waiting on them | Home dashboard → Tasks (My Tasks) |
| **Operations / support engineer** | Watch instances run, unstick stuck instances, triage errors, manage deployments across environments | Instances, Execution Errors, Deployments |
| **Process owner / manager** | Understand throughput, bottlenecks, SLA compliance, team workload — without touching the designer | Home dashboard → Reports & Analytics |
| **Platform admin** | Users/groups/roles, audit, system-wide settings, execution health | Admin |

## Documents

| # | Doc | What it covers |
|---|-----|-----------------|
| — | [README](./README.md) | This index — vision, principles, personas |
| 01 | [Research: jBPM & competitors](./01-research-jbpm-and-competitors.md) | Every jBPM/Business Central menu and screen researched, plus a jBPM→Camunda→Flowable concept comparison |
| 02 | [Information Architecture](./02-information-architecture.md) | Full sitemap/nav tree, jBPM-menu → our-nav mapping, what changed vs. the current app and why |
| 03 | [Design System](./03-design-system.md) | Token/component inventory, new components this redesign requires, interaction patterns |
| 04 | [Module: Projects & Designer](./04-module-projects-and-designer.md) | Home/Projects, Project workspace, Process Canvas (full palette/properties/validation spec), Assets, Form Builder, Data Objects, Contributors/Access |
| 05 | [Module: Operations](./05-module-operations.md) | Deployments/Execution Servers, Process Instances (list+detail), Execution Errors, Jobs & Timers |
| 06 | [Module: Tasks](./06-module-tasks.md) | Task Inbox (My/Available/All), task detail tabs, bulk actions, reassignment, SLA |
| 07 | [Module: Admin & IAM](./07-module-admin-iam.md) | Users/Groups/Roles (enriched), Audit Log, System Settings |
| 08 | [Module: Dashboards & Analytics](./08-module-dashboards-analytics.md) | Home dashboard, Process/Task analytics, Reports — surfaces the unused query/analytics backend |
| 09 | [Notifications & Realtime](./09-notifications-and-realtime.md) | Notification bell/panel, WS event catalog, email/reminder hooks |
| 10 | [Case Management (future)](./10-case-management-future.md) | Case definitions/roles/milestones/stages as a deferred phase, with rationale |
| 11 | [Feature Matrix & Roadmap](./11-feature-matrix-and-roadmap.md) | Full jBPM-parity matrix + phased build order (P0–P3) |
| — | [mockups/](./mockups/) | Static HTML mockups of key screens, built with the real `styles.css` tokens |

## How to use this while implementing

Each module doc marks every screen/behavior as one of:

- **Keep** — matches what's already built; described for completeness/cross-reference only.
- **Enrich** — the screen exists, this adds fields/actions/states to it.
- **New** — no screen exists today; backend may or may not exist yet (called out per item).

[11-feature-matrix-and-roadmap.md](./11-feature-matrix-and-roadmap.md) rolls all of these up into
one table with a phase (P0–P3), so implementation can be sequenced without re-deriving priority
from six separate docs.
