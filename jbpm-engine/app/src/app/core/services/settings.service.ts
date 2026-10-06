import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { SystemSettings } from '../models/domain';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  constructor(private http: HttpClient) {}
  get() { return this.http.get<SystemSettings>('/api/settings'); }
  update(patch: Partial<SystemSettings>) { return this.http.put<SystemSettings>('/api/settings', patch); }
}
