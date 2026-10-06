import type { AppContext } from '../../context.ts';
import { Collections, type Branch, type Version } from '../../domain.ts';
import { notFound, conflict, validation } from '../../infra/errors.ts';

export class BranchesService {
  constructor(private ctx: AppContext) {}
  private repo() { return this.ctx.store.repo<Branch>(Collections.branches); }
  private versions() { return this.ctx.store.repo<Version>(Collections.versions); }

  async list(workflowId: string): Promise<Branch[]> {
    return (await this.repo().query((b) => b.tenantId === this.ctx.tenantId && b.workflowId === workflowId)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<Branch> {
    const b = await this.repo().get(id);
    if (!b || b.tenantId !== this.ctx.tenantId) throw notFound('branch');
    return b;
  }

  /** Branch off `fromBranchId`'s current head — the new branch starts as a fresh draft (number 1)
   *  carrying a deep copy of the source head's engine content, so editing one branch never mutates
   *  another's. */
  async create(workflowId: string, name: string, fromBranchId: string, actor: string): Promise<Branch> {
    if (!name.trim()) throw validation('branch name is required');
    const source = await this.get(fromBranchId);
    if (source.workflowId !== workflowId) throw validation('source branch belongs to a different workflow');
    const existing = await this.list(workflowId);
    if (existing.some((b) => b.name === name.trim())) throw conflict(`branch "${name.trim()}" already exists`);
    const sourceHead = await this.versions().get(source.headVersionId);
    if (!sourceHead) throw notFound('source branch head version');

    const now = this.ctx.clock();
    const branchId = this.ctx.newId();
    const version: Version = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, workflowId, branchId, number: 1, state: 'draft',
      ...(sourceHead.engine ? { engine: structuredClone(sourceHead.engine) } : {}),
      parentVersionId: sourceHead.id, createdAt: now, createdBy: actor,
    };
    await this.versions().put(version);
    const branch: Branch = { id: branchId, tenantId: this.ctx.tenantId, workflowId, name: name.trim(), headVersionId: version.id, protected: false, createdAt: now, createdBy: actor };
    await this.repo().put(branch);
    await this.ctx.audit({ kind: 'branch.created', actor, workflowId, data: { name: branch.name, fromBranch: source.name } });
    return branch;
  }

  async rename(id: string, name: string, actor: string): Promise<Branch> {
    if (!name.trim()) throw validation('branch name is required');
    const branch = await this.get(id);
    branch.name = name.trim();
    await this.repo().put(branch);
    await this.ctx.audit({ kind: 'branch.renamed', actor, workflowId: branch.workflowId });
    return branch;
  }

  async setProtected(id: string, isProtected: boolean, actor: string): Promise<Branch> {
    const branch = await this.get(id);
    branch.protected = isProtected;
    await this.repo().put(branch);
    await this.ctx.audit({ kind: isProtected ? 'branch.protected' : 'branch.unprotected', actor, workflowId: branch.workflowId });
    return branch;
  }

  async delete(id: string, defaultBranchId: string): Promise<void> {
    const branch = await this.get(id);
    if (branch.protected) throw conflict('branch is protected — unprotect it first');
    if (id === defaultBranchId) throw conflict('cannot delete the workflow\'s default branch');
    const deployments = this.ctx.store.repo<import('../../domain.ts').Deployment>(Collections.deployments);
    const inUse = await deployments.query((d) => d.tenantId === this.ctx.tenantId && d.branchId === id && d.status === 'active');
    if (inUse.length) throw conflict('branch has an active deployment — undeploy it first');
    const versions = await this.versions().query((v) => v.tenantId === this.ctx.tenantId && v.branchId === id);
    for (const v of versions) await this.versions().delete(v.id);
    await this.repo().delete(id);
  }
}
