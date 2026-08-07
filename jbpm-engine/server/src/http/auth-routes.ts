// Public auth routes — the only endpoints reachable without a valid JWT besides /api/health. Mounted
// in app.ts BEFORE the requireAuth middleware.
import { Router } from 'express';
import type { Request } from 'express';
import { asyncHandler } from '../infra/errors.ts';
import type { AppContext } from '../context.ts';
import { IamService } from '../modules/iam/service.ts';

const ctxOf = (req: Request): AppContext => (req as any).ctx;

export function buildAuthRoutes(): Router {
  const r = Router();
  r.post('/login', asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    res.json(await new IamService(ctxOf(req)).login(String(username || ''), String(password || '')));
  }));
  return r;
}
