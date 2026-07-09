// Deployments: immutable runnable snapshots of a published version, labeled with tags, grouped by
// environment. Exactly one deployment is ACTIVE per (workflow, environment). See docs/09.
import type { AppContext } from '../../context.ts';
import { Collections, type Deployment, type TimerJob, type Version } from '../../domain.ts';
import { conflict, notFound, validation } from '../../infra/errors.ts';
import { computeDue } from '../../engine/duration.ts';

export class DeploymentService {
  constructor(private ctx: AppContext) {}
  private dp() { return this.ctx.store.repo<Deployment>(Collections.deployments); }
  private ve() { return this.ctx.store.repo<Version>(Collections.versions); }
  private tm() { return this.ctx.store.repo<TimerJob>(Collections.timers); }

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
      versionNumber: v.number, versionLabel: v.label,
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
    await this.syncStartTimers(d);
    return d;
  }

  /**
   * Reconcile start-timer / cron scheduled starts for (workflow, environment): cancel every scheduled
   * start job in that scope, then schedule a fresh job per timer-triggered start node of whichever
   * deployment is currently active. Called on activate/undeploy/archive so exactly the live
   * deployment's schedule runs. `changed` names the (workflow, environment) scope to reconcile.
   */
  private async syncStartTimers(changed: Deployment): Promise<void> {
    const scope = await this.dp().query((x) =>
      x.tenantId === this.ctx.tenantId && x.workflowId === changed.workflowId && x.environment === changed.environment);
    const ids = new Set(scope.map((x) => x.id));
    const stale = await this.tm().query((t) => t.kind === 'start' && t.status === 'scheduled' && ids.has(t.deploymentId || ''));
    for (const t of stale) { t.status = 'cancelled'; await this.tm().put(t); }
    const active = scope.find((x) => x.status === 'active');
    if (!active) return;
    const now = this.ctx.clock();
    for (const p of active.engine?.processes || []) {
      for (const n of p.nodes || []) {
        if (n.type !== 'start') continue;
        const spec = (n as any).on?.timer ?? (n as any).timer;   // ISO duration/date or { cycle: 'R/PT1H' }
        if (!spec) continue;
        const cycle = typeof spec === 'object' ? spec.cycle : (typeof spec === 'string' && spec.startsWith('R') ? spec : undefined);
        const job: TimerJob = {
          id: this.ctx.newId(), tenantId: this.ctx.tenantId, instanceId: '', tokenId: '', nodeId: n.id!,
          kind: 'start', dueAt: computeDue(cycle ? { cycle } : spec, now), cycle, fired: 0, status: 'scheduled',
          deploymentId: active.id, processId: p.id,
        };
        await this.tm().put(job);
      }
    }
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
    await this.syncStartTimers(d);   // no longer active → cancels its scheduled starts
    return d;
  }

  async archive(id: string, actor: string): Promise<Deployment> {
    const d = await this.get(id);
    d.status = 'archived'; d.archivedAt = this.ctx.clock();
    await this.dp().put(d);
    await this.ctx.audit({ actor, kind: 'deployment.archived', workflowId: d.workflowId, deploymentId: id });
    await this.syncStartTimers(d);
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
