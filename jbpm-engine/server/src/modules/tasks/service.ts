// User-task inbox: list/claim/complete. Completing a task resumes the waiting instance token.
import type { AppContext } from '../../context.ts';
import { Collections, type AuditEvent, type Deployment, type Task, type TaskComment, type User } from '../../domain.ts';
import { InstanceService } from '../instances/service.ts';
import { NotificationService } from '../notifications/service.ts';
import type { EngineEvent } from '../../engine/execution-engine.ts';
import { notFound, conflict, forbidden, validation } from '../../infra/errors.ts';

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

  /** Every task action ultimately depends on its instance still being able to accept a resume — even
   *  ones with no direct engine effect (claim, save, delegate, remind, priority edits) are pointless or
   *  actively misleading once the instance is gone (why claim/work/get reminded about a task whose
   *  process aborted, completed via another path, or already failed?). Was previously only checked
   *  inside complete()/skip(); every other action here let a task on a dead instance stay fully
   *  actionable right up until the wall at complete()/skip() — see the audit that flagged this. Missing
   *  instance (already pruned) is left unblocked, matching complete()/skip()'s existing behavior below. */
  private async assertInstanceActionable(t: Task): Promise<void> {
    const inst = await this.instances.get(t.instanceId).catch(() => null);
    if (!inst) return;
    if (inst.status === 'suspended') throw conflict('instance is suspended');
    if (inst.status === 'aborted' || inst.status === 'completed' || inst.status === 'failed') throw conflict(`instance is ${inst.status}`);
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
    await this.assertInstanceActionable(t);
    if (t.status !== 'created' && t.status !== 'reserved') throw conflict('task not claimable');
    t.assignee = user; t.status = 'reserved';
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: 'task.claimed', instanceId: t.instanceId, taskId: t.id });
    return t;
  }

  async release(id: string, user: string): Promise<Task> {
    const t = await this.get(id);
    await this.assertInstanceActionable(t);
    t.assignee = undefined; t.status = 'created';
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: 'task.released', instanceId: t.instanceId, taskId: t.id });
    return t;
  }

  /** userTask.outputs declares processVar ← taskVar (see engine/nodes/user-task/def.ts's schema) —
   *  translate the completer's raw submission through it before it reaches instance.variables. Keys
   *  not covered by the mapping still pass through as-is, so a node with no (or a partial) `outputs`
   *  mapping keeps today's direct-passthrough behavior; only declared mappings get renamed. */
  private mapTaskOutputs(node: any, outputs: Record<string, unknown>): Record<string, unknown> {
    const mapping = node?.outputs;
    if (!mapping || typeof mapping !== 'object' || !Object.keys(mapping).length) return outputs;
    const mapped: Record<string, unknown> = { ...outputs };
    for (const [processVar, taskVar] of Object.entries(mapping)) {
      if (typeof taskVar === 'string' && taskVar in outputs) mapped[processVar] = outputs[taskVar];
    }
    return mapped;
  }

  async complete(id: string, outputs: Record<string, unknown>, user: string): Promise<Task> {
    const t = await this.get(id);
    await this.assertOwnable(t, user);
    if (t.status === 'completed') throw conflict('task already completed');
    // Refuse before mutating the task if the instance can't accept it (e.g. suspended/aborted), so a
    // failed resume can't leave the task completed but the instance un-advanced.
    await this.assertInstanceActionable(t);
    const inst = await this.instances.get(t.instanceId).catch(() => null);
    // t.outputs keeps exactly what the completer submitted (the task's own record); the mapped version
    // — process-variable-named — is what actually resumes the instance (see mapTaskOutputs above).
    let mappedOutputs = outputs;
    if (inst) {
      const dep = await this.ctx.store.repo<Deployment>(Collections.deployments).get(inst.deploymentId);
      const proc = (dep?.engine.processes || []).find((p) => p.id === inst.processId) || dep?.engine.processes?.[0];
      const node = proc?.nodes.find((n) => n.id === t.nodeId) as any;
      mappedOutputs = this.mapTaskOutputs(node, outputs);
    }
    t.status = 'completed'; t.outputs = outputs; t.completedAt = this.ctx.clock(); t.completedBy = user;
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: 'task.completed', instanceId: t.instanceId, taskId: t.id, nodeId: t.nodeId });
    // resume the instance token that was waiting on this task
    await this.instances.resume(t.instanceId, t.tokenId, mappedOutputs);
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
    await this.assertInstanceActionable(t);
    const inst = await this.instances.get(t.instanceId).catch(() => null);
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

  /** jBPM Start: reserved → inprogress (the owner begins working; Work tab shows Save/Complete). */
  async start(id: string, user: string): Promise<Task> {
    const t = await this.get(id);
    await this.assertOwnable(t, user);
    await this.assertInstanceActionable(t);
    if (t.status === 'created') { t.assignee = user; }              // start straight from Ready = implicit claim
    else if (t.status !== 'reserved') throw conflict(`task is ${t.status}, not startable`);
    else if (t.assignee !== user && t.businessAdmin !== user) throw forbidden('only the task owner can start it');
    t.status = 'inprogress';
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: 'task.started', instanceId: t.instanceId, taskId: t.id });
    return t;
  }

  /** jBPM Stop: inprogress → reserved (pause work without giving the task up). */
  async stop(id: string, user: string): Promise<Task> {
    const t = await this.get(id);
    await this.assertInstanceActionable(t);
    if (t.status !== 'inprogress') throw conflict(`task is ${t.status}, not in progress`);
    if (t.assignee !== user && t.businessAdmin !== user) throw forbidden('only the task owner can stop it');
    t.status = 'reserved';
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: 'task.stopped', instanceId: t.instanceId, taskId: t.id });
    return t;
  }

  /** Save partial output data without completing (the Work tab's Save button). */
  async saveOutputs(id: string, outputs: Record<string, unknown>, user: string): Promise<Task> {
    const t = await this.get(id);
    await this.assertOwnable(t, user);
    await this.assertInstanceActionable(t);
    if (t.status === 'completed' || t.status === 'skipped') throw conflict(`task already ${t.status}`);
    t.outputs = outputs;
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: 'task.saved', instanceId: t.instanceId, taskId: t.id });
    return t;
  }

  /** jBPM Delegate: hand the task to a specific user (goes to their inbox as reserved). */
  async delegate(id: string, to: string, user: string): Promise<Task> {
    const t = await this.get(id);
    if (!to?.trim()) throw validation('target user is required');
    await this.assertInstanceActionable(t);
    if (t.status === 'completed' || t.status === 'skipped') throw conflict(`task already ${t.status}`);
    if (t.excludedOwners?.includes(to)) throw conflict(`${to} is excluded from this task`);
    const from = t.assignee;
    t.assignee = to; t.status = 'reserved';
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: 'task.delegated', instanceId: t.instanceId, taskId: t.id, data: { from, to } });
    await new NotificationService(this.ctx).notify({
      userId: to, kind: 'task-assigned', title: `Task "${t.name}" was delegated to you`,
      body: `by ${user}`, link: `/tasks/${t.id}`, taskId: t.id, instanceId: t.instanceId,
    });
    return t;
  }

  /** jBPM Forward: push the task back to Ready in another user's or group's queue — the target must
   *  claim it (unlike delegate, which reserves it for them directly). */
  async forward(id: string, to: { user?: string; group?: string }, user: string): Promise<Task> {
    const t = await this.get(id);
    if (!to?.user?.trim() && !to?.group?.trim()) throw validation('a target user or group is required');
    await this.assertInstanceActionable(t);
    if (t.status === 'completed' || t.status === 'skipped') throw conflict(`task already ${t.status}`);
    const from = t.assignee;
    t.assignee = undefined; t.status = 'created';
    if (to.group?.trim()) t.group = to.group.trim();
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: 'task.forwarded', instanceId: t.instanceId, taskId: t.id, data: { from, to } });
    if (to.user?.trim()) {
      await new NotificationService(this.ctx).notify({
        userId: to.user.trim(), kind: 'task-assigned', title: `Task "${t.name}" was forwarded to you`,
        body: `by ${user} — claim it to start`, link: `/tasks/${t.id}`, taskId: t.id, instanceId: t.instanceId,
      });
    }
    return t;
  }

  /** Admin-tab edits: priority / due date. No behavioral effect beyond sort order and overdue flags. */
  async update(id: string, patch: { priority?: number; dueAt?: string | null }, user: string): Promise<Task> {
    const t = await this.get(id);
    await this.assertInstanceActionable(t);
    if (t.status === 'completed' || t.status === 'skipped') throw conflict(`task already ${t.status}`);
    const changed: Record<string, unknown> = {};
    if (patch.priority !== undefined) { changed.priority = { from: t.priority, to: patch.priority }; t.priority = patch.priority; }
    if (patch.dueAt !== undefined) { changed.dueAt = { from: t.dueAt, to: patch.dueAt }; t.dueAt = patch.dueAt === null ? undefined : patch.dueAt; }
    if (!Object.keys(changed).length) return t;
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: 'task.updated', instanceId: t.instanceId, taskId: t.id, data: changed });
    return t;
  }

  /** Admin-tab reminder: ping the current owner (or the group queue's members' bell is out of scope —
   *  a group-queue reminder without an owner notifies no one and is a validation error). */
  async remind(id: string, user: string): Promise<{ notified: string }> {
    const t = await this.get(id);
    await this.assertInstanceActionable(t);
    if (t.status === 'completed' || t.status === 'skipped') throw conflict(`task already ${t.status}`);
    if (!t.assignee) throw validation('task has no owner to remind — forward or delegate it instead');
    await new NotificationService(this.ctx).notify({
      userId: t.assignee, kind: 'task-reminder', title: `Reminder: "${t.name}" is waiting on you`,
      body: t.dueAt ? `due ${t.dueAt}` : undefined, link: `/tasks/${t.id}`, taskId: t.id, instanceId: t.instanceId,
    });
    await this.ctx.audit({ actor: user, kind: 'task.reminded', instanceId: t.instanceId, taskId: t.id, data: { to: t.assignee } });
    return { notified: t.assignee };
  }

  // --- comments (separate entities so they page and audit cleanly — see domain.ts TaskComment) ---
  private comments() { return this.ctx.store.repo<TaskComment>(Collections.comments); }

  async listComments(taskId: string): Promise<TaskComment[]> {
    await this.get(taskId); // 404 on unknown task
    return (await this.comments().query((c) => c.tenantId === this.ctx.tenantId && c.taskId === taskId))
      .sort((a, b) => a.at.localeCompare(b.at));
  }

  async addComment(taskId: string, body: string, author: string): Promise<TaskComment> {
    const t = await this.get(taskId);
    if (!body?.trim()) throw validation('comment body is required');
    const c: TaskComment = { id: this.ctx.newId(), tenantId: this.ctx.tenantId, taskId, author, body: body.trim(), at: this.ctx.clock() };
    await this.comments().put(c);
    await this.ctx.audit({ actor: author, kind: 'task.commented', instanceId: t.instanceId, taskId });
    return c;
  }

  async deleteComment(taskId: string, commentId: string, actor: string): Promise<void> {
    const t = await this.get(taskId);
    const c = await this.comments().get(commentId);
    if (!c || c.tenantId !== this.ctx.tenantId || c.taskId !== taskId) throw notFound('Comment');
    if (c.author !== actor && t.businessAdmin !== actor) throw forbidden('only the comment author can delete it');
    await this.comments().delete(commentId);
    await this.ctx.audit({ actor, kind: 'task.comment.deleted', instanceId: t.instanceId, taskId });
  }

  /** The Logs tab: every audit event recorded against this task, oldest first. */
  async events(taskId: string): Promise<AuditEvent[]> {
    await this.get(taskId);
    return (await this.ctx.store.repo<AuditEvent>(Collections.audit)
      .query((e) => e.tenantId === this.ctx.tenantId && e.taskId === taskId))
      .sort((a, b) => a.at.localeCompare(b.at));
  }
}
