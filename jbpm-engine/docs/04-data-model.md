# 04 — Data Model

All entities are tenant-scoped (`tenantId`) and carry `createdAt/By`, `updatedAt/By`. IDs are ULIDs
(sortable). Engine process JSON is the SDK `EngineProcess` shape.

## Entity relationships

```
Tenant 1─* Workflow 1─* Branch 1─* Version ──deploy──> Deployment *─* Tag
                                     │                      │
                                     │                      └── active? (per environment)
                                     └── engineJSON (EngineProject/EngineProcess snapshot)
Deployment 1─* Instance 1─* Token
                   │           └── current node position
                   ├─* Task (user tasks)
                   ├─* TimerJob
                   └─* AuditEvent
```

## Workflow
```ts
interface Workflow {
  id: string;
  tenantId: string;
  name: string;                 // "Employee Directory" (reference header)
  key: string;                  // "employee-directory" — unique per tenant
  description?: string;
  defaultBranchId: string;      // usually the "main" branch
  permissions: WorkflowPermission[];   // "User Permissions" header button
  variables: EngineVar[];              // "Variables" header button (typed process vars)
  createdAt, createdBy, updatedAt, updatedBy;
  archived?: boolean;
}
interface WorkflowPermission { role: string; actions: ('view'|'edit'|'deploy'|'run'|'admin')[]; }
```

## Branch
```ts
interface Branch {
  id: string;
  workflowId: string;
  name: string;                 // "main", "feature/new-sms", …
  forkedFromVersionId?: string; // null for the root branch
  headVersionId?: string;       // latest version on this branch
  protected?: boolean;          // e.g. main requires review to publish
  createdAt, createdBy;
}
```

## Version  (immutable once `published`)
```ts
interface Version {
  id: string;
  workflowId: string;
  branchId: string;
  number: number;               // monotonic per branch (1,2,3,…)
  label?: string;               // "v1.2.0"
  state: 'draft' | 'published'; // drafts are mutable; publishing freezes
  engine: EngineProject;        // full engine JSON snapshot (process + assets + types)
  parentVersionId?: string;     // previous version on the branch (for diff/lineage)
  message?: string;             // commit-style note
  createdAt, createdBy;
}
```

## Deployment  (immutable snapshot of a published version)
```ts
interface Deployment {
  id: string;
  workflowId: string;
  versionId: string;            // the exact version deployed
  branchId: string;             // provenance
  engine: EngineProject;        // frozen copy (self-contained; version could be deleted)
  env: Record<string,string>;   // deployment-scoped env (INTEGRATION_LAYER_URL, …)
  tags: string[];               // ["dev"], ["staging","v1.2.0"], ["prod"] …
  status: 'active' | 'inactive' | 'archived';
  environment: string;          // tag namespace within which exactly one is active (e.g. "prod")
  deployedAt, deployedBy;
  undeployedAt?, archivedAt?;
}
```
- **Active pointer:** per `(workflowId, environment)` at most one deployment has `status:'active'`.
  Promotion = deactivate current + activate target atomically. See [09](./09-deployment-branching-versioning.md).
- **Tags** are free-form labels; some are environment names (dev/staging/prod), some are release
  labels (v1.2.0). The **active tag** is the environment whose active deployment is currently serving.

## Instance  (a running/finished process)
```ts
interface Instance {
  id: string;
  deploymentId: string;
  workflowId: string;
  correlationKey?: string;      // business key (e.g. caseId) for signal/message correlation
  status: 'running' | 'waiting' | 'completed' | 'aborted' | 'failed' | 'suspended';
  variables: Record<string, unknown>;   // live process variables
  tokens: Token[];              // active execution pointers
  startedAt, startedBy;
  endedAt?;
  error?: { nodeId: string; message: string; stack?: string; at: string };
  history: NodeVisit[];         // ordered node entries/exits (for the detail view + replay)
  parentInstanceId?, parentTokenId?;     // for call activities / sub-processes
}
interface Token {
  id: string;
  nodeId: string;               // where the token currently sits
  state: 'active' | 'waiting';  // waiting = at a wait node (task/timer/catch)
  scopeId?: string;             // sub-process/embedded scope
  waitFor?: WaitSpec;           // { kind:'timer'|'task'|'message'|'signal'|'condition', ref, dueAt? }
  enteredAt: string;
}
interface NodeVisit { tokenId: string; nodeId: string; type: string; enteredAt: string; exitedAt?: string; outcome?: string; }
```

## Task  (user task work item)
```ts
interface Task {
  id: string;
  instanceId: string;
  tokenId: string;
  nodeId: string;
  name: string;                 // node name / form name
  formName?: string;
  group?: string;               // owning role/queue
  assignee?: string;            // claimed user
  status: 'created' | 'reserved' | 'inprogress' | 'completed' | 'skipped' | 'error';
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  createdAt, dueAt?, completedAt?, completedBy?;
}
```

## TimerJob  (durable timer)
```ts
interface TimerJob {
  id: string;
  instanceId: string;
  tokenId: string;
  nodeId: string;               // catch-timer / boundary-timer / start-timer
  kind: 'duration' | 'cycle' | 'date';
  dueAt: string;                // next fire time (ISO)
  cycle?: string;               // ISO-8601 repeating (R/PT1H) for periodic
  fired: number;                // count for cycles
  status: 'scheduled' | 'fired' | 'cancelled';
}
```

## AuditEvent  (append-only)
```ts
interface AuditEvent {
  id: string;
  tenantId: string;
  at: string;
  actor: string;                // user or "system"
  kind: string;                 // "instance.started","node.entered","task.completed","deployment.activated",…
  workflowId?, deploymentId?, instanceId?, taskId?, nodeId?;
  data?: Record<string, unknown>;   // redacted payloads
}
```

## Supporting

```ts
interface Tenant { id: string; name: string; }
interface Secret { id: string; tenantId: string; name: string; valueRef: string; /* never stored plaintext in file store */ }
interface Principal { id: string; tenantId: string; email: string; roles: string[]; }
```

## Store collections (repository names)

`tenants`, `principals`, `workflows`, `branches`, `versions`, `deployments`, `instances`, `tasks`,
`timers`, `audit`, `secrets`. Each behind `Repository<T>` ([architecture §7](./03-architecture.md)).

Hot query indexes (Postgres): `versions(branchId, number)`, `deployments(workflowId, environment,
status)`, `instances(workflowId, status)`, `instances(correlationKey)`, `tasks(assignee, status)`,
`tasks(group, status)`, `timers(status, dueAt)`.
