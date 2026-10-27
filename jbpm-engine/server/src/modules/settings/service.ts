// Global configuration: one singleton SystemSettings row (id 'system' per tenant). Reads always
// succeed — a missing row yields the documented defaults — so the client never needs a seed step.
import type { AppContext } from '../../context.ts';
import { Collections, type SystemSettings } from '../../domain.ts';
import { validation } from '../../infra/errors.ts';

export const DEFAULT_SETTINGS: Omit<SystemSettings, 'id' | 'tenantId'> = {
  defaultPageSize: 20,
  instanceRetentionDays: 90,
  auditRetentionDays: 365,
  allowRunningVariableEdits: true,
  executorIntervalSeconds: 5,
  defaultJobRetries: 3,
  slaWarnThresholdPct: 80,
  sessionTimeoutHours: 8,
  emailEnabled: false,
  // 0 = unlimited — see SystemSettings' own doc comment (domain.ts).
  maxActiveInstances: 0,
  maxActiveTimers: 0,
  maxConcurrentScripts: 0,
};

const PAGE_SIZES = [10, 20, 50, 100];

export class SettingsService {
  constructor(private ctx: AppContext) {}
  private repo() { return this.ctx.store.repo<SystemSettings>(Collections.settings); }

  async get(): Promise<SystemSettings> {
    const existing = await this.repo().get('system');
    if (existing && existing.tenantId === this.ctx.tenantId) return existing;
    return { id: 'system', tenantId: this.ctx.tenantId, ...DEFAULT_SETTINGS };
  }

  async update(patch: Partial<SystemSettings>, actor: string): Promise<SystemSettings> {
    if (patch.defaultPageSize !== undefined && !PAGE_SIZES.includes(patch.defaultPageSize)) {
      throw validation(`defaultPageSize must be one of ${PAGE_SIZES.join(', ')}`);
    }
    for (const k of ['instanceRetentionDays', 'auditRetentionDays', 'executorIntervalSeconds', 'defaultJobRetries', 'sessionTimeoutHours'] as const) {
      const v = patch[k];
      if (v !== undefined && (typeof v !== 'number' || v <= 0)) throw validation(`${k} must be a positive number`);
    }
    if (patch.slaWarnThresholdPct !== undefined && (patch.slaWarnThresholdPct < 1 || patch.slaWarnThresholdPct > 100)) {
      throw validation('slaWarnThresholdPct must be between 1 and 100');
    }
    for (const k of ['maxActiveInstances', 'maxActiveTimers', 'maxConcurrentScripts'] as const) {
      const v = patch[k];
      if (v !== undefined && (typeof v !== 'number' || v < 0 || !Number.isInteger(v))) {
        throw validation(`${k} must be a non-negative integer (0 = unlimited)`);
      }
    }
    const current = await this.get();
    const next: SystemSettings = {
      ...current, ...patch,
      id: 'system', tenantId: this.ctx.tenantId,
      updatedAt: this.ctx.clock(), updatedBy: actor,
    };
    await this.repo().put(next);
    await this.ctx.audit({ actor, kind: 'settings.updated', data: { changed: Object.keys(patch) } });
    return next;
  }
}
