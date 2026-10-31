// Workspace team management — the zero-payment-ms TeamService model for Orkestr:
//   roles      owner (exactly one) > admin > everyone else; the fixed platform admin's `system_admin` seat is untouchable
//   invite     owner/admin invite an email with a role → status 'invited' + a single-use token (stored hashed, 7 days)
//   accept     the invitee signs in (SSO) and presents the token; their VERIFIED email must equal the invited one
//   manage     change role / remove / cancel invite / resend — only over members you may manage (canManage)
//   ownership  the owner hands the workspace to another active member (old owner becomes admin)
//   leave      anyone but the owner
// There is no mail transport in this service, so an invitation returns its one-time token/link to the inviter to deliver.
import crypto from 'node:crypto';
import type { AppContext } from '../../context.ts';
import { Collections, type Role, type Tenant, type TenantMember } from '../../domain.ts';
import { conflict, forbidden, notFound, validation } from '../../infra/errors.ts';
import { config } from '../../infra/config.ts';
import { DEFAULT_ROLES } from '../iam/service.ts';
import { isPlaceholderUserId, type Identity } from './identity.ts';

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const lower = (s?: string | null) => (s || '').trim().toLowerCase();
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export interface Actor {
  /** the caller's seat in THIS workspace (undefined for the platform admin acting from outside) */
  member?: TenantMember;
  platformAdmin: boolean;
  sub: string;
}

export interface PublicMember {
  id: string; email?: string; displayName?: string | null; role: string; status: string;
  userId?: string; joinedAt: string; lastActiveAt?: string; invitedBy?: string; invitationExpiresAt?: string | null;
}
const pub = (m: TenantMember): PublicMember => ({
  id: m.id, email: m.email, displayName: m.displayName, role: m.role, status: m.status,
  userId: isPlaceholderUserId(m) ? undefined : m.userId, joinedAt: m.joinedAt, lastActiveAt: m.lastActiveAt,
  invitedBy: m.invitedBy, invitationExpiresAt: m.invitationExpiresAt,
});

export class TeamService {
  constructor(private ctx: AppContext) {}
  private members() { return this.ctx.store.repo<TenantMember>(Collections.tenantMembers); }
  private tenants() { return this.ctx.store.repo<Tenant>(Collections.tenants); }
  private get tid() { return this.ctx.tenantId; }

  /** owner seat, or the platform admin acting on the workspace */
  private isOwner(a: Actor) { return a.member?.role === 'owner' || a.platformAdmin; }
  private isAdminish(a: Actor) { return this.isOwner(a) || a.member?.role === 'admin'; }

  /** Same rule as payment-ms's TenantMember.canManage: nobody manages themselves; nobody but the owner's transfer
   *  touches the owner; the platform-admin seat is not a workspace matter; admins can't manage other admins. */
  canManage(a: Actor, target: TenantMember): boolean {
    if (a.member && a.member.id === target.id) return false;
    if (target.role === 'owner') return false;
    if (target.role === 'system_admin') return a.platformAdmin;
    if (target.role === 'admin') return this.isOwner(a);
    return this.isAdminish(a);
  }

  /** Roles the caller may hand out: every built-in + this workspace's custom roles, never owner/system_admin, and
   *  an admin cannot mint another admin. */
  async assignableRoles(a: Actor): Promise<string[]> {
    const custom = (await this.ctx.store.repo<Role>(Collections.roles).query((r) => r.tenantId === this.tid)).map((r) => r.name);
    const all = new Set([...Object.keys(DEFAULT_ROLES), ...custom]);
    all.delete('owner'); all.delete('system_admin');
    if (!this.isOwner(a)) all.delete('admin');
    return [...all].sort();
  }

  async roles(a: Actor) {
    return { roles: ['owner', ...(await this.assignableRoles(a)).filter((r) => r !== 'owner')], assignableRoles: await this.assignableRoles(a), permissions: DEFAULT_ROLES };
  }

  async list(status?: string): Promise<PublicMember[]> {
    return (await this.members().query((m) => m.tenantId === this.tid && (!status || m.status === status)))
      .sort((x, y) => x.joinedAt.localeCompare(y.joinedAt)).map(pub);
  }

  private async get(id: string): Promise<TenantMember> {
    const m = (await this.members().get(id));
    if (!m || m.tenantId !== this.tid) throw notFound('Member');
    return m;
  }

  private async assertRole(a: Actor, role: unknown): Promise<string> {
    if (typeof role !== 'string' || !role) throw validation('role is required');
    if (role === 'owner') throw validation('There is exactly one owner — use ownership transfer');
    if (role === 'system_admin') throw validation('system_admin is not an assignable workspace role');
    if (!(await this.assignableRoles(a)).includes(role)) throw forbidden(`You cannot assign the role "${role}"`);
    return role;
  }

  // ---- invitations ----

  async invite(a: Actor, input: { email?: string; role?: string; displayName?: string }): Promise<{ member: PublicMember; invitationToken: string; invitationPath: string; expiresAt: string }> {
    const email = lower(input.email);
    if (!EMAIL.test(email)) throw validation('A valid email address is required');
    const role = await this.assertRole(a, input.role);
    if (email === config.platformAdminEmail) throw validation('That address is the platform administrator and needs no invitation');

    const existing = (await this.members().query((m) => m.tenantId === this.tid && lower(m.email) === email))[0];
    if (existing && existing.status === 'active') throw conflict(`${email} is already a member of this workspace`);
    if (existing && existing.status === 'suspended') throw conflict(`${email}'s membership is suspended — reinstate it instead of inviting again`);

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.parse(this.ctx.clock()) + INVITE_TTL_MS).toISOString();
    const member: TenantMember = existing ?? {
      id: this.ctx.newId(), tenantId: this.tid, userId: `pending:${email}`, email, role, status: 'invited',
      displayName: input.displayName?.trim() || email.split('@')[0], joinedAt: this.ctx.clock(),
    };
    // a pending invite is re-issued (resend semantics), possibly with a new role the caller is allowed to give
    if (existing && !this.canManage(a, existing)) throw forbidden('You cannot re-invite this member');
    Object.assign(member, { role, status: 'invited', invitedBy: a.member?.email || a.sub, invitationTokenHash: hash(token), invitationExpiresAt: expiresAt });
    await this.members().put(member);
    await this.ctx.audit({ actor: a.member?.email || a.sub, kind: 'team.invited', data: { email, role } });
    return { member: pub(member), invitationToken: token, invitationPath: `/accept-invite?token=${token}&workspace=${this.tid}`, expiresAt };
  }

  /** Public lookup so the accept page can say what the invitation is for. Token only; never lists the roster. */
  static async lookup(ctx: AppContext, token: string): Promise<{ workspace: { id: string; name: string }; email: string; role: string; expiresAt: string } | null> {
    const h = hash(token || '');
    const m = (await ctx.store.repo<TenantMember>(Collections.tenantMembers).query((x) => x.status === 'invited' && x.invitationTokenHash === h))[0];
    if (!m || !m.invitationExpiresAt || m.invitationExpiresAt < ctx.clock()) return null;
    const t = (await ctx.store.repo<Tenant>(Collections.tenants).query((x) => x.id === m.tenantId))[0];
    if (!t || t.status !== 'active') return null;
    return { workspace: { id: t.id, name: t.name }, email: m.email || '', role: m.role, expiresAt: m.invitationExpiresAt };
  }

  /** The invitee, signed in, presents the token. Their VERIFIED email must be the invited one; the seat is bound to their `sub`. */
  static async accept(ctx: AppContext, token: string, who: Identity & { name?: string }): Promise<TenantMember> {
    const repo = ctx.store.repo<TenantMember>(Collections.tenantMembers);
    const h = hash(token || '');
    const m = (await repo.query((x) => x.status === 'invited' && x.invitationTokenHash === h))[0];
    if (!m || !m.invitationExpiresAt || m.invitationExpiresAt < ctx.clock()) throw notFound('Invitation');
    const verified = who.source === 'oidc' ? who.emailVerified === true : true;   // local users have no email claim; username must match
    const mail = lower(who.email || who.username);
    if (!verified || mail !== lower(m.email)) throw forbidden('This invitation was sent to a different email address');
    const t = (await ctx.store.repo<Tenant>(Collections.tenants).query((x) => x.id === m.tenantId))[0];
    if (!t || t.status !== 'active') throw forbidden('This workspace is not active');
    m.userId = who.sub; m.status = 'active'; m.invitationTokenHash = null; m.invitationExpiresAt = null;
    m.joinedAt = ctx.clock(); m.lastActiveAt = ctx.clock();
    if (who.name && (!m.displayName || m.displayName === m.email?.split('@')[0])) m.displayName = who.name;
    await repo.put(m);
    return m;
  }

  async resend(a: Actor, id: string) {
    const m = await this.get(id);
    if (m.status !== 'invited') throw conflict('Only a pending invitation can be resent');
    return this.invite(a, { email: m.email, role: m.role });
  }

  async cancelInvitation(a: Actor, id: string): Promise<void> {
    const m = await this.get(id);
    if (m.status !== 'invited') throw conflict('That member has no pending invitation');
    if (!this.canManage(a, m)) throw forbidden('You cannot manage this member');
    await this.members().delete(m.id);
    await this.ctx.audit({ actor: a.member?.email || a.sub, kind: 'team.invitation_cancelled', data: { email: m.email } });
  }

  // ---- members ----

  async update(a: Actor, id: string, input: { role?: string; displayName?: string; status?: string }): Promise<PublicMember> {
    const m = await this.get(id);
    if (!this.canManage(a, m)) throw forbidden('You cannot manage this member');
    if (input.role !== undefined) { m.role = await this.assertRole(a, input.role); m.permissions = undefined; }
    if (input.displayName !== undefined) m.displayName = String(input.displayName).trim() || m.displayName;
    if (input.status !== undefined) {
      if (!['active', 'suspended'].includes(input.status) || m.status === 'invited') throw validation('status must be active or suspended (an invitation cannot be toggled)');
      m.status = input.status as TenantMember['status'];
    }
    await this.members().put(m);
    await this.ctx.audit({ actor: a.member?.email || a.sub, kind: 'team.member_updated', data: { memberId: id, role: m.role, status: m.status } });
    return pub(m);
  }

  async remove(a: Actor, id: string): Promise<void> {
    const m = await this.get(id);
    if (a.member?.id === m.id) throw forbidden('Use "leave workspace" to remove yourself');
    if (!this.canManage(a, m)) throw forbidden('You cannot manage this member');
    await this.members().delete(m.id);
    await this.ctx.audit({ actor: a.member?.email || a.sub, kind: 'team.member_removed', data: { email: m.email, role: m.role } });
  }

  async leave(a: Actor): Promise<void> {
    const m = a.member;
    if (!m) throw forbidden('You are not a member of this workspace');
    if (m.role === 'owner') throw forbidden('The owner cannot leave — transfer ownership first');
    if (m.role === 'system_admin') throw forbidden('The platform administrator seat cannot be left');
    await this.members().delete(m.id);
    await this.ctx.audit({ actor: m.email || a.sub, kind: 'team.member_left', data: { role: m.role } });
  }

  /** Owner → another ACTIVE member. The previous owner becomes admin; the workspace's ownerEmail follows. */
  async transferOwnership(a: Actor, targetId: string): Promise<{ owner: PublicMember; previousOwner?: PublicMember }> {
    if (!a.member || a.member.role !== 'owner') throw forbidden('Only the workspace owner can transfer ownership');
    const target = await this.get(targetId);
    if (target.id === a.member.id) throw validation('You already own this workspace');
    if (target.status !== 'active') throw validation('Ownership can only be transferred to an active member');
    if (target.role === 'system_admin') throw validation('The platform administrator cannot own a workspace');
    const prev = a.member;
    target.role = 'owner'; target.permissions = ['*'];
    prev.role = 'admin';
    await this.members().put(target);
    await this.members().put(prev);
    const t = (await this.tenants().query((x) => x.id === this.tid))[0];
    if (t) { t.ownerEmail = target.email || t.ownerEmail; t.ownerName = target.displayName || t.ownerName; t.updatedAt = this.ctx.clock(); await this.tenants().put(t); }
    await this.ctx.audit({ actor: prev.email || a.sub, kind: 'team.ownership_transferred', data: { to: target.email } });
    return { owner: pub(target), previousOwner: pub(prev) };
  }
}
