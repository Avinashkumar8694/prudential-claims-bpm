// Client-side mirrors of the server domain (docs/04-data-model.md). Kept intentionally loose.
export interface EngineVar { name: string; type: string; }

export interface Workflow {
  id: string; name: string; key: string; description?: string;
  defaultBranchId: string;
  /** stored server-side but never enforced by any authz check (superseded by the IAM role/permission
   *  model) — kept here only because the field still round-trips through the API, no UI reads it. */
  permissions: any[];
  variables: EngineVar[];
  createdAt: string; updatedAt: string; archived?: boolean;
  /** Which Folder (Projects-page tree) this project is organized under; null/undefined = root/unfiled. */
  folderId?: string | null;
}
/** Organizes Workflows into a tree on the Projects page — purely presentational. */
export interface Folder { id: string; name: string; parentId?: string | null; createdAt: string; updatedAt: string; }
export interface Branch { id: string; workflowId: string; name: string; headVersionId?: string; forkedFromVersionId?: string; protected?: boolean; }
export interface Version { id: string; workflowId: string; branchId: string; number: number; label?: string; state: 'draft' | 'published'; engine: any; message?: string; createdAt: string; }
export interface Deployment {
  id: string; workflowId: string; versionId: string; branchId: string;
  env: Record<string, string>; tags: string[]; status: 'active' | 'inactive' | 'archived';
  environment: string; versionNumber?: number; versionLabel?: string; deployedAt: string; deployedBy: string;
}
/** One process definition contained in a deployment (jBPM's "what's running in this container" view). */
export interface DeploymentProcessDef { id: string; name: string; nodes: number; startable: boolean; }
export interface Instance {
  id: string; deploymentId: string; workflowId: string; processId?: string; correlationKey?: string;
  status: 'running' | 'waiting' | 'completed' | 'aborted' | 'failed' | 'suspended';
  variables: Record<string, unknown>; tokens: Token[]; history: NodeVisit[];
  error?: { nodeId: string; message: string; at: string };
  parentInstanceId?: string; startedAt: string; startedBy: string; endedAt?: string;
}
export interface Token { id: string; nodeId: string; state: 'active' | 'waiting'; waitFor?: any; enteredAt: string; }
export interface NodeVisit { tokenId: string; nodeId: string; type: string; enteredAt: string; exitedAt?: string; outcome?: string; }
export interface DiagramState { activeNodeIds: string[]; visitedNodeIds: string[]; status: string; }

export interface NodeSpec {
  key: string; label: string; category: string; icon: string; color: string;
  engineType: string; defaults: Record<string, unknown>; docFolder: string;
}
export type VarSource = 'own' | 'ownRef' | 'called';
export interface UiField {
  key: string; label: string; widget: string; options?: string[]; placeholder?: string; help?: string;
  assetKind?: string; varSource?: VarSource; keySource?: VarSource; valueSource?: VarSource;
}
export interface UiSection { title: string; fields: UiField[]; }
export interface Ports { maxIn?: number; maxOut?: number; }   // 0 = none, n = that many, undefined = unlimited
export interface Catalog {
  categories: string[];
  nodes: NodeSpec[];
  schemas: Record<string, UiSection[]>;   // engineType → property form (served by the backend)
  ports: Record<string, Ports>;           // engineType → connection points
  /** engineType → how it renders on a live diagram (icon = IconComponent name, not the palette's
   *  emoji; shape follows real BPMN 2.0 notation) — the single source of truth for every diagram/
   *  canvas, in place of a hand-rolled per-page map (two of which had already drifted apart before
   *  this existed). */
  diagram: Record<string, { icon: string; color: string; shape: 'circle' | 'diamond' | 'rectangle' }>;
  /** engineType → neutral display name for the type itself (e.g. "Gateway"), distinct from a palette
   *  tile's own more specific label (e.g. "Exclusive Gateway"). */
  typeLabels: Record<string, string>;
}

/** One process behind a currently-active deployment, tenant-wide — exactly what a 'call'/'forEach'
 *  node can resolve at runtime (see server's instances/service.ts resolveCalled). Backs the
 *  'processRef' widget's picker and, once one is chosen, the 'called' variable-source suggestions. */
export interface CallableProcess { id: string; name: string; workflowId: string; workflowName: string; environment: string; vars: { name: string; type?: string }[]; }

export interface Problem { rule: string; severity: 'error' | 'warning'; message: string; nodeId?: string; flowId?: string; }
export interface ValidationResult { ok: boolean; errors: Problem[]; warnings: Problem[]; problems: Problem[]; }

export interface ImportResult {
  workflowId: string; processes: number;
  formsImported: string[];
  rulesetPlaceholders: { group: string; ruleNames: string[] }[];
  decisionsImported: string[];
  skipped: { path: string; kind: string; reason: string }[];
}

export interface Task {
  id: string; instanceId: string; nodeId: string; name: string; formName?: string;
  group?: string; assignee?: string;
  businessAdmin?: string; excludedOwners?: string[]; priority?: number;
  status: 'created' | 'reserved' | 'inprogress' | 'completed' | 'skipped' | 'error';
  inputs?: Record<string, unknown>; outputs?: Record<string, unknown>;
  createdAt: string; dueAt?: string; completedAt?: string; completedBy?: string;
}

// ---- operations: errors, jobs, audit, notifications, settings ----
export interface ExecutionError {
  id: string;
  type: 'process' | 'task' | 'job' | 'integration';
  instanceId?: string; taskId?: string; jobId?: string;
  workflowId?: string; deploymentId?: string; processId?: string;
  nodeId?: string; nodeName?: string; nodeType?: string;
  message: string; stack?: string;
  at: string; occurrences: number;
  acknowledged: boolean; acknowledgedBy?: string; acknowledgedAt?: string;
}
export interface ErrorSummary { total: number; unacknowledged: number; last24h: number; }

export interface TimerJob {
  id: string; instanceId: string; tokenId: string; nodeId: string;
  kind: 'duration' | 'cycle' | 'date' | 'start';
  dueAt: string; cycle?: string; fired: number;
  status: 'scheduled' | 'fired' | 'cancelled';
  deploymentId?: string; processId?: string;
}

export interface AuditEvent {
  id: string; at: string; actor: string; kind: string;
  workflowId?: string; deploymentId?: string; instanceId?: string; taskId?: string; nodeId?: string;
  data?: Record<string, unknown>;
}

/** Named AppNotification (not Notification) to avoid colliding with the DOM Notification global. */
export interface AppNotification {
  id: string; userId: string;
  kind: 'task-assigned' | 'sla-at-risk' | 'sla-breached' | 'instance-failed'
      | 'deployment-succeeded' | 'deployment-failed' | 'task-reminder';
  title: string; body?: string; link?: string;
  instanceId?: string; taskId?: string; deploymentId?: string;
  read: boolean; at: string;
}

export interface TaskComment { id: string; taskId: string; author: string; body: string; at: string; }

export interface SystemSettings {
  defaultPageSize: number;
  instanceRetentionDays: number;
  auditRetentionDays: number;
  allowRunningVariableEdits: boolean;
  executorIntervalSeconds: number;
  defaultJobRetries: number;
  slaWarnThresholdPct: number;
  sessionTimeoutHours: number;
  emailEnabled: boolean;
  emailFrom?: string; smtpHost?: string; smtpPort?: number;
  /** per-tenant resource quotas; 0/undefined = unlimited. */
  maxActiveInstances?: number;
  maxActiveTimers?: number;
  maxConcurrentScripts?: number;
  updatedAt?: string; updatedBy?: string;
}

export interface VariableChange { name: string; from: unknown; to: unknown; at: string; actor: string; }

// ---- IAM (users/groups/roles) ----
export interface AppUser { id: string; username: string; roles: string[]; groups: string[]; active: boolean; createdAt: string; }
export interface AppGroup { id: string; name: string; description?: string; }
export interface AppRole { id: string; name: string; permissions: string[]; }

// ---- query / task-admin / analytics (docs/17) ----
export interface UserRow { user: string; groups: string[]; startedInstances: number; openTasks: number; completedTasks: number; }
export interface ProcessDef { processId: string; name: string; version?: string; environment: string; nodes: number; instances: { total: number; active: number }; deploymentId?: string; workflowId?: string; }
export interface DurStats { count: number; avgMs: number; minMs: number; maxMs: number; }
export interface Summary { instances: { total: number; byStatus: Record<string, number> }; tasks: { total: number; byStatus: Record<string, number> }; deployments: { total: number; active: number }; jobs: { scheduled: number; fired: number }; }
export interface TaskAnalytics { byTask: (DurStats & { name: string })[]; byAssignee: (DurStats & { user: string })[]; openByStatus: Record<string, number>; }
export interface ProcessAnalytics { byProcess: (DurStats & { processId: string })[]; byStatus: Record<string, number>; }
