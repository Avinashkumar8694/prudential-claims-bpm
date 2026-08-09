# jBPM page-by-page comparison

Every screen and dialog jBPM Business Central / RHPAM 7.x actually ships, compared against what
this design has. Sourced from the RHPAM 7.x documentation set (docs.redhat.com) and docs.jbpm.org.

**Legend** — ✅ built · 🟡 partial · ❌ not built · ⛔ deliberately out of scope
([13-remaining-backlog.md](./13-remaining-backlog.md) explains every ❌ and ⛔).

---

## 1 · Design → Projects

| jBPM screen / dialog | jBPM specifics (documented) | Ours | Where |
|---|---|---|---|
| Spaces list | Multi-tenant grouping, default `MySpace` | ⛔ | Single-tenant; folders replace spaces |
| Project list | Grid of project cards, **Add Project** + caret menu | ✅ | [projects-list.html](./mockups/projects-list.html) |
| **Add Project** dialog | Name, Description, *Configure Advanced Options* → Group/Artifact/Version (GAV), Development Mode toggle, "Based on template" + archetype | 🟡 | [dialogs.html](./mockups/dialogs.html) — GAV/archetype ⛔ (no Maven layer) |
| **Import Project** dialog | Git URL (HTTPS/git:// only — SCP-style SSH rejected), credentials, branch multi-select (master mandatory) | 🟡 | Import kjar exists; git-clone import ❌ |
| **Try Samples** | Sample gallery — the welcome screen when no projects exist (Mortgage_Process, Evaluation, IT_Orders) | ❌ | Backlog C4 — this is the whole first-run path |
| Project asset library | Paginated tile grid, Add Asset, Import Asset | ✅ | [assets-overview.html](./mockups/assets-overview.html) |
| **Repository View** | Raw folder/file tree incl. pom.xml, per-asset copy/rename/delete/archive icons | 🟡 | Per-asset actions ✅; raw file tree ⛔ |
| Asset **Overview → Version History** | Per-asset version list + restore | ❌ | Backlog C2 — ours is project-level only |
| Asset **Overview → Metadata** | Tags (+ Filter by Tag), **Lock Status** `Locked by <user>`, **Force unlock asset** with "may cause \<user\> to lose unsaved changes" warning | ❌ | Backlog C2 |
| **Save with check-in comment** | Short change description required on every save; drives version history | ❌ | Backlog C3 |
| **Make a Copy** dialog | New name, target package, optional comment | 🟡 | Duplicate project ✅; per-asset copy ❌ |
| Project **Settings → General** | Name/Description/GAV, Development Mode, clone URL, GAV-conflict toggles | 🟡 | [project-settings.html](./mockups/project-settings.html) — GAV ⛔ |
| Settings → Dependencies, KIE Bases, Persistence, Properties | Maven deps, KIE base config, Hibernate props | ⛔ | No Maven/JPA layer |
| Settings → **Service Tasks** | Per-project install: Rest, Email, JMSSendTask, WebService, Decision | 🟡 | Our integration surface is HTTP nodes |
| Settings → Branch Management | Per-branch role access | 🟡 | [access-tab.html](./mockups/access-tab.html) is project-level |
| **Duplicate GAV check** | Validation gate — cancels save/build/deploy on collision | ⛔ | No Maven coordinates |
| **Change Requests** | Submit (summary/description/target branch) → Overview + Changed Files diff → Squash and Merge / Merge / Reject / Close | 🟡 | [version-history.html](./mockups/version-history.html) has branches + diff; no PR flow |
| **Contributors** (space + project) | Owner / Admin / Contributor tiers | 🟡 | Role-based instead — [access-tab.html](./mockups/access-tab.html) |

## 2 · Process designer (BPMN canvas)

| jBPM element | jBPM specifics | Ours | Where |
|---|---|---|---|
| Palette — Start events | None, Conditional, Compensation, Error, Escalation, Message, Signal, Timer | ✅ | [project-workspace.html](./mockups/project-workspace.html) |
| Palette — Intermediate | Message, Timer, Error (boundary), Signal, Conditional, Compensation, Escalation; interrupting / non-interrupting | ✅ | ditto |
| Palette — End events | None, Message, Signal, Error, Compensation, Escalation, Terminate | ✅ | ditto |
| Palette — Tasks | Business Rule, Script, User, Service, None/Manual | ✅ | ditto |
| Palette — Subprocesses | Embedded, Ad hoc, Reusable, Event, Multiple instance | ✅ | ditto |
| Palette — Gateways | Exclusive, Inclusive, Parallel, Event-based, **Complex** | 🟡 | Complex ⛔ (rare per jBPM's own docs) |
| Swimlanes | Auto-propagates actor from first claimed task in the lane | ❌ | Backlog A — engine semantic |
| **User Task properties** | Name, Task Name, Subject, Actors, Groups, Assignments, Reassignments, Notifications, Is Async, Skippable, Priority, Adhoc Autostart, Multiple Instance, On Entry/Exit, SLA Due Date | ✅ | [process-node-modal.html](./mockups/process-node-modal.html) |
| **Reassignment** dialog | Type (`not-started`/`not-completed`), **Expires At** (`2m`/`4h`/`6d`), Users, Groups | ✅ | ditto |
| **Notification** dialog | Type, Expires At, From, To Users, To Groups, Reply To, Subject, Body | 🟡 | Trigger+target shown; full email fields condensed |
| **Task Data I/O** dialog | Data Inputs/Outputs + Assignments; Name + Data Type per row | ✅ | ditto |
| Actors/Groups picker | Add row → pick existing or **New** | ✅ | Resolved from IAM groups (improvement — no free text) |
| Timer/event properties | Duration / Cycle / Date; interrupting flag | ✅ | [process-event-modal.html](./mockups/process-event-modal.html) |
| **Process Variables** editor | Global / Process / Local scopes, Name + Data Type | ✅ | [process-variables-modal.html](./mockups/process-variables-modal.html) |
| **Imports** (Data Type / WID) | Header-level imports | ⛔ | No Java classpath |
| **Work Item Definition** editor | Task name, icon, parameters, results, handler | ⛔ | HTTP-node model instead |
| **Generate forms** | Generate process form / all forms / forms for selection | 🟡 | Hook specified in [04](./04-module-projects-and-designer.md), not mocked |
| **Documentation tab** | Printable process summary → PDF | ❌ | Backlog |
| **Alerts panel** | Bottom-docked build/validation errors; red cross / green check | ✅ | Problems strip in [project-workspace.html](./mockups/project-workspace.html) |
| Cut/Copy/Paste/Undo/Redo | Toolbar buttons (no documented shortcuts) | ❌ | Backlog — we should ship real shortcuts |
| **Migrate Diagram** | Legacy → new designer, irreversible, `.bpmn2`→`.bpmn` | ⛔ | No legacy designer to migrate from |

## 3 · Deploy

| jBPM screen | jBPM specifics | Ours | Where |
|---|---|---|---|
| **Execution Servers** | Server Configurations (templates) → Deployment Units (KIE containers) → Alias; Start/Stop/Remove | ⛔ | We deploy to logical environments |
| Deploy / Redeploy / Build / Build&Install | Deploy = no instance stop; Redeploy = replaces instances; prod mode disables Redeploy | ✅ | [deployments.html](./mockups/deployments.html) |
| Container alias | Stable pointer across versions | 🟡 | Tags serve this role |
| **Jobs** — New Job dialog | Business Key, Type (command class), Parameters (k/v), Due On, Retries, Run now / Run later | 🟡 | [dialogs.html](./mockups/dialogs.html) — modelled on our `TimerJob`, not Java command classes |
| Jobs list | Thinly documented in jBPM | ✅ | [jobs-timers.html](./mockups/jobs-timers.html) — Job ID, PIID, kind, next fire, retries, status |

## 4 · Manage (operations)

| jBPM screen | jBPM specifics | Ours | Where |
|---|---|---|---|
| **Process Definitions** | List of deployed defs; details incl. subprocess associations; read-only Diagram tab; **New Process Instance** | 🟡 | Folded into project Processes + [start-instance-form.html](./mockups/start-instance-form.html) |
| **Process Instances** list | Filters: State, Errors, Filter By (Id/Initiator/Correlation Key/Description), Name, Definition ID, Deployment ID, **SLA Compliance**, Parent Process ID, Start Date, Last update | ✅ | [instances-list.html](./mockups/instances-list.html) — all present in the left rail |
| Advanced Filters | Name + description, Select column, operators (`equals to`, `!=` confirmed only), value | ✅ | [list-mechanics.html](./mockups/list-mechanics.html) — richer, type-aware operator set |
| Saved Filters | Star icon panel; one settable as **default** (auto-applies on load) | ✅ | ditto |
| Show/hide columns | Right of Bulk Actions; **process variables become columns only after filtering to one Definition Id**; drag to reorder | ✅ | ditto — dependency modelled explicitly |
| Instance **Details** tab | State + active activity + Parent link | ✅ | [process-instance-detail.html](./mockups/process-instance-detail.html) |
| Instance **Process Variables** tab | Editable inline, per-variable history | ✅ | [instance-variables-tab.html](./mockups/instance-variables-tab.html) |
| Instance **Documents** tab | Only when an `org.jbpm.Document` variable exists | ✅ | [instance-documents-tab.html](./mockups/instance-documents-tab.html) |
| Instance **Logs** tab | `Date Time: Event Node Type: Event Type`, filter by node/event type, **Reset** | ✅ | [instance-logs-tab.html](./mockups/instance-logs-tab.html) |
| Instance **Diagram** tab | Active node highlighted; parent/sub-instance navigation panels | ✅ | [instance-diagram-tab.html](./mockups/instance-diagram-tab.html) — plus clickable subprocess nodes |
| **Signal** dialog | **Signal Name** (required; `Message-` prefix targets a message event), **Signal Data** (optional); intermediate *catch* events only | ✅ | [dialogs.html](./mockups/dialogs.html) |
| **Abort** | Top-right button | ✅ | + destructive confirm (jBPM's confirm is undocumented) |
| **Tasks** (admin) / **Task Inbox** (personal) | Same screen, two scopes | ✅ | [task-inbox.html](./mockups/task-inbox.html) + [-available](./mockups/task-inbox-available.html) + [-all](./mockups/task-inbox-all.html) |
| Task filters | Id, Task, Correlation key, Actual Owner, Process Instance Description, Status (10 states), Process Name/Definition Id, Created On presets | ✅ | task pages |
| Task **Work / Details / Assignments / Comments / Admin / Logs** | Claim, Release, Start, Complete, Save, Delegate (Assignments), Forward + reminder (Admin) | ✅ | [task-detail.html](./mockups/task-detail.html) + 5 tab pages |
| **Bulk Actions** | Bulk Claim / Release / Resume / Suspend / **Reassign**; reassign dialog = user ID + confirm button labelled *Delegate*; **one notification per task** | ✅ | [dialogs.html](./mockups/dialogs.html), [ui-states.html](./mockups/ui-states.html) — we label it Reassign |
| **Execution Errors** | Filters: Type (DB/Task/Process/Job), Process Instance Id, Job Id, Id, Acknowledged, Error Date presets; **Acknowledge**; **Go to Task**; all errors start unacknowledged | ✅ | [execution-errors.html](./mockups/execution-errors.html) |
| **Process Instance Migration** | Standalone Tech Preview app: plan (source/target container+process, node mapping w/ side-by-side diagrams), Execute (Now/Schedule + callback URL) | ⛔ | Tech Preview even in jBPM |

## 5 · Track

| jBPM screen | jBPM specifics | Ours | Where |
|---|---|---|---|
| Task Inbox | Personal scope of the Tasks screen | ✅ | [task-inbox.html](./mockups/task-inbox.html) |
| Process Reports | Charts by Type, Start Date, Running Time | ✅ | [reports-analytics.html](./mockups/reports-analytics.html) |
| **Process & Task Dashboard** | Two tabs (Processes / Tasks), 14 predefined SQL providers: counts by status/version, completed/started by date, duration min/avg/max, instances by user, tasks by status/user | ✅ | [reports-analytics.html](./mockups/reports-analytics.html) + [reports-tasks.html](./mockups/reports-tasks.html) |
| Business Dashboards (Dashbuilder) | Generic drag-drop dashboard authoring | ⛔ | Build fixed reports first |
| Data Sets admin | Bean/CSV/SQL/ElasticSearch/Execution Server providers | ⛔ | No pluggable data-source layer |

## 6 · Admin (gear icon)

| jBPM screen | jBPM specifics | Ours | Where |
|---|---|---|---|
| **Users** | New user wizard: username → Roles (Add Roles) → Groups → Create → optional password. **A user needs ≥1 role to log in at all.** | ✅ | [admin-iam.html](./mockups/admin-iam.html) |
| **Groups** | New group → pick members; **Home Page** + **Priority** per group | ✅ | [admin-groups.html](./mockups/admin-groups.html) — priority ⛔ |
| **Roles** | Home page, priority, permissions | ✅ | [roles-permissions.html](./mockups/roles-permissions.html) |
| **Permissions matrix** | Grant/Deny, global or per-resource; **Add Exception** for Pages/Editor/Spaces/Projects; cannot except the root resource | 🟡 | Role→permission checkboxes + per-project [access-tab.html](./mockups/access-tab.html) |
| **Data Sources** | Add Driver (Name, Driver Class Name, GAV); Add DataSource (Name, Connection URL, User, Password, Driver, Test Connection) | ⛔ | No JDBC layer |
| **Artifacts** (Maven browser) | Open / Download / Upload (JAR/KJAR/pom only) | ⛔ | No Maven repo |
| **Archetypes** | GAV + status (valid/invalid/default) | ⛔ | ditto |
| **SSH Keys** | Name + Key; formats ssh-rsa, ssh-dss, ecdsa-sha2-nistp256/384/521 | 🟡 | Section stubbed in [system-settings.html](./mockups/system-settings.html) |
| **Process Administration** | **Default items per page: 10 / 20 / 50 / 100** | ✅ | [system-settings.html](./mockups/system-settings.html) |
| **Process Designer** settings | Auto-hide category panel; drawing area width 2800–5600, height 1400–2800 | ✅ | ditto |
| **Languages** | UI language | 🟡 | Section stubbed |
| **GAV check management** | Global disable via system property | ⛔ | No GAV |
| Git hooks / remote git | Repo integration | 🟡 | Git & versioning section stubbed |
| Audit / event log | *jBPM has no dedicated audit-log UI* | ✅ | [audit-log.html](./mockups/audit-log.html) — **beyond parity** |

## 7 · Cross-cutting — where jBPM is weak and we deliberately go further

Research found these effectively undocumented or absent in jBPM. Each is an intentional improvement,
not parity work, and should be judged as such:

| Area | jBPM | Ours |
|---|---|---|
| Empty states | Only "Try Samples" on the welcome screen; the rest undocumented | [ui-states.html](./mockups/ui-states.html) — empty vs **filtered-to-zero** distinguished |
| Loading states | Undocumented | Skeletons, per-shape |
| Permission-denied | Undocumented (nav likely just hidden) | Explicit denied state |
| Session timeout | Undocumented; likely silent redirect | Warn-before-expiry + Stay signed in |
| Unsaved-changes guard | Undocumented | Specified |
| Realtime refresh | **No documented refresh mechanism at all** | WebSocket push (`RealtimeService`) |
| Global search | **Does not appear to exist** | ⌘K planned — backlog C1 |
| Keyboard shortcuts | **No shortcut reference exists** | Focus-visible baseline shipped; shortcuts backlog |
| Breadcrumbs | Menu-path only, no breadcrumb bar | Enforced `Section › Subsection` contract |
| Notifications | Designer Alerts panel + task emails only; no notification centre | [notifications-panel.html](./mockups/notifications-panel.html) |
| Audit log UI | None | [audit-log.html](./mockups/audit-log.html) |
| PIID as a traceable identifier | Numeric id in a column | Pinned, monospace, click-to-copy, non-hideable, carried across Instances→Tasks→Errors→Jobs→Audit |

## Scorecard

- **✅ built: 46** · 🟡 partial: 21 · ❌ backlog: 11 · ⛔ out of scope: 21
- Every ❌ has an entry in [13-remaining-backlog.md](./13-remaining-backlog.md); every ⛔ has a
  stated reason there too.
- The largest genuine gaps remaining, in order: **per-asset version history + locking**,
  **check-in comments**, **sample gallery / first-run**, **global search**, **export/import flows**.
