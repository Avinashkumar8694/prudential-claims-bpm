// Durable timer scheduler: fires scheduled TimerJobs whose dueAt has passed by resuming their token.
// A real interval in index.ts calls tick() periodically; tests call tick(now) with a fake clock.
import type { AppContext } from '../../context.ts';
import { Collections, type TimerJob } from '../../domain.ts';
import { InstanceService } from '../instances/service.ts';
import type { EngineEvent } from '../../engine/execution-engine.ts';
import { computeDue } from '../../engine/duration.ts';

export class TimerService {
  private instances: InstanceService;
  constructor(private ctx: AppContext, emit: (e: EngineEvent) => void = () => {}) {
    this.instances = new InstanceService(ctx, emit);
  }
  private repo() { return this.ctx.store.repo<TimerJob>(Collections.timers); }

  /** Fire every scheduled timer due at or before `nowIso`; returns the number fired. */
  async tick(nowIso: string): Promise<number> {
    const due = await this.repo().query((t) => t.status === 'scheduled' && t.dueAt <= nowIso);
    for (const job of due) {
      job.status = 'fired'; job.fired += 1;
      await this.repo().put(job);
      try {
        if (job.kind === 'start') {
          await this.instances.startScheduled(job);
          // recurring start (cron/cycle) → schedule the next occurrence
          if (job.cycle) await this.reschedule(job, nowIso);
        } else {
          await this.instances.fireTimer(job);
        }
      } catch { /* token gone / instance finished / deployment inactive — ignore */ }
    }
    return due.length;
  }

  private async reschedule(job: TimerJob, nowIso: string): Promise<void> {
    const next: TimerJob = {
      ...job, id: this.ctx.newId(), status: 'scheduled', fired: 0,
      dueAt: computeDue({ cycle: job.cycle }, nowIso),
    };
    await this.repo().put(next);
  }
}
