// Process-instance lifecycle: start against a resolved deployment, query, inspect, resume.
import type { AppContext } from '../../context.js';
import { Collections, type Deployment, type Instance } from '../../domain.js';
import { ExecutionEngine, type EngineEvent } from '../../engine/execution-engine.js';
import { DeploymentService } from '../deployments/service.js';
import { notFound, conflict } from '../../infra/errors.js';

export class InstanceService {
  private engine: ExecutionEngine;
  private deployments: DeploymentService;
  constructor(private ctx: AppContext, emit: (e: EngineEvent) => void = () => {}) {
    this.engine = new ExecutionEngine(ctx, emit);
    this.deployments = new DeploymentService(ctx);
  }
  private repo() { return this.ctx.store.repo<Instance>(Collections.instances); }

  async start(input: { workflowId: string; environment?: string; deploymentId?: string; variables?: Record<string, unknown>; correlationKey?: string }, actor: string): Promise<Instance> {
    let dep: Deployment;
    if (input.deploymentId) dep = await this.deployments.get(input.deploymentId);
    else dep = await this.deployments.resolveActive(input.workflowId, input.environment || 'prod');
    if (dep.status === 'archived') throw conflict('cannot start on an archived deployment');
    return this.engine.start(dep, input.variables || {}, actor, input.correlationKey);
  }

  async get(id: string): Promise<Instance> {
    const i = await this.repo().get(id);
    if (!i || i.tenantId !== this.ctx.tenantId) throw notFound('Instance');
    return i;
  }

  async list(filter: { workflowId?: string; status?: string; deploymentId?: string; correlationKey?: string }): Promise<Instance[]> {
    return (await this.repo().query((i) =>
      i.tenantId === this.ctx.tenantId &&
      (!filter.workflowId || i.workflowId === filter.workflowId) &&
      (!filter.status || i.status === filter.status) &&
      (!filter.deploymentId || i.deploymentId === filter.deploymentId) &&
      (!filter.correlationKey || i.correlationKey === filter.correlationKey)))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async diagramState(id: string) {
    const i = await this.get(id);
    return this.engine.diagramState(i);
  }

  async history(id: string) { return (await this.get(id)).history; }

  /** Resume a waiting token (used by task completion / timer firing / signals). */
  async resume(id: string, tokenId: string, vars?: Record<string, unknown>): Promise<Instance> {
    const inst = await this.get(id);
    const dep = await this.deployments.get(inst.deploymentId);
    return this.engine.resumeToken(inst, dep, tokenId, vars);
  }

  async abort(id: string, actor: string): Promise<Instance> {
    const i = await this.get(id);
    if (i.status === 'completed' || i.status === 'aborted') return i;
    i.status = 'aborted'; i.tokens = []; i.endedAt = this.ctx.clock();
    await this.repo().put(i);
    await this.ctx.audit({ actor, kind: 'instance.aborted', workflowId: i.workflowId, instanceId: i.id });
    return i;
  }
}
