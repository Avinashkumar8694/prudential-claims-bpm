// Who a verified caller is, in terms of workspace membership — shared by the auth middleware and the
// tenant routes so the rules live in exactly one place (they used to be copy-pasted per call site).
//
// Two kinds of caller:
//  - 'local': a user of this server's own IAM (POST /auth/login). Legacy matching is kept: a membership
//    belongs to them by user id, username, or an email equal to the username.
//  - 'oidc': a user signed in through the Identity Server. Their ONLY stable key is the `sub`; an email
//    never matches a membership on its own. A membership created ahead of time (signup, invitation,
//    platform-admin bootstrap) carries a PLACEHOLDER userId (the email, or `pending:<email>`) and is
//    BOUND to the real `sub` the first time that email shows up VERIFIED (email_verified=true) — the same
//    claim-by-verified-email rule zero-payment-ms uses. An already-bound membership is never re-bound.
import type { Store } from '../../store/repository.ts';
import { Collections, type TenantMember } from '../../domain.ts';
import type { JwtClaims } from '../../infra/auth.ts';
import { config } from '../../infra/config.ts';
import { logger } from '../../infra/logger.ts';

export type Identity = Pick<JwtClaims, 'sub' | 'username'> & Partial<Pick<JwtClaims, 'roles' | 'email' | 'emailVerified' | 'source'>>;

const lower = (s?: string | null) => (s || '').trim().toLowerCase();

export function isPlaceholderUserId(m: Pick<TenantMember, 'userId' | 'email'>): boolean {
  return !m.userId || m.userId.startsWith('pending:') || (!!m.email && lower(m.userId) === lower(m.email));
}

/** Platform administrator by local-IAM role (never derivable from an OIDC token). */
export function isLocalAdmin(id: Identity): boolean {
  return id.source !== 'oidc' && (id.username === 'admin' || (Array.isArray(id.roles) && id.roles.includes('admin')));
}

export function memberMatches(m: TenantMember, id: Identity): boolean {
  if (m.userId === id.sub) return true;
  if (id.source === 'oidc') return false;
  const names = [id.username, id.sub].map(lower).filter(Boolean);
  return names.includes(lower(m.userId)) || (!!m.email && names.includes(lower(m.email)));
}

const recentlyClaimed = new Map<string, number>();
const CLAIM_INTERVAL_MS = 30_000;

/** Bind any placeholder memberships for this verified OIDC email to the caller's `sub`. No-op for other callers. */
export async function claimMemberships(store: Store, id: Identity): Promise<void> {
  if (id.source !== 'oidc' || !id.email || id.emailVerified !== true) return;
  const now = Date.now();
  if ((recentlyClaimed.get(id.sub) ?? 0) > now - CLAIM_INTERVAL_MS) return;
  recentlyClaimed.set(id.sub, now);
  if (recentlyClaimed.size > 5000) recentlyClaimed.clear();

  const repo = store.repo<TenantMember>(Collections.tenantMembers);
  const email = lower(id.email);
  const claimable = await repo.query((m) => lower(m.email) === email && m.status !== 'suspended' && m.userId !== id.sub && isPlaceholderUserId(m));
  for (const m of claimable) {
    m.userId = id.sub;
    if (m.status === 'invited') m.status = 'active';
    m.lastActiveAt = new Date().toISOString();
    await repo.put(m);
    logger.info('membership bound to verified identity', { tenantId: m.tenantId, memberId: m.id, userId: id.sub });
  }
}

export async function membershipsOf(store: Store, id: Identity): Promise<TenantMember[]> {
  await claimMemberships(store, id);
  return store.repo<TenantMember>(Collections.tenantMembers).query((m) => memberMatches(m, id));
}

export async function isPlatformAdmin(store: Store, id: Identity, memberships?: TenantMember[]): Promise<boolean> {
  if (isLocalAdmin(id)) return true;
  const ms = memberships ?? await membershipsOf(store, id);
  return ms.some((m) => m.role === 'system_admin' && m.status === 'active');
}

/** Idempotent start-up bootstrap: PLATFORM_ADMIN_EMAIL becomes system_admin of the default workspace on first verified sign-in. */
export async function ensurePlatformAdmin(store: Store, now: string, newId: () => string): Promise<void> {
  const email = config.platformAdminEmail;
  if (!email) return;
  const repo = store.repo<TenantMember>(Collections.tenantMembers);
  const existing = await repo.query((m) => m.tenantId === config.defaultTenant && lower(m.email) === email);
  if (existing.length) return;
  await repo.put({
    id: newId(), tenantId: config.defaultTenant, userId: `pending:${email}`, email, role: 'system_admin',
    status: 'active', displayName: 'Platform Administrator', permissions: ['*'], joinedAt: now,
  });
  logger.info('platform administrator bootstrapped', { email });
}
