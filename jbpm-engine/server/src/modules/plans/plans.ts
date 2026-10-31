// Plans, metered usage and the checks that enforce them.
//
//   resolvePlan(store, tenantId)  → the workspace's plan with its effective limits (cached ~2 s; a workspace row that
//                                   does not exist — bare engine contexts — resolves to "no plan = unlimited")
//   enforce*(ctx)                 → called at the point where work is created: process start, workflow create, member
//                                   invite, deploy. Refuses with 402 PLAN_EXPIRED when the plan/trial has lapsed and
//                                   with 429 QUOTA_EXCEEDED (limit, used, resetsAt) when a limit is reached.
//   reserve*                      → daily / weekly / monthly process-start counters, incremented atomically per
//                                   workspace (an in-process lock; counters live in the `usage` collection).
//
// The platform administrator (ctx.planExempt) is not subject to plan limits or expiry in any workspace.
import type { Store } from '../../store/repository.ts';
import type { AppContext } from '../../context.ts';
import { Collections, type Deployment, type Instance, type Plan, type Tenant, type TenantMember, type Usage, type Workflow } from '../../domain.ts';
import { notFound, planExpired, quotaExceeded, validation } from '../../infra/errors.ts';
import { DEFAULT_PLAN_LIMITS, LIMIT_CATALOG, PLAN_LIMIT_KEYS, TRIAL_DAYS, UNLIMITED, cap, type PlanLimitKey, type PlanLimits } from './plan-limits.ts';

export interface ResolvedPlan {
  tenant?: Tenant;
  key: string;
  name: string;
  limits: Required<PlanLimits>;
  planExpiresAt: string | null;
  expired: boolean;
}

// ---------------------------------------------------------------------------------------------- resolution
const TTL_MS = 2000;
let caches = new WeakMap<Store, Map<string, { at: number; v: ResolvedPlan }>>();
/** call after any plan / workspace-plan write so the next request sees it */
export function invalidatePlanCache(store: Store): void { caches.delete(store); }

const knownLimits = (raw: unknown): Partial<PlanLimits> => {
  const out: Partial<PlanLimits> = {};
  if (raw && typeof raw === 'object') for (const k of PLAN_LIMIT_KEYS) { const v = (raw as any)[k]; if (typeof v === 'number' && Number.isFinite(v)) out[k] = v; }
  return out;
};

export async function resolvePlan(store: Store, tenantId: string, nowMs = Date.now()): Promise<ResolvedPlan> {
  let m = caches.get(store);
  if (!m) { m = new Map(); caches.set(store, m); }
  const hit = m.get(tenantId);
  if (hit && nowMs - hit.at < TTL_MS && nowMs >= hit.at) return recompute(hit.v, nowMs);

  const tenant = tenantId === 'all' ? undefined : await store.repo<Tenant>(Collections.tenants).get(tenantId);
  let v: ResolvedPlan;
  if (!tenant) {
    v = { key: 'none', name: 'No plan', limits: DEFAULT_PLAN_LIMITS.enterprise, planExpiresAt: null, expired: false };
  } else {
    const key = tenant.plan || 'enterprise';
    const row = (await store.repo<Plan>(Collections.plans).query((p) => p.key === key))[0];
    const base = DEFAULT_PLAN_LIMITS[key] ?? DEFAULT_PLAN_LIMITS.enterprise;
    v = { tenant, key, name: row?.name ?? key, limits: { ...base, ...knownLimits(row?.limits) } as Required<PlanLimits>, planExpiresAt: tenant.planExpiresAt ?? null, expired: false };
  }
  m.set(tenantId, { at: nowMs, v });
  return recompute(v, nowMs);
}
const recompute = (v: ResolvedPlan, nowMs: number): ResolvedPlan => ({ ...v, expired: !!v.planExpiresAt && Date.parse(v.planExpiresAt) < nowMs });

// ---------------------------------------------------------------------------------------------- usage windows
const DAY = 86_400_000;
export function periodWindows(nowMs: number) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear(), mo = d.getUTCMonth();
  const dayStart = Date.UTC(y, mo, d.getUTCDate());
  const weekStart = dayStart - ((new Date(dayStart).getUTCDay() + 6) % 7) * DAY;     // ISO week: Monday
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {
    day: { key: iso(dayStart), resetsAt: new Date(dayStart + DAY).toISOString() },
    week: { key: iso(weekStart), resetsAt: new Date(weekStart + 7 * DAY).toISOString() },
    month: { key: `${y}-${String(mo + 1).padStart(2, '0')}`, resetsAt: new Date(Date.UTC(y, mo + 1, 1)).toISOString() },
  } as const;
}
const PERIODS: Array<['day' | 'week' | 'month', PlanLimitKey]> = [['day', 'instancesPerDay'], ['week', 'instancesPerWeek'], ['month', 'instancesPerMonth']];
const usageId = (tenantId: string, period: string, key: string) => `${tenantId}:${period}:${key}`;

const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return run;
}

/** Checks all three period budgets and, only if none is exhausted, counts this start in all three — atomically per workspace. */
async function reserveInstanceStart(ctx: AppContext, p: ResolvedPlan): Promise<void> {
  const nowMs = Date.parse(ctx.clock());
  const w = periodWindows(nowMs);
  const repo = ctx.store.repo<Usage>(Collections.usage);
  await withLock(ctx.tenantId, async () => {
    const docs = await Promise.all(PERIODS.map(async ([period]) => (await repo.get(usageId(ctx.tenantId, period, w[period].key))) ?? { id: usageId(ctx.tenantId, period, w[period].key), tenantId: ctx.tenantId, period, key: w[period].key, count: 0, resetsAt: w[period].resetsAt } as Usage));
    PERIODS.forEach(([period, limitKey], i) => {
      const limit = cap(p.limits[limitKey]);
      if (limit !== undefined && docs[i].count >= limit) {
        throw quotaExceeded(`Plan limit reached: ${limit} process starts per ${period} on the ${p.name} plan. It resets at ${w[period].resetsAt}.`,
          { quota: limitKey, limit, used: docs[i].count, resetsAt: w[period].resetsAt, plan: p.key });
      }
    });
    for (const d of docs) { d.count += 1; await repo.put(d); }
  });
}

// ---------------------------------------------------------------------------------------------- enforcement
const exempt = (ctx: AppContext) => !!ctx.planExempt || ctx.tenantId === 'all';

function assertActive(p: ResolvedPlan, what: string): void {
  if (p.expired) {
    throw planExpired(`Your ${p.name} plan ended on ${p.planExpiresAt!.slice(0, 10)}. Your workflows and history are kept and stay readable; choose a plan to continue ${what}.`, { plan: p.key, expiredAt: p.planExpiresAt });
  }
}
const atLimit = (what: string, limitKey: PlanLimitKey, limit: number, used: number, p: ResolvedPlan) =>
  quotaExceeded(`Plan limit reached: the ${p.name} plan allows ${what}. Remove one or upgrade your plan.`, { quota: limitKey, limit, used, plan: p.key });

export async function enforceInstanceStart(ctx: AppContext): Promise<void> {
  if (exempt(ctx)) return;
  const p = await resolvePlan(ctx.store, ctx.tenantId, Date.parse(ctx.clock()));
  if (p.key === 'none') return;
  assertActive(p, 'starting process instances');
  await reserveInstanceStart(ctx, p);
}

export async function enforceWorkflowCreate(ctx: AppContext): Promise<void> {
  if (exempt(ctx)) return;
  const p = await resolvePlan(ctx.store, ctx.tenantId, Date.parse(ctx.clock()));
  if (p.key === 'none') return;
  assertActive(p, 'creating workflows');
  const limit = cap(p.limits.maxWorkflows);
  if (limit === undefined) return;
  const used = (await ctx.store.repo<Workflow>(Collections.workflows).query((w) => w.tenantId === ctx.tenantId && !w.archived)).length;
  if (used >= limit) throw atLimit(`${limit} workflows`, 'maxWorkflows', limit, used, p);
}

export async function enforceMemberInvite(ctx: AppContext): Promise<void> {
  if (exempt(ctx)) return;
  const p = await resolvePlan(ctx.store, ctx.tenantId, Date.parse(ctx.clock()));
  if (p.key === 'none') return;
  assertActive(p, 'inviting people');
  const limit = cap(p.limits.maxTeamMembers);
  if (limit === undefined) return;
  const used = (await ctx.store.repo<TenantMember>(Collections.tenantMembers).query((m) => m.tenantId === ctx.tenantId && m.role !== 'system_admin' && (m.status === 'active' || m.status === 'invited'))).length;
  if (used >= limit) throw atLimit(`${limit} team members (including pending invitations)`, 'maxTeamMembers', limit, used, p);
}

export async function enforceDeploy(ctx: AppContext): Promise<void> {
  if (exempt(ctx)) return;
  const p = await resolvePlan(ctx.store, ctx.tenantId, Date.parse(ctx.clock()));
  if (p.key === 'none') return;
  assertActive(p, 'deploying');
  const limit = cap(p.limits.maxDeployments);
  if (limit === undefined) return;
  const used = (await ctx.store.repo<Deployment>(Collections.deployments).query((d) => d.tenantId === ctx.tenantId && d.status !== 'archived')).length;
  if (used >= limit) throw atLimit(`${limit} deployments`, 'maxDeployments', limit, used, p);
}

// ---------------------------------------------------------------------------------------------- reporting
export async function planUsageFor(ctx: AppContext) {
  const nowMs = Date.parse(ctx.clock());
  const p = await resolvePlan(ctx.store, ctx.tenantId, nowMs);
  const w = periodWindows(nowMs);
  const repo = ctx.store.repo<Usage>(Collections.usage);
  const periods: Record<string, { used: number; limit: number | null; remaining: number | null; resetsAt: string }> = {};
  for (const [period, limitKey] of PERIODS) {
    const used = (await repo.get(usageId(ctx.tenantId, period, w[period].key)))?.count ?? 0;
    const limit = cap(p.limits[limitKey]) ?? null;
    periods[period] = { used, limit, remaining: limit === null ? null : Math.max(0, limit - used), resetsAt: w[period].resetsAt };
  }
  const t = ctx.tenantId;
  const [wf, members, deps, inst, timers] = await Promise.all([
    ctx.store.repo<Workflow>(Collections.workflows).query((x) => x.tenantId === t && !x.archived),
    ctx.store.repo<TenantMember>(Collections.tenantMembers).query((m) => m.tenantId === t && m.role !== 'system_admin' && (m.status === 'active' || m.status === 'invited')),
    ctx.store.repo<Deployment>(Collections.deployments).query((d) => d.tenantId === t && d.status !== 'archived'),
    ctx.store.repo<Instance>(Collections.instances).query((i) => i.tenantId === t && !i.parentInstanceId && (i.status === 'running' || i.status === 'waiting')),
    ctx.store.repo<{ id: string; tenantId: string; status: string }>(Collections.timers).query((j) => j.tenantId === t && j.status === 'scheduled'),
  ]);
  const res = (used: number, key: PlanLimitKey) => ({ used, limit: cap(p.limits[key]) ?? null });
  return {
    plan: { key: p.key, name: p.name }, trialEndsAt: p.planExpiresAt, expired: p.expired,
    limits: Object.fromEntries(PLAN_LIMIT_KEYS.map((k) => [k, cap(p.limits[k]) ?? null])),
    usage: periods,
    resources: { workflows: res(wf.length, 'maxWorkflows'), teamMembers: res(members.length, 'maxTeamMembers'), deployments: res(deps.length, 'maxDeployments'), activeInstances: res(inst.length, 'maxActiveInstances'), activeTimers: res(timers.length, 'maxActiveTimers') },
  };
}

// ---------------------------------------------------------------------------------------------- platform administration
export class PlanService {
  constructor(private store: Store) {}
  private plans() { return this.store.repo<Plan>(Collections.plans); }
  private tenants() { return this.store.repo<Tenant>(Collections.tenants); }

  /** Idempotent seed top-up: every stored built-in plan gets the limit keys it lacks (admin-edited values are never overwritten). */
  async ensureDefaults(): Promise<void> {
    for (const row of await this.plans().query(() => true)) {
      let next: Plan = { ...row };
      if (row.key === 'trial' && row.trialDays === 14) {            // the original default trial length
        next = { ...next, trialDays: TRIAL_DAYS, description: row.description.replace('14 days', `${TRIAL_DAYS} days`) };
      }
      const defaults = DEFAULT_PLAN_LIMITS[row.key];
      if (defaults) {
        const have = knownLimits(row.limits);
        const limits: Record<string, unknown> = { ...(row.limits ?? {}) };
        delete limits.maxInstances;                                 // the old, never-enforced total
        for (const k of PLAN_LIMIT_KEYS) if (have[k] === undefined) limits[k] = defaults[k];
        next = { ...next, limits };
      }
      if (JSON.stringify(next) !== JSON.stringify(row)) await this.plans().put(next);
    }
    invalidatePlanCache(this.store);
  }

  async list() {
    const rows = await this.plans().query(() => true);
    const keys = [...new Set([...Object.keys(DEFAULT_PLAN_LIMITS), ...rows.map((r) => r.key)])];
    return keys.map((key) => {
      const row = rows.find((r) => r.key === key);
      return { key, name: row?.name ?? key, description: row?.description ?? '', public: row ? !row.hidden : false, stored: !!row,
        limits: { ...(DEFAULT_PLAN_LIMITS[key] ?? DEFAULT_PLAN_LIMITS.enterprise), ...knownLimits(row?.limits) } };
    });
  }

  async update(key: string, patch: { limits?: Record<string, unknown>; name?: string; description?: string; public?: boolean }, actor: string) {
    if (!/^[a-z][a-z0-9_-]{1,31}$/.test(key)) throw validation('plan key must be 2–32 chars: lowercase letters, digits, - or _');
    const limits: Partial<PlanLimits> = {};
    for (const [k, v] of Object.entries(patch.limits ?? {})) {
      if (!(k in LIMIT_CATALOG)) throw validation(`unknown plan limit "${k}" (known: ${PLAN_LIMIT_KEYS.join(', ')})`);
      if (typeof v !== 'number' || !Number.isInteger(v) || v < UNLIMITED) throw validation(`${k} must be an integer ≥ -1 (-1 = unlimited)`);
      limits[k as PlanLimitKey] = v;
    }
    const existing = (await this.plans().query((p) => p.key === key))[0];
    const now = new Date().toISOString();
    const row: Plan = existing
      ? { ...existing, limits: { ...(existing.limits ?? {}), ...limits } }
      : { id: `plan_${key}`, tenantId: 'system', key, name: patch.name?.trim() || key, description: '', isDefault: false, isCustom: false, trialDays: key === 'trial' ? TRIAL_DAYS : null, contactConfig: null, hidden: patch.public !== true,
          limits: { ...(DEFAULT_PLAN_LIMITS[key] ?? DEFAULT_PLAN_LIMITS.enterprise), ...limits }, features: [] };
    if (existing && typeof patch.name === 'string' && patch.name.trim()) row.name = patch.name.trim().slice(0, 80);
    if (typeof patch.description === 'string') row.description = patch.description.slice(0, 500);
    if (typeof patch.public === 'boolean') row.hidden = !patch.public;
    await this.plans().put(row);
    invalidatePlanCache(this.store);
    void now; void actor;
    return (await this.list()).find((p) => p.key === key)!;
  }

  /** Put a workspace on a plan; a trial gets its window (TRIAL_DAYS from now unless a date is given), other plans none unless given. */
  async assign(tenantId: string, plan: string, opts: { planExpiresAt?: string | null; extendDays?: number }): Promise<Tenant> {
    const t = await this.tenants().get(tenantId);
    if (!t) throw notFound('Workspace');
    const known = (await this.list()).some((p) => p.key === plan);
    if (!known) throw validation(`unknown plan "${plan}"`);
    let expires: string | null;
    if (opts.planExpiresAt !== undefined) {
      if (opts.planExpiresAt !== null && Number.isNaN(Date.parse(opts.planExpiresAt))) throw validation('planExpiresAt must be an ISO date or null');
      expires = opts.planExpiresAt;
    } else if (typeof opts.extendDays === 'number') {
      if (!Number.isFinite(opts.extendDays) || opts.extendDays < 0 || opts.extendDays > 3650) throw validation('extendDays must be between 0 and 3650');
      const base = Math.max(Date.now(), t.planExpiresAt ? Date.parse(t.planExpiresAt) : 0);
      expires = new Date(base + opts.extendDays * DAY).toISOString();
    } else {
      expires = plan === 'trial' ? new Date(Date.now() + TRIAL_DAYS * DAY).toISOString() : null;
    }
    const next: Tenant = { ...t, plan, planExpiresAt: expires, updatedAt: new Date().toISOString() };
    await this.tenants().put(next);
    invalidatePlanCache(this.store);
    return next;
  }
}
