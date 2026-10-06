import type { AppContext } from '../../context.ts';
import { Collections, type Version, type Branch } from '../../domain.ts';
import { ApiError, notFound, conflict, validation } from '../../infra/errors.ts';
import { validateEngineProcess } from '../../sdk/index.ts';
import { runEngineRulesForAll, type ValidationIssue } from '../validation/rules.ts';

type EngineBundle = NonNullable<Version['engine']>;

export interface PublishResult { version: Version; warnings: ValidationIssue[]; }

export class VersionsService {
  constructor(private ctx: AppContext) {}
  private repo() { return this.ctx.store.repo<Version>(Collections.versions); }
  private branches() { return this.ctx.store.repo<Branch>(Collections.branches); }

  async get(id: string): Promise<Version> {
    const v = await this.repo().get(id);
    if (!v || v.tenantId !== this.ctx.tenantId) throw notFound('version');
    return v;
  }

  async list(branchId: string): Promise<Version[]> {
    return (await this.repo().query((v) => v.tenantId === this.ctx.tenantId && v.branchId === branchId)).sort((a, b) => b.number - a.number);
  }

  async saveDraft(id: string, engine: EngineBundle, actor: string): Promise<Version> {
    const version = await this.get(id);
    if (version.state !== 'draft') throw conflict('only a draft version can be edited — publishing opens a new draft to continue from');
    version.engine = engine;
    await this.repo().put(version);
    await this.ctx.audit({ kind: 'version.saved', actor, workflowId: version.workflowId, data: { versionId: version.id } });
    return version;
  }

  /** Same checks `publish()` runs, with no side effect — backs the builder's own "Validate" action,
   *  which must be safe to click repeatedly while still drafting. */
  async validateOnly(id: string): Promise<ValidationIssue[]> {
    const version = await this.get(id);
    if (!version.engine || !version.engine.processes.length) return [];
    return this.runValidation(version.engine.processes);
  }

  private runValidation(processes: EngineBundle['processes']): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const p of processes) {
      const sdkResult = validateEngineProcess(p);
      for (const e of sdkResult.errors) issues.push({ code: 'bpmn2-structural', severity: 'error', scope: p.name || p.id, message: e });
      for (const w of sdkResult.warnings) issues.push({ code: 'bpmn2-structural', severity: 'warning', scope: p.name || p.id, message: w });
    }
    issues.push(...runEngineRulesForAll(processes));
    return issues;
  }

  /** Validates (bpmn-sdk's own structural checks + this engine's additive rules), refuses on any
   *  'error'-severity issue, then freezes this version and opens the NEXT draft on the same branch so
   *  authoring can continue uninterrupted — mirrors what a real publish action does: you keep editing,
   *  you just can't mutate what's already been published. */
  async publish(id: string, actor: string): Promise<PublishResult> {
    const version = await this.get(id);
    if (version.state !== 'draft') throw conflict('version is already published');
    if (!version.engine || !version.engine.processes.length) throw validation('cannot publish an empty version — add at least one process first');

    const issues = this.runValidation(version.engine.processes);
    const blocking = issues.filter((i) => i.severity === 'error');
    if (blocking.length) throw new ApiError(400, `cannot publish: ${blocking.length} validation error(s)`, 'VALIDATION', blocking);

    const now = this.ctx.clock();
    version.state = 'published'; version.publishedAt = now; version.publishedBy = actor;
    await this.repo().put(version);

    const branch = await this.branches().get(version.branchId);
    if (branch && branch.tenantId === this.ctx.tenantId) {
      const nextDraft: Version = {
        id: this.ctx.newId(), tenantId: this.ctx.tenantId, workflowId: version.workflowId, branchId: version.branchId,
        number: version.number + 1, state: 'draft', engine: structuredClone(version.engine),
        parentVersionId: version.id, createdAt: now, createdBy: actor,
      };
      await this.repo().put(nextDraft);
      branch.headVersionId = nextDraft.id;
      await this.branches().put(branch);
    }

    const warnings = issues.filter((i) => i.severity === 'warning');
    await this.ctx.audit({ kind: 'version.published', actor, workflowId: version.workflowId, data: { versionId: version.id, warnings: warnings.length } });
    return { version, warnings };
  }
}
