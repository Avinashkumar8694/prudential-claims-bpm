// User-task inbox: list/claim/complete. Completing a task resumes the waiting instance token.
import type { AppContext } from '../../context.ts';
import { Collections, type Task } from '../../domain.ts';
import { InstanceService } from '../instances/service.ts';
import type { EngineEvent } from '../../engine/execution-engine.ts';
import { notFound, conflict } from '../../infra/errors.ts';

export class TaskService {
  private instances: InstanceService;
  constructor(private ctx: AppContext, emit: (e: EngineEvent) => void = () => {}) {
    this.instances = new InstanceService(ctx, emit);
  }
  private repo() { return this.ctx.store.repo<Task>(Collections.tasks); }

  async get(id: string): Promise<Task> {
    const t = await this.repo().get(id);
    if (!t || t.tenantId !== this.ctx.tenantId) throw notFound('Task');
    return t;
  }

  async list(filter: { assignee?: string; group?: string; status?: string }): Promise<Task[]> {
    return (await this.repo().query((t) =>
      t.tenantId === this.ctx.tenantId &&
      (!filter.assignee || t.assignee === filter.assignee) &&
      (!filter.group || t.group === filter.group) &&
      (!filter.status || t.status === filter.status)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async claim(id: string, user: string): Promise<Task> {
    const t = await this.get(id);
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
}
