import type { AppContext } from '../../context.ts';
import { Collections, type Workflow, type Branch, type Version, type Folder, type Deployment } from '../../domain.ts';
import { notFound, conflict, validation } from '../../infra/errors.ts';

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow';
}

export interface ListWorkflowsOptions { folderId?: string | null; includeArchived?: boolean; search?: string; }

export class WorkflowsService {
  constructor(private ctx: AppContext) {}
  private repo() { return this.ctx.store.repo<Workflow>(Collections.workflows); }
  private branches() { return this.ctx.store.repo<Branch>(Collections.branches); }
  private versions() { return this.ctx.store.repo<Version>(Collections.versions); }

  async list(opts: ListWorkflowsOptions = {}): Promise<Workflow[]> {
    let rows = await this.repo().query((w) => w.tenantId === this.ctx.tenantId);
    if (opts.folderId !== undefined) rows = rows.filter((w) => (w.folderId ?? null) === opts.folderId);
    if (!opts.includeArchived) rows = rows.filter((w) => !w.archived);
    if (opts.search) { const q = opts.search.toLowerCase(); rows = rows.filter((w) => w.name.toLowerCase().includes(q) || w.key.toLowerCase().includes(q)); }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<Workflow> {
    const w = await this.repo().get(id);
    if (!w || w.tenantId !== this.ctx.tenantId) throw notFound('workflow');
    return w;
  }

  private async assertFolderExists(folderId: string): Promise<void> {
    const f = await this.ctx.store.repo<Folder>(Collections.folders).get(folderId);
    if (!f || f.tenantId !== this.ctx.tenantId) throw notFound('folder');
  }

  private async uniqueKey(name: string): Promise<string> {
    const base = slugify(name);
    const existing = await this.repo().query((w) => w.tenantId === this.ctx.tenantId);
    const keys = new Set(existing.map((w) => w.key));
    return keys.has(base) ? `${base}-${Date.now()}` : base;
  }

  /** Creates the workflow AND its default branch ("main", protected) AND that branch's initial, empty
   *  draft version (number 1) — a workflow always has somewhere to start authoring immediately, exactly
   *  matching the real shape of a freshly-created draft (no `engine` at all until first saved). */
  async create(name: string, folderId: string | undefined, actor: string): Promise<Workflow> {
    if (!name.trim()) throw validation('workflow name is required');
    if (folderId) await this.assertFolderExists(folderId);
    const now = this.ctx.clock();
    const workflowId = this.ctx.newId();
    const branchId = this.ctx.newId();
    const versionId = this.ctx.newId();

    const version: Version = { id: versionId, tenantId: this.ctx.tenantId, workflowId, branchId, number: 1, state: 'draft', createdAt: now, createdBy: actor };
    await this.versions().put(version);
    const branch: Branch = { id: branchId, tenantId: this.ctx.tenantId, workflowId, name: 'main', headVersionId: versionId, protected: true, createdAt: now, createdBy: actor };
    await this.branches().put(branch);
    const workflow: Workflow = {
      id: workflowId, tenantId: this.ctx.tenantId, key: await this.uniqueKey(name), name: name.trim(), folderId,
      defaultBranchId: branchId, permissions: [], variables: [],
      createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor, archived: false,
    };
    await this.repo().put(workflow);
    await this.ctx.audit({ kind: 'workflow.created', actor, workflowId, data: { name: workflow.name } });
    return workflow;
  }

  async rename(id: string, name: string, actor: string): Promise<Workflow> {
    if (!name.trim()) throw validation('workflow name is required');
    const w = await this.get(id);
    w.name = name.trim(); w.updatedAt = this.ctx.clock(); w.updatedBy = actor;
    await this.repo().put(w);
    return w;
  }

  async move(id: string, folderId: string | undefined, actor: string): Promise<Workflow> {
    const w = await this.get(id);
    if (folderId) await this.assertFolderExists(folderId);
    w.folderId = folderId; w.updatedAt = this.ctx.clock(); w.updatedBy = actor;
    await this.repo().put(w);
    return w;
  }

  async setArchived(id: string, archived: boolean, actor: string): Promise<Workflow> {
    const w = await this.get(id);
    w.archived = archived; w.updatedAt = this.ctx.clock(); w.updatedBy = actor;
    await this.repo().put(w);
    await this.ctx.audit({ kind: archived ? 'workflow.archived' : 'workflow.unarchived', actor, workflowId: id });
    return w;
  }

  /** Only a workflow with no deployment history at all may be hard-deleted — anything that was ever
   *  deployed keeps its audit/instance trail meaningful, so archive it instead. */
  async delete(id: string): Promise<void> {
    await this.get(id);
    const anyDeployment = await this.ctx.store.repo<Deployment>(Collections.deployments).query((d) => d.tenantId === this.ctx.tenantId && d.workflowId === id);
    if (anyDeployment.length) throw conflict('workflow has deployment history — archive it instead of deleting');
    const branches = await this.branches().query((b) => b.tenantId === this.ctx.tenantId && b.workflowId === id);
    for (const b of branches) {
      const versions = await this.versions().query((v) => v.tenantId === this.ctx.tenantId && v.branchId === b.id);
      for (const v of versions) await this.versions().delete(v.id);
      await this.branches().delete(b.id);
    }
    await this.repo().delete(id);
  }
}
