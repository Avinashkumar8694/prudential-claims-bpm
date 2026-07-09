// Typed thin client over the REST API (docs/05-api-spec.md). Proxy forwards /api to the server.
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Branch, Catalog, Deployment, Instance, Task, Version, Workflow } from './models';

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

  // branches + versions
  listBranches(wfId: string): Observable<Branch[]> { return this.http.get<List<Branch>>(`${base}/workflows/${wfId}/branches`).pipe(map((r) => r.items)); }
  listVersions(branchId: string): Observable<Version[]> { return this.http.get<List<Version>>(`${base}/branches/${branchId}/versions`).pipe(map((r) => r.items)); }
  saveDraft(branchId: string, engine: any, message?: string): Observable<Version> { return this.http.post<Version>(`${base}/branches/${branchId}/versions`, { engine, message }); }
  publish(versionId: string, label?: string): Observable<any> { return this.http.post(`${base}/versions/${versionId}/publish`, { label }); }
  validate(versionId: string): Observable<{ ok: boolean; errors: string[]; warnings: string[] }> { return this.http.post<any>(`${base}/versions/${versionId}/validate`, {}); }

  // deployments
  deploy(versionId: string, body: { environment: string; tags?: string[]; env?: Record<string, string>; activate?: boolean }): Observable<Deployment> { return this.http.post<Deployment>(`${base}/versions/${versionId}/deploy`, body); }
  listDeployments(wfId: string): Observable<Deployment[]> { return this.http.get<List<Deployment>>(`${base}/workflows/${wfId}/deployments`).pipe(map((r) => r.items)); }
  activate(depId: string): Observable<Deployment> { return this.http.post<Deployment>(`${base}/deployments/${depId}/activate`, {}); }
  undeploy(depId: string): Observable<Deployment> { return this.http.post<Deployment>(`${base}/deployments/${depId}/undeploy`, {}); }
  setTags(depId: string, change: { add?: string[]; remove?: string[] }): Observable<Deployment> { return this.http.post<Deployment>(`${base}/deployments/${depId}/tags`, change); }

  // instances
  startInstance(body: { workflowId: string; environment?: string; deploymentId?: string; variables?: Record<string, unknown> }): Observable<Instance> { return this.http.post<Instance>(`${base}/instances`, body); }
  listInstances(workflowId: string): Observable<Instance[]> { return this.http.get<List<Instance>>(`${base}/instances`, { params: { workflowId } }).pipe(map((r) => r.items)); }
  getInstance(id: string): Observable<Instance> { return this.http.get<Instance>(`${base}/instances/${id}`); }
  diagramState(id: string): Observable<any> { return this.http.get(`${base}/instances/${id}/diagram-state`); }
  abort(id: string): Observable<Instance> { return this.http.post<Instance>(`${base}/instances/${id}/abort`, {}); }

  // tasks
  listTasks(): Observable<Task[]> { return this.http.get<List<Task>>(`${base}/tasks`).pipe(map((r) => r.items)); }
  completeTask(id: string, outputs: Record<string, unknown>): Observable<Task> { return this.http.post<Task>(`${base}/tasks/${id}/complete`, { outputs }); }
}
