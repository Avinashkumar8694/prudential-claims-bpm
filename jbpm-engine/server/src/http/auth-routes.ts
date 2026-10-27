// Auth routes. Mounted in app.ts BEFORE the requireAuth middleware, so /login stays reachable without
// a token; /me needs one, so it applies requireAuth itself rather than moving into the protected router
// (it's conceptually "auth", not a workflow/task/etc. resource).
import { Router } from 'express';
import type { Request } from 'express';
import { asyncHandler } from '../infra/errors.ts';
import type { AppContext } from '../context.ts';
import { IamService } from '../modules/iam/service.ts';
import { requireAuth } from './auth-middleware.ts';
import type { JwtClaims } from '../infra/auth.ts';
import { rateLimit } from './rate-limit.ts';

const ctxOf = (req: Request): AppContext => (req as any).ctx;

// per-IP (no authenticated user yet at this route) — slows credential-stuffing/brute-force without
// blocking a legitimate user who mistypes their password a few times in a row.
const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, keyOf: (req) => req.ip || 'anon' });

export function buildAuthRoutes(): Router {
  const r = Router();
  r.post('/login', loginLimiter, asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    res.json(await new IamService(ctxOf(req)).login(String(username || ''), String(password || '')));
  }));
  // "what can I actually do" — lets the frontend resolve real permissions (including custom roles
  // created later via the admin UI) instead of hardcoding a mirror of DEFAULT_ROLES.
  r.get('/me', requireAuth, asyncHandler(async (req, res) => {
    const claims = (req as any).user as JwtClaims;
    const permissions = await new IamService(ctxOf(req)).permissionsFor(claims.roles);
    res.json({ user: { id: claims.sub, username: claims.username, roles: claims.roles, groups: claims.groups }, permissions });
  }));
  // self-service — any authenticated user can change their OWN password (gated by knowing the current
  // one), independent of the admin-only POST /users/:id/password.
  r.post('/me/password', requireAuth, asyncHandler(async (req, res) => {
    const claims = (req as any).user as JwtClaims;
    await new IamService(ctxOf(req)).changeOwnPassword(claims.sub, req.body?.currentPassword, req.body?.newPassword);
    res.status(204).end();
  }));
  return r;
}
