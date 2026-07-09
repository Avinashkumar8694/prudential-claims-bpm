// Workflow lifecycle: create (with a main branch + initial draft v1), read/update, permissions, vars.
import type { AppContext } from '../../context.ts';
import { Collections, type Branch, type Version, type Workflow, type WorkflowPermission } from '../../domain.ts';
import type { EngineProject, EngineVar } from '../../sdk/index.ts';
import { notFound, validation } from '../../infra/errors.ts';

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function emptyEngine(id: string, name: string, key: string): EngineProject {
  return {
    id: key, name,
    processes: [{
      id: `${key}.process`, name, package: 'com.acme',
      vars: [], nodes: [{ id: 'start', type: 'start', name: 'Start' }], flows: [],
    }],
  } as unknown as EngineProject;
}

export class WorkflowService {
  constructor(private ctx: AppContext) {}
  private wf() { return this.ctx.store.repo<Workflow>(Collections.workflows); }
  private br() { return this.ctx.store.repo<Branch>(Collections.branches); }
  private ve() { return this.ctx.store.repo<Version>(Collections.versions); }

  async list(): Promise<Workflow[]> {
    return (await this.wf().query((w) => w.tenantId === this.ctx.tenantId && !w.archived))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<Workflow> {
    const w = await this.wf().get(id);
    if (!w || w.tenantId !== this.ctx.tenantId) throw notFound('Workflow');
    return w;
  }

  async create(input: { name: string; key?: string; description?: string }, actor: string): Promise<Workflow> {
    const name = (input.name || '').trim();
    if (!name) throw validation('name is required');
    const key = slug(input.key || name);
    const dupe = await this.wf().query((w) => w.tenantId === this.ctx.tenantId && w.key === key);
    if (dupe.length) throw validation(`key "${key}" already exists`);

    const now = this.ctx.clock();
    const wfId = this.ctx.newId();
    const branchId = this.ctx.newId();
    const versionId = this.ctx.newId();

    const workflow: Workflow = {
      id: wfId, tenantId: this.ctx.tenantId, name, key, description: input.description,
      defaultBranchId: branchId, permissions: [], variables: [],
      createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor,
    };
    const branch: Branch = {
      id: branchId, tenantId: this.ctx.tenantId, workflowId: wfId, name: 'main',
      headVersionId: versionId, protected: true, createdAt: now, createdBy: actor,
    };
    const version: Version = {
      id: versionId, tenantId: this.ctx.tenantId, workflowId: wfId, branchId,
      number: 1, state: 'draft', engine: emptyEngine(wfId, name, key),
      createdAt: now, createdBy: actor,
    };

    await this.wf().put(workflow);
    await this.br().put(branch);
    await this.ve().put(version);
    await this.ctx.audit({ actor, kind: 'workflow.created', workflowId: wfId, data: { name, key } });
    return workflow;
  }

  async update(id: string, patch: Partial<Pick<Workflow, 'name' | 'description' | 'permissions' | 'variables'>>, actor: string): Promise<Workflow> {
    const w = await this.get(id);
    if (patch.name !== undefined) w.name = patch.name.trim() || w.name;
    if (patch.description !== undefined) w.description = patch.description;
    if (patch.permissions !== undefined) w.permissions = patch.permissions;
    if (patch.variables !== undefined) w.variables = patch.variables;
    w.updatedAt = this.ctx.clock(); w.updatedBy = actor;
    await this.wf().put(w);
    await this.ctx.audit({ actor, kind: 'workflow.updated', workflowId: id });
    return w;
  }

  async setPermissions(id: string, permissions: WorkflowPermission[], actor: string) {
    return this.update(id, { permissions }, actor);
  }
  async setVariables(id: string, variables: EngineVar[], actor: string) {
    return this.update(id, { variables }, actor);
  }

  async archive(id: string, actor: string): Promise<void> {
    const w = await this.get(id);
    w.archived = true; w.updatedAt = this.ctx.clock(); w.updatedBy = actor;
    await this.wf().put(w);
    await this.ctx.audit({ actor, kind: 'workflow.archived', workflowId: id });
  }
}
