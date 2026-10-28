# 13 — Projects, Multi-Process, Assets & Operations

This is the plan (research + design) for the **Project** model and the operations around it: a project
groups many processes + shared variables/settings/assets/rules; the whole project is versioned and
deployed as a unit; and processes run with per-version definitions, instances, tasks, and cron
triggers. Scope, decisions, and the build checklist are here; items are tracked in
[10-checklist.md](./10-checklist.md) (Phase 7).

## 1. Key decision — Project = versioned/deployed unit; Process = a flow inside it

The SDK `EngineProject` **already** carries `processes[]`, `types`, `rulesets`, `decisions`,
`guidedTables`, `forms`, `enumerations`, `messages`, `tests`, … So we do **not** need a new storage
shape — a **Version's `engine` is the whole project snapshot**. What changes is that we now manage
*many* processes + assets inside it (today the UI only touched `processes[0]`).

| Concept | Maps to | Notes |
|---------|---------|-------|
| **Project** | the `Workflow` entity (relabelled "Project" in the UI) | has branches, versions, project-level permissions & shared variables |
| **Process** | an `EngineProcess` in `version.engine.processes[]` | add/remove/rename; each opens in the builder |
| **Assets** | `version.engine.{forms,rulesets,decisions,guidedTables,decisionTrees,scorecards,enumerations,types,messages,tests}` | shared across the project's processes |
| **Project variables** | `Workflow.variables` (shared) + each process's own `vars` | shared + per-process |
| **Version** | `EngineProject` snapshot | one publish freezes ALL processes + assets together |
| **Deployment** | frozen `EngineProject` + env + tags | contains every process definition of that version |

> Rename is UI/label-level; the `workflows` collection & routes stay to avoid data churn (a thin
> `/api/projects` alias may be added). Instances gain a `processId` so a deployment with N processes
> can start/track each independently.

## 2. Project detail — tabs

Selecting a project opens a tabbed view; selecting a process opens the **builder**.

| Tab | Content |
|-----|---------|
| **Processes** | list of processes (name, id, node count, status); add / rename / delete; **Open** → builder; per-process **cron** trigger toggle |
| **Variables** | project-shared variables (typed); per-process vars are edited in the builder |
| **Assets** | grouped list of all asset kinds (Forms, DRL rules, DMN, Decision tables/trees, Scorecards, Enumerations, Data types, Messages, Test scenarios) with **Add** + inline/basic config; full editors are per-asset (Phase 8) |
| **Rules** | rulesets + DMN decisions (subset of Assets, surfaced for convenience) |
| **Settings** | key, description, deployment env defaults (`INTEGRATION_LAYER_URL`, …), tags policy, per-process cron schedules |
| **Deployments** | this project's deployments (version, tags, environment, active), promote/rollback/undeploy/export |
| **Instances** | running/finished instances across the project's processes (see §6) |

Builder header (per process): project ▸ process name, branch/version switcher, **Update**, User
Permissions, Variables, **Test** (dry-run: start an instance on a scratch/tag and open its diagram),
**Deploy** (publish + deploy the whole project). Deploy disabled while validation errors exist.

## 3. Assets — how they're added and applied

- **Authoring**: each asset kind is an entry in the project's `EngineProject` (the SDK models them).
  The Assets tab lists them by kind and lets you Add (seed a minimal asset) + edit (basic form now;
  dedicated designers later). Saving updates the head draft `engine` (autosave), same as processes.
- **Linking**: nodes reference assets by **name** — `userTask.form`, `rule.ruleflowGroup` /
  `rule.dmn`, decision-table/tree names, etc. Validation checks the referenced asset exists (Phase 7
  rule `asset-ref`).
- **Applying at runtime** (Node engine):
  - **Forms** → task rendering/validation via the SDK form runtime.
  - **DRL rulesets** → the SDK `rule-engine` evaluator runs `rule` nodes by `ruleflowGroup`.
  - **DMN** → the SDK `dmn-engine` evaluates `rule.dmn` decisions.
  - **Decision tables/trees/scorecards/enumerations** → corresponding SDK runtime evaluators.
  - **Data types** → validate/instantiate variables; used for form field types.
- **Applying on export** (`fromEngineProject`) → real jBPM assets (`.drl`, `.dmn`, `.gdst`, `.frm`,
  `.java`, …) in the kjar. This already works in the SDK.

## 4. Versioning & deployment (per project)

- A **version** snapshots the entire `EngineProject`. **Publish** validates **every** process
  (Phase 7 rules) and freezes; **Deploy** copies the snapshot into a Deployment with env + tags and
  (optionally) activates it in an environment. Exactly one active deployment per (project, env).
- **Process definitions per version** = `deployment.engine.processes[]`. Endpoint:
  `GET /deployments/:id/definitions` → `[{ id, name, nodes, startable }]`. The Instances/Definitions
  views read these so everything is **version-pinned**.
- Promote/rollback/undeploy/archive + kjar export are unchanged (already implemented).

## 5. Cron / scheduled starts (per process)

- **Model**: each process may have a `cron` trigger in project **settings**:
  `{ processId, spec, environment, inputs?, enabled }` where `spec` is an ISO-8601 repeating cycle
  (`R/PT1H`, `R/P1D`) or a simple cron-ish interval. (BPMN start-timer `on.timer.cycle` is the
  in-diagram equivalent; the settings cron is the ops-level equivalent that starts an instance.)
- **Scheduler**: a `CronService` computes the next due time per enabled cron and, on tick, starts an
  instance on the active deployment for that environment/process. Deterministic core: `tick(now)`
  returns the crons that are due and advances their `nextAt`; a real `setInterval` drives it in
  `index.ts`. Persisted as `timers`/cron records so it survives restart.
- **UI**: Settings/Processes tab toggle + schedule field per process; a "Scheduled" badge.

## 6. Process instances — management & alignment with rules

- **Statuses**: `running · waiting · completed · aborted · failed · suspended` (already modelled).
  The Instances view filters by status, process, and deployment; opening one shows the **diagram
  highlight, variables, history, related instances, signal, node re-trigger, suspend/resume/abort**
  (already built).
- **Version alignment**: an instance pins its `deploymentId` (and thus the exact engine snapshot);
  it always runs against the definition it started on, even after new deployments (jBPM-like).
- **Alignment with validation rules**: a process can only be **deployed** if it passes the Phase 7
  rule set, so **every running instance is of a validated definition**. Runtime additionally guards:
  unresolved called-process → graceful passthrough (logged), script errors → node `failed` + retry,
  gateway with no matching branch + no default → instance `failed` with a clear error. Optionally a
  pre-start check re-validates the active deployment (defense in depth).
- **Tasks per version**: the Task inbox is filtered by deployment/version so task lists are
  version-scoped; task forms come from the deployment's assets.

## 7. Backend changes (incremental, mostly additive)

1. `Instance.processId`; `ExecutionEngine.start(dep, vars, actor, { processId })` selects the process.
2. `InstanceService.start({ workflowId, processId, environment|deploymentId, … })`.
3. `resolveCalled` searches **all** processes across active deployments (cross-process call activities).
4. `processes` module: list/add/rename/remove processes inside the project head draft; `getProcess`/
   `saveProcess` (builder reads/writes a single process, preserving the rest).
5. `definitions` endpoint on deployments; instance `graph()` uses the instance's own process.
6. `assets` module: list/add asset entries in the head draft engine (Forms/DRL/DMN/…); validation
   `asset-ref` rule (referenced asset exists).
7. `CronService` + settings model + scheduler wiring.

## 8. Frontend changes

1. Relabel Workflows→**Projects**; project list.
2. **Project detail** with the tabs in §2.
3. Builder loads a **specific process** by id within the project engine; header Test/Deploy.
4. Assets/Rules tabs (list + basic add); Settings (env + cron); Deployments/Instances tabs reuse
   existing views scoped to the project.

## 9. Out of scope (later phases)
- Dedicated asset designers (visual form builder, DRL/DMN/table editors) — Phase 8.
- 3-way branch merge; multi-tenant admin UI; Postgres store (Phase 6).
