// WS upgrade-handshake auth: same bearer token the REST API requires (see http/auth-middleware.ts's
// requireAuth — a local token or an Identity Server token), passed as a query param since browsers can't
// set an Authorization header during the WebSocket handshake itself. A socket is also bound to ONE
// workspace (?tenant=…, else the default) the caller must belong to, and may only subscribe to topics of
// instances in that workspace — otherwise any signed-in user could watch any tenant's instances by id.
import type { IncomingMessage } from 'node:http';
import { verifyBearer, type JwtClaims } from './auth.ts';
import type { Store } from '../store/repository.ts';
import { Collections, type Instance, type Tenant, type TenantMember } from '../domain.ts';
import { config } from './config.ts';
import { isPlatformAdmin, membershipsOf } from '../modules/tenants/identity.ts';

export interface WsSession { claims: JwtClaims; tenantId: string; platformAdmin: boolean }

const queryOf = (req: IncomingMessage) => new URL(req.url || '', 'http://internal').searchParams;

/** Token check only (null when missing/invalid/expired). */
export async function authenticateWsUpgrade(req: IncomingMessage): Promise<JwtClaims | null> {
  const token = queryOf(req).get('token');
  if (!token) return null;
  try { return await verifyBearer(token); } catch { return null; }
}

/** Binds the authenticated caller to the requested workspace; null when they may not use it. */
export async function authorizeWsTenant(store: Store, claims: JwtClaims, req: IncomingMessage): Promise<WsSession | null> {
  const tenantId = queryOf(req).get('tenant')?.trim() || config.defaultTenant;
  const memberships = await membershipsOf(store, claims);
  const platformAdmin = await isPlatformAdmin(store, claims, memberships);
  if (tenantId === 'all') return platformAdmin ? { claims, tenantId, platformAdmin } : null;
  const tenant = (await store.repo<Tenant>(Collections.tenants).query((t) => t.id === tenantId))[0];
  if (!tenant || tenant.status !== 'active') return null;
  const member = memberships.some((m: TenantMember) => m.tenantId === tenantId && m.status === 'active');
  return member || platformAdmin ? { claims, tenantId, platformAdmin } : null;
}

/** May this socket receive `topic`? Instance topics must belong to the socket's workspace. */
export async function canSubscribe(store: Store, s: WsSession, topic: string): Promise<boolean> {
  const m = /^instance:(.+)$/.exec(topic);
  if (!m) return false;
  const inst = await store.repo<Instance>(Collections.instances).get(m[1]);
  if (!inst) return false;
  return s.tenantId === 'all' ? s.platformAdmin : inst.tenantId === s.tenantId;
}
