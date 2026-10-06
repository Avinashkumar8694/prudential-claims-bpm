// Mirrors server/src/domain.ts exactly — the frontend's own copy of the wire shapes, since the two
// apps don't share a package. Keep this in sync with the backend by hand; it's small and stable.
import type { EngineProcess } from './engine';

export interface Entity { id: string; }

export interface Workflow extends Entity {
  tenantId: string; key: string; name: string; folderId?: string;
  defaultBranchId: string; permissions: string[]; variables: unknown[];
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
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

export interface Version extends Entity {
  tenantId: string; workflowId: string; branchId: string; number: number;
  state: 'draft' | 'published';
  engine?: { id: string; name: string; processes: EngineProcess[] };
  parentVersionId?: string;
  createdAt: string; createdBy: string; publishedAt?: string; publishedBy?: string;
}

export interface Deployment extends Entity {
  tenantId: string; workflowId: string; versionId: string; branchId: string;
  versionLabel?: string; versionNumber?: number;
  environment: string; status: 'active' | 'inactive' | 'archived';
  engine: { id: string; name: string; processes: EngineProcess[] };
  env: Record<string, string>; tags: string[];
  deployedAt: string; deployedBy: string; undeployedAt?: string;
}

export type InstanceStatus = 'running' | 'waiting' | 'suspended' | 'completed' | 'aborted' | 'failed';
export interface WaitSpec { kind: 'timer' | 'task' | 'message' | 'signal' | 'condition' | 'child' | 'multiInstance'; ref?: string; dueAt?: string; }
export interface Token { id: string; nodeId: string; state: 'active' | 'waiting'; waitFor?: WaitSpec; enteredAt: string; }
export interface NodeVisit { tokenId: string; nodeId: string; type: string; enteredAt: string; exitedAt?: string; outcome?: string; }

export interface Instance extends Entity {
  tenantId: string; deploymentId: string; workflowId: string; processId?: string; correlationKey?: string;
  status: InstanceStatus;
  variables: Record<string, unknown>;
  tokens: Token[]; history: NodeVisit[];
  startedAt: string; startedBy: string; endedAt?: string;
  error?: { nodeId: string; message: string; stack?: string; at: string };
  parentInstanceId?: string; parentTokenId?: string; independent?: boolean; terminateAll?: boolean;
  compensations?: Array<{ host: string; handler: string }>;
}

export type TaskStatus = 'created' | 'reserved' | 'inprogress' | 'completed' | 'skipped' | 'error' | 'exited';
export interface Task extends Entity {
  tenantId: string; instanceId: string; tokenId: string; nodeId: string;
  name: string; formName?: string; description?: string;
  group?: string; assignee?: string; candidates?: string[]; businessAdmin?: string; excludedOwners?: string[];
  priority?: number; status: TaskStatus;
  inputs: Record<string, unknown>; outputs?: Record<string, unknown>;
  createdAt: string; dueAt?: string; completedAt?: string; completedBy?: string;
}

export interface TimerJob extends Entity {
  tenantId: string; instanceId: string; tokenId: string; nodeId: string;
  kind: 'duration' | 'cycle' | 'date' | 'start'; dueAt: string; cycle?: string; fired: number;
  status: 'scheduled' | 'fired' | 'cancelled';
}

export interface AuditEvent extends Entity {
  tenantId: string; at: string; actor: string; kind: string;
  workflowId?: string; instanceId?: string; taskId?: string; nodeId?: string; data?: Record<string, unknown>;
}

export interface SystemSettings extends Entity {
  tenantId: string; defaultPageSize: number; instanceRetentionDays: number; auditRetentionDays: number;
  allowRunningVariableEdits: boolean; executorIntervalSeconds: number; defaultJobRetries: number;
  slaWarnThresholdPct: number; sessionTimeoutHours: number; emailEnabled: boolean;
  maxActiveInstances?: number; maxActiveTimers?: number; maxConcurrentScripts?: number;
  updatedAt?: string; updatedBy?: string;
}

export interface User extends Entity { tenantId: string; username: string; groups: string[]; roles: string[]; active: boolean; createdAt: string; }
export interface Group extends Entity { tenantId: string; name: string; }
export interface Role extends Entity { tenantId: string; name: string; permissions: string[]; }

export function taskGroups(group?: string): string[] {
  return (group || '').split(',').map((g) => g.trim()).filter(Boolean);
}
