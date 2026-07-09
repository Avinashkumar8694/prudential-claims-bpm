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
    this.deployments = new DeploymentService(ctx);
    // resolve a called process id -> its active deployment + the matching process (any process, any active deployment)
    const resolveCalled = async (processId: string): Promise<{ dep: Deployment; processId: string } | undefined> => {
      const deps = await this.ctx.store.repo<Deployment>(Collections.deployments).query((d) => d.tenantId === this.ctx.tenantId && d.status === 'active');
      for (const dep of deps) {
        const p = (dep.engine?.processes || []).find((x) => x.id === processId);
        if (p) return { dep, processId: p.id! };
      }
      return undefined;
    };
    this.engine = new ExecutionEngine(ctx, emit, resolveCalled);
  }
  private repo() { return this.ctx.store.repo<Instance>(Collections.instances); }

  async start(input: { workflowId: string; processId?: string; environment?: string; deploymentId?: string; variables?: Record<string, unknown>; correlationKey?: string }, actor: string): Promise<Instance> {
    let dep: Deployment;
    if (input.deploymentId) dep = await this.deployments.get(input.deploymentId);
    else dep = await this.deployments.resolveActive(input.workflowId, input.environment || 'prod');
    if (dep.status === 'archived') throw conflict('cannot start on an archived deployment');
    return this.engine.start(dep, input.variables || {}, actor, { processId: input.processId, correlationKey: input.correlationKey });
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

  /** Deliver a signal/message to a running instance (resumes matching waiting tokens). */
  async signal(id: string, name: string, payload: unknown, actor: string): Promise<Instance> {
    const inst = await this.get(id);
    const dep = await this.deployments.get(inst.deploymentId);
    await this.ctx.audit({ actor, kind: 'instance.signaled', workflowId: inst.workflowId, instanceId: id, data: { name } });
    return this.engine.signalInstance(inst, dep, name, payload);
  }

  /** Re-trigger a node (retry a failed node, or replay a node) and continue the flow. */
  async retry(id: string, nodeId: string, actor: string): Promise<Instance> {
    const inst = await this.get(id);
    const dep = await this.deployments.get(inst.deploymentId);
    await this.ctx.audit({ actor, kind: 'instance.node.retriggered', workflowId: inst.workflowId, instanceId: id, nodeId });
    return this.engine.retryNode(inst, dep, nodeId);
  }

  /** Parent + child instances (call activities) for related-instance navigation. */
  async related(id: string): Promise<{ instance: Instance; parent: Instance | null; children: Instance[] }> {
    const inst = await this.get(id);
    const parent = inst.parentInstanceId ? (await this.repo().get(inst.parentInstanceId)) || null : null;
    const children = await this.repo().query((c) => c.tenantId === this.ctx.tenantId && c.parentInstanceId === id);
    return { instance: inst, parent, children };
  }

  async suspend(id: string, actor: string): Promise<Instance> {
    const i = await this.get(id);
    if (i.status === 'running' || i.status === 'waiting') { i.status = 'suspended'; await this.repo().put(i); await this.ctx.audit({ actor, kind: 'instance.suspended', instanceId: id }); }
    return i;
  }
  async resumeInstance(id: string, actor: string): Promise<Instance> {
    const i = await this.get(id);
    if (i.status === 'suspended') { i.status = i.tokens.some((t) => t.state === 'active') ? 'running' : 'waiting'; await this.repo().put(i); await this.ctx.audit({ actor, kind: 'instance.resumed', instanceId: id }); }
    return i;
  }

  /** Read-only process graph (nodes + flows + positions) for rendering the instance diagram. */
  async graph(id: string) {
    const inst = await this.get(id);
    const dep = await this.deployments.get(inst.deploymentId);
    const p = (dep.engine.processes || []).find((x) => x.id === inst.processId) || dep.engine.processes?.[0];
    return { nodes: p?.nodes || [], flows: p?.flows || [], diagram: this.engine.diagramState(inst) };
  }
}
