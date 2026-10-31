// Workspace team management (see modules/tenants/team.ts). Mounted inside the protected router, so every
// route here already has a verified caller who is an active member of the x-tenant-id workspace.
import { Router, type Request } from 'express';
import { asyncHandler } from '../infra/errors.ts';
import { ctxOf } from './route-context.ts';
import { requirePermission } from './auth-middleware.ts';
import { TeamService, type Actor } from '../modules/tenants/team.ts';
import type { JwtClaims } from '../infra/auth.ts';

const perm = requirePermission;
const actorOf = (req: Request): Actor => {
  const access = (req as any).access as { platformAdmin: boolean; member?: Actor['member'] } | undefined;
  return { member: access?.member, platformAdmin: !!access?.platformAdmin, sub: ((req as any).user as JwtClaims).sub };
};
const svc = (req: Request) => new TeamService(ctxOf(req));

export function buildTeamRoutes(): Router {
  const r = Router();
  r.get('/team/roles', perm('team:read'), asyncHandler(async (req, res) => res.json({ success: true, data: await svc(req).roles(actorOf(req)) })));
  r.get('/team/members', perm('team:read'), asyncHandler(async (req, res) => res.json({ success: true, data: await svc(req).list() })));
  r.get('/team/members/pending', perm('team:manage'), asyncHandler(async (req, res) => res.json({ success: true, data: await svc(req).list('invited') })));
  r.post('/team/members/invite', perm('team:invite'), asyncHandler(async (req, res) => res.status(201).json({ success: true, data: await svc(req).invite(actorOf(req), req.body || {}) })));
  r.put('/team/members/:id', perm('team:manage'), asyncHandler(async (req, res) => res.json({ success: true, data: await svc(req).update(actorOf(req), req.params.id, req.body || {}) })));
  r.delete('/team/members/:id', perm('team:manage'), asyncHandler(async (req, res) => { await svc(req).remove(actorOf(req), req.params.id); res.status(204).end(); }));
  r.delete('/team/members/:id/invitation', perm('team:manage'), asyncHandler(async (req, res) => { await svc(req).cancelInvitation(actorOf(req), req.params.id); res.status(204).end(); }));
  r.post('/team/members/:id/resend', perm('team:invite'), asyncHandler(async (req, res) => res.json({ success: true, data: await svc(req).resend(actorOf(req), req.params.id) })));
  // owner-only / self-only: any member may call, the service refuses everyone it does not apply to
  r.post('/team/ownership/transfer', perm('team:read'), asyncHandler(async (req, res) => res.json({ success: true, data: await svc(req).transferOwnership(actorOf(req), String(req.body?.memberId || '')) })));
  r.post('/team/leave', perm('team:read'), asyncHandler(async (req, res) => { await svc(req).leave(actorOf(req)); res.status(204).end(); }));
  return r;
}
