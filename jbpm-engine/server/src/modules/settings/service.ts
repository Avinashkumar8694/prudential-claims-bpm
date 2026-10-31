// Global configuration: one singleton SystemSettings row (id 'system' per tenant). Reads always
// succeed — a missing row yields the documented defaults — so the client never needs a seed step.
import type { AppContext } from '../../context.ts';
import { Collections, type SystemSettings } from '../../domain.ts';
import { validation } from '../../infra/errors.ts';
import { encryptAtRest, decryptAtRest } from '../../infra/crypto.ts';
import { logger } from '../../infra/logger.ts';

export const DEFAULT_SETTINGS: Omit<SystemSettings, 'id' | 'tenantId'> = {
  defaultPageSize: 20,
  instanceRetentionDays: 90,
  auditRetentionDays: 365,
  allowRunningVariableEdits: true,
  executorIntervalSeconds: 5,
  timerBatchSize: 50,
  defaultJobRetries: 3,
  jobRetryBackoffMultiplier: 2,
  scriptTimeoutSeconds: 5,
  slaWarnThresholdPct: 80,
  defaultTaskSlaHours: 48,
  autoReleaseClaimedTaskHours: 0,
  httpTimeoutSeconds: 10,
  outboundAllowlist: '',
  historyAuditLevel: 'full' as const,
  logLevel: 'info' as const,
  sessionTimeoutHours: 8,
  emailEnabled: false,
  instanceCreationMode: 'both' as const,
  // 0 = unlimited — see SystemSettings' own doc comment (domain.ts).
  maxActiveInstances: 0,
  maxActiveTimers: 0,
  maxConcurrentScripts: 0,
};

const PAGE_SIZES = [10, 20, 50, 100];

export class SettingsService {
  constructor(private ctx: AppContext) {}
  private repo() { return this.ctx.store.repo<SystemSettings>(Collections.settings); }

  async get(isAdmin = true): Promise<SystemSettings> {
    const existing = await this.repo().get('system');
    if (existing && existing.tenantId === this.ctx.tenantId) {
      return {
        ...existing,
        outboundAllowlist: isAdmin ? existing.outboundAllowlist : (existing.outboundAllowlist ? '***' : ''),
        smtpPasswordConfigured: Boolean(existing.smtpPassword),
        smtpPassword: existing.smtpPassword ? '••••••••' : undefined,
      };
    }
    return { id: 'system', tenantId: this.ctx.tenantId, ...DEFAULT_SETTINGS };
  }

  /** Internal retrieval for background runners (e.g. mail delivery) with decrypted secrets */
  async getDecrypted(): Promise<SystemSettings> {
    const existing = await this.repo().get('system');
    if (existing && existing.tenantId === this.ctx.tenantId) {
      return {
        ...existing,
        smtpPassword: existing.smtpPassword ? decryptAtRest(existing.smtpPassword) : undefined,
      };
    }
    return { id: 'system', tenantId: this.ctx.tenantId, ...DEFAULT_SETTINGS };
  }

  async update(patch: Partial<SystemSettings>, actor: string): Promise<SystemSettings> {
    if (patch.defaultPageSize !== undefined && !PAGE_SIZES.includes(patch.defaultPageSize)) {
      throw validation(`defaultPageSize must be one of ${PAGE_SIZES.join(', ')}`);
    }
    if (patch.instanceCreationMode !== undefined && !['both', 'case-only', 'process-only'].includes(patch.instanceCreationMode)) {
      throw validation(`instanceCreationMode must be 'both', 'case-only', or 'process-only'`);
    }
    for (const k of ['instanceRetentionDays', 'auditRetentionDays', 'executorIntervalSeconds', 'timerBatchSize', 'defaultJobRetries', 'sessionTimeoutHours', 'scriptTimeoutSeconds', 'jobRetryBackoffMultiplier', 'httpTimeoutSeconds', 'defaultTaskSlaHours'] as const) {
      const v = patch[k];
      if (v !== undefined && (typeof v !== 'number' || v <= 0)) throw validation(`${k} must be a positive number`);
    }
    if (patch.autoReleaseClaimedTaskHours !== undefined && (typeof patch.autoReleaseClaimedTaskHours !== 'number' || patch.autoReleaseClaimedTaskHours < 0)) {
      throw validation('autoReleaseClaimedTaskHours must be a non-negative number');
    }
    if (patch.historyAuditLevel !== undefined && !['full', 'activity', 'minimal'].includes(patch.historyAuditLevel)) {
      throw validation(`historyAuditLevel must be 'full', 'activity', or 'minimal'`);
    }
    if (patch.logLevel !== undefined) {
      if (!['debug', 'info', 'warn', 'error'].includes(patch.logLevel)) {
        throw validation(`logLevel must be 'debug', 'info', 'warn', or 'error'`);
      }
      logger.setLevel(patch.logLevel);
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
    const currentRaw = (await this.repo().get('system')) || { id: 'system', tenantId: this.ctx.tenantId, ...DEFAULT_SETTINGS };
    
    // Encrypt secrets at rest before persisting
    const preparedPatch = { ...patch };
    if (preparedPatch.smtpPassword) {
      if (preparedPatch.smtpPassword === '••••••••' || !preparedPatch.smtpPassword.trim()) {
        delete preparedPatch.smtpPassword; // preserve current
      } else {
        preparedPatch.smtpPassword = encryptAtRest(preparedPatch.smtpPassword);
      }
    }

    const next: SystemSettings = {
      ...currentRaw, ...preparedPatch,
      id: 'system', tenantId: this.ctx.tenantId,
      updatedAt: this.ctx.clock(), updatedBy: actor,
    };
    await this.repo().put(next);
    await this.ctx.audit({ actor, kind: 'settings.updated', data: { changed: Object.keys(patch) } });
    return this.get();
  }
}
