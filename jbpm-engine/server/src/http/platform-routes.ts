// Platform administration: governs the limits every workspace lives under. EVERY route here is reachable only by
// the fixed platform administrator (config.platformAdminEmail, verified SSO identity) — workspace owners/admins of
// any workspace, local IAM admins and everyone else get 403. See modules/platform/limits.ts for the model.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { asyncHandler, forbidden } from '../infra/errors.ts';
import type { JwtClaims } from '../infra/auth.ts';
import { isPlatformAdmin } from '../modules/tenants/identity.ts';
import { PlatformLimitsService } from '../modules/platform/limits.ts';
import type { AppContext } from '../context.ts';

export async function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = (req as any).user as JwtClaims;
    const ctx = (req as any).ctx as AppContext;
    if (!user || !(await isPlatformAdmin(ctx.store, user))) throw forbidden('Platform system administrator access required');
    next();
  } catch (e) { next(e); }
}

export function buildPlatformRoutes(): Router {
  const r = Router();
  const svc = (req: Request) => new PlatformLimitsService(((req as any).ctx as AppContext).store);
  const actor = (req: Request) => ((req as any).user as JwtClaims).email || ((req as any).user as JwtClaims).sub;

  r.get('/limits', asyncHandler(async (req, res) => res.json({ success: true, data: await svc(req).getGlobal() })));
  r.put('/limits', asyncHandler(async (req, res) => res.json({ success: true, data: await svc(req).putGlobal(req.body || {}, actor(req)) })));
  r.get('/limits/usage', asyncHandler(async (req, res) => res.json({ success: true, data: await svc(req).usage() })));
  r.get('/workspaces/:id/limits', asyncHandler(async (req, res) => res.json({ success: true, data: await svc(req).getWorkspace(req.params.id) })));
  r.put('/workspaces/:id/limits', asyncHandler(async (req, res) => res.json({ success: true, data: await svc(req).putWorkspace(req.params.id, req.body || {}, actor(req)) })));
  return r;
}
