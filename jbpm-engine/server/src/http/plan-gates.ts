// Per-workspace request gates. Mounted after requireWorkspaceAccess, so the workspace is already verified; the platform
// administrator is exempt. Every number here is a WORKSPACE number, so it is enforced across all replicas through the
// coordinator (infra/coordinator.ts): with Redis the limits hold no matter how many pods run; without REDIS_URL it is a
// private in-memory backend (single process — the pre-cluster behaviour).
//
//   replicaPlacementGate  at most `maxReplicas` replicas serve a workspace; the rest answer 503 + Retry-After
//   planRequestGate       requestsPerMinute + concurrentRequests from the workspace's plan, cluster-wide
import type { Request, Response, NextFunction } from 'express';
import { rateLimited, replicaNotAssigned } from '../infra/errors.ts';
import type { AppContext } from '../context.ts';
import { resolvePlan } from '../modules/plans/plans.ts';
import { cap } from '../modules/plans/plan-limits.ts';
import { maxReplicasFor } from '../modules/platform/limits.ts';
import { coordinator, resetCoordinator } from '../infra/coordinator.ts';

/** test hook: counters, leases and placements all live in the coordinator now */
export function resetPlanGates(): void { resetCoordinator(); }

const exemptCtx = (ctx: AppContext) => ctx.planExempt || ctx.tenantId === 'all';

export async function replicaPlacementGate(req: Request, res: Response, next: NextFunction) {
  try {
    const ctx = (req as any).ctx as AppContext;
    const co = coordinator();
    res.setHeader('X-Served-By', co.replicaId);
    if (exemptCtx(ctx)) return next();
    const max = await maxReplicasFor(ctx.store, ctx.tenantId);
    const p = await co.place(ctx.tenantId, max);
    if (!p.ok) {
      res.setHeader('Retry-After', '1');
      return next(replicaNotAssigned(`This workspace is served by at most ${max} replica${max === 1 ? '' : 's'} and this one is not among them — retry (the load balancer should pick another).`, { maxReplicas: max, replica: co.replicaId }));
    }
    next();
  } catch (e) { next(e); }
}

export async function planRequestGate(req: Request, res: Response, next: NextFunction) {
  try {
    const ctx = (req as any).ctx as AppContext;
    if (exemptCtx(ctx)) return next();
    const plan = await resolvePlan(ctx.store, ctx.tenantId);
    const t = ctx.tenantId;
    const co = coordinator();

    const perMinute = cap(plan.limits.requestsPerMinute);
    if (perMinute !== undefined) {
      const h = await co.rate(t, perMinute);
      if (!h.ok) {
        const retry = Math.max(1, Math.ceil(h.retryMs / 1000));
        res.setHeader('Retry-After', String(retry));
        return next(rateLimited(`Plan limit reached: ${perMinute} API requests per minute on the ${plan.name} plan. Retry in ${retry}s.`));
      }
    }

    const max = cap(plan.limits.concurrentRequests);
    if (max !== undefined) {
      const release = await co.acquire('req', t, max);
      if (!release) {
        res.setHeader('Retry-After', '1');
        return next(rateLimited(`Plan limit reached: ${max} concurrent API requests on the ${plan.name} plan. Retry shortly.`));
      }
      res.on('finish', () => { void release(); }); res.on('close', () => { void release(); });
    }
    next();
  } catch (e) { next(e); }
}
