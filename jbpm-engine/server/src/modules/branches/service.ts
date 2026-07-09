// Branches: named lines of development. Fork a new branch from any version (copies its engine JSON
// into a fresh draft that becomes the new branch's head).
import type { AppContext } from '../../context.ts';
import { Collections, type Branch, type Version } from '../../domain.ts';
import { notFound, validation } from '../../infra/errors.ts';

export class BranchService {
  constructor(private ctx: AppContext) {}
  private br() { return this.ctx.store.repo<Branch>(Collections.branches); }
  private ve() { return this.ctx.store.repo<Version>(Collections.versions); }

  async listByWorkflow(workflowId: string): Promise<Branch[]> {
    return (await this.br().query((b) => b.tenantId === this.ctx.tenantId && b.workflowId === workflowId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(id: string): Promise<Branch> {
    const b = await this.br().get(id);
    if (!b || b.tenantId !== this.ctx.tenantId) throw notFound('Branch');
    return b;
  }

  async create(workflowId: string, input: { name: string; fromVersionId?: string }, actor: string): Promise<Branch> {
    const name = (input.name || '').trim();
    if (!name) throw validation('branch name is required');
    const existing = await this.listByWorkflow(workflowId);
    if (existing.some((b) => b.name === name)) throw validation(`branch "${name}" already exists`);

    // seed engine JSON from the fork point (or the workflow's default-branch head)
    let from: Version | undefined;
    if (input.fromVersionId) {
      from = await this.ve().get(input.fromVersionId);
      if (!from || from.tenantId !== this.ctx.tenantId) throw notFound('fromVersion');
    }

    const now = this.ctx.clock();
    const branchId = this.ctx.newId();
    const versionId = this.ctx.newId();
    const branch: Branch = {
      id: branchId, tenantId: this.ctx.tenantId, workflowId, name,
      forkedFromVersionId: from?.id, headVersionId: versionId, createdAt: now, createdBy: actor,
    };
    const version: Version = {
      id: versionId, tenantId: this.ctx.tenantId, workflowId, branchId,
      number: 1, state: 'draft',
      engine: from ? structuredClone(from.engine) : ({ id: workflowId, name, processes: [] } as any),
      parentVersionId: from?.id, createdAt: now, createdBy: actor,
    };
    await this.br().put(branch);
    await this.ve().put(version);
    await this.ctx.audit({ actor, kind: 'branch.created', workflowId, data: { branchId, name, from: from?.id } });
    return branch;
  }
}
