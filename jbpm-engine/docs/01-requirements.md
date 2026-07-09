# 01 — Requirements

## 1. Purpose & scope

Build a Node.js-native BPM platform that replicates the **authoring** and **operations** experience of
jBPM / Business Central, without a Java/KIE runtime. Processes are authored in the
`@neutrinos/bpmn-sdk` engine JSON model, executed by a Node interpreter, and can be exported to a real
jBPM kjar at any time.

**In scope**
- Visual workflow builder (palette, canvas, properties panel) — see [UI Spec](./06-ui-spec.md).
- The full node set the SDK models (all events, gateways, tasks, sub-processes, boundary events).
- Data objects / variables, forms, business rules (DRL), DMN decisions, decision tables/trees,
  scorecards, guided rules — reusing SDK models + runtime evaluators.
- **Deployments** with **branches**, **per-branch versioning**, **deployment tags**, and an
  **active tag** per environment.
- **Runtime execution** in Node with **per-instance detail** and **live executing-flow** highlight.
- **Export as jBPM project** (kjar) for any workflow version.
- REST + WebSocket API; multi-tenant, role-based access.

**Out of scope (v1)**
- Running actual Drools/KIE (we simulate; export bridges to real jBPM).
- BPMN constructs the SDK marks best-effort only (documented in SDK) beyond round-trip fidelity.
- Native mobile apps.

## 2. Personas

| Persona | Needs |
|---------|-------|
| **Process Author** | Drag/drop build, configure nodes, manage variables/forms/rules, save & version |
| **Release Manager** | Branch, tag, promote, set active deployment, roll back |
| **Operator** | Start instances, monitor running/failed instances, inspect executing flow, retry/abort |
| **Task Worker** | See assigned user tasks, open forms, complete/claim tasks |
| **Admin** | Manage users/roles/tenants, secrets, integration endpoints, audit |
| **Integrator** | Call REST API, receive webhooks/WS events, export kjar to CI |

## 3. Functional requirements

### FR-A Authoring
- FR-A1 Create/rename/delete a **workflow** (name + unique key), like the header in the reference UI.
- FR-A2 Drag nodes from a categorized **palette** onto the canvas; connect with edges.
- FR-A3 Select a node/edge → edit its properties in the right **properties panel** (per-type forms).
- FR-A4 Configure process **variables** (typed) and **user permissions** (header buttons in reference).
- FR-A5 Auto-layout, pan/zoom, multi-select, copy/paste, undo/redo, "Undo all changes".
- FR-A6 Validate the model (SDK `validateModel`) with inline error surfacing.
- FR-A7 Persist as engine JSON; every save creates/updates a **draft version** on the current branch.

### FR-B Branching & versioning
- FR-B1 Each workflow has one or more **branches** (default: `main`).
- FR-B2 Create a branch from any existing version (fork point recorded).
- FR-B3 Each branch has an ordered list of **versions** (immutable once published).
- FR-B4 Diff two versions (node/edge/property level).
- FR-B5 Merge is explicit copy-forward in v1 (no 3-way auto-merge); conflicts surfaced.

### FR-C Deployment & tags
- FR-C1 **Deploy** a specific version → creates a **deployment** record (immutable snapshot).
- FR-C2 Attach **tags** to a deployment (e.g. `dev`, `staging`, `prod`, `v1.2.0`).
- FR-C3 Exactly one **active** deployment per (workflow, environment/tag-namespace).
- FR-C4 Promote/rollback = move the active pointer to another deployment.
- FR-C5 List all deployments with their tags and active state (deployment management view).
- FR-C6 Undeploy / archive.

### FR-D Execution & operations
- FR-D1 **Start** a process instance against the active deployment (or a chosen tag), with input vars.
- FR-D2 Interpreter advances tokens through nodes per BPMN semantics ([Execution Engine](./08-execution-engine.md)).
- FR-D3 Per-instance **detail view**: state, variables, node history, current token(s), errors.
- FR-D4 **Live executing-flow**: highlight active nodes/edges on the canvas in real time (WS).
- FR-D5 **Timers** (delay/wait, boundary timers) fire correctly, survive restart.
- FR-D6 **User tasks**: task list, claim/complete, form rendering & validation.
- FR-D7 **Signals/messages**: send to an instance / broadcast; correlate.
- FR-D8 Retry / resume / abort an instance; retry a failed node.
- FR-D9 Full **audit log** per instance (who/what/when + payloads).

### FR-E Integrations
- FR-E1 HTTP/REST service tasks call external systems (base URL from deployment env).
- FR-E2 Business-rule / DMN / decision-table / decision-tree / scorecard evaluation via SDK runtimes.
- FR-E3 Sub-process & multi-instance call activities.

### FR-F Export / interop
- FR-F1 **Export** any workflow version as a jBPM kjar (SDK `fromEngineProject`+`writeProject`).
- FR-F2 **Import** a jBPM project → engine model (SDK `toEngineProject`); lossless round-trip.
- FR-F3 Download the generated `.bpmn`/assets; zip the kjar.

## 4. Non-functional requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | API latency (CRUD) | p95 < 150 ms |
| NFR-2 | Canvas interaction | 60 fps up to ~300 nodes |
| NFR-3 | Concurrent instances | 10k active (single node), horizontal scale via queue/DB |
| NFR-4 | Durability | No lost instances/timers across restart (persisted store) |
| NFR-5 | Security | See [Security](./07-security.md): authZ on every route, sandboxed script exec |
| NFR-6 | Observability | Structured logs, metrics, per-instance trace |
| NFR-7 | Portability | Pure Node 20; no native/Java deps for core; Docker image |
| NFR-8 | Testability | Unit + integration + e2e; deterministic interpreter for tests |
| NFR-9 | Accessibility | WCAG 2.1 AA for the builder & consoles |
| NFR-10 | Data model swappability | Store behind a repository interface (file → Postgres) |

## 5. Constraints & assumptions

- Reuses `@neutrinos/bpmn-sdk` as the authoring & conversion source of truth.
- Script tasks author code in `js` | `java` | `mvel`; **only `js` executes natively** in Node
  (sandboxed). `java`/`mvel` are preserved for export and flagged as non-executable at runtime.
- Single-writer per instance (actor-style) to keep token semantics simple in v1.
