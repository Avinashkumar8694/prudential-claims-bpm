import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Version } from '../models/domain';
import type { EngineBundle } from '../models/engine';

export interface ValidationIssue { code: string; severity: 'error' | 'warning'; message: string; nodeId?: string; scope: string; }
export interface PublishResult { version: Version; warnings: ValidationIssue[]; }

@Injectable({ providedIn: 'root' })
export class VersionsService {
  constructor(private http: HttpClient) {}
  list(branchId: string) { return this.http.get<Version[]>(`/api/branches/${branchId}/versions`); }
  get(id: string) { return this.http.get<Version>(`/api/versions/${id}`); }
  saveDraft(id: string, engine: EngineBundle) { return this.http.put<Version>(`/api/versions/${id}`, { engine }); }
  publish(id: string) { return this.http.post<PublishResult>(`/api/versions/${id}/publish`, {}); }
  validate(id: string) { return this.http.post<{ issues: ValidationIssue[] }>(`/api/versions/${id}/validate`, {}); }
}
