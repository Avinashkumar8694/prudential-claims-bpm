import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Workflow } from '../models/domain';

export interface ListWorkflowsOptions { folderId?: string | null; includeArchived?: boolean; search?: string; }

@Injectable({ providedIn: 'root' })
export class WorkflowsService {
  constructor(private http: HttpClient) {}

  list(opts: ListWorkflowsOptions = {}) {
    const params: Record<string, string> = {};
    if (opts.folderId !== undefined) params['folderId'] = opts.folderId === null ? 'null' : opts.folderId;
    if (opts.includeArchived) params['includeArchived'] = 'true';
    if (opts.search) params['search'] = opts.search;
    return this.http.get<Workflow[]>('/api/workflows', { params });
  }

  get(id: string) { return this.http.get<Workflow>(`/api/workflows/${id}`); }
  create(name: string, folderId?: string) { return this.http.post<Workflow>('/api/workflows', { name, folderId }); }
  rename(id: string, name: string) { return this.http.put<Workflow>(`/api/workflows/${id}`, { name }); }
  move(id: string, folderId: string | undefined) { return this.http.put<Workflow>(`/api/workflows/${id}`, { folderId }); }
  setArchived(id: string, archived: boolean) { return this.http.put<Workflow>(`/api/workflows/${id}`, { archived }); }
  delete(id: string) { return this.http.delete<void>(`/api/workflows/${id}`); }
}
