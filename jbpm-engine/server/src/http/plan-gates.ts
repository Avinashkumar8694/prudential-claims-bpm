// Per-workspace request gates driven by the workspace's PLAN (concurrentRequests, requestsPerMinute). Mounted after
// requireWorkspaceAccess, so the workspace is already verified; the platform administrator is exempt. In-memory,
// per pod (the same single-process assumption as the rate limiters) — with N pods the effective limit is N×.
import type { Request, Response, NextFunction } from 'express';
import { rateLimited } from '../infra/errors.ts';
import type { AppContext } from '../context.ts';
import { resolvePlan } from '../modules/plans/plans.ts';
import { cap } from '../modules/plans/plan-limits.ts';

const inflight = new Map<string, number>();
const windows = new Map<string, { start: number; count: number }>();
setInterval(() => { const now = Date.now(); for (const [k, w] of windows) if (now - w.start > 120_000) windows.delete(k); }, 60_000).unref?.();

/** test hook */
export function resetPlanGates(): void { inflight.clear(); windows.clear(); }

export async function planRequestGate(req: Request, res: Response, next: NextFunction) {
  try {
    const ctx = (req as any).ctx as AppContext;
    if (ctx.planExempt || ctx.tenantId === 'all') return next();
    const plan = await resolvePlan(ctx.store, ctx.tenantId);
    const t = ctx.tenantId;

    const perMinute = cap(plan.limits.requestsPerMinute);
    if (perMinute !== undefined) {
      const now = Date.now();
      let w = windows.get(t);
      if (!w || now - w.start >= 60_000) { w = { start: now, count: 0 }; windows.set(t, w); }
      if (w.count >= perMinute) {
        const retry = Math.max(1, Math.ceil((w.start + 60_000 - now) / 1000));
        res.setHeader('Retry-After', String(retry));
        return next(rateLimited(`Plan limit reached: ${perMinute} API requests per minute on the ${plan.name} plan. Retry in ${retry}s.`));
      }
      w.count++;
    }

    const max = cap(plan.limits.concurrentRequests);
    if (max !== undefined) {
      const n = inflight.get(t) ?? 0;
      if (n >= max) {
        res.setHeader('Retry-After', '1');
        return next(rateLimited(`Plan limit reached: ${max} concurrent API requests on the ${plan.name} plan. Retry shortly.`));
      }
      inflight.set(t, n + 1);
      let done = false;
      const release = () => { if (done) return; done = true; const c = (inflight.get(t) ?? 1) - 1; if (c <= 0) inflight.delete(t); else inflight.set(t, c); };
      res.on('finish', release); res.on('close', release);
    }
    next();
  } catch (e) { next(e); }
}
