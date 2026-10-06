import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Instance, InstanceStatus } from '../models/domain';

export interface StartInstanceOptions {
  deploymentId?: string; workflowId?: string; environment?: string;
  processId?: string; correlationKey?: string; variables?: Record<string, unknown>;
}
export interface ListInstancesOptions { workflowId?: string; deploymentId?: string; status?: InstanceStatus; parentInstanceId?: string; }
export interface DiagramState { activeNodeIds: string[]; visitedNodeIds: string[]; status: string; }

@Injectable({ providedIn: 'root' })
export class InstancesService {
  constructor(private http: HttpClient) {}

  list(opts: ListInstancesOptions = {}) {
    const params: Record<string, string> = {};
    if (opts.workflowId) params['workflowId'] = opts.workflowId;
    if (opts.deploymentId) params['deploymentId'] = opts.deploymentId;
    if (opts.status) params['status'] = opts.status;
    if (opts.parentInstanceId) params['parentInstanceId'] = opts.parentInstanceId;
    return this.http.get<Instance[]>('/api/instances', { params });
  }

  get(id: string) { return this.http.get<Instance>(`/api/instances/${id}`); }
  diagram(id: string) { return this.http.get<DiagramState>(`/api/instances/${id}/diagram`); }
  start(opts: StartInstanceOptions) { return this.http.post<Instance>('/api/instances', opts); }
  abort(id: string) { return this.http.post<Instance>(`/api/instances/${id}/abort`, {}); }
  retryNode(id: string, nodeId: string) { return this.http.post<Instance>(`/api/instances/${id}/retry`, { nodeId }); }
  editVariables(id: string, patch: Record<string, unknown>) { return this.http.put<Instance>(`/api/instances/${id}/variables`, patch); }
  signal(id: string, name: string, payload?: unknown) { return this.http.post<Instance>(`/api/instances/${id}/signal`, { name, payload }); }
}
