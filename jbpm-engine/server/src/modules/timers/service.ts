// Durable timer scheduler: fires scheduled TimerJobs whose dueAt has passed by resuming their token.
// A real interval in index.ts calls tick() periodically; tests call tick(now) with a fake clock.
import type { AppContext } from '../../context.ts';
import { Collections, type TimerJob } from '../../domain.ts';
import { InstanceService } from '../instances/service.ts';
import type { EngineEvent } from '../../engine/execution-engine.ts';
import { computeDue, parseCycleRepeatCount } from '../../engine/duration.ts';

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
          await this.instances.startScheduled(job);
          // recurring start (cron/cycle) → schedule the next occurrence
          if (job.cycle) await this.reschedule(job, nowIso);
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
