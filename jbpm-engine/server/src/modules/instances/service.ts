import type { AppContext } from '../../context.ts';
import { Collections, type Instance, type Deployment } from '../../domain.ts';
import { notFound, conflict, validation } from '../../infra/errors.ts';
import { ExecutionEngine, type EngineEvent } from '../../engine/execution-engine.ts';
import { SettingsService } from '../settings/service.ts';

/** Resolves a Call/ForEach node's bare `process` id (+ optional `workflowId` pin) to one active
 *  Deployment that declares it. When `workflowId` is pinned, only that workflow's active deployments
 *  are searched (fully disambiguating); otherwise every active deployment in the tenant is searched and
 *  the first match wins — ambiguous only when two independently-authored workflows both happen to use
 *  the exact same bare process id AND neither call site pins one, which the workflowId picker exists to
 *  prevent. */
export function makeResolveCalled(ctx: AppContext) {
  return async (processId: string, workflowId?: string): Promise<{ dep: Deployment; processId: string } | undefined> => {
    const candidates = await ctx.store.repo<Deployment>(Collections.deployments).query((d) =>
      d.tenantId === ctx.tenantId && d.status === 'active' && (!workflowId || d.workflowId === workflowId));
    const dep = candidates.find((d) => (d.engine.processes || []).some((p) => p.id === processId));
    return dep ? { dep, processId } : undefined;
  };
}

export interface StartInstanceOptions {
  deploymentId?: string; workflowId?: string; environment?: string;
  processId?: string; correlationKey?: string; variables?: Record<string, unknown>;
}
export interface ListInstancesOptions { workflowId?: string; deploymentId?: string; status?: Instance['status']; parentInstanceId?: string; }

export class InstancesService {
  private engine: ExecutionEngine;
  constructor(private ctx: AppContext, emit: (e: EngineEvent) => void = () => {}) {
    this.engine = new ExecutionEngine(ctx, emit, makeResolveCalled(ctx));
  }

  private repo() { return this.ctx.store.repo<Instance>(Collections.instances); }
  private deployments() { return this.ctx.store.repo<Deployment>(Collections.deployments); }

  async get(id: string): Promise<Instance> {
    const i = await this.repo().get(id);
    if (!i || i.tenantId !== this.ctx.tenantId) throw notFound('instance');
    return i;
  }

  async list(opts: ListInstancesOptions = {}): Promise<Instance[]> {
    let rows = await this.repo().query((i) => i.tenantId === this.ctx.tenantId);
    if (opts.workflowId) rows = rows.filter((i) => i.workflowId === opts.workflowId);
    if (opts.deploymentId) rows = rows.filter((i) => i.deploymentId === opts.deploymentId);
    if (opts.status) rows = rows.filter((i) => i.status === opts.status);
    if (opts.parentInstanceId !== undefined) rows = rows.filter((i) => i.parentInstanceId === opts.parentInstanceId);
    return rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private async resolveDeployment(opts: StartInstanceOptions): Promise<Deployment> {
    if (opts.deploymentId) {
      const d = await this.deployments().get(opts.deploymentId);
      if (!d || d.tenantId !== this.ctx.tenantId) throw notFound('deployment');
      return d;
    }
    if (opts.workflowId && opts.environment) {
      const rows = await this.deployments().query((d) =>
        d.tenantId === this.ctx.tenantId && d.workflowId === opts.workflowId && d.environment === opts.environment && d.status === 'active');
      if (!rows[0]) throw notFound(`active deployment for this workflow in "${opts.environment}"`);
      return rows[0];
    }
    throw validation('either deploymentId, or workflowId + environment, is required to start an instance');
  }

  async start(opts: StartInstanceOptions, actor: string): Promise<Instance> {
    const dep = await this.resolveDeployment(opts);
    const inst = await this.engine.start(dep, opts.variables || {}, actor, { processId: opts.processId, correlationKey: opts.correlationKey });
    await this.ctx.audit({ kind: 'instance.started', actor, workflowId: dep.workflowId, instanceId: inst.id });
    return inst;
  }

  private async depFor(inst: Instance): Promise<Deployment> {
    const d = await this.deployments().get(inst.deploymentId);
    if (!d) throw notFound('deployment for this instance');
    return d;
  }

  async abort(id: string, actor: string): Promise<Instance> {
    const inst = await this.get(id);
    const result = await this.engine.abortInstance(inst);
    await this.ctx.audit({ kind: 'instance.abortedByUser', actor, instanceId: id });
    return result;
  }

  async retryNode(id: string, nodeId: string, actor: string): Promise<Instance> {
    const inst = await this.get(id);
    if (inst.status !== 'failed') throw conflict('instance is not in a failed state');
    const dep = await this.depFor(inst);
    const result = await this.engine.retryNode(inst, dep, nodeId);
    await this.ctx.audit({ kind: 'instance.retried', actor, instanceId: id, data: { nodeId } });
    return result;
  }

  /** Merges `patch` into the running/waiting instance's variables. Refused on a terminal instance;
   *  refused on a `running` one unless SystemSettings.allowRunningVariableEdits is on (a genuinely
   *  running instance mutating out from under itself is a much bigger footgun than editing one that's
   *  merely parked waiting). A condition catch/boundary gets an immediate chance to notice the edit. */
  async editVariables(id: string, patch: Record<string, unknown>, actor: string): Promise<Instance> {
    const inst = await this.get(id);
    if (inst.status === 'completed' || inst.status === 'aborted' || inst.status === 'failed') throw conflict('cannot edit variables on a terminal instance');
    if (inst.status === 'running') {
      const settings = await new SettingsService(this.ctx).get();
      if (!settings.allowRunningVariableEdits) throw conflict('editing variables on a running instance is disabled by settings');
    }
    Object.assign(inst.variables, patch);
    await this.repo().put(inst);
    await this.ctx.audit({ kind: 'instance.variablesEdited', actor, instanceId: id, data: { keys: Object.keys(patch) } });
    const dep = await this.depFor(inst);
    return this.engine.recheckConditions(inst, dep);
  }

  /** Deliver a signal/message payload to exactly this instance (point-to-point — see
   *  ExecutionEngine.signalTargeted for the broadcast alternative used internally by throw/send/end). */
  async signal(id: string, name: string, payload: unknown, actor: string): Promise<Instance> {
    const inst = await this.get(id);
    const dep = await this.depFor(inst);
    await this.engine.signalTargeted(inst, dep, id, name, payload);
    await this.ctx.audit({ kind: 'instance.signaled', actor, instanceId: id, data: { name } });
    return this.get(id);
  }

  async diagram(id: string): Promise<{ activeNodeIds: string[]; visitedNodeIds: string[]; status: string }> {
    return this.engine.diagramState(await this.get(id));
  }
}
