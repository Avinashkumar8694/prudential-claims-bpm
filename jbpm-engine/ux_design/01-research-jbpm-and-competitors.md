# Research: jBPM Business Central & competitors

Primary source for every claim below: official jBPM docs (docs.jbpm.org / docs.jboss.org/jbpm) and
the Red Hat Process Automation Manager 7.x doc set (the productized, most thoroughly documented
version of the exact same Business Central UI). Version differences are called out where they
change the IA. Anything thinly documented in the source manuals is flagged as such rather than
invented.

## 0. Version eras (why "jBPM UI" isn't one thing)

| Era | Console | Top-level IA | Tenancy unit |
|---|---|---|---|
| jBPM 5.x | Guvnor (authoring) + jBPM console (runtime), two separate WARs | — | Repository |
| jBPM 6.x early | KIE Workbench | Perspectives: Administration / Authoring / Process Management / Dashboards | Organizational Unit |
| jBPM 6.x BPM Suite | KIE Workbench | **Home / Authoring / Deploy / Process Management / Dashboards / Extensions** | Organizational Unit |
| jBPM 7.x / RHPAM 7.x | **Business Central** | **Home / Design / Deploy / Manage / Track** menu + gear-icon Admin + Apps launcher | **Space** → Project → Git branch |
| RHPAM 8 / Kogito era | Business Central discontinued; cloud-native Kogito services + lightweight Management/Task/Trusty consoles | fundamentally different (no Git-VFS monolith) — out of scope | — |

Everything below is the 7.x/mature era — the most complete and most useful reference point.

## 1. Top-level IA (Business Central 7.x)

Top bar: logo | **Menu** (Home/Design/Deploy/Manage/Track dropdown) | search | Apps launcher |
notifications | **gear/Admin icon** | user avatar.

- **Home** — landing page; largely superseded by Design → Projects as the real entry point once a
  space is picked. (Exact widget/tile layout is thinly documented — flagged, not invented.)
- **Design → Projects** — the Project Explorer/Library. The single biggest sub-area (§3).
- **Deploy → Execution Servers**, **Deploy → Jobs** (§6).
- **Manage → Process Definitions**, **Process Instances**, **Tasks** (admin/all-tasks view),
  **Execution Errors** (§7).
- **Track → Task Inbox** (personal/group view of the same Tasks screen), **Process Reports**,
  **Business Dashboards** (§8).
- **gear/Admin icon → Business Central Settings** — Users/Groups/Roles, Data Sources, Data Sets,
  Artifacts, Archetypes, SSH Keys, Service Tasks Administration, Process Administration, Process
  Designer settings, Language settings (§9). This is the 7.x successor to 6.x's literal
  "Extensions" menu.
- **Apps launcher** — satellite apps, e.g. the Case Management Showcase (§5).

## 2. Home / Spaces

- **Space** = multi-tenancy grouping (successor to 6.x "Organizational Unit"); default `MySpace`.
- **Add Project**: Name + Description, "Configure Advanced Options" → GAV (Group/Artifact/Version)
  + "Based on template" archetype picker. Dropdown also offers **Try Samples** (checkbox list of
  bundled samples), **Import Project** (Git URL + credentials, then per-branch import picker), and
  **Case project** (scaffolds Case Definition assets).
- **Contributors** (community-documented, not primary-manual-verified): Owner (full control,
  delete space) / Admin (manage contributors, create projects) / Contributor (create projects
  only); a project inherits its space's contributor list on creation.
- **Repository/branch model**: every project is a Git repo (JGit VFS). `master` can't be deleted.
  **Add Branch** (name + base branch), **Delete Branch** (type-to-confirm). **Change Requests** —
  a lightweight PR flow: Submit (summary/description/target branch) → reviewer sees Overview +
  Changed Files (diff) → **Squash and Merge** / **Merge** / **Reject** / **Close**.

## 3. Design → Projects

**Sample projects** bundled with the product span optimization (Course_Scheduling,
Employee_Rostering), process automation (Evaluation_Process, Mortgage_Process), case management
(IT_Orders — case + process combo), rules (Mortgages), and DMN (Traffic_Violation) — useful as a
checklist of "what a complete BPM suite lets you build," not for literal parity.

**Asset list ("Library")**: paginated tile grid, **Add Asset** (per-type creation dialog: name +
package + type-specific fields), **Import Asset** (upload an existing file, e.g. `.dmn`),
**Deploy** / **Build** / **Build & Install** / **Redeploy** (dev-mode only). A collapsible
**Project Explorer** panel toggles a raw **Repository View** (folder/file tree incl. `pom.xml`)
alongside the curated asset view, with **Filter by Tag** once tagging is enabled.

**Full asset kind enumeration** (from the "Types of assets" chapter): Business Process (BPMN2),
Case Definition, Case Management (Preview), Data Object, Decision Table (Spreadsheet, XLS), DMN,
DRL file, DSL definition, Enumeration, Form, Global Variable(s), Guided Decision Table, Guided
Decision Table Graph, Guided Rule, Guided Rule Template, Package, Solver configuration, Test
Scenario (+ legacy), Work Item definition.

**Asset lifecycle**: rename/copy/delete/archive; every asset has an **Overview** tab with
**Version History** + **Metadata** (Tags with add/remove, **Lock Status** — auto-locked while
being edited, **Force unlock** with a data-loss warning for the other user).

**Project Settings** (exhaustive, this is what a "project" configures beyond its process list):
General (Name/Description/GAV/Development Mode toggle, clone URL, GAV-conflict toggles),
Dependencies (GAV + per-dependency package whitelist), KIE Bases (name, default flag, included KIE
bases, package, Equal Behavior Identity/Equality, Event Processing Stream/Cloud, sessions,
external data objects), Service Tasks (enable per-project: BusinessRuleTask, Email, JMSSendTask,
Rest, ServiceTask, WebService), Deployments (runtime strategy, persistence unit/mode, marshalling
strategies, globals, event listeners, required roles, work item handlers), Persistence
(unit/provider/data source), Properties (Hibernate dialect/DDL/etc. + free-form custom props),
Branch Management (per-branch role-based access), Validation (Maven repos checked for duplicate
GAVs).

## 4. Business Process designer (BPMN2 canvas)

**Toolbar**: Save, implicit Validate (errors in a bottom **Alerts** panel), Copy ("Make a Copy" →
new name/package/comment), Documentation tab (printable PDF summary), Migrate Diagram
(legacy→new, irreversible), **Form Generation** dropdown (Generate process form / all forms /
forms for selection), Diagram properties icon, zoom controls, corner-drag resize handle. Left
**Object Library** palette, collapsible, grouped by Start/End/Intermediate Events, Activities,
Sub-processes, Gateways, Data Objects, Artifacts, Swimlanes, Milestone (case-only), Connections.
Elements expose an inline **quick-add contextual menu** on hover (Create Task / Create Sequence
Flow / Create End) as an alternative to dragging from the palette.

**Events** — three families (Start/Intermediate/End) × types **None, Conditional, Compensation,
Error, Escalation, Message, Signal, Timer, Terminate** (not every type valid in every family/
position — e.g. Error/Compensation start events are subprocess-only, Terminate is end-only).
Boundary and event-subprocess-start events add an **Interrupting / Non-interrupting** flag.

**Tasks**:
- **User Task** full property set: Name, Documentation, Task Name, Subject, **Actors**, **Groups**,
  **Assignments** (Data I/O dialog), **Reassignments** (time-based, e.g. "not started in 4h → 
  reassign to manager"), **Notifications** (time-based email), Is Async, Skippable, Priority,
  Description, Created By, Adhoc Autostart, **Multiple Instance** (Sequential/Parallel execution
  mode + collection input/output + completion condition MVEL expression), On Entry/Exit Action,
  Content, **SLA Due Date**.
- **Business Rule task** — Rule Language DMN or DRL, Rule Flow Group (DRL) or
  Namespace/Decision Name/DMN Model Name (DMN), On Entry/Exit, Is Async, Adhoc Autostart, SLA.
- **Script task** — Script + language (Java/JavaScript/MVEL).
- **Service task** — Implementation (Java/WebService), Interface/Operation, Assignments, Is
  Async, Is Multiple Instance, On Entry/Exit, SLA.
- Predefined custom Service Tasks (Work Item Handlers): **Rest, Email, Log, Java, WebService,
  Decision (DMN) Task** — globally enabled in Admin → Service Tasks, then installed per-project.

**Subprocesses**: Embedded, Ad hoc, Reusable (Called Element, Independent, Abort Parent, Wait for
completion), Event, Multiple instance.

**Gateways**: Exclusive (XOR), Inclusive, Parallel, Event-based, Complex.

**Structure**: Sequence flow (execution) vs. Association (no semantics); **Swimlanes** (a
swimlane auto-propagates the actor from the first claimed task in the lane to later tasks in the
same lane); Artifacts (Group, Text Annotation); Data Objects + per-task Data I/O Assignments.

**Process-level properties** (nothing selected): Process Variables + Global Variables (name + data
type), Local (element-scoped) variables live on the element itself.

**User task life cycle**: Created → Ready → Reserved (claim) → InProgress (start) → Completed /
Failed, plus Suspended/Resumed/Exited/Obsolete and delegate/forward/revoke/skip/stop. Permission
matrix (who can do what — Potential owner / Actual owner / Business administrator):

| Operation | Potential owner | Actual owner | Business admin |
|---|:---:|:---:|:---:|
| claim | ✓ | – | ✓ |
| start | ✓ | ✓ | ✓ |
| complete | – | ✓ | ✓ |
| release | – | ✓ | ✓ |
| delegate | ✓ | ✓ | ✓ |
| forward | ✓ | ✓ | ✓ |
| skip | ✓ | ✓ | ✓ |
| suspend/resume | ✓ | ✓ | ✓ |
| fail/stop | – | ✓ | ✓ |
| activate/nominate/remove | – | – | ✓ |

## 5. Case Management

Case Definition = an asset built in the same designer with case-only additions: **Case File**
(per-instance data bag, own variable scope), **Case Roles** (name + cardinality — max assignable
users/groups; guidance is explicit: *never* hard-code a user/group to a task, always assign via
role so it can change mid-case), **Milestones** (name, Adhoc Autostart, a completion condition
expression; states Active/Completed/Terminated, can also be signaled manually), **Stages** (an ad
hoc subprocess — a loosely-ordered collection of tasks/milestones), **Ad hoc fragments** (activities
not wired by sequence flow). No explicit start node required (unlike a regular process, which
requires exactly one).

**Case Management Showcase** — a separate demo app, not part of Business Central proper, and
explicitly not production-supported: Case List → Start Case (pick definition, assign role→user/
group) → Case Overview (Available/In-progress/Completed dynamic-action columns, Milestones pane,
Comments, Close button — no reopen, that's REST/JMS-only, manual Refresh only, no live push).

## 6. Deploy

**Execution Servers**: **Server Configurations** (aka "server templates" — logical groups of
physical KIE Server instances running the same deployed services, e.g. Test vs. Production).
Under a configuration, **Deployment Units** (KIE Containers): Add (Alias + GAV picker + "Start
Deployment Unit?" checkbox), then per-unit **Start/Stop/Remove** (must Stop before Remove).
**Development vs. Production mode** (per KIE Server + per project's GAV "Development Mode"
toggle): dev mode's Deploy updates in place without stopping instances, Redeploy replaces all
instances; production mode disables Redeploy entirely — every deploy is a new unit alongside old
ones. Duplicate-GAV detection runs automatically against configured Maven repos.

**Jobs**: New Job dialog — Name, due Date/Time, Type (fully-qualified executor command class, e.g.
`org.jbpm.executor.commands.LogCleanupCommand`), repeatable key/value **Add Parameter** rows. (The
Jobs *list* screen's exact column set is thinly documented — only the creation dialog and the log-
cleanup example are spelled out in the manuals.)

## 7. Manage

**Process Definitions**: list of deployed definitions across monitored servers; row → Details page
(subprocess associations, participant counts, read-only Diagram tab); **New Process Instance**
button opens the definition's generated start form.

**Process Instances**: **New Process Instance** button; a **Filters** panel (State: Active/
Aborted/Completed/Pending/Suspended; Errors has/none; Filter By Id/Initiator/Correlation
key/Description; Name; Definition ID; Deployment ID; **SLA Compliance**: Aborted/Met/N-A/Pending/
Violated; Parent Process ID; Start Date; Last update); an **Advanced Filters** panel (build
`column [operator] value` predicates, Save); a **Saved Filters** panel (star icon, mark one
default); a **Show/hide columns** icon that can also surface process-variable values as ad hoc
columns once filtered to one process. Row **⋮ actions**: **Signal** (Signal Name required — prefix
`Message-` to target a message event — + optional Signal Data), **Abort**.

*Process Instance Details tabs*: **Instance Details** (state + active activity + Parent link for
subprocesses), **Process Variables** (editable inline, per-variable history), **Documents** (only
if an `org.jbpm.Document`-typed variable exists), **Logs** (audit trail `Date Time: Event Node
Type: Event Type`, filterable, Reset button), **Diagram** (active node highlighted, Parent/Sub
Process Instance panels to navigate).

**Tasks (Manage) vs. Task Inbox (Track)** — same screen/filters/columns, two audiences: Manage →
Tasks is the process-admin-only all-tasks view; Track → Task Inbox is the logged-in user's own
scope. Filters: Id, Task name, Correlation key, Actual Owner, Process Instance Description,
**Status** (multi-select: Completed/Created/Error/Exited/Failed/InProgress/Obsolete/Ready/
Reserved/Suspended), Process Name/Definition Id, Created On (quick presets: Last Hour/Today/Last
24h/Last 7d/Last 30d/Custom range). Same Advanced/Saved Filters + Show/hide-columns pattern as
Process Instances.

*Task detail tabs*: **Work** (task form + Claim/Release/Start/Complete/comments), **Details**
(description, status, Due Date + Priority with Update), **Assignments** (owner + Delegate),
**Comments** (list + add/delete), **Admin** (potential-owner list, Forward, send reminder to
actual owner), **Logs** (lifecycle events). **Bulk Actions**: Bulk Claim/Release/Resume/Suspend/
Reassign (target user + Delegate confirm), each row reporting success/skip individually.

**Execution Errors**: Filters (Type: DB/Task/Process/Job multi-select; Process Instance Id; Job
Id; Id; Acknowledged yes/no; Error Date quick-range). Row → Details tab, **Acknowledge** button
(records user+timestamp), **Go to Task** when task-related.

**Process Instance Migration** — a separate Technology-Preview standalone app: migration plan
(source/target container+process, node-to-node mapping via side-by-side diagrams), Execute
(select instances → Now or Schedule with callback URL).

## 8. Track

**Process Reports** — chart breakdown by Type/Start Date/Running Time (thinly documented beyond
this one paragraph).

**Dashboards (Dashbuilder/BAM)**: generic drag-and-drop dashboard authoring across heterogeneous
data sources, plus a purpose-built **Process & Task Dashboard** (Processes tab / Tasks tab) backed
by 14 predefined SQL data providers over `processinstancelog`/`bamtasksummary`: counts by
status/version, completed/started-by-date, duration (min/avg/max), instances by user, tasks by
status/user, tasks completed by date.

**Data Sets** (admin-authored, feed dashboards): New Data Set wizard (provider type: Bean/CSV/SQL/
Elastic Search/Execution Server) → Test → Save; editing exposes Configuration/Preview/Advanced
(client vs. back-end caching) tabs.

## 9. Extensions / Access Control (gear icon)

Predefined roles: **process-admin, manager, admin, analyst, developer, user** — each scoped
differently (manager = dashboards only, analyst = no repo/deploy access, user = task execution
only). New user: username → assign Roles/Groups → Create → optional set-password. Edit user:
Groups/Roles/Permissions(read-only effective view)/Change Password/Delete. New group: name → pick
member users. Edit group: Home Page + **Priority** (resolves permission precedence across multiple
group memberships — equal-priority conflicts resolve positive-overrides-negative), **Permissions**
per resource type + **Add Exception** (per-item overrides on Pages/Editor/Spaces/Projects). A
reserved `unknown` account must never be created manually (superuser fallback for SLA-listener
processing with no logged-in user).

**Artifacts** (Maven repo browser): Open/Download/Upload (JAR/KJAR/pom.xml only). **Data
Sources**: Add Driver, Add DataSource (+ Test Connection). **Archetypes**: registry list with
valid/invalid/default-for-new-spaces status.

## 10. Common UI patterns worth adopting outright

- **Filters → Advanced Filters → Saved Filters triad** — the single most reusable pattern found:
  predefined typed filters, a custom `column/operator/value` builder, and a starred saved-filter
  list with a settable default. Appears identically on Process Instances, Tasks, Execution Errors.
- **Show/hide columns**, including surfacing entity-specific variable values as ad hoc columns
  once a list is filtered down to one definition — turns a generic list into a purpose-built report
  without a new screen.
- **Bulk Actions** on any list with row checkboxes, each action reporting per-row success/skip
  rather than an all-or-nothing toast.
- **Breadcrumb-as-navigation-contract**: every procedure in the docs is phrased
  `Menu → Top → Sub`, and that's literally the on-screen structure — a good discipline for keeping
  IA and documentation from drifting apart.
- **Generated dynamic forms (Form Modeler)**: forms auto-generate from a process (start form) or
  task, or are hand-built as a standalone Form asset; confirmed field type: **Document** (file
  upload, pluggable marshalling strategy). The rest of the palette (Text/Textarea/Integer/Decimal/
  Currency/Checkbox/Date/Radio/Dropdown/Slider/Sub-form/Multiple-Sub-form/HTML) is well-established
  general knowledge but not literally spelled out field-by-field in the fetched manuals — flagged
  as reasonably-confident, not manual-verified.
- **Everything has a REST counterpart** — KIE Server REST API, Controller REST API (execution
  servers), Knowledge Store REST API (spaces/projects), each with a live Swagger UI.

## Areas the official manuals leave thin (flagged, not guessed)

Form Modeler's full field palette; the Jobs *list* screen (vs. its creation dialog); the Home
page's exact widget layout; the Guided Rule/Decision Table designer's field-by-field anatomy;
the Contributors permission model (sourced from a community blog, not the primary manual).

## Comparison: jBPM concept → Camunda → Flowable

| jBPM / Business Central | Camunda 7 | Camunda 8 | Flowable |
|---|---|---|---|
| Space (tenant grouping) | Tenant (mostly API-level) | Tenant (Console) | No direct UI equivalent |
| Design → Projects (Git-VFS authoring) | No built-in web repo — own repo/IDE | Web Modeler's project/file browser | Flowable Design's app/model list |
| BPMN2 canvas | Camunda Modeler (desktop) | Web Modeler (browser, live-collab) | Flowable Modeler (browser) |
| Form Modeler | Camunda Forms (embedded) | Dedicated Form Builder | Flowable Form Builder |
| Manage → Process Definitions/Instances | **Cockpit** | **Operate** | Flowable Admin app |
| Track/Manage → Tasks | **Tasklist** | **Tasklist** | Flowable Task app |
| Track → Dashboards | Cockpit metrics + plugins | **Optimize** (dedicated BI product) | Basic charts only, no BI product |
| Deploy → Execution Servers | REST/Cockpit Deployments tab | Web Modeler Deploy / `zbctl` | Flowable Admin Deployments tab |
| Manage → Execution Errors | Cockpit **Incidents** | Operate **Incidents** | Admin app job/exception views |
| Deploy/Manage → Jobs | Cockpit Jobs/Job Definitions | Different model (Zeebe job-workers) | Admin app Jobs view |
| Access Control | Camunda Admin webapp | Identity/Console | Flowable IDM app |
| Case Management | Removed (early CMMN support dropped) | Not supported | Native CMMN engine + Modeler |
| Artifacts (Maven browser) | No equivalent | No equivalent | No equivalent |

**Takeaway carried into the IA**: Camunda/Flowable's persona-split (builder app / task app /
ops app / admin app) reads far cleaner than jBPM's one-workbench-five-menus shape. Our current
top-level nav already leans this way — this redesign leans further in, not back toward jBPM's
grouping. See [02-information-architecture.md](./02-information-architecture.md).
