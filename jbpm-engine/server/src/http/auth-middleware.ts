// Express auth middleware: verifies the bearer JWT (requireAuth) and checks role-granted permissions
// (requirePermission) against the IAM roles collection. Wired in app.ts / routes.ts. Replaces the
// previous "trust whatever X-User header the caller sends" actor resolution entirely.
import type { Request, Response, NextFunction } from 'express';
import { verifyToken, permissionGrants } from '../infra/auth.ts';
import { authRequired, forbidden } from '../infra/errors.ts';
import { Collections, type Role } from '../domain.ts';
import type { AppContext } from '../context.ts';

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) return next(authRequired());
  try {
    const claims = verifyToken(token);
    (req as any).user = claims;
    (req as any).actor = claims.username;   // routes.ts's actorOf(req) keeps working unchanged
    next();
  } catch {
    next(authRequired('invalid or expired token'));
  }
}

/** Must run after requireAuth (needs req.user) and the ctx-attaching middleware (needs req.ctx for a
 *  tenant-scoped role lookup) — both already true for anything mounted under app.ts's protected `/api`
 *  router. Resolves the caller's role NAMES (from their JWT) to permission sets via the roles
 *  collection (see modules/iam/service.ts's DEFAULT_ROLES for the seeded set), same as
 *  IamService.authorize() — kept separate since this one is Express-shaped (middleware, not a promise
 *  the caller awaits directly) and has no reason to depend on the rest of IamService. */
export function requirePermission(action: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user as { roles: string[] } | undefined;
      if (!user) throw authRequired();
      const ctx = (req as any).ctx as AppContext;
      const roles = await ctx.store.repo<Role>(Collections.roles).query((r) => r.tenantId === ctx.tenantId && user.roles.includes(r.name));
      const perms = roles.flatMap((r) => r.permissions);
      if (!permissionGrants(perms, action)) throw forbidden(`missing permission: ${action}`);
      next();
    } catch (e) { next(e); }
  };
}
