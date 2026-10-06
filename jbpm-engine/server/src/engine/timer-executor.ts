// Polls every tenant's scheduled TimerJobs whose dueAt has passed and fires them through the engine.
// Processes jobs one at a time (not Promise.all) — different jobs almost always belong to different
// instances, but this keeps the "operations against one instance are serialized" assumption
// execution-engine.ts itself documents trivially true, with no extra locking needed.
import type { Store } from '../store/types.ts';
import type { AppContext } from '../context.ts';
import { Collections, type TimerJob, type Instance, type Deployment } from '../domain.ts';
import { ExecutionEngine, type EngineEvent } from './execution-engine.ts';
import { makeResolveCalled } from '../modules/instances/service.ts';
import { parseCycle } from './duration.ts';

export interface TimerExecutorOptions {
  store: Store;
  makeCtx: (tenantId: string) => AppContext;
  /** Same clock abstraction every AppContext already carries — defaults to real wall time. Threading
   *  it through here (rather than calling `new Date()` directly) keeps a fake-clock test run fully
   *  deterministic end to end, and matches how every other "what time is it" decision in this engine
   *  is made. */
  now?: () => string;
  emit?: (e: EngineEvent) => void;
  onError?: (job: TimerJob, err: unknown) => void;
}

async function rescheduleOrRetire(ctx: AppContext, job: TimerJob): Promise<void> {
  const repo = ctx.store.repo<TimerJob>(Collections.timers);
  if (job.kind !== 'cycle' || !job.cycle) {
    job.status = 'fired'; job.fired += 1;
    await repo.put(job);
    return;
  }
  const { count, ms } = parseCycle(job.cycle);
  const nextFired = job.fired + 1;
  job.fired = nextFired;
  if (count !== undefined && nextFired >= count) {
    job.status = 'fired';
  } else {
    job.dueAt = new Date(Date.parse(job.dueAt) + ms).toISOString();
  }
  await repo.put(job);
}

/** Returns the number of jobs actually fired this pass. A job whose instance already moved on some
 *  other way (completed/aborted/failed, or simply gone) is quietly retired rather than fired — the
 *  engine already cancels a token's own TimerJob whenever that token resolves another way, so reaching
 *  a stale job here should be rare, not the common case. */
export async function runDueTimers(opts: TimerExecutorOptions): Promise<number> {
  const { store, makeCtx, emit = () => {}, onError, now = () => new Date().toISOString() } = opts;
  const nowIso = now();
  const due = await store.repo<TimerJob>(Collections.timers).query((j) => j.status === 'scheduled' && j.dueAt <= nowIso);
  let fired = 0;
  for (const job of due) {
    const ctx = makeCtx(job.tenantId);
    const timers = ctx.store.repo<TimerJob>(Collections.timers);
    try {
      const inst = await ctx.store.repo<Instance>(Collections.instances).get(job.instanceId);
      if (!inst || (inst.status !== 'running' && inst.status !== 'waiting')) {
        job.status = 'cancelled';
        await timers.put(job);
        continue;
      }
      const dep = await ctx.store.repo<Deployment>(Collections.deployments).get(inst.deploymentId);
      if (!dep) { job.status = 'cancelled'; await timers.put(job); continue; }

      const engine = new ExecutionEngine(ctx, emit, makeResolveCalled(ctx));
      await engine.fireTimerJob(inst, dep, job.nodeId, job.tokenId);
      fired++;
      await rescheduleOrRetire(ctx, job);
    } catch (e) {
      onError?.(job, e);
      job.status = 'fired'; job.fired += 1; // don't retry a poison job forever
      await timers.put(job).catch(() => {});
    }
  }
  return fired;
}

/** Starts the polling loop on `intervalMs` (config.executorIntervalMs) and returns a stop function. */
export function startTimerExecutor(opts: TimerExecutorOptions, intervalMs: number): () => void {
  const handle = setInterval(() => {
    runDueTimers(opts).catch((e) => console.error('timer executor pass failed:', e));
  }, intervalMs);
  return () => clearInterval(handle);
}
