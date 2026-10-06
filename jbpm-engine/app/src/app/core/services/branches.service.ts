import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Branch } from '../models/domain';

@Injectable({ providedIn: 'root' })
export class BranchesService {
  constructor(private http: HttpClient) {}
  list(workflowId: string) { return this.http.get<Branch[]>(`/api/workflows/${workflowId}/branches`); }
  get(id: string) { return this.http.get<Branch>(`/api/branches/${id}`); }
  create(workflowId: string, name: string, fromBranchId: string) {
    return this.http.post<Branch>(`/api/workflows/${workflowId}/branches`, { name, fromBranchId });
  }
  rename(id: string, name: string) { return this.http.put<Branch>(`/api/branches/${id}`, { name }); }
  setProtected(id: string, isProtected: boolean) { return this.http.put<Branch>(`/api/branches/${id}`, { protected: isProtected }); }
  delete(id: string) { return this.http.delete<void>(`/api/branches/${id}`); }
}
