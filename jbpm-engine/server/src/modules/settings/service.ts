// Global configuration: one singleton SystemSettings row (id 'system' per tenant). Reads always
// succeed — a missing row yields the documented defaults — so the client never needs a seed step.
import { effectiveLimitsFor, assertWithinCaps } from '../platform/limits.ts';
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

// keys a workspace admin may write; everything else is read-only (id/tenantId/audit stamps) or platform-only (caps).
const EDITABLE: ReadonlySet<string> = new Set([
  'defaultPageSize', 'instanceRetentionDays', 'auditRetentionDays', 'allowRunningVariableEdits', 'executorIntervalSeconds',
  'defaultJobRetries', 'slaWarnThresholdPct', 'sessionTimeoutHours', 'emailEnabled', 'emailFrom', 'smtpHost', 'smtpPort',
  'maxActiveInstances', 'maxActiveTimers', 'maxConcurrentScripts', 'scriptPoolSize', 'scriptQueueMax', 'scriptOverflowMode',
]);
// echoed back by clients that PUT the whole object they GET — harmless, silently dropped
const ECHOED: ReadonlySet<string> = new Set(['id', 'tenantId', 'updatedAt', 'updatedBy', 'effectiveScriptConcurrency', 'effectiveScriptOverflowMode', 'effectiveLimits', 'limitCaps']);

export class SettingsService {
  constructor(private ctx: AppContext) {}
  private repo() { return this.ctx.store.repo<SystemSettings>(Collections.settings); }
  private rowId() { return `system:${this.ctx.tenantId}`; }

  async get(): Promise<SystemSettings> {
    // one row PER workspace. (The legacy single row id 'system' is still read for the workspace it names, so existing
    // data survives; it used to be shared by every workspace, so one workspace's save clobbered another's.)
    const own = await this.repo().get(this.rowId());
    if (own) return { ...own, id: 'system' };
    const legacy = await this.repo().get('system');
    if (legacy && legacy.tenantId === this.ctx.tenantId) return legacy;
    return { id: 'system', tenantId: this.ctx.tenantId, ...DEFAULT_SETTINGS };
  }

  async update(patch: Partial<SystemSettings>, actor: string): Promise<SystemSettings> {
    patch = { ...patch };
    for (const k of Object.keys(patch)) {
      if (ECHOED.has(k)) delete (patch as Record<string, unknown>)[k];
      else if (!EDITABLE.has(k)) throw validation(`"${k}" is not a workspace setting (read-only or platform-controlled)`, { field: k });
    }
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
    // limits: integer/enum validation + the platform caps (a workspace may always go lower, never above the cap)
    // caps = platform global ∩ per-workspace override ∩ the workspace's PLAN (a workspace can only go lower)
    assertWithinCaps(patch, (await effectiveLimitsFor(this.ctx)).caps);
    const current = await this.get();
    const next: SystemSettings = {
      ...current, ...patch,
      id: 'system', tenantId: this.ctx.tenantId,
      updatedAt: this.ctx.clock(), updatedBy: actor,
    };
    // null = clear back to the platform default
    for (const k of ['scriptOverflowMode', 'scriptPoolSize', 'scriptQueueMax'] as const) if (next[k] == null) delete next[k];
    await this.repo().put({ ...next, id: this.rowId() });
    await this.ctx.audit({ actor, kind: 'settings.updated', data: { changed: Object.keys(patch) } });
    return next;
  }
}
