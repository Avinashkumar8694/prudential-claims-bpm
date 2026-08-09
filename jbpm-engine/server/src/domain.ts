// Domain entities — see docs/04-data-model.md. Persisted via Repository<T>.
import type { EngineProject, EngineVar } from './sdk/index.ts';
import type { Entity } from './store/repository.ts';

export interface Audited { createdAt: string; createdBy: string; updatedAt: string; updatedBy: string; }

export interface WorkflowPermission { role: string; actions: ('view' | 'edit' | 'deploy' | 'run' | 'admin')[]; }

export interface Workflow extends Entity, Audited {
  id: string; tenantId: string;
  name: string; key: string; description?: string;
  defaultBranchId: string;
  permissions: WorkflowPermission[];
  variables: EngineVar[];
  archived?: boolean;
  /** Project-organizing folder (see Folder below); undefined/null means "root", no folder. */
  folderId?: string | null;
}

/** Organizes Workflows into a tree for the Projects page — purely presentational, no effect on
 *  execution/permissions (a workflow's folder is not consulted by any authz check). */
export interface Folder extends Entity, Audited {
  id: string; tenantId: string;
  name: string;
  parentId?: string | null;
}

export interface Branch extends Entity {
  id: string; tenantId: string; workflowId: string;
  name: string;
  forkedFromVersionId?: string;
  headVersionId?: string;
  protected?: boolean;
  createdAt: string; createdBy: string;
}

export type VersionState = 'draft' | 'published';
export interface Version extends Entity {
  id: string; tenantId: string; workflowId: string; branchId: string;
  number: number; label?: string; state: VersionState;
  engine: EngineProject;
  parentVersionId?: string;
  message?: string;
  createdAt: string; createdBy: string;
}

export type DeploymentStatus = 'active' | 'inactive' | 'archived';
export interface Deployment extends Entity {
  id: string; tenantId: string; workflowId: string; versionId: string; branchId: string;
  engine: EngineProject;
  env: Record<string, string>;
  tags: string[];
  status: DeploymentStatus;
  environment: string;
  versionNumber?: number; versionLabel?: string;   // shown as "Version" in the instance list
  deployedAt: string; deployedBy: string;
  undeployedAt?: string; archivedAt?: string;
}

export type InstanceStatus = 'running' | 'waiting' | 'completed' | 'aborted' | 'failed' | 'suspended';
export type TokenState = 'active' | 'waiting';
// 'multiInstance': a forEach node waiting on 2+ children at once (a plain 'child' wait only ever
// tracks one). No `ref` — siblings are found by querying for Instance.parentTokenId === this token's
// id (see execution-engine.ts's tryResumeParent/tryFailParent), so nothing about which children are
// still outstanding needs to be stored on the token itself.
export interface WaitSpec { kind: 'timer' | 'task' | 'message' | 'signal' | 'condition' | 'child' | 'multiInstance'; ref?: string; dueAt?: string; }
export interface Token {
  id: string; nodeId: string; state: TokenState; scopeId?: string; waitFor?: WaitSpec; enteredAt: string;
}
export interface NodeVisit { tokenId: string; nodeId: string; type: string; enteredAt: string; exitedAt?: string; outcome?: string; }
export interface Instance extends Entity {
  id: string; tenantId: string; deploymentId: string; workflowId: string;
  processId?: string;              // which process (definition) in the deployment this instance runs
  correlationKey?: string;
  status: InstanceStatus;
  variables: Record<string, unknown>;
  tokens: Token[];
  history: NodeVisit[];
  error?: { nodeId: string; message: string; stack?: string; at: string };
  parentInstanceId?: string; parentTokenId?: string;
  // Set when spawned by a call activity with independent:true (fire-and-forget) — this child's
  // lifecycle is decoupled from its parent's: it survives the parent's completion/abort instead of
  // being cascade-torn-down with it (see execution-engine.ts's abortDescendants).
  independent?: boolean;
  // Compensation stack: activities completed successfully that have a compensation handler attached,
  // in completion order. A compensate throw runs the matching entries in reverse (LIFO).
  compensations?: Array<{ host: string; handler: string }>;
  startedAt: string; startedBy: string; endedAt?: string;
}

// 'exited' = jBPM's own term for "the process moved on without you" — the task's host activity was
// cancelled by an interrupting boundary event, or its instance reached a terminal state (completed
// via a terminate/other branch, aborted, or failed) while this task was still open. Distinct from
// 'skipped' (an explicit human/API action on the task itself) and 'error' (the task's OWN execution
// failed) — 'exited' is something that happened to the PROCESS, not to the task.
export type TaskStatus = 'created' | 'reserved' | 'inprogress' | 'completed' | 'skipped' | 'error' | 'exited';
export interface Task extends Entity {
  id: string; tenantId: string; instanceId: string; tokenId: string; nodeId: string;
  name: string; formName?: string; group?: string; assignee?: string;
  /** may act on this task (reassign/claim/complete) regardless of group/assignee/excludedOwners. */
  businessAdmin?: string;
  /** users who may NOT claim/complete this task even if they're in `group` (segregation of duties,
   *  e.g. the claim's own submitter can't also approve it) — not enforced against `businessAdmin`. */
  excludedOwners?: string[];
  /** higher = more urgent; used for inbox sort order only, no behavioral effect. */
  priority?: number;
  status: TaskStatus;
  inputs: Record<string, unknown>; outputs?: Record<string, unknown>;
  createdAt: string; dueAt?: string; completedAt?: string; completedBy?: string;
}

export interface TimerJob extends Entity {
  id: string; tenantId: string; instanceId: string; tokenId: string; nodeId: string;
  kind: 'duration' | 'cycle' | 'date' | 'start';
  dueAt: string; cycle?: string; fired: number;
  status: 'scheduled' | 'fired' | 'cancelled';
  // kind 'start' (timer/cron start event): begin a new instance instead of resuming a token.
  deploymentId?: string; processId?: string;
}

export interface AuditEvent extends Entity {
  id: string; tenantId: string; at: string; actor: string; kind: string;
  workflowId?: string; deploymentId?: string; instanceId?: string; taskId?: string; nodeId?: string;
  data?: Record<string, unknown>;
}

/**
 * A persisted, queryable failure record.
 *
 * `Instance.error` only ever holds the MOST RECENT failure for an instance, which is enough to
 * render a status badge but useless as an operational work queue: it can't be listed across
 * instances, can't be acknowledged, and is overwritten by the next failure. ExecutionError is the
 * append-only log that backs the Execution Errors screen — one row per occurrence, acknowledged
 * explicitly so an unacked list is a real queue rather than noise.
 */
export interface ExecutionError extends Entity {
  id: string; tenantId: string;
  /** what failed — mirrors the filter facet on the Execution Errors screen */
  type: 'process' | 'task' | 'job' | 'integration';
  instanceId?: string; taskId?: string; jobId?: string;
  workflowId?: string; deploymentId?: string; processId?: string;
  nodeId?: string; nodeName?: string; nodeType?: string;
  message: string; stack?: string;
  at: string;
  /** repeat count for an identical (instance, node, message) triple — avoids flooding the list */
  occurrences: number;
  /** unacknowledged until someone takes ownership; ack records who and when */
  acknowledged: boolean; acknowledgedBy?: string; acknowledgedAt?: string;
}

/** A comment on a task. Separate entity (not a Task field) so it can be paged and audited. */
export interface TaskComment extends Entity {
  id: string; tenantId: string; taskId: string;
  author: string; body: string; at: string;
}

/** In-app notification. Persisted so the bell survives a reload and "mark read" is real state. */
export interface Notification extends Entity {
  id: string; tenantId: string; userId: string;
  kind: 'task-assigned' | 'sla-at-risk' | 'sla-breached' | 'instance-failed'
      | 'deployment-succeeded' | 'deployment-failed' | 'task-reminder';
  title: string; body?: string;
  /** where clicking it should land — kept as a route path so the client needs no mapping table */
  link?: string;
  instanceId?: string; taskId?: string; deploymentId?: string;
  read: boolean; at: string;
}

/** Singleton row of global configuration (id is always 'system'). */
export interface SystemSettings extends Entity {
  id: string; tenantId: string;
  defaultPageSize: number;                 // 10 | 20 | 50 | 100
  instanceRetentionDays: number;
  auditRetentionDays: number;
  allowRunningVariableEdits: boolean;
  executorIntervalSeconds: number;
  defaultJobRetries: number;
  slaWarnThresholdPct: number;             // e.g. 80 → amber at 80% of time-to-due elapsed
  sessionTimeoutHours: number;
  emailEnabled: boolean;
  emailFrom?: string; smtpHost?: string; smtpPort?: number;
  /** per-tenant resource quotas — undefined/0 means unlimited (default, so existing tenants are
   *  unaffected until an admin opts in). Enforced at the point of creation, not retroactively. */
  maxActiveInstances?: number;   // top-level (root) instances concurrently running/waiting
  maxActiveTimers?: number;      // scheduled TimerJobs (boundary/catch timers) at once
  maxConcurrentScripts?: number; // script-task/exit-script executions running at this instant
  updatedAt?: string; updatedBy?: string;
}

// Collection names (repository keys)
// ---- IAM: users, groups, roles/permissions (single-tenant — see docs/07-security.md) ----
export interface Role extends Entity {
  id: string; tenantId: string;
  name: string;   // 'admin' | 'author' | 'release' | 'operator' | 'worker' | 'viewer', or a custom name
  /** action strings this role grants (e.g. 'workflow:edit', 'instance:abort'); '*' grants everything. */
  permissions: string[];
}

export interface Group extends Entity {
  id: string; tenantId: string;
  name: string;   // matches the plain-string names userTask.group / Task.group already use
  description?: string;
}

export interface User extends Entity {
  id: string; tenantId: string;
  username: string;         // login name, unique within the tenant
  passwordHash: string;     // scrypt-hashed; never serialized back out by the API
  roles: string[];          // Role names
  groups: string[];         // Group names
  active: boolean;
  createdAt: string;
}

export const Collections = {
  workflows: 'workflows', folders: 'folders', branches: 'branches', versions: 'versions', deployments: 'deployments',
  instances: 'instances', tasks: 'tasks', timers: 'timers', audit: 'audit',
  users: 'users', groups: 'groups', roles: 'roles',
  errors: 'errors', comments: 'comments', notifications: 'notifications', settings: 'settings',
} as const;
