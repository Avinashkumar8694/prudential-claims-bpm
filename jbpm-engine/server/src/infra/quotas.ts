// In-memory per-tenant concurrency tracking for quotas that have no natural persisted row to count
// (unlike maxActiveInstances/maxActiveTimers, which are counted straight from the store at the
// moment of creation) — "how many scripts are running RIGHT NOW" is a runtime-only concept, scoped
// to this single server process. That matches the same single-process assumption the WS hub and the
// in-memory event emitter already make elsewhere in this codebase (see docs/07-security.md's
// multi-tenancy note) — a process restart naturally resets the count to zero, which is correct since
// nothing was actually still running across that restart either.
import { quotaExceeded } from './errors.ts';

const runningScripts = new Map<string, number>();

/** Reserve one concurrent-script slot for `tenantId`, or throw QUOTA_EXCEEDED if `max` (0/undefined =
 *  unlimited) is already saturated. Returns a release function — callers MUST call it exactly once,
 *  in a `finally`, whether the script succeeded, threw, or timed out. */
export function acquireScriptSlot(tenantId: string, max: number | undefined): () => void {
  const current = runningScripts.get(tenantId) || 0;
  if (max && current >= max) {
    throw quotaExceeded(`per-tenant concurrent script quota exceeded (max ${max})`, { quota: 'maxConcurrentScripts', max, current });
  }
  runningScripts.set(tenantId, current + 1);
  let released = false;
  return () => {
    if (released) return;   // guards against a caller accidentally releasing twice
    released = true;
    runningScripts.set(tenantId, Math.max(0, (runningScripts.get(tenantId) || 1) - 1));
  };
}
