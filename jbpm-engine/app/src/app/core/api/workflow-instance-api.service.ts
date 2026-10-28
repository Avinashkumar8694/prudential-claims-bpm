import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiBase, ApiList } from './api-base';
import type { Instance, Task, WorkflowInstance, WorkflowInstanceAggregate, WorkflowInstanceAudit, WorkflowInstanceComment } from '../models';

export interface CreateWorkflowInstanceBody { workflowName: string; variables?: Record<string, unknown>; workflowData?: Record<string, unknown>; }
export interface ListWorkflowInstancesFilter { workflowName?: string; workflowDefinitionId?: string; status?: string; piid?: string; }
export interface SearchWorkflowInstancesBody { workflowName?: string; status?: string; data?: Record<string, unknown>; }

@Injectable({ providedIn: 'root' })
export class WorkflowInstanceApiService extends ApiBase {
  create(body: CreateWorkflowInstanceBody): Observable<WorkflowInstance> { return this.http.post<WorkflowInstance>(`${this.base}/workflow-instances`, body); }
  list(filter: ListWorkflowInstancesFilter = {}): Observable<WorkflowInstance[]> { return this.items(this.http.get<ApiList<WorkflowInstance>>(`${this.base}/workflow-instances`, { params: this.cleanParams(filter) })); }
  search(body: SearchWorkflowInstancesBody): Observable<WorkflowInstance[]> { return this.items(this.http.post<ApiList<WorkflowInstance>>(`${this.base}/workflow-instances/search`, body)); }
  aggregate(id: string): Observable<WorkflowInstanceAggregate> { return this.http.get<WorkflowInstanceAggregate>(`${this.base}/workflow-instances/${id}`); }
  updateStatus(id: string, status: string): Observable<WorkflowInstance> { return this.http.patch<WorkflowInstance>(`${this.base}/workflow-instances/${id}/status`, { status }); }
  updateData(id: string, data: Record<string, unknown>): Observable<WorkflowInstance> { return this.http.put<WorkflowInstance>(`${this.base}/workflow-instances/${id}/data`, data); }
  signal(id: string, name: string, payload?: unknown): Observable<Instance> { return this.http.post<Instance>(`${this.base}/workflow-instances/${id}/signal`, { name, payload }); }
  decision(id: string, taskId: string, outputs: Record<string, unknown>): Observable<Task> { return this.http.post<Task>(`${this.base}/workflow-instances/${id}/tasks/${taskId}/decision`, { outputs }); }
  delegate(id: string, to: string, taskId?: string): Observable<Task> { return this.http.post<Task>(`${this.base}/workflow-instances/${id}/delegate`, { to, taskId }); }
  tasks(id: string): Observable<Task[]> { return this.items(this.http.get<ApiList<Task>>(`${this.base}/workflow-instances/${id}/tasks`)); }
  signals(id: string): Observable<{ processId: string; listensFor: string[]; throws: string[] } | null> { return this.http.get<any>(`${this.base}/workflow-instances/${id}/signals`); }

  listComments(id: string): Observable<WorkflowInstanceComment[]> { return this.items(this.http.get<ApiList<WorkflowInstanceComment>>(`${this.base}/workflow-instances/${id}/comments`)); }
  addComment(id: string, body: string): Observable<WorkflowInstanceComment> { return this.http.post<WorkflowInstanceComment>(`${this.base}/workflow-instances/${id}/comments`, { body }); }
  deleteComment(id: string, commentId: string): Observable<void> { return this.http.delete<void>(`${this.base}/workflow-instances/${id}/comments/${commentId}`); }

  listAudits(id: string): Observable<WorkflowInstanceAudit[]> { return this.items(this.http.get<ApiList<WorkflowInstanceAudit>>(`${this.base}/workflow-instances/${id}/audits`)); }
  addAudit(id: string, kind: string, data?: Record<string, unknown>): Observable<WorkflowInstanceAudit> { return this.http.post<WorkflowInstanceAudit>(`${this.base}/workflow-instances/${id}/audits`, { kind, data }); }
  deleteAudit(id: string, auditId: string): Observable<void> { return this.http.delete<void>(`${this.base}/workflow-instances/${id}/audits/${auditId}`); }
}
