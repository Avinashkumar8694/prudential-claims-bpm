# 03 — Architecture (Technical)

## 1. Big picture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                          app/  (Angular 18, :4200)                          │
│  Header · SideNav(palette) · Canvas(@foblex/flow) · PropertiesPanel · Footer│
│  Builder view  ·  Deployments view  ·  Instances view  ·  Task inbox        │
│              REST (HttpClient)  +  WebSocket (live flow/instance)            │
└───────────────────────────────▲───────────────────────┬────────────────────┘
                                 │ JSON/HTTP + WS         │
┌────────────────────────────────┴───────────────────────▼────────────────────┐
│                        server/  (Node 20 + Express, :4000)                    │
│                                                                               │
│  HTTP API layer (routers, DTOs, validation, authZ)                            │
│  ├─ workflows        ├─ branches/versions   ├─ deployments/tags               │
│  ├─ instances        ├─ tasks               ├─ assets(forms/rules/dmn/…)      │
│  └─ export/import                                                             │
│                                                                               │
│  Domain services                                                              │
│  ├─ WorkflowService   BranchService   VersionService                          │
│  ├─ DeploymentService (tags, active pointer, promote/rollback)                │
│  ├─ ExecutionEngine (token interpreter)  ── uses ──┐                          │
│  ├─ TimerService   TaskService   SignalBus         │                          │
│  └─ ExportService / ImportService                  │                          │
│                                                     ▼                          │
│  Runtime evaluators (from SDK examples/functions):  rule-engine, dmn-engine,  │
│  decision-tree, guided-table, scorecard, form, enumeration, properties        │
│                                                                               │
│  @neutrinos/bpmn-sdk:  fromEngine/toEngine, validateModel, serializeProcess,  │
│                        fromEngineProject/toEngineProject, writeProject        │
│                                                                               │
│  Stores (repository interfaces)  ── file (dev) │ Postgres (prod) ──           │
│  workflows · branches · versions · deployments · instances · tasks · audit    │
│                                                                               │
│  Cross-cutting: auth, tenancy, secrets, logging, metrics, WS hub, scheduler   │
└───────────────────────────────────────────────────────────────────────────┘
```

## 2. Layering (server)

1. **HTTP/API** (`src/api`) — Express routers per module; request validation (zod); maps DTO↔domain;
   enforces authN/authZ; never contains business logic.
2. **Domain services** (`src/modules/*`) — the business logic; pure, store-injected, unit-testable.
3. **Execution** (`src/engine`) — the token interpreter + node handlers + timer/task/signal services.
4. **Persistence** (`src/store`) — `Repository<T>` interfaces + `FileStore`/`PgStore` implementations.
5. **Integration** (`src/sdk`) — thin wrappers over `@neutrinos/bpmn-sdk` + the runtime evaluators.
6. **Infra** (`src/infra`) — config, logger, metrics, WS hub, scheduler, auth, errors.

**Dependency rule:** api → services → (engine, store, sdk) → infra. No upward imports.

## 3. Module map

| Module | Responsibility | Key types |
|--------|----------------|-----------|
| `workflows` | Workflow CRUD, keys, permissions, variables | `Workflow` |
| `branches` | Branch lifecycle, fork points | `Branch` |
| `versions` | Immutable snapshots of engine JSON | `Version` |
| `deployments` | Deploy, tags, active pointer, promote/rollback | `Deployment`, `Tag` |
| `instances` | Process-instance lifecycle & queries | `Instance`, `Token` |
| `tasks` | User-task inbox, claim/complete | `Task` |
| `assets` | Forms, rules, DMN, tables, trees, scorecards | SDK asset models |
| `export` | Engine model → kjar (zip); download | — |
| `import` | kjar/project → engine model | — |
| `engine` | Interpreter, handlers, timers, signals | `ExecutionEngine` |
| `auth` | Users, roles, tenants, sessions | `Principal` |
| `secrets` | Secret & endpoint management | `Secret` |
| `audit` | Append-only event log | `AuditEvent` |

## 4. How the SDK is used

- **Author time**: UI edits engine JSON. On save, server runs `validateModel(fromEngine(process))`
  and stores the engine JSON as a version.
- **Run time**: the interpreter walks the **engine JSON** directly (not BPMN XML) — engine JSON is the
  native runtime IR. Rule/DMN/etc. nodes call the SDK runtime evaluators.
- **Export**: `fromEngineProject(engineProject)` → jBPM `Project` → `writeProject` → zip a kjar.
- **Import**: `parseProject`/`toEngineProject` → engine JSON → new workflow/version.

> Engine JSON is the single IR for authoring **and** execution; BPMN XML is only produced on export.

## 5. Data flow — "deploy then run"

```
Author saves → Version(engineJSON) created on Branch
Release deploys Version → Deployment(snapshot) + Tags; sets active pointer
Operator starts instance → resolve active Deployment → ExecutionEngine.start(engineJSON, vars)
Engine advances tokens → emits events → WS hub → UI highlights nodes; audit persists
Timer/task/signal waits → scheduler/task service → resume token
Instance completes/fails → final state + audit
```

## 6. Execution model (summary — full detail in [08](./08-execution-engine.md))

- **Token-based interpreter.** An instance holds one or more tokens; each token sits on a node.
- **Node handlers** — one per engine node `type` (`start`, `script`, `http`, `rule`, `userTask`,
  `gateway`, `catch`, `throw`, `boundary`, `subprocess`, `forEach`, …). A handler consumes a token,
  does its work (sync or async/wait), and produces outgoing tokens.
- **Wait states** (userTask, receive, catch-timer/message/signal, boundary) persist and resume on an
  external event (task completed, timer fired, signal received).
- **Deterministic core** — no wall-clock/random inside the step function (injected clock) → testable.

## 7. Persistence strategy

- `Repository<T>` interface: `get/list/put/delete/query`. 
- `FileStore` — JSON files under `server/.data/<tenant>/<collection>/<id>.json` (dev, zero-setup).
- `PgStore` — Postgres (prod); same interface, JSONB columns + indexes on hot query fields.
- Instances & timers are persisted after **every** committed step so nothing is lost on restart.

## 8. Realtime

- A **WS hub** broadcasts `instance.updated`, `token.moved`, `node.entered/exited`, `task.created`,
  `timer.fired`, `deployment.activated`. Clients subscribe by `instanceId` / `workflowId` / topic.

## 9. Frontend architecture (Angular)

- **Standalone components**, routed feature areas: `builder`, `deployments`, `instances`, `tasks`,
  `admin`.
- **Canvas**: `@foblex/flow` wraps a node/edge model derived from engine JSON; a `CanvasStore`
  (signals) is the single source of truth; property edits mutate the store → autosave debounce → API.
- **Services**: `ApiService` (HttpClient), `RealtimeService` (WS), one store service per feature.
- **Shell**: `HeaderComponent` (workflow name/key, Update/User Permissions/Variables, import/export),
  `SideNavComponent` (palette + app nav), `FooterComponent`, `PropertiesPanelComponent`.
- Theming via CSS variables tuned to the reference screenshots.

## 10. Configuration & environments

- `server/.env` — `PORT`, `DATA_DIR`, `STORE=file|pg`, `PG_URL`, `JWT_SECRET`, `INTEGRATION_BASE_URL`,
  `SCRIPT_SANDBOX=vm|isolate`, `WS_PATH`.
- Per-**deployment** env (e.g. `INTEGRATION_LAYER_URL`) overrides global at run time for service tasks.

## 11. Testing strategy

- **Unit**: services + node handlers + stores (in-memory repo).
- **Integration**: API + engine + file store; start→complete a real multi-node instance.
- **Contract**: export a workflow → assert kjar validates via SDK; import → round-trip equals.
- **E2E**: Angular + Playwright — build a flow, deploy, run, watch live highlight, complete a task.

## 12. Directory layout

```
server/
  src/
    index.ts app.ts config.ts
    infra/   (logger, ws-hub, scheduler, errors, auth, metrics)
    sdk/     (sdk wrapper + runtime evaluators re-export)
    store/   (repository.ts, file-store.ts, pg-store.ts)
    engine/  (execution-engine.ts, handlers/*, timer-service.ts, task-service.ts, signal-bus.ts)
    modules/ (workflows, branches, versions, deployments, instances, tasks, assets, export, import,
              auth, secrets, audit)  ← each: model.ts service.ts router.ts *.test.ts
  test/
app/
  src/app/
    core/ (api.service, realtime.service, models, guards, interceptors)
    shell/ (header, footer, side-nav)
    features/ (builder, deployments, instances, tasks, admin)
    shared/ (ui components, canvas, properties-panel, node-registry)
```
