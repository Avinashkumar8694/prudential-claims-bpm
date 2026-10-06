import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Instance, Task, TaskStatus } from '../models/domain';

export interface ListTasksOptions { instanceId?: string; status?: TaskStatus; mine?: boolean; }

@Injectable({ providedIn: 'root' })
export class TasksService {
  constructor(private http: HttpClient) {}

  list(opts: ListTasksOptions = {}) {
    const params: Record<string, string> = {};
    if (opts.instanceId) params['instanceId'] = opts.instanceId;
    if (opts.status) params['status'] = opts.status;
    if (opts.mine) params['mine'] = 'true';
    return this.http.get<Task[]>('/api/tasks', { params });
  }

  get(id: string) { return this.http.get<Task>(`/api/tasks/${id}`); }
  claim(id: string) { return this.http.post<Task>(`/api/tasks/${id}/claim`, {}); }
  release(id: string) { return this.http.post<Task>(`/api/tasks/${id}/release`, {}); }
  start(id: string) { return this.http.post<Task>(`/api/tasks/${id}/start`, {}); }
  complete(id: string, outputs: Record<string, unknown>) { return this.http.post<Instance>(`/api/tasks/${id}/complete`, outputs); }
  skip(id: string) { return this.http.post<Instance>(`/api/tasks/${id}/skip`, {}); }
}
