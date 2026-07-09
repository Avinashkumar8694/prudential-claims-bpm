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
export interface WaitSpec { kind: 'timer' | 'task' | 'message' | 'signal' | 'condition' | 'child'; ref?: string; dueAt?: string; }
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
  startedAt: string; startedBy: string; endedAt?: string;
}

export type TaskStatus = 'created' | 'reserved' | 'inprogress' | 'completed' | 'skipped' | 'error';
export interface Task extends Entity {
  id: string; tenantId: string; instanceId: string; tokenId: string; nodeId: string;
  name: string; formName?: string; group?: string; assignee?: string;
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

// Collection names (repository keys)
export const Collections = {
  workflows: 'workflows', branches: 'branches', versions: 'versions', deployments: 'deployments',
  instances: 'instances', tasks: 'tasks', timers: 'timers', audit: 'audit',
} as const;
