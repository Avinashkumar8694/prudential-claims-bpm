// Lightweight in-memory sliding-window rate limiter — single-process, matching every other in-memory
// assumption this codebase already makes for its current single-instance deployment model (WS hub,
// infra/quotas.ts). Not a distributed limiter; if this server is ever run multi-instance behind a
// load balancer, this would need to move to a shared store (e.g. the same Postgres backing PgStore).
import type { Request, Response, NextFunction } from 'express';
import { rateLimited } from '../infra/errors.ts';

interface Bucket { count: number; resetAt: number; }
const buckets = new Map<string, Bucket>();

// periodic sweep so a long-running server doesn't accumulate one bucket per distinct (route, key)
// forever — unref'd so it never keeps the process (or a test importing this file) alive on its own.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 5 * 60_000).unref?.();

/** `keyOf` defaults to the authenticated user id (req.user.sub, set by requireAuth) falling back to
 *  the client IP for routes mounted BEFORE auth (e.g. /auth/login, where there's no user yet). */
export function rateLimit(opts: { windowMs: number; max: number; keyOf?: (req: Request) => string }) {
  const keyOf = opts.keyOf || ((req: Request) => (req as any).user?.sub || req.ip || 'anon');
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${req.method} ${req.baseUrl}${req.path}::${keyOf(req)}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + opts.windowMs }; buckets.set(key, b); }
    b.count += 1;
    if (b.count > opts.max) return next(rateLimited(`rate limit exceeded (max ${opts.max} per ${Math.round(opts.windowMs / 1000)}s) — try again shortly`));
    next();
  };
}
