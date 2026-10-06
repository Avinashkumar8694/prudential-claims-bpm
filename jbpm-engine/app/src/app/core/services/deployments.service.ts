import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Deployment } from '../models/domain';

export interface ListDeploymentsOptions { workflowId?: string; environment?: string; status?: Deployment['status']; }

@Injectable({ providedIn: 'root' })
export class DeploymentsService {
  constructor(private http: HttpClient) {}

  list(opts: ListDeploymentsOptions = {}) {
    const params: Record<string, string> = {};
    if (opts.workflowId) params['workflowId'] = opts.workflowId;
    if (opts.environment) params['environment'] = opts.environment;
    if (opts.status) params['status'] = opts.status;
    return this.http.get<Deployment[]>('/api/deployments', { params });
  }

  get(id: string) { return this.http.get<Deployment>(`/api/deployments/${id}`); }
  deploy(versionId: string, environment: string, env?: Record<string, string>, tags?: string[]) {
    return this.http.post<Deployment>('/api/deployments', { versionId, environment, env, tags });
  }
  undeploy(id: string) { return this.http.post<Deployment>(`/api/deployments/${id}/undeploy`, {}); }
  archive(id: string) { return this.http.post<Deployment>(`/api/deployments/${id}/archive`, {}); }
}
