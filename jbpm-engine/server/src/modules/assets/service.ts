// Project assets (shared across the project's processes). Kinds + seeds are defined per-folder under
// src/assets/<kind>/def.ts (registry in src/assets/index.ts). This module lists + adds asset entries
// into the head-draft version.engine; the SDK exports them to real jBPM assets and the runtime
// evaluators apply them. Full per-asset editors: Phase 8.
import type { AppContext } from '../../context.ts';
import type { EngineProject } from '../../sdk/index.ts';
import { WorkflowService } from '../workflows/service.ts';
import { VersionService } from '../versions/service.ts';
import { ASSET_KINDS, ASSET_DEFS } from '../../assets/index.ts';
import { notFound, validation } from '../../infra/errors.ts';

export class AssetsService {
  private wf: WorkflowService;
  private ver: VersionService;
  constructor(private ctx: AppContext) { this.wf = new WorkflowService(ctx); this.ver = new VersionService(ctx); }

  private async head(projectId: string): Promise<{ branchId: string; engine: EngineProject }> {
    const project = await this.wf.get(projectId);
    const versions = await this.ver.listByBranch(project.defaultBranchId);
    const head = versions.filter((v) => v.state === 'draft').at(-1) || versions.at(-1);
    if (!head) throw notFound('draft version');
    return { branchId: project.defaultBranchId, engine: head.engine };
  }

  async list(projectId: string): Promise<{ kinds: { key: string; label: string }[]; assets: Record<string, { name: string }[]> }> {
    const { engine } = await this.head(projectId);
    const assets: Record<string, { name: string }[]> = {};
    for (const k of ASSET_KINDS) {
      const arr = ((engine as any)[k.key] as any[]) || [];
      assets[k.key] = arr.map((a) => ({ name: a[k.nameField] || a.name || a.group || a.id || '(unnamed)' }));
    }
    return { kinds: ASSET_KINDS.map((k) => ({ key: k.key, label: k.label })), assets };
  }

  async add(projectId: string, kind: string, name: string, actor: string): Promise<{ kind: string; name: string }> {
    const nm = (name || '').trim();
    if (!nm) throw validation('asset name is required');
    const def = ASSET_DEFS[kind];
    if (!def) throw validation(`unknown asset kind "${kind}"`);
    const { branchId, engine } = await this.head(projectId);
    const coll = ((engine as any)[kind] ||= []) as any[];
    if (coll.some((a) => (a[def.nameField] || a.name) === nm)) throw validation(`asset "${nm}" already exists`);
    coll.push(def.seed(nm));
    await this.ver.saveDraft(branchId, engine, actor);
    await this.ctx.audit({ actor, kind: 'asset.added', workflowId: projectId, data: { kind, name: nm } });
    return { kind, name: nm };
  }
}
