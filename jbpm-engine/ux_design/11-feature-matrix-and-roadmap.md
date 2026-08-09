# Feature Matrix & Roadmap

Every item from modules 04–10, rolled into one build-order list. Phases:

- **P0** — cheapest + highest value: pure frontend against APIs/entities that already exist, or a
  near-zero backend addition. Do these first regardless of anything else.
- **P1** — needs a real but small backend addition (a new list endpoint, a new small entity).
- **P2** — needs a genuinely new backend capability (new engine semantics, storage, or a resolver).
- **P3** — deferred/out-of-scope-for-now (Case Management, DMN boxed-expression editor).

## P0 — frontend-mostly, backend already there

| Feature | Module | Why it's P0 |
|---|---|---|
| Home dashboard (KPI tiles, my tasks, activity feed) | [08](./08-module-dashboards-analytics.md) | `Summary`/`analyticsSummary()` fully built, zero consumers |
| Reports & Analytics (Processes/Tasks tabs) | [08](./08-module-dashboards-analytics.md) | `analyticsProcesses`/`analyticsTasks` fully built, zero consumers |
| Access tab (per-project permissions) | [04](./04-module-projects-and-designer.md) | `Workflow.permissions` + `PUT /workflows/:id/permissions` already round-trip |
| Project Overview tab (landing after opening a project) | [04](./04-module-projects-and-designer.md) | Every number on it is already computed elsewhere (processes/assets/deployments/instances APIs) — new screen, no new data |
| Instances filter bar (Filters/Advanced/Saved/Columns) | [05](./05-module-operations.md) | Pure frontend over the existing `listInstances` API's params |
| Tasks filter bar + bulk actions bar | [06](./06-module-tasks.md) | Pure frontend over existing `listTasks`/claim/release/complete |
| Task detail: Details, Assignments (read), Comments (UI shell) tabs | [06](./06-module-tasks.md) | Mostly rendering fields (`priority`, `dueAt`, owners) already on `Task` |
| Footer status bar wiring (validation/save-state) | [02](./02-information-architecture.md), [03](./03-design-system.md) | Component already exists, just unwired |
| Data Object field editor | [04](./04-module-projects-and-designer.md) | Extends the existing `types` asset kind's seed shape |
| Users list: usage/workload chips | [07](./07-module-admin-iam.md) | Derived from data already queryable |

## P1 — small, additive backend work

| Feature | Module | Backend addition needed |
|---|---|---|
| Execution Errors screen | [05](./05-module-operations.md) | Promote `Instance.error` to a persisted, listable error log |
| Jobs & Timers screen | [05](./05-module-operations.md) | `GET /jobs` list/query endpoint over existing `TimerJob` |
| Audit Log screen | [07](./07-module-admin-iam.md) | `GET /audit` query endpoint over existing `AuditEvent` |
| System Settings screen | [07](./07-module-admin-iam.md) | A small global-config entity (page size, SLA threshold, retention) |
| In-app notification bell + panel | [09](./09-notifications-and-realtime.md) | `Notification` entity + one new WS topic |
| Task Comments (real persistence) | [06](./06-module-tasks.md) | `TaskComment` sub-collection or entity |
| Task Delegate/Forward actions | [06](./06-module-tasks.md) | New `delegate`/`forward` endpoints alongside claim/release/complete |
| Environment overrides UI (project settings) | [04](./04-module-projects-and-designer.md) | UI only — `Deployment.env` already exists, just needs a form |
| Scheduled start (project settings) | [04](./04-module-projects-and-designer.md) | UI only — `TimerJob.kind:'start'` already modeled |
| Deployment compare/diff | [05](./05-module-operations.md) | UI only — `GET /versions/:a/diff/:b` already exists |
| Integration base URL: wire or remove | [04](./04-module-projects-and-designer.md) | Either wire the field to real per-project config, or delete it |

## P2 — real new capability

| Feature | Module | What's genuinely new |
|---|---|---|
| Visual Form Builder | [04](./04-module-projects-and-designer.md) | New editor surface + a field-type/runtime-rendering contract |
| Decision Table / Decision Tree grid+tree editors | [04](./04-module-projects-and-designer.md) | New editor surfaces |
| SLA end-to-end (task + process, badges, filters) | [03](./03-design-system.md), [05](./05-module-operations.md), [06](./06-module-tasks.md) | `dueAt` exists on `Task`; needs process-level SLA + rollup logic |
| Reassignment/notification rules authored on User Task nodes | [06](./06-module-tasks.md) | Engine evaluates time-based rules, not just manual Forward |
| Multiple Instance (sequential/parallel) on User Task & Reusable Subprocess | [04](./04-module-projects-and-designer.md) | Engine semantics for MI execution + completion condition |
| Canvas: real auto-layout (dagre/elk.js), minimap, marquee-select, copy/paste | [03](./03-design-system.md) §6 | Canvas engineering |
| Document-typed variables + file storage | [04](./04-module-projects-and-designer.md), [05](./05-module-operations.md) | Storage strategy decision, Document field type, Documents tab |
| Variable-change history (Instances → Process Variables) | [05](./05-module-operations.md) | Audit trail on variable writes |
| Log tab filters (Event Node Type / Event Type + Reset) | [05](./05-module-operations.md) | Mostly UI, small query-param addition |
| NL "Ask" filter on the filter-bar triad | [03](./03-design-system.md) §1 | NL→predicate resolver; structured builder ships standalone first |
| Email delivery for notifications | [09](./09-notifications-and-realtime.md) | SMTP/provider integration |
| Command/search palette (⌘K) | [02](./02-information-architecture.md) | Cross-entity search index |
| Swimlanes on canvas | [04](./04-module-projects-and-designer.md) | Canvas rendering + actor-propagation engine semantic |

## P3 — deferred / explicitly out of scope for now

| Feature | Why deferred |
|---|---|
| Case Management (roles, milestones, stages, Case Overview) | Engine has zero case constructs today — see [10-case-management-future.md](./10-case-management-future.md) |
| DMN boxed-expression editor | Large, separable effort; `decisions` kind stays name-only until this is prioritized |
| Complex gateway | Rare in practice per jBPM's own docs; revisit only if a real process needs it |
| Dashbuilder-style custom dashboard authoring | Build the fixed Processes/Tasks reports first; generic authoring is speculative until there's a real ask |
| Notification preferences screen | Event catalog too small today to justify a preferences UI |
| Group priority / per-resource exception permission model | Our role-based model has no corresponding problem to solve yet |

## Explicitly out of scope (not a phase — just not applicable to this engine)

Execution Servers/KIE Containers (we deploy to environments, not a physical server fleet), Data
Sources/Data Sets/Artifacts/Archetypes (no Maven/JDBC layer), Process Instance Migration (jBPM
itself ships this as Technology Preview), Java/WebService Service Task implementation details
(this engine's integration surface is HTTP-node-based, not JVM-classpath-based).

## Suggested build order (cross-module)

1. All of **P0** — no backend work, immediate visible value, closes the "biggest built-and-unused
   backend surface" gap (Dashboards) and the "cheapest new screen" gap (Access) in one pass.
2. **P1** items needed to unblock daily ops use: Execution Errors, Jobs & Timers, Audit Log — these
   three complete the Operations persona's toolkit.
3. Remaining **P1**: notifications, task comments/delegate, deployment compare, settings gaps.
4. **P2**, prioritized by which persona is currently most underserved once P0/P1 land — likely
   Form Builder first (it's the biggest single visible gap a business user would notice) then SLA.
5. **P3** only once a specific project genuinely needs Case Management or DMN — don't build ahead
   of that need.
