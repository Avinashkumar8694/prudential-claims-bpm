// Tenant & Workspace routes for multi-tenancy support
import { Router, type Request } from 'express';
import { asyncHandler } from '../infra/errors.ts';
import type { AppContext } from '../context.ts';
import { TenantService } from '../modules/tenants/service.ts';
import { TeamService } from '../modules/tenants/team.ts';
import { requireAuth } from './auth-middleware.ts';
import { verifyBearer, type JwtClaims } from '../infra/auth.ts';
import { authRequired, forbidden, notFound } from '../infra/errors.ts';
import { isPlatformAdmin } from '../modules/tenants/identity.ts';
import { oidc } from '../infra/oidc.ts';
import { rateLimit } from './rate-limit.ts';
import { Collections, type Tenant, type TenantMember, type Instance, type Task, type Deployment } from '../domain.ts';

const ctxOf = (req: Request): AppContext => (req as any).ctx;

export function buildPublicTenantRoutes(): Router {
  const r = Router();

  // Public: live address availability check for workspace signup
  r.get('/tenants/check/:slug', asyncHandler(async (req, res) => {
    const service = new TenantService(ctxOf(req));
    const result = await service.checkSlug(req.params.slug);
    res.json({ success: true, data: result });
  }));

  // Self-service workspace signup. With SSO configured the caller must be signed in: the workspace is
  // created for THEIR verified identity (no free-text owner email to squat). Without SSO (local dev) it
  // stays open, as before.
  const signupLimiter = rateLimit({ windowMs: 60_000, max: 30, keyOf: (req) => req.ip || 'anon' });
  r.post('/tenants/signup', signupLimiter, asyncHandler(async (req, res) => {
    const service = new TenantService(ctxOf(req));
    let caller: JwtClaims | undefined;
    if (oidc.isConfigured()) {
      const header = req.header('authorization') || '';
      if (!header.startsWith('Bearer ')) throw authRequired('sign in to create a workspace');
      try { caller = await verifyBearer(header.slice(7)); } catch { throw authRequired('invalid or expired token'); }
    }
    const tenant = await service.signup(req.body || {}, caller);
    res.status(201).json({ success: true, data: tenant });
  }));

  // Public: public plans for landing page pricing grid
  r.get('/public/plans', asyncHandler(async (req, res) => {
    const service = new TenantService(ctxOf(req));
    const plans = await service.listPublicPlans();
    res.json({ success: true, data: plans });
  }));

  // Public: what an invitation is for (token only — the accept page renders this before sign-in)
  r.get('/team/invitations/:token', asyncHandler(async (req, res) => {
    const info = await TeamService.lookup(ctxOf(req), req.params.token);
    if (!info) throw notFound('Invitation');
    res.json({ success: true, data: info });
  }));

  return r;
}

export function buildTenantRoutes(): Router {
  const r = Router();

  // POST /api/team/invitations/accept - the signed-in invitee presents the single-use token (identity only: no membership yet)
  r.post('/team/invitations/accept', requireAuth, asyncHandler(async (req, res) => {
    const claims = (req as any).user as JwtClaims;
    const m = await TeamService.accept(ctxOf(req), String(req.body?.token || ''), claims);
    res.json({ success: true, data: { tenantId: m.tenantId, role: m.role } });
  }));

  // GET /api/me/tenants - list of workspaces the authenticated user belongs to
  r.get('/me/tenants', requireAuth, asyncHandler(async (req, res) => {
    const claims = (req as any).user as JwtClaims;
    const requested = (req.headers['x-tenant-id'] as string | undefined)?.trim();
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 10;

    const service = new TenantService(ctxOf(req));
    const { tenants, currentTenantId } = await service.listMyTenants(claims, search, limit, requested);
    res.json({ success: true, data: tenants, currentTenantId });
  }));

  // GET /api/me/profile - member's profile & permissions in current tenant
  r.get('/me/profile', requireAuth, asyncHandler(async (req, res) => {
    const claims = (req as any).user as JwtClaims;
    const requested = (req.headers['x-tenant-id'] as string | undefined)?.trim() || ctxOf(req).tenantId;

    const service = new TenantService(ctxOf(req));
    const profile = await service.getMyProfile(claims, requested);
    res.json({ success: true, data: profile });
  }));

  // GET /api/tenants/current - selected workspace info, plan, and status
  r.get('/tenants/current', requireAuth, asyncHandler(async (req, res) => {
    const claims = (req as any).user as JwtClaims;
    const requested = (req.headers['x-tenant-id'] as string | undefined)?.trim() || ctxOf(req).tenantId;
    const service = new TenantService(ctxOf(req));
    const tenant = await service.getCurrentTenant(requested, claims);
    res.json({ success: true, data: tenant });
  }));

  // GET /api/tenants - list all user's memberships (active, pending, suspended)
  r.get('/tenants', requireAuth, asyncHandler(async (req, res) => {
    const claims = (req as any).user as JwtClaims;
    const service = new TenantService(ctxOf(req));
    const memberships = await service.listMemberships(claims);
    res.json({ success: true, data: memberships });
  }));

  // GET /api/system/stats - platform-wide workspace, member, and engine counters (system_admin only)
  r.get('/system/stats', requireAuth, asyncHandler(async (req, res) => {
    const claims = (req as any).user as JwtClaims;
    const ctx = ctxOf(req);
    if (!(await isPlatformAdmin(ctx.store, claims))) throw forbidden('Platform system administrator access required');

    const [allTenants, allMembers, allInstances, allTasks, allDeployments] = await Promise.all([
      ctx.store.repo<Tenant>(Collections.tenants).query(() => true),
      ctx.store.repo<TenantMember>(Collections.tenantMembers).query(() => true),
      ctx.store.repo<Instance>(Collections.instances).query(() => true),
      ctx.store.repo<Task>(Collections.tasks).query(() => true),
      ctx.store.repo<Deployment>(Collections.deployments).query(() => true),
    ]);

    const activeTenants = allTenants.filter((t) => t.status === 'active').length;
    const activeMembers = allMembers.filter((m) => m.status === 'active').length;
    const tenantsByPlan: Record<string, number> = {};
    for (const t of allTenants) {
      tenantsByPlan[t.plan] = (tenantsByPlan[t.plan] || 0) + 1;
    }

    res.json({
      success: true,
      data: {
        totalTenants: allTenants.length,
        activeTenants,
        totalMembers: activeMembers,
        tenantsByPlan: Object.entries(tenantsByPlan).map(([plan, count]) => ({ plan, count })),
        engine: {
          totalInstances: allInstances.length,
          activeInstances: allInstances.filter((i) => i.status === 'running' || i.status === 'waiting').length,
          totalTasks: allTasks.length,
          openTasks: allTasks.filter((t) => t.status === 'created' || t.status === 'inprogress').length,
          totalDeployments: allDeployments.length,
          activeDeployments: allDeployments.filter((d) => d.status === 'active').length,
        },
      },
    });
  }));

  return r;
}
