import type { AppContext } from '../../context.ts';
import { Collections, type SystemSettings } from '../../domain.ts';

const DEFAULTS: Omit<SystemSettings, 'id' | 'tenantId'> = {
  defaultPageSize: 20,
  instanceRetentionDays: 90,
  auditRetentionDays: 365,
  allowRunningVariableEdits: true,
  executorIntervalSeconds: 5,
  defaultJobRetries: 3,
  slaWarnThresholdPct: 80,
  sessionTimeoutHours: 8,
  emailEnabled: false,
  maxActiveInstances: 0,
  maxActiveTimers: 0,
  maxConcurrentScripts: 0,
};

export class SettingsService {
  constructor(private ctx: AppContext) {}
  private repo() { return this.ctx.store.repo<SystemSettings>(Collections.settings); }

  async get(): Promise<SystemSettings> {
    const existing = await this.repo().get('system');
    if (existing) return existing;
    const fresh: SystemSettings = { id: 'system', tenantId: this.ctx.tenantId, ...DEFAULTS };
    await this.repo().put(fresh);
    return fresh;
  }

  async update(patch: Partial<Omit<SystemSettings, 'id' | 'tenantId'>>, actor: string): Promise<SystemSettings> {
    const current = await this.get();
    const updated: SystemSettings = { ...current, ...patch, updatedAt: this.ctx.clock(), updatedBy: actor };
    await this.repo().put(updated);
    return updated;
  }
}
