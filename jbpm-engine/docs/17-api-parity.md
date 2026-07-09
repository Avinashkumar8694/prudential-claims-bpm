# 17 — API Parity with jBPM / KIE Server (query, task-admin, analytics)

Research of the jBPM KIE-Server + Business Central REST surface (the Swagger the user referenced) and
what this engine exposes, with the gaps we close in the `queries` module.

## Interactive API docs (Swagger)
- **`GET /api/openapi.json`** — the full OpenAPI 3.0 spec (58 paths, tagged by area) authored in
  `server/src/http/openapi.ts`.
- **`GET /api/docs`** — Swagger UI (try-it-out enabled), the same experience as jBPM's KIE-Server Swagger.
- A conformance test (`test/openapi.test.ts`) keeps the spec honest: every documented path+method must be
  a real route and every route must be documented, and all `$ref`s must resolve.

## What jBPM exposes (the relevant families)
- **Process definitions** — list all deployed defs, by container, variables, subprocesses, referenced signals.
- **Process instances** — list/filter (status, var, container, correlation, initiator, date), node instances
  (executed nodes + counts), variables history, diagram, signal/abort.
- **Task queries** — tasks *as potential owner* (by user / by group), tasks *owned*, tasks by process
  instance, task events, tasks by status, task by variables.
- **User/group task summaries** — per-user inbox, per-group queue, tasks completed by a user.
- **Admin / analytics** — task & process **duration (TAT)**, execution errors, jobs (timers), dashboards.
- **Correlation & relations** — related process instances, signals a process listens for/throws.

## Before this change (already present)
| Area | Endpoint(s) |
|---|---|
| Process definitions per version | `GET /deployments/:id/definitions` |
| Instances list/detail/history/graph | `GET /instances`, `/:id`, `/:id/history`, `/:id/graph`, `/:id/diagram-state` |
| Instance node **execution counts** + active highlight | `graph.counts` (rendered as jBPM-style badges) |
| Related (parent/children) | `GET /instances/:id/related` |
| Signal / retry / suspend / resume / abort | `POST /instances/:id/{signal,retry,suspend,resume,abort}` |
| Tasks list + claim/release/complete | `GET /tasks`, `POST /tasks/:id/{claim,release,complete}` |
| Deployment lifecycle + versioning | `deploy/activate/rollback/undeploy/archive`, branches→versions |

## Gaps closed here (`queries` module → `/query/*`)
| jBPM concept | New endpoint |
|---|---|
| All deployed process definitions (+ live stats) | `GET /query/process-definitions` |
| Instances of a process definition | `GET /query/process-definitions/:processId/instances` |
| Signals a process references (listen/throw) | `GET /query/process-definitions/:processId/signals` |
| User directory (derived) with work counts | `GET /query/users` |
| Tasks owned by a user (inbox) | `GET /query/users/:user/tasks` |
| Tasks completed by a user | `GET /query/users/:user/tasks/completed` |
| Tasks for a group (queue / potential owner) | `GET /query/groups/:group/tasks` |
| Tasks of a process instance | `GET /query/instances/:id/tasks` |
| **Task duration / TAT** analytics | `GET /query/analytics/tasks` |
| **Process duration / TAT** + status mix | `GET /query/analytics/processes` |
| Dashboard summary (counts) | `GET /query/analytics/summary` |
| Timers / jobs list | `GET /query/jobs` |

All are read-only aggregates over the same MemoryStore repos (instances/tasks/deployments/timers/audit),
tenant-scoped, and covered by `test/queries.test.ts`.

## Notes on fidelity
- **Potential-owner semantics**: jBPM resolves group membership from its identity store. This engine has
  no identity store yet (auth/RBAC is out of scope), so *by-group* returns the group queue and *by-user*
  returns owned tasks; the derived `/query/users` list is inferred from actual activity (initiators,
  assignees, completers, audit actors).
- **TAT** = wall-clock between create/complete (tasks) and start/end (instances), reported as
  count/avg/min/max ms, grouped by process and by assignee.
