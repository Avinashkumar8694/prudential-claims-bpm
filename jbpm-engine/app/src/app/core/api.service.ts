// Typed thin client over the REST API (docs/05-api-spec.md). Proxy forwards /api to the server.
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Branch, Catalog, Deployment, Instance, Task, ValidationResult, Version, Workflow } from './models';

const base = '/api';
type List<T> = { items: T[] };

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  // catalog
  catalog(): Observable<Catalog> { return this.http.get<Catalog>(`${base}/catalog/nodes`); }

  // workflows
  listWorkflows(): Observable<Workflow[]> { return this.http.get<List<Workflow>>(`${base}/workflows`).pipe(map((r) => r.items)); }
  getWorkflow(id: string): Observable<Workflow> { return this.http.get<Workflow>(`${base}/workflows/${id}`); }
  createWorkflow(body: { name: string; description?: string }): Observable<Workflow> { return this.http.post<Workflow>(`${base}/workflows`, body); }
  updateWorkflow(id: string, patch: Partial<Workflow>): Observable<Workflow> { return this.http.patch<Workflow>(`${base}/workflows/${id}`, patch); }

  // import / export (jBPM kjar)
  importJbpm(files: Record<string, string>, name?: string): Observable<{ workflowId: string; processes: number }> { return this.http.post<any>(`${base}/import/jbpm`, { files, name }); }
  exportVersion(versionId: string): Observable<{ files: Record<string, string> }> { return this.http.get<any>(`${base}/versions/${versionId}/export`); }

  // processes (within a project) + assets
  listProcesses(projectId: string): Observable<{ id: string; name: string; nodes: number; flows: number }[]> { return this.http.get<List<any>>(`${base}/workflows/${projectId}/processes`).pipe(map((r) => r.items)); }
  addProcess(projectId: string, name: string): Observable<{ id: string; name: string }> { return this.http.post<any>(`${base}/workflows/${projectId}/processes`, { name }); }
  renameProcess(projectId: string, pid: string, name: string): Observable<any> { return this.http.patch(`${base}/workflows/${projectId}/processes/${pid}`, { name }); }
  removeProcess(projectId: string, pid: string): Observable<any> { return this.http.delete(`${base}/workflows/${projectId}/processes/${pid}`); }
  getProcess(projectId: string, pid: string): Observable<any> { return this.http.get<any>(`${base}/workflows/${projectId}/processes/${pid}`); }
  saveProcess(projectId: string, pid: string, process: any): Observable<any> { return this.http.put(`${base}/workflows/${projectId}/processes/${pid}`, { process }); }
  getAssets(projectId: string): Observable<{ kinds: { key: string; label: string }[]; assets: Record<string, { name: string }[]> }> { return this.http.get<any>(`${base}/workflows/${projectId}/assets`); }
  addAsset(projectId: string, kind: string, name: string): Observable<any> { return this.http.post(`${base}/workflows/${projectId}/assets`, { kind, name }); }

  // branches + versions
  listBranches(wfId: string): Observable<Branch[]> { return this.http.get<List<Branch>>(`${base}/workflows/${wfId}/branches`).pipe(map((r) => r.items)); }
  listVersions(branchId: string): Observable<Version[]> { return this.http.get<List<Version>>(`${base}/branches/${branchId}/versions`).pipe(map((r) => r.items)); }
  saveDraft(branchId: string, engine: any, message?: string): Observable<Version> { return this.http.post<Version>(`${base}/branches/${branchId}/versions`, { engine, message }); }
  publish(versionId: string, label?: string): Observable<any> { return this.http.post(`${base}/versions/${versionId}/publish`, { label }); }
  validate(versionId: string): Observable<ValidationResult> { return this.http.post<ValidationResult>(`${base}/versions/${versionId}/validate`, {}); }
  validateProcess(process: any): Observable<ValidationResult> { return this.http.post<ValidationResult>(`${base}/validate`, { process }); }

  // deployments
  deploy(versionId: string, body: { environment: string; tags?: string[]; env?: Record<string, string>; activate?: boolean }): Observable<Deployment> { return this.http.post<Deployment>(`${base}/versions/${versionId}/deploy`, body); }
  listDeployments(wfId: string): Observable<Deployment[]> { return this.http.get<List<Deployment>>(`${base}/workflows/${wfId}/deployments`).pipe(map((r) => r.items)); }
  activate(depId: string): Observable<Deployment> { return this.http.post<Deployment>(`${base}/deployments/${depId}/activate`, {}); }
  undeploy(depId: string): Observable<Deployment> { return this.http.post<Deployment>(`${base}/deployments/${depId}/undeploy`, {}); }
  setTags(depId: string, change: { add?: string[]; remove?: string[] }): Observable<Deployment> { return this.http.post<Deployment>(`${base}/deployments/${depId}/tags`, change); }

  // instances
  startInstance(body: { workflowId: string; processId?: string; environment?: string; deploymentId?: string; variables?: Record<string, unknown> }): Observable<Instance> { return this.http.post<Instance>(`${base}/instances`, body); }
  listInstances(workflowId: string): Observable<Instance[]> { return this.http.get<List<Instance>>(`${base}/instances`, { params: { workflowId } }).pipe(map((r) => r.items)); }
  getInstance(id: string): Observable<Instance> { return this.http.get<Instance>(`${base}/instances/${id}`); }
  diagramState(id: string): Observable<any> { return this.http.get(`${base}/instances/${id}/diagram-state`); }
  instanceGraph(id: string): Observable<{ nodes: any[]; flows: any[]; diagram: { activeNodeIds: string[]; visitedNodeIds: string[]; status: string }; counts: Record<string, number>; status: string }> { return this.http.get<any>(`${base}/instances/${id}/graph`); }
  relatedInstances(id: string): Observable<{ instance: Instance; parent: Instance | null; children: Instance[] }> { return this.http.get<any>(`${base}/instances/${id}/related`); }
  signalInstance(id: string, name: string, payload?: unknown): Observable<Instance> { return this.http.post<Instance>(`${base}/instances/${id}/signal`, { name, payload }); }
  retryNode(id: string, nodeId: string): Observable<Instance> { return this.http.post<Instance>(`${base}/instances/${id}/retry`, { nodeId }); }
  suspendInstance(id: string): Observable<Instance> { return this.http.post<Instance>(`${base}/instances/${id}/suspend`, {}); }
  resumeInstance(id: string): Observable<Instance> { return this.http.post<Instance>(`${base}/instances/${id}/resume`, {}); }
  abort(id: string): Observable<Instance> { return this.http.post<Instance>(`${base}/instances/${id}/abort`, {}); }

  // tasks
  listTasks(filter?: { assignee?: string; group?: string; status?: string }): Observable<Task[]> { return this.http.get<List<Task>>(`${base}/tasks`, { params: (filter || {}) as any }).pipe(map((r) => r.items)); }
  claimTask(id: string): Observable<Task> { return this.http.post<Task>(`${base}/tasks/${id}/claim`, {}); }
  releaseTask(id: string): Observable<Task> { return this.http.post<Task>(`${base}/tasks/${id}/release`, {}); }
  completeTask(id: string, outputs: Record<string, unknown>): Observable<Task> { return this.http.post<Task>(`${base}/tasks/${id}/complete`, { outputs }); }

  // query / task-admin / analytics (docs/17)
  queryUsers(): Observable<UserRow[]> { return this.http.get<List<UserRow>>(`${base}/query/users`).pipe(map((r) => r.items)); }
  userTasks(user: string, status?: string): Observable<Task[]> { return this.http.get<List<Task>>(`${base}/query/users/${user}/tasks`, { params: status ? { status } : {} }).pipe(map((r) => r.items)); }
  userTasksCompleted(user: string): Observable<Task[]> { return this.http.get<List<Task>>(`${base}/query/users/${user}/tasks/completed`).pipe(map((r) => r.items)); }
  groupTasks(group: string, status?: string): Observable<Task[]> { return this.http.get<List<Task>>(`${base}/query/groups/${group}/tasks`, { params: status ? { status } : {} }).pipe(map((r) => r.items)); }
  processDefinitions(): Observable<ProcessDef[]> { return this.http.get<List<ProcessDef>>(`${base}/query/process-definitions`).pipe(map((r) => r.items)); }
  processSignals(processId: string): Observable<{ processId: string; listensFor: string[]; throws: string[] }> { return this.http.get<any>(`${base}/query/process-definitions/${processId}/signals`); }
  analyticsSummary(): Observable<Summary> { return this.http.get<Summary>(`${base}/query/analytics/summary`); }
  analyticsTasks(): Observable<TaskAnalytics> { return this.http.get<TaskAnalytics>(`${base}/query/analytics/tasks`); }
  analyticsProcesses(): Observable<ProcessAnalytics> { return this.http.get<ProcessAnalytics>(`${base}/query/analytics/processes`); }
}

export interface UserRow { user: string; groups: string[]; startedInstances: number; openTasks: number; completedTasks: number; }
export interface ProcessDef { processId: string; name: string; version?: string; environment: string; nodes: number; instances: { total: number; active: number }; }
export interface DurStats { count: number; avgMs: number; minMs: number; maxMs: number; }
export interface Summary { instances: { total: number; byStatus: Record<string, number> }; tasks: { total: number; byStatus: Record<string, number> }; deployments: { total: number; active: number }; jobs: { scheduled: number; fired: number }; }
export interface TaskAnalytics { byTask: (DurStats & { name: string })[]; byAssignee: (DurStats & { user: string })[]; openByStatus: Record<string, number>; }
export interface ProcessAnalytics { byProcess: (DurStats & { processId: string })[]; byStatus: Record<string, number>; }
