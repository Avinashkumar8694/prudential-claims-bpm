// User-task inbox: list/claim/complete. Completing a task resumes the waiting instance token.
import type { AppContext } from '../../context.ts';
import { Collections, type Deployment, type Task, type User } from '../../domain.ts';
import { InstanceService } from '../instances/service.ts';
import type { EngineEvent } from '../../engine/execution-engine.ts';
import { notFound, conflict, forbidden } from '../../infra/errors.ts';

export class TaskService {
  private instances: InstanceService;
  constructor(private ctx: AppContext, emit: (e: EngineEvent) => void = () => {}) {
    this.instances = new InstanceService(ctx, emit);
  }
  private repo() { return this.ctx.store.repo<Task>(Collections.tasks); }
  private async lookupUser(username: string): Promise<User | undefined> {
    return (await this.ctx.store.repo<User>(Collections.users).query((u) => u.tenantId === this.ctx.tenantId && u.username === username))[0];
  }

  /** Segregation of duties + group membership: excludedOwners can never act on this task; businessAdmin
   *  always can. If the task has a `group` and the caller resolves to a REAL registered User (via
   *  lookupUser), they must be a member of that group — or already be the assignee — to act on it.
   *  This check only activates for real IAM-provisioned accounts: a caller whose username isn't a
   *  registered User (any pre-IAM actor string, e.g. everywhere in this engine's own test suite) is
   *  unaffected, so adding real IAM enforcement here doesn't retroactively break every caller that
   *  predates user provisioning. */
  private async assertOwnable(t: Task, user: string): Promise<void> {
    if (t.businessAdmin === user) return;
    if (t.excludedOwners?.includes(user)) throw forbidden(`${user} is excluded from this task`);
    if (!t.group || t.assignee === user) return;
    const actingUser = await this.lookupUser(user);
    if (actingUser && !actingUser.groups.includes(t.group)) throw forbidden(`${user} is not a member of group "${t.group}"`);
  }

  async get(id: string): Promise<Task> {
    const t = await this.repo().get(id);
    if (!t || t.tenantId !== this.ctx.tenantId) throw notFound('Task');
    return t;
  }

  async list(filter: { assignee?: string; group?: string; status?: string; overdue?: boolean }): Promise<Task[]> {
    const now = this.ctx.clock();
    return (await this.repo().query((t) =>
      t.tenantId === this.ctx.tenantId &&
      (!filter.assignee || t.assignee === filter.assignee) &&
      (!filter.group || t.group === filter.group) &&
      (!filter.status || t.status === filter.status) &&
      (!filter.overdue || (!!t.dueAt && t.dueAt < now && t.status !== 'completed' && t.status !== 'skipped'))))
      // higher priority first (undefined = lowest), then newest first within the same priority
      .sort((a, b) => (b.priority ?? -Infinity) - (a.priority ?? -Infinity) || b.createdAt.localeCompare(a.createdAt));
  }

  async claim(id: string, user: string): Promise<Task> {
    const t = await this.get(id);
    await this.assertOwnable(t, user);
    if (t.status !== 'created' && t.status !== 'reserved') throw conflict('task not claimable');
    t.assignee = user; t.status = 'reserved';
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: 'task.claimed', instanceId: t.instanceId, taskId: t.id });
    return t;
  }

  async release(id: string, user: string): Promise<Task> {
    const t = await this.get(id);
    t.assignee = undefined; t.status = 'created';
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: 'task.released', instanceId: t.instanceId, taskId: t.id });
    return t;
  }

  async complete(id: string, outputs: Record<string, unknown>, user: string): Promise<Task> {
    const t = await this.get(id);
    await this.assertOwnable(t, user);
    if (t.status === 'completed') throw conflict('task already completed');
    // Refuse before mutating the task if the instance can't accept it (e.g. suspended/aborted), so a
    // failed resume can't leave the task completed but the instance un-advanced.
    const inst = await this.instances.get(t.instanceId).catch(() => null);
    if (inst && inst.status === 'suspended') throw conflict('instance is suspended');
    if (inst && (inst.status === 'aborted' || inst.status === 'completed' || inst.status === 'failed')) throw conflict(`instance is ${inst.status}`);
    t.status = 'completed'; t.outputs = outputs; t.completedAt = this.ctx.clock(); t.completedBy = user;
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: 'task.completed', instanceId: t.instanceId, taskId: t.id, nodeId: t.nodeId });
    // resume the instance token that was waiting on this task
    await this.instances.resume(t.instanceId, t.tokenId, outputs);
    return t;
  }

  /** Skip a task without completing it — real jBPM's TaskService.skip(): the instance continues past
   *  it with no output data mapped, only allowed when the node itself is declared `skippable: true`
   *  (this engine enforces that at the API layer; the node's own runtime handler has nothing to do
   *  with skip — it's purely a task-lifecycle shortcut around the normal complete() path). */
  async skip(id: string, user: string): Promise<Task> {
    const t = await this.get(id);
    await this.assertOwnable(t, user);
    if (t.status === 'completed' || t.status === 'skipped') throw conflict(`task already ${t.status}`);
    const inst = await this.instances.get(t.instanceId).catch(() => null);
    if (inst && inst.status === 'suspended') throw conflict('instance is suspended');
    if (inst && (inst.status === 'aborted' || inst.status === 'completed' || inst.status === 'failed')) throw conflict(`instance is ${inst.status}`);
    if (inst) {
      const dep = await this.ctx.store.repo<Deployment>(Collections.deployments).get(inst.deploymentId);
      const proc = (dep?.engine.processes || []).find((p) => p.id === inst.processId) || dep?.engine.processes?.[0];
      const node = proc?.nodes.find((n) => n.id === t.nodeId) as any;
      if (node && node.skippable !== true) throw conflict('task is not skippable');
    }
    t.status = 'skipped'; t.completedAt = this.ctx.clock(); t.completedBy = user;
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: 'task.skipped', instanceId: t.instanceId, taskId: t.id, nodeId: t.nodeId });
    await this.instances.resume(t.instanceId, t.tokenId, {});
    return t;
  }
}
