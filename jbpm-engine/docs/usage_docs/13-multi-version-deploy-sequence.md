# Multi-Version Deploy → Instance → Tasks → Signals (Full Request Sequence)

A complete, request-level trace of deploying the **same project twice** (two published versions),
starting one instance against each, then reading tasks and signals back — with exact request/response
bodies and the precise moment every identifier gets generated. This ties together
[Projects & processes](04-projects-and-processes.md), [Deployments & environments](05-deployments-and-environments.md),
[Running & monitoring instances](06-running-and-monitoring-instances.md), and
[Human tasks](07-human-tasks.md) into one continuous trace, grounded directly in the current route/
service implementations (`modules/workflows`, `modules/versions`, `modules/deployments`,
`modules/instances`, `modules/queries`) — not the original design intent.

## The model, in one picture

```
Workflow (project, stable "key")
  └─ Branch (e.g. "main")
       └─ Version (draft → published; auto-numbered v1, v2, v3…)
            └─ Deployment (an IMMUTABLE snapshot of ONE published version, bound to one environment)
                 └─ Instance (bound to exactly ONE deploymentId, forever)
```

A `Deployment` is a `structuredClone()` of the version's engine JSON at deploy time — **not** a live
pointer. Deploying the same project again always creates a brand-new `Deployment` row with a brand-new
`deploymentId`; nothing is ever overwritten. Only one deployment per `(workflowId, environment)` can be
`active` at a time — activating a new one just flips the previous one to `inactive`
(`DeploymentService.activate`); it never touches instances already running on the old one, and never
touches other environments.

An `Instance` stores `deploymentId` + `workflowId` + `processId` — **not** a `versionId` directly. To
find an instance's version, look up its `deploymentId` → that `Deployment.versionNumber`/`versionLabel`.
`processId` (e.g. `claim-review.process`) stays **stable across every version** (`ProcessService.
saveProcess` keeps the id fixed on every edit) — that's what lets a query aggregate "every instance of
this process, across every version it ever ran on."

## When each identifier is generated

| Identifier | Generated at | Reused across versions? |
|---|---|---|
| `workflowId` | Project creation (`POST /workflows`) — **once, ever** | Always |
| `branchId` | Project creation (default branch), or an explicit new branch | Across every version on that branch |
| `versionId` | Every `saveDraft`/`publish` — a new, incrementing number each time | No — one per version |
| `deploymentId` | Every `deploy` call — a new row even for the *same* version deployed twice | No — one per deploy |
| `instanceId` | Every `POST /instances` (or a timer/signal-triggered start) | No — one per run |
| `processId` | First authored, kept stable on every edit (`saveProcess` preserves it) | Always |

**`workflowId` is generated exactly once** — inside `WorkflowService.create()` — and is never
regenerated. Every version, deployment, and instance created afterward all carry a reference back to
that same original id; it is the one constant through the entire trace below.

## Full sequence diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant API as API Router
    participant WF as WorkflowService
    participant VS as VersionService
    participant DS as DeploymentService
    participant IS as InstanceService
    participant EN as ExecutionEngine
    participant QS as QueryService
    participant DB as Store

    rect rgb(224,236,242)
    Note over Client,DB: Phase 1 · Create project
    Client->>API: POST /workflows
    API->>WF: create({name,key})
    WF->>DB: put Workflow, Branch(main), Version v1(draft)
    Note right of WF: workflowId generated HERE
    WF-->>Client: 201 Workflow{id: WF_ID}
    end

    rect rgb(224,240,230)
    Note over Client,DB: Phase 2 · Author + publish v1
    Client->>API: PUT /workflows/WF_ID/processes/:pid
    API->>DB: update Version v1(draft).engine
    Client->>API: POST /versions/V1_ID/publish
    API->>VS: publish(V1_ID)
    VS->>DB: V1 -> state=published; open draft v2
    VS-->>Client: 200 {published:{id:V1_ID}, newDraft:{id:V2_ID}}
    end

    rect rgb(224,240,230)
    Note over Client,DB: Phase 3 · Deploy v1 to prod, activate
    Client->>API: POST /versions/V1_ID/deploy {environment:"prod",activate:true}
    API->>DS: deploy(V1_ID)
    DS->>DB: put Deployment{id:DEP1, status:inactive, versionNumber:1}
    DS->>DS: activate(DEP1)
    DS->>DB: DEP1.status -> active
    DS-->>Client: 201 Deployment{id:DEP1, status:"active"}
    end

    rect rgb(232,226,245)
    Note over Client,DB: Phase 4 · Start instance A (binds to v1)
    Client->>API: POST /instances {workflowId:WF_ID, environment:"prod"}
    API->>IS: start()
    IS->>DS: resolveActive(WF_ID,"prod")
    DS-->>IS: DEP1
    IS->>EN: engine.start(DEP1, vars)
    EN->>DB: put Instance{id:INST_A, deploymentId:DEP1, workflowId:WF_ID}
    EN-->>Client: 201 Instance{id:INST_A, deploymentId:DEP1, status:"waiting"}
    end

    rect rgb(224,240,230)
    Note over Client,DB: Phase 5 · Edit + publish v2 (same processId)
    Client->>API: PUT /workflows/WF_ID/processes/:pid (v2 edits)
    Client->>API: POST /versions/V2_ID/publish
    API->>VS: publish(V2_ID)
    VS->>DB: V2 -> state=published; open draft v3
    VS-->>Client: 200 {published:{id:V2_ID, number:2}}
    end

    rect rgb(224,240,230)
    Note over Client,DB: Phase 6 · Deploy v2 to SAME env, activate
    Client->>API: POST /versions/V2_ID/deploy {environment:"prod",activate:true}
    API->>DS: deploy(V2_ID)
    DS->>DB: put Deployment{id:DEP2, status:inactive, versionNumber:2}
    DS->>DS: activate(DEP2)
    DS->>DB: DEP1.status -> inactive; DEP2.status -> active
    Note right of DS: instance A on DEP1 keeps running, untouched
    DS-->>Client: 200 Deployment{id:DEP2, status:"active"}
    end

    rect rgb(232,226,245)
    Note over Client,DB: Phase 7 · Start instance B (binds to v2)
    Client->>API: POST /instances {workflowId:WF_ID, environment:"prod"}
    API->>IS: start()
    IS->>DS: resolveActive(WF_ID,"prod")
    DS-->>IS: DEP2
    IS->>EN: engine.start(DEP2, vars)
    EN->>DB: put Instance{id:INST_B, deploymentId:DEP2, workflowId:WF_ID}
    EN-->>Client: 201 Instance{id:INST_B, deploymentId:DEP2, status:"waiting"}
    end

    rect rgb(246,232,210)
    Note over Client,DB: Phase 8 · Fetch tasks (per version, then per instance)
    Client->>API: GET /instances?workflowId=WF_ID&deploymentId=DEP1
    API->>IS: list({workflowId,deploymentId})
    IS->>DB: query Instance
    IS-->>Client: 200 {items:[INST_A]}
    Client->>API: GET /query/instances/INST_A/tasks
    API->>QS: instanceTasks(INST_A)
    QS->>DB: query Task where instanceId=INST_A
    QS-->>Client: 200 {items:[Task{id,name,status,group}]}
    end

    rect rgb(246,232,210)
    Note over Client,DB: Phase 9 · Fetch signals the process listens for / throws
    Client->>API: GET /query/process-definitions/claim-review.process/signals
    API->>QS: processSignals(processId)
    QS->>DB: resolve process from any ACTIVE deployment (DEP2 wins)
    QS-->>Client: 200 {processId, listensFor:[...], throws:[...]}
    end
```

## Phase-by-phase: curl + exact request/response

Assumes `TOKEN` is already set — see [Getting started](01-getting-started.md) /
[Authentication](03-authentication-and-authorization.md) for login.

### Phase 1 — Create the project

`WorkflowService.create` seeds a Workflow, its default branch, and version 1 as a draft in one write.
**This is the only moment `workflowId` is ever generated.**

```bash
curl -s -X POST http://localhost:4000/api/workflows \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Claim Review","key":"claim-review"}'
```

Request body:
```json
{ "name": "Claim Review", "key": "claim-review" }
```

Response (`201`):
```json
{
  "id": "WF_ID",
  "key": "claim-review",
  "defaultBranchId": "BRANCH_ID",
  "variables": [],
  "permissions": []
}
```

`defaultBranchId`'s `headVersionId` is version 1 (draft) — `GET /workflows/:id/branches` to read it and
get `V1_ID` for the next step.

### Phase 2 — Author + publish v1

Publishing freezes the current draft and immediately opens a new draft (v2) on the same branch.

```bash
curl -s -X PUT http://localhost:4000/api/workflows/$WF_ID/processes/claim-review.process \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{
    "id": "claim-review.process", "name": "Claim Review", "package": "com.acme",
    "vars": [{"name":"amount","type":"double"}],
    "nodes": [
      {"id":"s","type":"start"},
      {"id":"review","type":"userTask","name":"Review claim","group":"claims-examiners"},
      {"id":"e","type":"end"}
    ],
    "flows": [{"id":"f1","from":"s","to":"review"},{"id":"f2","from":"review","to":"e"}]
  }'
```

```bash
curl -s -X POST http://localhost:4000/api/versions/$V1_ID/publish \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"label":"v1.0"}'
```

Response (`200`):
```json
{
  "published": { "id": "V1_ID", "number": 1, "state": "published", "label": "v1.0" },
  "newDraft":  { "id": "V2_ID", "number": 2, "state": "draft" }
}
```

### Phase 3 — Deploy v1 to `prod`, activate it

Deploying snapshots the published version's engine JSON into a new, immutable `Deployment` row — a
brand-new id every time, even for the same project. `activate:true` makes it the one
`resolveActive()` will hand back for `(workflow, environment)`.

```bash
curl -s -X POST http://localhost:4000/api/versions/$V1_ID/deploy \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"environment":"prod","activate":true,"tags":["v1"]}'
```

Response (`201`):
```json
{
  "id": "DEP1",
  "workflowId": "WF_ID",
  "versionId": "V1_ID",
  "versionNumber": 1,
  "environment": "prod",
  "status": "active",
  "tags": ["prod", "v1"]
}
```

### Phase 4 — Start instance A

No `deploymentId` given, so `resolveActive(workflowId, "prod")` resolves it — right now, `DEP1`. The
returned instance's own `deploymentId` is the permanent record of which version it ran on.

```bash
curl -s -X POST http://localhost:4000/api/instances \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"workflowId":"'"$WF_ID"'","environment":"prod","variables":{"amount":500}}'
```

Response (`201`):
```json
{
  "id": "INST_A",
  "deploymentId": "DEP1",
  "workflowId": "WF_ID",
  "processId": "claim-review.process",
  "status": "waiting",
  "variables": { "amount": 500 },
  "tokens": [{ "id": "TOK_1", "nodeId": "review", "state": "waiting", "waitFor": { "kind": "task" } }]
}
```

### Phase 5 & 6 — Publish + deploy v2 to the same environment

Editing the draft and publishing again produces `V2_ID` — same `processId`, next version number.
Deploying it to `prod` with `activate:true` creates a second, independent deployment (`DEP2`) and flips
`DEP1` to `inactive`. **Instance A is unaffected** — it stays pinned to `DEP1` for life.

```bash
curl -s -X PUT http://localhost:4000/api/workflows/$WF_ID/processes/claim-review.process \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{ "...": "v2 edits — e.g. an added boundary timer on the review task" }'
```

```bash
curl -s -X POST http://localhost:4000/api/versions/$V2_ID/publish \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"label":"v2.0"}'
```

```bash
curl -s -X POST http://localhost:4000/api/versions/$V2_ID/deploy \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"environment":"prod","activate":true,"tags":["v2"]}'
```

Response (`201`):
```json
{
  "id": "DEP2",
  "versionId": "V2_ID",
  "versionNumber": 2,
  "environment": "prod",
  "status": "active"
}
```

Confirm the flip:
```bash
curl -s http://localhost:4000/api/workflows/$WF_ID/deployments \
  -H "Authorization: Bearer $TOKEN"
```
```json
{ "items": [
  { "id": "DEP2", "versionNumber": 2, "status": "active",   "environment": "prod" },
  { "id": "DEP1", "versionNumber": 1, "status": "inactive", "environment": "prod" }
]}
```

### Phase 7 — Start instance B

Identical request to phase 4 — but `resolveActive` now returns `DEP2`, so this instance binds to v2.

```bash
curl -s -X POST http://localhost:4000/api/instances \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"workflowId":"'"$WF_ID"'","environment":"prod","variables":{"amount":2000}}'
```

Response (`201`):
```json
{ "id": "INST_B", "deploymentId": "DEP2", "workflowId": "WF_ID", "status": "waiting" }
```

### Phase 8 — Fetch tasks, scoped to one version, then one instance

`Task` rows carry `instanceId`, not a version — there is **no `deploymentId` filter on `/tasks`
itself**. This two-step join is how you get "every open task on version 1":

```bash
curl -s "http://localhost:4000/api/instances?workflowId=$WF_ID&deploymentId=$DEP1" \
  -H "Authorization: Bearer $TOKEN"
```
```json
{ "items": [{ "id": "INST_A", "deploymentId": "DEP1", "status": "waiting" }] }
```

```bash
curl -s http://localhost:4000/api/query/instances/$INST_A/tasks \
  -H "Authorization: Bearer $TOKEN"
```
```json
{ "items": [{
  "id": "TASK_1", "instanceId": "INST_A", "tokenId": "TOK_1",
  "name": "Review claim", "group": "claims-examiners", "status": "created",
  "inputs": {}, "createdAt": "2026-08-09T10:00:00.000Z"
}] }
```

Or the direct task inbox route (no version filter — filters by `group`/`assignee`/`status`/`overdue`
only, across every instance/version):

```bash
curl -s "http://localhost:4000/api/tasks?group=claims-examiners&status=created" \
  -H "Authorization: Bearer $TOKEN"
```

### Phase 9 — Fetch the signals a process listens for / throws

**Version-blind by construction**: `processSignals` resolves `claim-review.process` against whichever
deployment is *currently active* — right now the v2 snapshot (`DEP2`), even though v1 instances (like
instance A) are still running elsewhere on `DEP1`.

```bash
curl -s http://localhost:4000/api/query/process-definitions/claim-review.process/signals \
  -H "Authorization: Bearer $TOKEN"
```

Response (`200`):
```json
{
  "processId": "claim-review.process",
  "listensFor": ["DocumentsReceived"],
  "throws": ["ReviewComplete"]
}
```

## Analysis notes — things this trace makes visible

- **Version isolation is real**: instance A (v1) and instance B (v2) run concurrently against
  different engine snapshots, on the *same* `workflowId`, in the *same* `environment`. Activating v2
  never migrated, paused, or cancelled instance A.
- **`processId` is the version-spanning key; `deploymentId` is the version-specific key.** Use
  `GET /query/process-definitions/:processId/instances` when you want "every run of this process
  regardless of version," and `GET /instances?deploymentId=` when you want exactly one version's runs.
- **The process-definitions and signals endpoints only ever see the active deployment.** If you need
  a inactive/older version's node graph or signal list, read it via
  `GET /deployments/:id/definitions` (any deployment, any status) instead of the query endpoints
  (active-only).
- **Tasks have no version dimension at all** in their own schema — any "tasks per version" report has
  to join through instances first, as shown in phase 8. There is no single endpoint for it.
- **Timer/signal-triggered starts** (see [Jobs, timers & scheduling](08-jobs-timers-and-scheduling.md),
  [node reference](nodes/README.md#cross-cutting-conventions-common-to-many-nodes)) go through the
  exact same `ExecutionEngine.start()` shown in phases 4/7 — `workflowId` still comes from
  `dep.workflowId`, never generated or passed independently.
