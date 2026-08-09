# jBPM Coverage Audit — feature by feature, section by section

The point of this doc: for **every** area of jBPM Business Central, state what jBPM does, what this
design does, and whether that's **✅ covered**, **⚠️ partial**, **❌ missing**, or **⛔ deliberately
excluded** (with the reason). Anything not on this page is an omission, not a decision — that's the
standard this doc is held to.

Source of truth for the jBPM column: [01-research-jbpm-and-competitors.md](./01-research-jbpm-and-competitors.md).
"Ours" refers to a mockup in [mockups/](./mockups/) and/or a module doc (04–10).

Legend: ✅ covered · ⚠️ partial (gap named) · ❌ missing (must build) · ⛔ excluded (reason given)

---

## 1. Navigation & shell

| jBPM | Ours | Status |
|---|---|---|
| Top menu: Home / Design / Deploy / Manage / Track | Persona-based left sidenav (Home, Projects, Deployments, Instances, Execution Errors, Jobs & Timers, Tasks, Reports, Admin, Settings) | ✅ `mockups/*` — rationale in [02](./02-information-architecture.md) |
| gear icon → Business Central Settings | Admin section (Users/Roles/Groups/Audit/System Settings) | ✅ `admin-iam`, `roles-permissions`, `audit-log`, `system-settings` |
| Apps launcher (Case Mgmt Showcase) | Deferred — [10](./10-case-management-future.md) | ⛔ engine has no case constructs |
| Notification icon | Bell + dropdown panel | ✅ `notifications-panel` |
| Global search icon (full-page search) | ⌘K command palette | ❌ **no mockup yet** — spec'd in [02](./02-information-architecture.md), P2 |
| Breadcrumbs (`Menu → X → Y`) | `shared/breadcrumb` contract, on every page | ✅ |
| User avatar / profile menu | Sidenav footer (avatar, name, roles) | ⚠️ no logout/profile dropdown mocked |

## 2. Spaces & Projects

| jBPM | Ours | Status |
|---|---|---|
| Space (multi-tenancy grouping) | Folders on the Projects page | ⚠️ folders are presentational only; no space-level contributors/permissions |
| Project list, Add Project dialog (name/description/GAV/template) | Projects grid + inline create | ⚠️ **no Create Project dialog mocked** (advanced options, template picker) |
| Import Project (git URL + branch picker) | "Import jBPM" (kjar import) | ⚠️ different mechanism (kjar not git) — **no import dialog mocked** |
| Try Samples | — | ❌ **missing** — a sample/template gallery is real onboarding value |
| Contributors (Owner/Admin/Contributor) | Per-project Access tab (role → actions) | ✅ `access-tab` — simpler role model, deliberate |
| Project Settings (GAV, KIE bases, persistence, service tasks…) | Project Settings (general, shared vars, env overrides, scheduled start) | ✅ `project-settings` — jBPM's Java/Maven-specific tabs ⛔ excluded (no Maven/JPA layer) |
| Git branches, Add/Delete Branch | Branch switcher + version history | ✅ `version-history` |
| Change Requests (PR-like: submit/review/diff/merge) | — | ❌ **missing** — engine has branches+versions; a merge/review flow is a real gap |
| Duplicate GAV detection warning | — | ⛔ no Maven coordinates in this engine |

## 3. Asset authoring

| jBPM asset type | Ours | Status |
|---|---|---|
| Business Process (BPMN2) | Process canvas | ✅ `project-workspace` |
| Data Object | Data Object field editor | ✅ `data-object-editor` |
| Form (Form Modeler) | Visual Form Builder | ✅ `assets-form-builder` |
| Decision Table (guided + spreadsheet) | Guided decision table grid | ✅ `decision-table-editor` (spreadsheet upload ⚠️ not mocked) |
| DMN | Asset kind listed, no editor | ⚠️ P3 — boxed-expression editor is a large separate effort |
| DRL file / Guided Rule / Guided Rule Template / DSL | `rulesets` kind listed | ⚠️ no rule editor mocked |
| Decision Tree | kind listed | ⚠️ no editor mocked |
| Scorecard | kind listed | ⚠️ no editor mocked |
| Enumeration | kind listed | ⚠️ no editor mocked (trivial list editor) |
| Test Scenario | kind listed | ❌ **missing** — a test-runner UI is genuinely useful and has no mockup |
| Work Item Definition | — | ⚠️ maps to our Service Task config |
| Package | — | ⛔ no Java packages in this engine |
| Asset versioning / metadata / tags / lock | Version history (project-level) | ⚠️ **per-asset** version history, tags, and lock/force-unlock not mocked |

## 4. Process designer (canvas)

| jBPM | Ours | Status |
|---|---|---|
| Palette: all event/task/gateway/subprocess types | Full palette, all categories | ✅ `project-workspace` |
| Element properties panel | Double-click property modal | ✅ `process-node-modal`, `process-event-modal` |
| Task Data I/O Assignments dialog | Data I/O rows inside the node modal | ⚠️ simplified; jBPM has a dedicated mapping dialog |
| Actors/Groups picker | Assignment chips ("+ Add actor / group") | ⚠️ picker dialog itself not mocked |
| Reassignment / Notification rules | Fields in the User Task modal | ✅ `process-node-modal` |
| Process Variables + Global Variables | Variables modal | ✅ `process-variables-modal` |
| Imports (data types / WIDs) | — | ❌ **missing** |
| Validate → Alerts/Problems panel | Problems strip at canvas bottom | ✅ `project-workspace` |
| Documentation tab (printable) | — | ❌ **missing** — auto-generated process documentation is a real jBPM feature |
| Save with comment | — | ⚠️ autosave assumed; no commit-message dialog |
| Copy/paste, undo/redo, keyboard shortcuts | — | ❌ **not represented** in any mockup |
| Zoom / fit / minimap / marquee select | Zoom pill + minimap | ✅ (marquee/copy-paste are engineering, spec'd in [03](./03-design-system.md)) |
| Generate forms (process + task) | "Generate form" action on User Task | ⚠️ mentioned in [04](./04-module-projects-and-designer.md), not mocked |
| Migrate diagram | — | ⛔ no legacy designer to migrate from |

## 5. Deploy

| jBPM | Ours | Status |
|---|---|---|
| Execution Servers / server templates | Environment-based deployments | ✅ `deployments` — deliberate model difference |
| Deployment Units (KIE containers) + Start/Stop/Remove | Deployment list + Activate/Undeploy/Archive/Rollback | ✅ `deployments` |
| Add Deployment Unit wizard | Build/Deploy from the canvas toolbar | ⚠️ no deploy confirmation dialog mocked |
| Dev vs Production mode (Redeploy rules) | — | ❌ **missing** — no dev/prod deploy-semantics UI |
| Deploy → Jobs (executor jobs) | Jobs & Timers | ✅ `jobs-timers` |
| Job creation dialog (name/date/type/params) | — | ⚠️ list exists; **no New Job dialog** |
| Process Instance Migration wizard | — | ⛔ Tech Preview even in jBPM |

## 6. Manage / runtime

| jBPM | Ours | Status |
|---|---|---|
| Process Definitions list + details + diagram | Project → Processes covers this | ✅ (deliberately not a separate cross-project list — [02](./02-information-architecture.md)) |
| New Process Instance (generated start form) | Start instance form | ✅ `start-instance-form` |
| Process Instances list + Filters/Advanced/Saved/Columns | Instances list + left filter rail | ✅ `instances-list` |
| Row ⋮ actions (Signal, Abort) | Row ⋮ menu (View tasks, View errors, Abort) | ✅ `instances-list` |
| Signal Process Instance dialog (Signal Name + Data) | Signal button | ⚠️ **dialog not mocked** |
| Instance Details / Variables / Documents / Logs / Diagram | All five tabs, consistent shell | ✅ `process-instance-detail` + 4 tab pages |
| Parent/child instance navigation | Related processes panel on every tab + clickable subprocess node | ✅ |
| Task list (admin) + Task Inbox (personal) | One Tasks screen, scope tabs | ✅ `task-inbox` |
| Task detail: Work/Details/Assignments/Comments/Admin/Logs | All six as real pages | ✅ `task-detail*` |
| Task actions: Claim/Release/Start/Complete/Save/Delegate/Forward/Skip | Buttons present across tabs | ⚠️ **no action dialogs** (Delegate/Forward/Reassign pickers) |
| Bulk actions + per-row result reporting | Bulk bar on Tasks & Instances | ⚠️ **bulk result notification not mocked** |
| Execution Errors + filters + Acknowledge + Go to Task | Execution Errors list+detail | ✅ `execution-errors` |

## 7. Track / analytics

| jBPM | Ours | Status |
|---|---|---|
| Task Inbox | Tasks | ✅ |
| Process Reports (by type/date/running time) | Reports & Analytics → Processes tab | ✅ `reports-analytics` |
| Process & Task Dashboard (14 SQL providers) | Processes + Tasks analytics tabs | ✅ (backed by our own query API) |
| Dashbuilder custom dashboard authoring | — | ⛔ deliberate — [08](./08-module-dashboards-analytics.md) |
| Data Sets admin | — | ⛔ no pluggable data-source layer |
| Export | Export CSV button | ⚠️ not mocked as a flow |

## 8. Admin / access control

| jBPM | Ours | Status |
|---|---|---|
| Users list + New User wizard + roles/groups/permissions/password | Users list+detail | ✅ `admin-iam` — ⚠️ New User *wizard* not mocked |
| Groups + Home Page + Priority | Groups tab | ⚠️ priority ⛔ excluded (role-based model); groups screen not separately mocked |
| Roles + permission matrix + Add Exception | Roles + permission checkboxes | ✅ `roles-permissions` — Add Exception ⛔ excluded |
| Artifacts (Maven browser) | — | ⛔ no Maven |
| Data Sources / Drivers | — | ⛔ no JDBC layer |
| Archetypes | — | ⛔ no Maven archetypes |
| SSH Keys | — | ⛔ no git remote |
| Service Tasks Administration | — | ⚠️ our Service Task = HTTP node; no global registry screen |
| Process Administration / Designer settings / Language | System Settings | ✅ `system-settings` |
| (jBPM has no audit viewer) | Audit Log | ✅ `audit-log` — **we exceed jBPM here** |

## 9. Cross-cutting states (the easiest things to miss)

| Concern | Ours | Status |
|---|---|---|
| Empty states | `.empty-state` class exists | ❌ **not shown in any mockup** |
| Loading / skeleton states | `.skeleton` class exists | ❌ **not shown in any mockup** |
| Error / permission-denied pages | — | ❌ **missing** |
| Zero-results (filtered to nothing) | — | ❌ **missing** |
| Destructive-action confirmations | ModalService exists | ❌ **no confirm dialog mocked** |
| Unsaved-changes warning | — | ❌ **missing** |
| Session timeout / re-auth | — | ❌ **missing** |
| Pagination controls | — | ❌ **missing on every list** |
| Sort affordances on table headers | — | ❌ **missing** |
| Toast/inline feedback after an action | ToastService exists | ❌ **not mocked** |
| Dark mode | Token pairs exist, verified | ✅ |
| Responsive / narrow viewport | — | ❌ **not designed** |

---

## What this audit changes

The ❌ rows above are the real backlog. Ranked by how badly a user would feel the absence:

1. **Interaction states** (empty/loading/error/zero-results/confirm/toast/pagination/sort) — these
   affect *every* screen and are the clearest "this is a mockup, not a design system" tell.
2. **Action dialogs** — Signal, Delegate/Forward/Reassign, New Job, Deploy confirm, Create Project,
   destructive confirms. jBPM's UI is largely *made of* these; we show the buttons but not what they
   open.
3. **Authoring gaps** — per-asset version history/tags/lock, process Documentation tab, Imports,
   remaining asset editors (rules, decision tree, scorecard, enumeration, test scenario runner).
4. **Onboarding/scale** — sample gallery, global search, Change Requests (branch review/merge).

See [13-remaining-backlog.md](./13-remaining-backlog.md) for these written as buildable items.
