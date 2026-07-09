// Deployments: immutable runnable snapshots of a published version, labeled with tags, grouped by
// environment. Exactly one deployment is ACTIVE per (workflow, environment). See docs/09.
import type { AppContext } from '../../context.ts';
import { Collections, type Deployment, type Version } from '../../domain.ts';
import { conflict, notFound, validation } from '../../infra/errors.ts';

export class DeploymentService {
  constructor(private ctx: AppContext) {}
  private dp() { return this.ctx.store.repo<Deployment>(Collections.deployments); }
  private ve() { return this.ctx.store.repo<Version>(Collections.versions); }

  async get(id: string): Promise<Deployment> {
    const d = await this.dp().get(id);
    if (!d || d.tenantId !== this.ctx.tenantId) throw notFound('Deployment');
    return d;
  }

  async listByWorkflow(workflowId: string): Promise<Deployment[]> {
    return (await this.dp().query((d) => d.tenantId === this.ctx.tenantId && d.workflowId === workflowId))
      .sort((a, b) => b.deployedAt.localeCompare(a.deployedAt));
  }

  /** Snapshot a published version into an inactive deployment. */
  async deploy(versionId: string, input: { environment: string; tags?: string[]; env?: Record<string, string>; activate?: boolean }, actor: string): Promise<Deployment> {
    const v = await this.ve().get(versionId);
    if (!v || v.tenantId !== this.ctx.tenantId) throw notFound('Version');
    if (v.state !== 'published') throw conflict('only published versions can be deployed');
    const environment = (input.environment || '').trim();
    if (!environment) throw validation('environment is required');

    const dep: Deployment = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, workflowId: v.workflowId, versionId: v.id, branchId: v.branchId,
      engine: structuredClone(v.engine), env: input.env || {},
      tags: [...new Set([environment, ...(input.tags || [])])],
      status: 'inactive', environment,
      deployedAt: this.ctx.clock(), deployedBy: actor,
    };
    await this.dp().put(dep);
    await this.ctx.audit({ actor, kind: 'deployment.created', workflowId: v.workflowId, deploymentId: dep.id, data: { versionId, environment, tags: dep.tags } });
    if (input.activate) return this.activate(dep.id, actor);
    return dep;
  }

  async setTags(id: string, change: { add?: string[]; remove?: string[] }, actor: string): Promise<Deployment> {
    const d = await this.get(id);
    const set = new Set(d.tags);
    for (const t of change.add || []) set.add(t);
    for (const t of change.remove || []) if (t !== d.environment) set.delete(t); // never remove the environment tag
    d.tags = [...set];
    await this.dp().put(d);
    await this.ctx.audit({ actor, kind: 'deployment.tagged', workflowId: d.workflowId, deploymentId: id, data: { tags: d.tags } });
    return d;
  }

  /** Activate this deployment in its environment; atomically deactivate the previous active one. */
  async activate(id: string, actor: string): Promise<Deployment> {
    const d = await this.get(id);
    if (d.status === 'archived') throw conflict('cannot activate an archived deployment');
    const siblings = await this.dp().query((x) =>
      x.tenantId === this.ctx.tenantId && x.workflowId === d.workflowId && x.environment === d.environment && x.status === 'active');
    for (const s of siblings) {
      if (s.id === d.id) continue;
      s.status = 'inactive'; s.undeployedAt = this.ctx.clock();
      await this.dp().put(s);
      await this.ctx.audit({ actor, kind: 'deployment.deactivated', workflowId: d.workflowId, deploymentId: s.id });
    }
    d.status = 'active'; d.undeployedAt = undefined;
    await this.dp().put(d);
    await this.ctx.audit({ actor, kind: 'deployment.activated', workflowId: d.workflowId, deploymentId: id, data: { environment: d.environment } });
    return d;
  }

  async rollback(environment: string, toDeploymentId: string, actor: string): Promise<Deployment> {
    const target = await this.get(toDeploymentId);
    if (target.environment !== environment) throw validation('target deployment is in a different environment');
    return this.activate(toDeploymentId, actor);
  }

  async undeploy(id: string, actor: string): Promise<Deployment> {
    const d = await this.get(id);
    d.status = 'inactive'; d.undeployedAt = this.ctx.clock();
    await this.dp().put(d);
    await this.ctx.audit({ actor, kind: 'deployment.undeployed', workflowId: d.workflowId, deploymentId: id });
    return d;
  }

  async archive(id: string, actor: string): Promise<Deployment> {
    const d = await this.get(id);
    d.status = 'archived'; d.archivedAt = this.ctx.clock();
    await this.dp().put(d);
    await this.ctx.audit({ actor, kind: 'deployment.archived', workflowId: d.workflowId, deploymentId: id });
    return d;
  }

  /** Resolve the deployment that should serve a new instance for (workflow, environment). */
  async resolveActive(workflowId: string, environment: string): Promise<Deployment> {
    const active = await this.dp().query((d) =>
      d.tenantId === this.ctx.tenantId && d.workflowId === workflowId && d.environment === environment && d.status === 'active');
    if (!active.length) throw conflict(`no active deployment for environment "${environment}"`);
    return active[0]!;
  }
}
