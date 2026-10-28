# Information Architecture

## Top-level nav (side-nav)

```
Home                        NEW — dashboard/landing (see 08)
Projects                    KEEP — build workspace
Deployments                 KEEP — cross-project, ?workflowId= pre-filter stays
Instances                   KEEP — cross-project, ?workflowId= pre-filter stays
Execution Errors            NEW — cross-project, ?instanceId= pre-filter
Jobs & Timers               NEW — cross-project, scheduled/fired timers
Tasks                       ENRICH — tab-scoped: My Tasks / Available / All (admin)
Reports & Analytics         NEW — surfaces the already-built, unused query/analytics API
─────────────────────────────
Admin                       ENRICH — Users / Roles / Groups / Audit Log / System Settings
Settings                    KEEP — account-level (theme + own password), unchanged
```

Permission gating follows the existing computed-signal pattern in `side-nav.component.ts` — every
new item declares the permission it needs and the list re-derives on login, exactly like
`Deployments`/`Instances` today gate on `workflow:view` and `Tasks` gates on `task:manage`:

| Nav item | Gate |
|---|---|
| Home | always (content adapts to permissions) |
| Projects | always |
| Deployments, Instances | `workflow:view` |
| Execution Errors, Jobs & Timers | `workflow:view` |
| Tasks | `task:manage` |
| Reports & Analytics | `query:read` *(exists on the backend already, unused — see 08)* |
| Admin | `admin:iam` |
| Settings | always |

## Why this shape, not jBPM's

jBPM's top bar is **Home / Design / Deploy / Manage / Track**, each a dropdown into 2-4 more
screens, plus a separate gear icon for Admin. That's a defensible IA for a single do-everything
workbench, but two things make it worse for us to copy verbatim:

1. **"Manage" and "Track" overlap on purpose** (`Manage → Tasks` and `Track → Task Inbox` are
   *the same screen* scoped differently) — confirmed in research §7 — which only makes sense if
   you already know the product. Collapsing that into one **Tasks** page with scope tabs (My /
   Available / All) is strictly clearer and is what the current app already does.
2. **Deploy and Manage are both "operations," split only because jBPM models a physical KIE
   Server fleet** we don't have (we deploy to logical **environments**, not execution-server
   templates). Splitting Deployments/Instances/Errors/Jobs into flat top-level items — as the
   current app already does for the first two — avoids inventing a "Deploy" vs. "Manage" menu
   distinction that maps to nothing in our domain model.

The one place we deliberately *add* structure jBPM doesn't have at the top level: **Home** and
**Reports & Analytics** as their own nav items, because the backend for both already exists
(`QueryApiService`, `Summary`/`TaskAnalytics`/`ProcessAnalytics` models) and today has literally no
UI — see [08-module-dashboards-analytics.md](./08-module-dashboards-analytics.md). jBPM bolts this
onto "Track" almost as an afterthought (thinly documented); we're making it a first-class citizen
because it's the screen a process *owner* (not builder, not operator) lives in.

## jBPM menu → our nav mapping

| jBPM (Business Central) | Our nav | Status |
|---|---|---|
| Home | Home | New |
| Design → Projects (Space→Project→asset Library) | Projects → project shell | Keep, enrich (Contributors/Access tab) |
| Design → Projects → Business Process (BPMN2 canvas) | Projects → \[project\] → Processes (embedded canvas) | Keep, enrich (see 04) |
| Design → Projects → Form asset / Form Modeler | Projects → \[project\] → Assets → Forms (visual builder) | Enrich — today a name-only seed |
| Design → Projects → Data Object | Projects → \[project\] → Assets → Data Objects (`types` kind) | Enrich — needs a field editor |
| Design → Projects → Decision Table / DMN / Guided Rule | Projects → \[project\] → Assets (decisionTrees/guidedTables/decisions/rulesets) | Enrich — needs per-kind editors |
| Design → Projects → Settings (GAV/KIE Base/Persistence/etc.) | Projects → \[project\] → Settings | Keep (already scoped down to what our single-runtime engine needs — no KIE Base/persistence-unit concepts to expose) |
| Deploy → Execution Servers | Deployments (environment-scoped, not server-template-scoped) | Keep — different model, same job |
| Deploy → Jobs | Jobs & Timers | New — backend (`TimerJob`) exists, no UI |
| Manage → Process Definitions | Projects → \[project\] → Processes (list) doubles as this | Keep — we don't need a separate cross-project "all definitions" list; a project already scopes its processes |
| Manage → Process Instances | Instances | Keep, enrich (filters triad, columns) |
| Manage → Tasks (admin) + Track → Task Inbox (personal) | Tasks (scope tabs) | Keep, enrich |
| Manage → Execution Errors | Execution Errors | New — no UI or backend model today (roadmap P1) |
| Manage → Process Instance Migration | *(not planned — Technology Preview even in jBPM itself)* | Out of scope |
| Track → Process Reports / Business Dashboards | Reports & Analytics | New |
| gear → Users/Groups/Roles | Admin → Users/Roles/Groups | Keep, enrich |
| gear → (implicit) audit | Admin → Audit Log | New — `AuditEvent` entity exists, no UI |
| gear → Data Sources / Data Sets / Artifacts / Archetypes | *(not applicable — no Maven/JDBC layer in this engine)* | Out of scope |
| Apps launcher → Case Management Showcase | *(future — see 10-case-management-future.md)* | Deferred |

## Project workspace nav (inside a project — `ProjectShellComponent` tabs)

```
Overview          NEW  — landing tab after opening a project: stats, processes, assets,
                          activity, contributors — every tile links onward (see 04)
Processes         KEEP — list + embedded canvas, unchanged shape
Assets            KEEP — enrich per-kind editors (Forms, Data Objects, Decision Tables)
Access            NEW  — Contributors/permissions editor surfacing Workflow.permissions
                          (already round-trips through PUT /workflows/:id/permissions,
                          today read by nothing — this is the single cheapest "new" screen
                          in the whole redesign, pure UI, zero backend work)
Settings          KEEP — General + shared variables (unchanged); flag "planned" items
                          (per-process cron, environment overrides) explicitly as P2 roadmap,
                          don't silently drop them from the doc trail
```

Deployments and Instances stay **out** of the project shell, exactly as the current app already
decided (`docs/13`'s own comment: deliberately top-level with `?workflowId=` filtering, not nested
routes) — this redesign keeps that call. It's the right one: an operator watching instances across
every project shouldn't have to enter a specific project first.

## Global chrome additions

- **Notification bell** in the header/side-nav footer area (next to the user avatar), badge count,
  dropdown of recent events — see [09-notifications-and-realtime.md](./09-notifications-and-realtime.md).
  This is new chrome, not a new nav item.
- **Command/search palette** (⌘K) — jump to a project, process, instance by id, or task by id
  without walking the nav. Not present in jBPM's UI at all (its search icon is a full-page search,
  thinly documented) — a deliberate improvement, not parity work. P2 roadmap.
- **Footer status bar** (`shell/footer.component.ts`) already exists but is currently unwired dead
  chrome (no component binds its `errors`/`status` inputs). This redesign wires it to the active
  canvas's live validation/save-state when a Processes workspace is open, and to "Ready" elsewhere
  — closing a gap already flagged in the existing frontend-conventions memory, not a new concept.

## Breadcrumb discipline

Every screen keeps the existing `shared/breadcrumb.component.ts` contract
(`[{label, link?, onClick?}]`). New screens follow the same pattern jBPM's docs use internally
(`Section → Subsection → Item`) so the breadcrumb trail and this IA never drift apart:

- `Home`
- `Projects › {project} › Processes`, `› Assets`, `› Access`, `› Settings`
- `Deployments` (`› {env}` when one is selected)
- `Instances` (`› #{id}`)
- `Execution Errors`
- `Jobs & Timers`
- `Tasks › My Tasks | Available | All`
- `Reports & Analytics › Processes | Tasks`
- `Admin › Users | Roles | Groups | Audit Log | System Settings`
