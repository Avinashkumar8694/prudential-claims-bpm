// Durable timer scheduler: fires scheduled TimerJobs whose dueAt has passed by resuming their token.
// A real interval in index.ts calls tick() periodically; tests call tick(now) with a fake clock.
import type { AppContext } from '../../context.ts';
import { Collections, type TimerJob } from '../../domain.ts';
import { InstanceService } from '../instances/service.ts';
import type { EngineEvent } from '../../engine/execution-engine.ts';
import { computeDue, parseCycleRepeatCount } from '../../engine/duration.ts';
import { notFound, conflict, validation } from '../../infra/errors.ts';

export class TimerService {
  private instances: InstanceService;
  constructor(private ctx: AppContext, emit: (e: EngineEvent) => void = () => {}) {
    this.instances = new InstanceService(ctx, emit);
  }
  private repo() { return this.ctx.store.repo<TimerJob>(Collections.timers); }

  /** Fire every scheduled timer due at or before `nowIso`; returns the number fired. */
  async tick(nowIso: string): Promise<number> {
    const due = await this.repo().query((t) => t.status === 'scheduled' && t.dueAt <= nowIso);
    let fired = 0;
    for (const job of due) {
      // Don't fire (or consume) a timer whose instance is suspended — leave it scheduled to fire on resume.
      if (job.kind !== 'start') {
        const inst = await this.instances.get(job.instanceId).catch(() => null);
        if (inst && inst.status === 'suspended') continue;
      }
      job.status = 'fired'; job.fired += 1;
      await this.repo().put(job);
      fired++;
      try {
        if (job.kind === 'start') {
          // reschedule the next occurrence in `finally`, not only on success — a single failed firing
          // (deployment archived, or now a quota rejection) must not permanently kill a recurring
          // cron/cycle start; it should just skip this occurrence and try again next time.
          try { await this.instances.startScheduled(job); }
          finally { if (job.cycle) await this.reschedule(job, nowIso); }
        } else {
          const inst = await this.instances.fireTimer(job);
          // A non-interrupting boundary timer doesn't remove its host token — if it's also declared
          // with a cycle, that means "keep pinging every period" (e.g. an SLA reminder), so reschedule
          // for the next occurrence. An interrupting boundary (or a plain catch-timer, which always
          // consumes its own wait) removes the token, so this naturally stops recurring on its own —
          // no separate "which kind was this" check needed.
          if (job.cycle && inst.tokens.some((t) => t.id === job.tokenId)) await this.reschedule(job, nowIso);
        }
      } catch { /* token gone / instance finished / deployment inactive — ignore */ }
    }
    return fired;
  }

  // --- Jobs & Timers screen ---

  async list(q: { status?: string; instanceId?: string; kind?: string } = {}): Promise<TimerJob[]> {
    return (await this.repo().query((t) =>
      t.tenantId === this.ctx.tenantId &&
      (!q.status || t.status === q.status) &&
      (!q.instanceId || t.instanceId === q.instanceId) &&
      (!q.kind || t.kind === q.kind)))
      // scheduled first (soonest due at the top), then the rest newest-first
      .sort((a, b) => (a.status === 'scheduled' ? 0 : 1) - (b.status === 'scheduled' ? 0 : 1) || a.dueAt.localeCompare(b.dueAt) * (a.status === 'scheduled' ? 1 : -1));
  }

  async getJob(id: string): Promise<TimerJob> {
    const j = await this.repo().get(id);
    if (!j || j.tenantId !== this.ctx.tenantId) throw notFound('TimerJob');
    return j;
  }

  async cancel(id: string, actor: string): Promise<TimerJob> {
    const j = await this.getJob(id);
    if (j.status !== 'scheduled') throw conflict(`job is ${j.status}, not cancellable`);
    j.status = 'cancelled';
    await this.repo().put(j);
    await this.ctx.audit({ actor, kind: 'job.cancelled', instanceId: j.instanceId || undefined, nodeId: j.nodeId, data: { jobId: id } });
    return j;
  }

  /** Fire a scheduled job right now instead of waiting for dueAt ("Trigger" on the Jobs screen). Same
   *  "leave it scheduled, don't fire" rule for a suspended instance as tick() above — a manual trigger
   *  shouldn't be able to do what the periodic poller itself refuses to do. */
  async trigger(id: string, actor: string): Promise<TimerJob> {
    const j = await this.getJob(id);
    if (j.status !== 'scheduled') throw conflict(`job is ${j.status}, not triggerable`);
    if (j.kind !== 'start') {
      const inst = await this.instances.get(j.instanceId).catch(() => null);
      if (inst && inst.status === 'suspended') throw conflict('instance is suspended; resume it before triggering this job');
    }
    j.status = 'fired'; j.fired += 1;
    await this.repo().put(j);
    await this.ctx.audit({ actor, kind: 'job.triggered', instanceId: j.instanceId || undefined, nodeId: j.nodeId, data: { jobId: id } });
    if (j.kind === 'start') await this.instances.startScheduled(j);
    else await this.instances.fireTimer(j);
    return j;
  }

  /** Move a scheduled job's fire time ("Reschedule"); also revives a cancelled job. */
  async rescheduleJob(id: string, dueAt: string, actor: string): Promise<TimerJob> {
    const j = await this.getJob(id);
    if (j.status === 'fired') throw conflict('job already fired');
    if (!dueAt || Number.isNaN(Date.parse(dueAt))) throw validation('dueAt must be an ISO date-time');
    j.dueAt = new Date(dueAt).toISOString(); j.status = 'scheduled';
    await this.repo().put(j);
    await this.ctx.audit({ actor, kind: 'job.rescheduled', instanceId: j.instanceId || undefined, nodeId: j.nodeId, data: { jobId: id, dueAt: j.dueAt } });
    return j;
  }

  /** Schedules the next occurrence of a recurring (cycled) job — unless its ISO-8601 repeat count
   *  ("R3/PT1H" = 3 times; "R/PT1H" = unbounded) has already been reached. */
  private async reschedule(job: TimerJob, nowIso: string): Promise<void> {
    const limit = parseCycleRepeatCount(job.cycle!);
    if (limit !== null && job.fired >= limit) return;
    const next: TimerJob = {
      ...job, id: this.ctx.newId(), status: 'scheduled', fired: job.fired,
      dueAt: computeDue({ cycle: job.cycle }, nowIso),
    };
    await this.repo().put(next);
  }
}
