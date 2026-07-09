// Durable timer scheduler: fires scheduled TimerJobs whose dueAt has passed by resuming their token.
// A real interval in index.ts calls tick() periodically; tests call tick(now) with a fake clock.
import type { AppContext } from '../../context.js';
import { Collections, type TimerJob } from '../../domain.js';
import { InstanceService } from '../instances/service.js';
import type { EngineEvent } from '../../engine/execution-engine.js';

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
      try { await this.instances.resume(job.instanceId, job.tokenId); }
      catch { /* token already gone / instance finished — ignore */ }
    }
    return due.length;
  }
}
