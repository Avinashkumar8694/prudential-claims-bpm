// Platform-administrator surface (limits every workspace lives under). All calls are 403 for anyone but the platform admin.
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiBase } from './api-base';

export interface PlatformLimits {
  scriptPoolDefaultSize: number; scriptPoolMaxSize: number; scriptQueueDefaultMax: number; scriptQueueMaxCap: number;
  scriptQueueTimeoutMs: number; scriptMaxIsolates: number; scriptOverflowModeDefault: 'queue' | 'reject';
  maxActiveInstancesCap: number; maxActiveTimersCap: number; maxReplicasCap: number;
}
export interface WorkspaceLimitOverride {
  scriptPoolDefaultSize?: number; scriptPoolMaxSize?: number; scriptQueueDefaultMax?: number; scriptQueueMaxCap?: number;
  maxActiveInstancesCap?: number; maxActiveTimersCap?: number; maxReplicasCap?: number; lockedOverflowMode?: 'queue' | 'reject';
}
export interface PlatformUsageRow {
  workspaceId: string; name?: string; slug?: string;
  effective: { scriptPoolSize: number; scriptQueueMax: number; scriptOverflowMode: string; maxActiveInstances: number; maxActiveTimers: number };
  caps: { scriptPoolMaxSize: number; scriptQueueMaxCap: number; maxActiveInstancesCap: number; maxActiveTimersCap: number; lockedOverflowMode?: string };
  pool: { size: number | null; isolatesAlive: number; running: number; queued: number; peakRunning: number; created: number; recycled: number };
}
export interface PlatformUsage {
  global: PlatformLimits;
  server: { totalIsolates: number; maxIsolates: number; queuedTotal: number; created: number; recycled: number; executions: number; queueRejected: number; overflowRejected: number; queueTimeouts: number };
  workspaces: PlatformUsageRow[];
}

@Injectable({ providedIn: 'root' })
export class PlatformApiService extends ApiBase {
  getLimits(): Observable<{ limits: PlatformLimits; defaults: PlatformLimits; overriddenFields: string[] }> { return this.http.get<{ data: any }>(`${this.base}/platform/limits`).pipe(map((r) => r.data)); }
  putLimits(patch: Partial<PlatformLimits>): Observable<{ limits: PlatformLimits }> { return this.http.put<{ data: any }>(`${this.base}/platform/limits`, patch).pipe(map((r) => r.data)); }
  usage(): Observable<PlatformUsage> { return this.http.get<{ data: PlatformUsage }>(`${this.base}/platform/limits/usage`).pipe(map((r) => r.data)); }
  getWorkspace(id: string): Observable<{ override: WorkspaceLimitOverride }> { return this.http.get<{ data: any }>(`${this.base}/platform/workspaces/${id}/limits`).pipe(map((r) => r.data)); }
  putWorkspace(id: string, patch: Record<string, unknown>): Observable<{ override: WorkspaceLimitOverride }> { return this.http.put<{ data: any }>(`${this.base}/platform/workspaces/${id}/limits`, patch).pipe(map((r) => r.data)); }
}
