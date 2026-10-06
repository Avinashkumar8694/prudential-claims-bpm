// Core domain types shared across every module. Every persisted record is tenant-scoped (multi-tenant
// from day one) and carries an `id` (see Entity below).
import type { EngineProcess } from './sdk/index.ts';

export interface Entity { id: string; }

// ---- workflows / versions / deployments ----

export interface Workflow extends Entity {
  tenantId: string; key: string; name: string; folderId?: string;
  defaultBranchId: string;
  permissions: string[];
  /** Process-variable declarations shown/editable at the workflow level (distinct from a specific
   *  Version's own engine.processes[].vars). */
  variables: unknown[];
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
  /** Absent on older records (added after they were created) — treat missing as `false`. */
  archived?: boolean;
}

export interface Folder extends Entity {
  tenantId: string; name: string; parentId: string | null;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
}

export interface Branch extends Entity {
  tenantId: string; workflowId: string; name: string; headVersionId: string; protected: boolean;
  createdAt: string; createdBy: string;
}

/** One saved snapshot of a workflow's process graph(s). `state: 'draft'` is editable; `'published'` is
 *  immutable and the only thing a Deployment may point at. `number` increments per branch, gapless.
 *  `engine` is absent on a brand-new draft that hasn't been opened in the builder yet. */
export interface Version extends Entity {
  tenantId: string; workflowId: string; branchId: string; number: number;
  state: 'draft' | 'published';
  engine?: { id: string; name: string; processes: EngineProcess[] };
  parentVersionId?: string;
  createdAt: string; createdBy: string; publishedAt?: string; publishedBy?: string;
}

/** A published Version, activated into one environment. Only one deployment per (workflowId,
 *  environment) may be `status: 'active'` at a time — activating a new one deactivates the old.
 *  `'archived'` is a terminal, non-reactivatable state distinct from `'inactive'` (superseded by a
 *  newer activation but still a valid target to reactivate). */
export interface Deployment extends Entity {
  tenantId: string; workflowId: string; versionId: string; branchId: string;
  versionLabel?: string; versionNumber?: number;
  environment: string; status: 'active' | 'inactive' | 'archived';
  engine: { id: string; name: string; processes: EngineProcess[] };
  env: Record<string, string>;
  tags: string[];
  deployedAt: string; deployedBy: string; undeployedAt?: string;
}

// ---- runtime: instances, tokens, tasks, timers ----

export type InstanceStatus = 'running' | 'waiting' | 'suspended' | 'completed' | 'aborted' | 'failed';

export interface WaitSpec { kind: 'timer' | 'task' | 'message' | 'signal' | 'condition' | 'child' | 'multiInstance'; ref?: string; dueAt?: string; }
export interface Token {
  id: string; nodeId: string; state: TokenState; scopeId?: string; waitFor?: WaitSpec; enteredAt: string;
}
export type TokenState = 'active' | 'waiting';
export interface NodeVisit { tokenId: string; nodeId: string; type: string; enteredAt: string; exitedAt?: string; outcome?: string; }

export interface Instance extends Entity {
  id: string; tenantId: string; deploymentId: string; workflowId: string;
  processId?: string;
  correlationKey?: string;
  status: InstanceStatus;
  variables: Record<string, unknown>;
  tokens: Token[];
  history: NodeVisit[];
  startedAt: string; startedBy: string; endedAt?: string;
  error?: { nodeId: string; message: string; stack?: string; at: string };
  parentInstanceId?: string; parentTokenId?: string;
  /** A call/subprocess/forEach child started with `independent: true` — its lifecycle is fully
   *  decoupled from its parent in both directions (parent completion/abort never reaches it, and it
   *  never reaches back up into the parent either — see the matching doc comment in call/handler.ts). */
  independent?: boolean;
  /** Set when this instance was force-ended by a `terminateAll` escalation from a descendant's
   *  Terminate end — forensic/audit marker only, no behavioral effect of its own. */
  terminateAll?: boolean;
  compensations?: Array<{ host: string; handler: string }>;
}

export type TaskStatus = 'created' | 'reserved' | 'inprogress' | 'completed' | 'skipped' | 'error' | 'exited';

export interface Task extends Entity {
  id: string; tenantId: string; instanceId: string; tokenId: string; nodeId: string;
  name: string; formName?: string;
  description?: string;
  group?: string;
  assignee?: string;
  candidates?: string[];
  businessAdmin?: string;
  excludedOwners?: string[];
  priority?: number;
  status: TaskStatus;
  inputs: Record<string, unknown>; outputs?: Record<string, unknown>;
  createdAt: string; dueAt?: string; completedAt?: string; completedBy?: string;
}

/** Split a task's `group` into its individual potential-owner groups. */
export function taskGroups(group?: string): string[] {
  return (group || '').split(',').map((g) => g.trim()).filter(Boolean);
}
/** Does the user's OWN IAM group membership list overlap with ANY group `taskGroup` lists? Callers
 *  handle "no group at all" (an unassigned/direct task) themselves — this only answers membership. */
export function inAnyTaskGroup(taskGroup: string | undefined, userGroups: string[]): boolean {
  return taskGroups(taskGroup).some((g) => userGroups.includes(g));
}

export interface TimerJob extends Entity {
  id: string; tenantId: string; instanceId: string; tokenId: string; nodeId: string;
  kind: 'duration' | 'cycle' | 'date' | 'start';
  dueAt: string; cycle?: string; fired: number;
  status: 'scheduled' | 'fired' | 'cancelled';
  deploymentId?: string; processId?: string;
}

export interface AuditEvent extends Entity {
  id: string; tenantId: string; at: string; actor: string; kind: string;
  workflowId?: string; instanceId?: string; taskId?: string; nodeId?: string;
  data?: Record<string, unknown>;
}

export interface TaskComment extends Entity {
  id: string; tenantId: string; taskId: string;
  author: string; body: string; at: string;
}

export interface Notification extends Entity {
  id: string; tenantId: string; userId: string;
  kind: 'task-assigned' | 'sla-at-risk' | 'sla-breached' | 'instance-failed'
      | 'deployment-succeeded' | 'deployment-failed' | 'task-reminder';
  title: string; body?: string;
  link?: string;
  instanceId?: string; taskId?: string; deploymentId?: string;
  read: boolean; at: string;
}

export interface SystemSettings extends Entity {
  id: string; tenantId: string;
  defaultPageSize: number;
  instanceRetentionDays: number;
  auditRetentionDays: number;
  allowRunningVariableEdits: boolean;
  executorIntervalSeconds: number;
  defaultJobRetries: number;
  slaWarnThresholdPct: number;
  sessionTimeoutHours: number;
  emailEnabled: boolean;
  maxActiveInstances?: number;
  maxActiveTimers?: number;
  maxConcurrentScripts?: number;
  updatedAt?: string; updatedBy?: string;
}

export interface ExecutionError extends Entity {
  id: string; tenantId: string;
  type: 'process' | 'task' | 'job' | 'integration';
  instanceId?: string; taskId?: string; jobId?: string;
  workflowId?: string; deploymentId?: string; processId?: string;
  nodeId?: string; nodeName?: string; nodeType?: string;
  message: string; stack?: string;
  at: string; occurrences: number;
  acknowledged: boolean; acknowledgedBy?: string; acknowledgedAt?: string;
}

// ---- project assets (forms, messages, rulesets, DMN decisions, ...) ----
// One generic, kind-discriminated collection — `model` shape depends on `kind` (see assetKind in
// @fabrixly/bpmn-sdk for the exact real-jBPM asset kinds this can round-trip).
export interface Asset extends Entity {
  tenantId: string; workflowId: string; kind: string; name: string; model: unknown;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
}

// ---- external-facing facade (a stable, named, optionally schema-validated entry point in front of
// one specific Deployment — for callers that shouldn't need to know about branches/versions/processId
// picking at all, e.g. the wider pru-claims integration layer this engine is embedded in). A
// WorkflowInstance's own `piid`, once set, is the REAL engine Instance.id this facade instance started
// — the facade's own `status`/`startError` track its OUTER view (did the schema validate, did the
// underlying engine.start() call succeed), not a duplicate of the engine's own instance lifecycle. ----

export interface WorkflowDefinition extends Entity {
  tenantId: string; name: string; deploymentId: string;
  dataSchema?: Record<string, unknown>;
  schemaValidationEnabled: boolean;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
}

export type WorkflowInstanceStatus = 'active' | 'completed' | 'failed' | 'aborted';

export interface WorkflowInstance extends Entity {
  tenantId: string; workflowDefinitionId: string; workflowName: string; deploymentId: string;
  data: Record<string, unknown>;
  status: WorkflowInstanceStatus;
  piid?: string;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
  startError?: string;
}

export interface WorkflowInstanceAudit extends Entity {
  tenantId: string; workflowInstanceId: string; actor: string; kind: string;
  data?: Record<string, unknown>; at: string;
}

export interface WorkflowInstanceComment extends Entity {
  tenantId: string; workflowInstanceId: string; author: string; body: string; at: string;
}

/** A saved, re-runnable aggregate query over one entity (e.g. "cases by status") — powers a
 *  dashboard/report widget. `definition` is intentionally loose beyond its common fields; only one
 *  real sample survived the data loss, not enough to lock its exact shape down further. */
export interface SavedQuery extends Entity {
  tenantId: string; name: string;
  definition: { entity: string; filters: unknown[]; groupBy?: string; metric?: string; [k: string]: unknown };
  ownerId: string; createdAt: string; createdBy: string;
}

// ---- IAM ----

export interface User extends Entity {
  tenantId: string; username: string; passwordHash: string; groups: string[]; roles: string[];
  active: boolean;
  createdAt: string;
}
// createdAt is absent on every real Group/Role record that survived the loss — optional, not required.
export interface Group extends Entity { tenantId: string; name: string; createdAt?: string; }
export interface Role extends Entity { tenantId: string; name: string; permissions: string[]; createdAt?: string; }

// ---- namespaced collection keys (used by every store implementation) ----
export const Collections = {
  workflows: 'workflows', folders: 'folders', branches: 'branches', versions: 'versions',
  deployments: 'deployments', instances: 'instances', tasks: 'tasks', timers: 'timers',
  audit: 'audit', comments: 'comments', notifications: 'notifications', settings: 'settings',
  errors: 'errors', users: 'users', groups: 'groups', roles: 'roles', assets: 'assets',
  workflowDefinitions: 'workflow_definition', workflowInstances: 'workflow_instance',
  workflowInstanceAudit: 'workflow_instance_audit', workflowInstanceComments: 'workflow_instance_comment',
  savedQueries: 'saved_query',
} as const;
