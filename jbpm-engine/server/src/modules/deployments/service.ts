import type { AppContext } from '../../context.ts';
import { Collections, type Deployment, type Version, type Branch } from '../../domain.ts';
import { notFound, conflict, validation } from '../../infra/errors.ts';

export interface ListDeploymentsOptions { workflowId?: string; environment?: string; status?: Deployment['status']; }

export class DeploymentsService {
  constructor(private ctx: AppContext) {}
  private repo() { return this.ctx.store.repo<Deployment>(Collections.deployments); }
  private versions() { return this.ctx.store.repo<Version>(Collections.versions); }

  async get(id: string): Promise<Deployment> {
    const d = await this.repo().get(id);
    if (!d || d.tenantId !== this.ctx.tenantId) throw notFound('deployment');
    return d;
  }

  async list(opts: ListDeploymentsOptions = {}): Promise<Deployment[]> {
    let rows = await this.repo().query((d) => d.tenantId === this.ctx.tenantId);
    if (opts.workflowId) rows = rows.filter((d) => d.workflowId === opts.workflowId);
    if (opts.environment) rows = rows.filter((d) => d.environment === opts.environment);
    if (opts.status) rows = rows.filter((d) => d.status === opts.status);
    return rows.sort((a, b) => b.deployedAt.localeCompare(a.deployedAt));
  }

  async getActive(workflowId: string, environment: string): Promise<Deployment | undefined> {
    const rows = await this.repo().query((d) => d.tenantId === this.ctx.tenantId && d.workflowId === workflowId && d.environment === environment && d.status === 'active');
    return rows[0];
  }

  /** Deploys a PUBLISHED version into one environment. Only one deployment per (workflowId,
   *  environment) may be active at a time — activating this one deactivates whatever was active there
   *  before (never deleted; it just becomes reactivatable history). */
  async deploy(versionId: string, environment: string, actor: string, env: Record<string, string> = {}, tags: string[] = []): Promise<Deployment> {
    if (!environment.trim()) throw validation('environment is required');
    const version = await this.versions().get(versionId);
    if (!version || version.tenantId !== this.ctx.tenantId) throw notFound('version');
    if (version.state !== 'published') throw conflict('only a published version can be deployed');
    if (!version.engine) throw conflict('version has no engine content'); // shouldn't happen post-publish — VersionsService.publish() already guards this
    const branch = await this.ctx.store.repo<Branch>(Collections.branches).get(version.branchId);

    const previous = await this.getActive(version.workflowId, environment);
    if (previous) {
      previous.status = 'inactive'; previous.undeployedAt = this.ctx.clock();
      await this.repo().put(previous);
    }

    const now = this.ctx.clock();
    const deployment: Deployment = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, workflowId: version.workflowId, versionId: version.id, branchId: version.branchId,
      versionLabel: branch?.name, versionNumber: version.number,
      environment: environment.trim(), status: 'active',
      engine: structuredClone(version.engine),
      env, tags,
      deployedAt: now, deployedBy: actor,
    };
    await this.repo().put(deployment);
    await this.ctx.audit({ kind: 'deployment.activated', actor, workflowId: version.workflowId, data: { deploymentId: deployment.id, environment: deployment.environment, versionNumber: version.number } });
    return deployment;
  }

  async undeploy(id: string, actor: string): Promise<Deployment> {
    const d = await this.get(id);
    if (d.status !== 'active') throw conflict('deployment is not active');
    d.status = 'inactive'; d.undeployedAt = this.ctx.clock();
    await this.repo().put(d);
    await this.ctx.audit({ kind: 'deployment.deactivated', actor, workflowId: d.workflowId, data: { deploymentId: d.id } });
    return d;
  }

  async archive(id: string, actor: string): Promise<Deployment> {
    const d = await this.get(id);
    if (d.status === 'active') throw conflict('cannot archive an active deployment — undeploy it first');
    d.status = 'archived';
    await this.repo().put(d);
    await this.ctx.audit({ kind: 'deployment.archived', actor, workflowId: d.workflowId, data: { deploymentId: d.id } });
    return d;
  }
}
