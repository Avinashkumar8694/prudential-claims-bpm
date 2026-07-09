# 02 — Features

Feature catalog, each mapped to the jBPM/Business Central capability it mirrors and the SDK/engine
piece that powers it. Priority: **P0** = v1 must-have, **P1** = fast-follow, **P2** = later.

## A. Workflow builder (authoring)

| Feature | jBPM analog | Powered by | Pri |
|---------|-------------|-----------|-----|
| Categorized node palette (sidenav) | BC process palette | SDK node types + `docs/bpm-nodes` | P0 |
| Drag-drop canvas, connect edges | BC process designer canvas | @foblex/flow + engine JSON | P0 |
| Per-node properties panel | BC node properties | `docs/bpm-nodes/*/node_properties.md` JSON schemas | P0 |
| Node types: start/end (all triggers) | Start/End events | `EngineStart`/`EngineEnd` | P0 |
| Tasks: script, user, service(REST), business-rule, send, receive, manual | BC tasks | Engine task nodes | P0 |
| Call activity + multi-instance | Reusable/MI sub-process | `EngineCall`/`EngineForEach` | P0 |
| Gateways: exclusive/parallel/inclusive/event/complex | BC gateways | `EngineGateway` | P0 |
| Boundary events (timer/error/message/signal/…) | BC boundary events | `EngineBoundary` | P0 |
| Intermediate catch/throw | BC intermediate events | `EngineCatch`/`EngineThrow` | P0 |
| Sub-process: embedded/transaction/event | BC sub-processes | `EngineSubprocess` | P0 |
| Data objects / process variables (typed) | BC variables/data objects | `EngineProcess.vars`/`data` | P0 |
| Lanes / swimlanes | BC lanes | `EngineProcess.lanes` | P1 |
| Model validation with inline errors | BC problems view | SDK `validateModel` | P0 |
| Undo/redo, undo-all, copy/paste | BC editor | Command stack (client) | P1 |
| Auto-layout | BC auto-arrange | dagre layout | P1 |

## B. Assets (rules, decisions, forms)

| Feature | jBPM analog | Powered by | Pri |
|---------|-------------|-----------|-----|
| Forms designer + runtime render/validate | BC forms | SDK form model + `form.mjs` runtime | P0 |
| DRL rulesets (authored simply) | BC DRL / guided rules | SDK `rulesToDrl` + `rule-engine.mjs` | P0 |
| DMN decision tables | BC DMN | SDK `decisionToDmn` + `dmn-engine.mjs` | P0 |
| Guided decision table / tree | BC guided editors | SDK `gdst`/`gdt` + runtimes | P1 |
| Scorecards | BC scorecards | SDK `scorecardToScgd` + `scorecard.mjs` | P1 |
| Enumerations, DSL, properties (i18n) | BC assets | SDK codecs + runtimes | P2 |
| Data-object types → POJOs (for export) | BC data objects | SDK `types` → `.java` | P1 |

## C. Deployment, branching, versioning  → see [09](./09-deployment-branching-versioning.md)

| Feature | jBPM analog | Pri |
|---------|-------------|-----|
| Branches per workflow (fork from a version) | Git-backed spaces / branches | P0 |
| Immutable versions per branch | BC project versions | P0 |
| Version diff | — (value-add) | P1 |
| Deploy a version → deployment snapshot | BC deploy to KIE server | P0 |
| Deployment **tags** | KIE container aliases / labels | P0 |
| **Active** deployment per environment | KIE server "active" container alias | P0 |
| Promote / rollback (move active pointer) | Redeploy / alias swap | P0 |
| Deployment management dashboard | BC/Business Central deployments | P0 |
| Undeploy / archive | Remove container | P1 |

## D. Runtime & operations  → see [08](./08-execution-engine.md)

| Feature | jBPM analog | Powered by | Pri |
|---------|-------------|-----------|-----|
| Start instance (active deployment / by tag) | Start process instance | Interpreter | P0 |
| Instance list + filters | Process instances view | Store | P0 |
| **Per-instance detail** (vars, history, tokens, errors) | Instance details | Interpreter + audit | P0 |
| **Live executing-flow highlight on canvas** | Diagram with node state | WS + canvas overlay | P0 |
| Timers (delay, boundary) durable | jBPM timers | Timer service | P0 |
| User task inbox + claim/complete + forms | Task list | Task service + forms | P0 |
| Signals / messages (send/broadcast/correlate) | Signal/message events | Signal bus | P1 |
| Retry / resume / abort; retry failed node | Instance ops | Interpreter | P0 |
| Audit log per instance | jBPM audit | Audit store | P0 |
| Metrics & dashboards | BC dashboards | Metrics module | P1 |

## E. Interop / export  → see [05](./05-api-spec.md)

| Feature | jBPM analog | Powered by | Pri |
|---------|-------------|-----------|-----|
| Export workflow version → kjar (zip) | Build & deploy kjar | SDK `fromEngineProject`+`writeProject` | P0 |
| Import jBPM project → engine model | Import project | SDK `toEngineProject` | P1 |
| Download `.bpmn` / assets | Export assets | SDK serializers | P1 |
| REST API + WebSocket events | KIE Server REST | Express + ws | P0 |
| Webhooks (instance/task lifecycle) | — | Event bus | P2 |

## F. Platform

| Feature | Pri |
|---------|-----|
| Multi-tenant workspaces | P1 |
| RBAC (author/release/operator/worker/admin) | P0 |
| Secrets & integration endpoint management | P0 |
| Audit of admin actions | P1 |
| Import/export of whole workspace | P2 |
| Theming to match reference UI | P0 |
