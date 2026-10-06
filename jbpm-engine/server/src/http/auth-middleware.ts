import type { Request, Response, NextFunction } from 'express';
import type { AppContext } from '../context.ts';
import { IamService, verifyToken, type AuthedUser } from '../modules/iam/service.ts';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
    ctx?: AppContext;
  }
}

/** Verifies the bearer token (pure — no store access), then builds a tenant-scoped AppContext for
 *  everything downstream via the tenant id carried IN the token's own claims. */
export function requireAuth(makeCtx: (tenantId: string) => AppContext) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) { res.status(401).json({ error: 'missing bearer token' }); return; }
    try {
      const user = verifyToken(header.slice(7));
      req.user = user;
      req.ctx = makeCtx(user.tenantId);
      next();
    } catch (e) {
      res.status(401).json({ error: (e as Error).message });
    }
  };
}

export function requirePermission(permission: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.ctx) { res.status(401).json({ error: 'unauthenticated' }); return; }
    const iam = new IamService(req.ctx);
    if (!(await iam.hasPermission(req.user, permission))) { res.status(403).json({ error: `missing permission "${permission}"` }); return; }
    next();
  };
}
