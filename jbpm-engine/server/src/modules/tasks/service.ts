import type { AppContext } from '../../context.ts';
import { Collections, type Task, type Instance, type Deployment, inAnyTaskGroup } from '../../domain.ts';
import { notFound, conflict, forbidden } from '../../infra/errors.ts';
import { ExecutionEngine, type EngineEvent } from '../../engine/execution-engine.ts';
import { makeResolveCalled } from '../instances/service.ts';

/** `username` — NOT the store id — is what `Task.assignee`/`candidates`/`excludedOwners`/`group` are
 *  authored and compared against (a process author writes "assignee: alice", not an opaque user id;
 *  see user-task/handler.ts's own resolveRef). `groups` are group NAMES, matching User.groups. */
export interface TaskUser { username: string; groups: string[]; }
export interface ListTasksOptions { instanceId?: string; status?: Task['status']; forUser?: TaskUser; }

export class TasksService {
  private engine: ExecutionEngine;
  constructor(private ctx: AppContext, emit: (e: EngineEvent) => void = () => {}) {
    this.engine = new ExecutionEngine(ctx, emit, makeResolveCalled(ctx));
  }

  private repo() { return this.ctx.store.repo<Task>(Collections.tasks); }
  private instances() { return this.ctx.store.repo<Instance>(Collections.instances); }
  private deployments() { return this.ctx.store.repo<Deployment>(Collections.deployments); }

  async get(id: string): Promise<Task> {
    const t = await this.repo().get(id);
    if (!t || t.tenantId !== this.ctx.tenantId) throw notFound('task');
    return t;
  }

  private isPotentialOwner(t: Task, user: TaskUser): boolean {
    return t.assignee === user.username || !!t.candidates?.includes(user.username) || inAnyTaskGroup(t.group, user.groups);
  }

  private assertOwnable(t: Task, user: TaskUser): void {
    if (t.excludedOwners?.includes(user.username)) throw forbidden('you are excluded from this task');
    if (!this.isPotentialOwner(t, user)) throw forbidden('you are not a potential owner of this task');
  }

  async list(opts: ListTasksOptions = {}): Promise<Task[]> {
    let rows = await this.repo().query((t) => t.tenantId === this.ctx.tenantId);
    if (opts.instanceId) rows = rows.filter((t) => t.instanceId === opts.instanceId);
    if (opts.status) rows = rows.filter((t) => t.status === opts.status);
    if (opts.forUser) {
      const user = opts.forUser;
      rows = rows.filter((t) => this.isPotentialOwner(t, user) && !t.excludedOwners?.includes(user.username));
    }
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async claim(id: string, user: TaskUser): Promise<Task> {
    const t = await this.get(id);
    if (t.status !== 'created') throw conflict(`task is "${t.status}", not available to claim`);
    this.assertOwnable(t, user);
    t.assignee = user.username; t.status = 'reserved';
    await this.repo().put(t);
    await this.ctx.audit({ kind: 'task.claimed', actor: user.username, taskId: id, instanceId: t.instanceId });
    return t;
  }

  async release(id: string, actor: string): Promise<Task> {
    const t = await this.get(id);
    if (t.status !== 'reserved' && t.status !== 'inprogress') throw conflict(`task is "${t.status}", cannot release`);
    t.assignee = undefined; t.status = 'created';
    await this.repo().put(t);
    await this.ctx.audit({ kind: 'task.released', actor, taskId: id, instanceId: t.instanceId });
    return t;
  }

  async start(id: string, user: TaskUser): Promise<Task> {
    const t = await this.get(id);
    if (t.status !== 'reserved') throw conflict(`task must be reserved before it can be started (is "${t.status}")`);
    if (t.assignee !== user.username) throw forbidden('only the assignee can start this task');
    t.status = 'inprogress';
    await this.repo().put(t);
    return t;
  }

  /** Completes the task and resumes the waiting instance's token with `outputs` merged into its
   *  variables — the one place a Task's own lifecycle and the engine's token lifecycle meet. */
  async complete(id: string, outputs: Record<string, unknown>, user: TaskUser): Promise<Instance> {
    const t = await this.get(id);
    if (t.status !== 'reserved' && t.status !== 'inprogress') throw conflict(`task is "${t.status}", cannot complete`);
    if (t.assignee !== user.username) throw forbidden('only the assignee can complete this task');

    t.status = 'completed'; t.outputs = outputs; t.completedAt = this.ctx.clock(); t.completedBy = user.username;
    await this.repo().put(t);
    await this.ctx.audit({ kind: 'task.completed', actor: user.username, taskId: id, instanceId: t.instanceId });

    const inst = await this.instances().get(t.instanceId);
    if (!inst || inst.tenantId !== this.ctx.tenantId) throw notFound('instance for this task');
    const dep = await this.deployments().get(inst.deploymentId);
    if (!dep) throw notFound('deployment for this instance');
    return this.engine.resumeToken(inst, dep, t.tokenId, outputs);
  }

  /** Only valid for a task whose node was authored with `skippable: true` (EngineUserTask.skippable) —
   *  moves the token forward exactly like a completion, but with no outputs merged in. */
  async skip(id: string, actor: string): Promise<Instance> {
    const t = await this.get(id);
    if (t.status !== 'created' && t.status !== 'reserved' && t.status !== 'inprogress') throw conflict(`task is "${t.status}", cannot skip`);
    const inst = await this.instances().get(t.instanceId);
    if (!inst || inst.tenantId !== this.ctx.tenantId) throw notFound('instance for this task');
    const dep = await this.deployments().get(inst.deploymentId);
    if (!dep) throw notFound('deployment for this instance');
    const proc = this.engine.proc(inst, dep);
    const node = (proc.nodes || []).find((n) => n.id === t.nodeId) as any;
    if (!node?.skippable) throw conflict('this task is not skippable');

    t.status = 'skipped'; t.completedAt = this.ctx.clock(); t.completedBy = actor;
    await this.repo().put(t);
    await this.ctx.audit({ kind: 'task.skipped', actor, taskId: id, instanceId: t.instanceId });
    return this.engine.resumeToken(inst, dep, t.tokenId);
  }
}
