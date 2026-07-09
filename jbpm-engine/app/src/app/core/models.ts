// Client-side mirrors of the server domain (docs/04-data-model.md). Kept intentionally loose.
export interface EngineVar { name: string; type: string; }

export interface Workflow {
  id: string; name: string; key: string; description?: string;
  defaultBranchId: string; permissions: any[]; variables: EngineVar[];
  createdAt: string; updatedAt: string; archived?: boolean;
}
export interface Branch { id: string; workflowId: string; name: string; headVersionId?: string; forkedFromVersionId?: string; protected?: boolean; }
export interface Version { id: string; workflowId: string; branchId: string; number: number; label?: string; state: 'draft' | 'published'; engine: any; message?: string; createdAt: string; }
export interface Deployment {
  id: string; workflowId: string; versionId: string; branchId: string;
  env: Record<string, string>; tags: string[]; status: 'active' | 'inactive' | 'archived';
  environment: string; deployedAt: string; deployedBy: string;
}
export interface Instance {
  id: string; deploymentId: string; workflowId: string; correlationKey?: string;
  status: 'running' | 'waiting' | 'completed' | 'aborted' | 'failed' | 'suspended';
  variables: Record<string, unknown>; tokens: Token[]; history: NodeVisit[];
  error?: { nodeId: string; message: string; at: string }; startedAt: string; endedAt?: string;
}
export interface Token { id: string; nodeId: string; state: 'active' | 'waiting'; waitFor?: any; enteredAt: string; }
export interface NodeVisit { tokenId: string; nodeId: string; type: string; enteredAt: string; exitedAt?: string; outcome?: string; }
export interface DiagramState { activeNodeIds: string[]; visitedNodeIds: string[]; status: string; }

export interface NodeSpec {
  key: string; label: string; category: string; icon: string; color: string;
  engineType: string; defaults: Record<string, unknown>; docFolder: string;
}
export interface Catalog { categories: string[]; nodes: NodeSpec[]; }

export interface Problem { rule: string; severity: 'error' | 'warning'; message: string; nodeId?: string; flowId?: string; }
export interface ValidationResult { ok: boolean; errors: Problem[]; warnings: Problem[]; problems: Problem[]; }

export interface Task {
  id: string; instanceId: string; nodeId: string; name: string; formName?: string;
  group?: string; assignee?: string; status: string; createdAt: string;
}
