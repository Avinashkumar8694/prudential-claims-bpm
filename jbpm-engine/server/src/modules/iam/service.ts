// IAM: users, groups, roles/permissions, login. Single-tenant (this project intentionally doesn't do
// JWT-bound multi-tenancy — see docs/07-security.md) but otherwise implements the RBAC model that doc
// describes: named roles carrying permission strings, users carrying role + group names, group names
// matching the same plain strings userTask.group/Task.group already use.
import type { AppContext } from '../../context.ts';
import { Collections, type Group, type Role, type User } from '../../domain.ts';
import { hashPassword, verifyPassword, signToken, permissionGrants } from '../../infra/auth.ts';
import { notFound, validation, conflict, forbidden, authRequired, rateLimited } from '../../infra/errors.ts';
import { config } from '../../infra/config.ts';
import { sendMail } from '../../infra/mailer.ts';
import { templates } from '../../infra/mail-templates.ts';
import { passwordProblem } from '../../infra/passwords.ts';
import { AccountService } from './accounts.ts';

export { sanitize, type PublicUser, type LoginResult } from './session.ts';
import { sanitize, finishSignIn, type PublicUser, type LoginResult } from './session.ts';

/** name -> default permission set, seeded once (see ensureSeeded) if the roles collection is empty.
 *  Matches docs/07-security.md's role list exactly. */
export const DEFAULT_ROLES: Record<string, string[]> = {
  admin: ['*'],
  developer: ['workflow:view', 'workflow:edit', 'workflow:run', 'query:read', 'task:manage', 'team:read'],
  author: ['workflow:view', 'workflow:edit', 'team:read'],
  release: ['workflow:view', 'workflow:deploy', 'workflowInstance:admin', 'team:read'],
  operator: ['workflow:view', 'workflow:run', 'query:read', 'workflowInstance:manage', 'analytics:query', 'team:read'],
  worker: ['task:manage', 'workflowInstance:manage', 'team:read'],
  viewer: ['workflow:view', 'query:read', 'team:read'],
};

let _dummy: Promise<string> | undefined;
const dummyHash = () => (_dummy ??= hashPassword('not-a-real-password-0'));

export class IamService {
  constructor(private ctx: AppContext) {}
  private users() { return this.ctx.store.repo<User>(Collections.users); }
  private groups() { return this.ctx.store.repo<Group>(Collections.groups); }
  private roles() { return this.ctx.store.repo<Role>(Collections.roles); }

  /** Bootstraps a fresh deployment: default roles (if none exist) + one admin user (if no users exist
   *  at all) so there's always a way in. Call once at server startup — safe to call repeatedly
   *  (no-ops once seeded). */
  async ensureSeeded(defaultAdminPassword: string): Promise<{ seededAdmin: boolean }> {
    const existingRoles = await this.roles().query((r) => r.tenantId === this.ctx.tenantId);
    if (existingRoles.length === 0) {
      for (const [name, permissions] of Object.entries(DEFAULT_ROLES)) {
        await this.roles().put({ id: this.ctx.newId(), tenantId: this.ctx.tenantId, name, permissions });
      }
    }
    const existingUsers = await this.users().query((u) => u.tenantId === this.ctx.tenantId);
    if (existingUsers.length === 0) {
      await this.createUser({ username: 'admin', password: defaultAdminPassword, roles: ['admin'], groups: [] }, 'system');
      return { seededAdmin: true };
    }
    return { seededAdmin: false };
  }

  /** Sign in by username OR email. Wrong password / unknown account answer identically (and spend the same
   *  hashing time), repeated failures lock the account for a while, and an account whose mailbox is not yet
   *  verified cannot sign in when verification is required. */
  async login(identifier: string, password: string): Promise<LoginResult> {
    if (typeof identifier !== 'string' || typeof password !== 'string') throw authRequired('invalid username or password');
    const id = identifier.trim();
    const low = id.toLowerCase();
    let u = id ? (await this.users().query((x) => x.tenantId === this.ctx.tenantId && (x.username === id || x.username.toLowerCase() === low || (x.email || '').toLowerCase() === low)))[0] : undefined;
    // not an account yet: maybe a self-registration waiting for its emailed temporary password (confirms → creates the account)
    if (!u && id) u = await new AccountService(this.ctx).confirmPendingRegistration(low, password);
    if (!u) { await verifyPassword(password || '', await dummyHash()); throw authRequired('invalid username or password'); }

    const now = this.ctx.clock();
    if (u.lockedUntil && u.lockedUntil > now) {
      const mins = Math.max(1, Math.ceil((Date.parse(u.lockedUntil) - Date.parse(now)) / 60000));
      throw rateLimited(`Too many failed sign-in attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
    }
    const ok = u.active && await verifyPassword(password || '', u.passwordHash);
    if (!ok) {
      if (u.active) {
        u.failedLogins = (u.failedLogins ?? 0) + 1;
        if (u.failedLogins >= config.auth.maxFailedLogins) {
          u.lockedUntil = new Date(Date.parse(now) + config.auth.lockoutMinutes * 60000).toISOString();
          u.failedLogins = 0;
          await this.ctx.audit({ actor: u.username, kind: 'user.locked', data: { userId: u.id } });
          if (u.email) void sendMail(templates.accountLocked(u.email, config.auth.lockoutMinutes));
        }
        await this.users().put(u);
      }
      throw authRequired('invalid username or password');
    }
    const result = finishSignIn(u, now);
    if (u.failedLogins || u.lockedUntil) { u.failedLogins = 0; u.lockedUntil = null; await this.users().put(u); }
    return result;
  }

  /** Resolves a role-name list to its union of granted permission strings (missing/unknown role names
   *  simply contribute nothing — a deleted role silently drops from anyone still holding it). */
  async permissionsFor(roleNames: string[]): Promise<string[]> {
    if (!roleNames.length) return [];
    const rows = await this.roles().query((r) => r.tenantId === this.ctx.tenantId && roleNames.includes(r.name));
    return rows.flatMap((r) => r.permissions);
  }
  async authorize(roleNames: string[], action: string): Promise<boolean> {
    return permissionGrants(await this.permissionsFor(roleNames), action);
  }

  // ---- users ----
  async listUsers(): Promise<PublicUser[]> {
    return (await this.users().query((u) => u.tenantId === this.ctx.tenantId)).sort((a, b) => a.username.localeCompare(b.username)).map(sanitize);
  }
  async getUser(id: string): Promise<PublicUser> {
    const u = await this.users().get(id);
    if (!u || u.tenantId !== this.ctx.tenantId) throw notFound('User');
    return sanitize(u);
  }
  async createUser(input: { username: string; password: string; roles?: string[]; groups?: string[] }, actor: string): Promise<PublicUser> {
    const username = (input.username || '').trim();
    if (!username) throw validation('username is required');
    { const pp = passwordProblem(input.password, config.auth.passwordMinLength, username, false); if (pp) throw validation(pp); }
    const dupe = await this.users().query((u) => u.tenantId === this.ctx.tenantId && u.username === username);
    if (dupe.length) throw conflict(`username "${username}" already exists`);
    const u: User = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, username,
      passwordHash: await hashPassword(input.password),
      roles: input.roles || [], groups: input.groups || [], active: true, createdAt: this.ctx.clock(),
    };
    await this.users().put(u);
    await this.ctx.audit({ actor, kind: 'user.created', data: { username } });
    return sanitize(u);
  }
  async updateUser(id: string, patch: Partial<Pick<User, 'roles' | 'groups' | 'active'>>, actor: string): Promise<PublicUser> {
    const u = await this.users().get(id);
    if (!u || u.tenantId !== this.ctx.tenantId) throw notFound('User');
    if (patch.roles !== undefined) u.roles = patch.roles;
    if (patch.groups !== undefined) u.groups = patch.groups;
    if (patch.active !== undefined) u.active = patch.active;
    await this.users().put(u);
    await this.ctx.audit({ actor, kind: 'user.updated', data: { userId: id } });
    return sanitize(u);
  }
  async setPassword(id: string, newPassword: string, actor: string): Promise<void> {
    const u = await this.users().get(id);
    if (!u || u.tenantId !== this.ctx.tenantId) throw notFound('User');
    { const pp = passwordProblem(newPassword, config.auth.passwordMinLength, u.username, false); if (pp) throw validation(pp); }
    u.passwordHash = await hashPassword(newPassword);
    u.passwordChangedAt = this.ctx.clock();
    await this.users().put(u);
    await this.ctx.audit({ actor, kind: 'user.password_changed', data: { userId: id } });
    if (u.email) void sendMail(templates.passwordChanged(u.email, 'admin'));
  }

  /** Self-service variant of setPassword — for a user changing their OWN password (no admin:iam
   *  needed), gated by knowing the current password rather than by permission. */
  async changeOwnPassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
    const u = await this.users().get(id);
    if (!u || u.tenantId !== this.ctx.tenantId) throw notFound('User');
    if (!(await verifyPassword(currentPassword || '', u.passwordHash))) throw forbidden('current password is incorrect');
    { const pp = passwordProblem(newPassword, config.auth.passwordMinLength, u.username); if (pp) throw validation(pp); }
    u.passwordHash = await hashPassword(newPassword);
    u.passwordChangedAt = this.ctx.clock();
    await this.users().put(u);
    await this.ctx.audit({ actor: u.username, kind: 'user.password_changed', data: { userId: id, self: true } });
    if (u.email) void sendMail(templates.passwordChanged(u.email, 'changed'));
  }

  // ---- groups ----
  async listGroups(): Promise<Group[]> { return (await this.groups().query((g) => g.tenantId === this.ctx.tenantId)).sort((a, b) => a.name.localeCompare(b.name)); }
  async createGroup(input: { name: string; description?: string }, actor: string): Promise<Group> {
    const name = (input.name || '').trim();
    if (!name) throw validation('name is required');
    if ((await this.groups().query((g) => g.tenantId === this.ctx.tenantId && g.name === name)).length) throw conflict(`group "${name}" already exists`);
    const g: Group = { id: this.ctx.newId(), tenantId: this.ctx.tenantId, name, description: input.description };
    await this.groups().put(g);
    await this.ctx.audit({ actor, kind: 'group.created', data: { name } });
    return g;
  }
  async deleteGroup(id: string, actor: string): Promise<void> {
    const g = await this.groups().get(id);
    if (!g || g.tenantId !== this.ctx.tenantId) throw notFound('Group');
    await this.groups().delete(id);
    await this.ctx.audit({ actor, kind: 'group.deleted', data: { name: g.name } });
  }

  // ---- roles ----
  async listRoles(): Promise<Role[]> { return (await this.roles().query((r) => r.tenantId === this.ctx.tenantId)).sort((a, b) => a.name.localeCompare(b.name)); }
  async createRole(input: { name: string; permissions: string[] }, actor: string): Promise<Role> {
    const name = (input.name || '').trim();
    if (!name) throw validation('name is required');
    if ((await this.roles().query((r) => r.tenantId === this.ctx.tenantId && r.name === name)).length) throw conflict(`role "${name}" already exists`);
    const r: Role = { id: this.ctx.newId(), tenantId: this.ctx.tenantId, name, permissions: input.permissions || [] };
    await this.roles().put(r);
    await this.ctx.audit({ actor, kind: 'role.created', data: { name } });
    return r;
  }
  async updateRole(id: string, permissions: string[], actor: string): Promise<Role> {
    const r = await this.roles().get(id);
    if (!r || r.tenantId !== this.ctx.tenantId) throw notFound('Role');
    if (r.name === 'admin') throw forbidden('the admin role\'s permissions cannot be changed');
    r.permissions = permissions;
    await this.roles().put(r);
    await this.ctx.audit({ actor, kind: 'role.updated', data: { roleId: id } });
    return r;
  }
  async deleteRole(id: string, actor: string): Promise<void> {
    const r = await this.roles().get(id);
    if (!r || r.tenantId !== this.ctx.tenantId) throw notFound('Role');
    if (r.name === 'admin') throw forbidden('the admin role cannot be deleted');
    await this.roles().delete(id);
    await this.ctx.audit({ actor, kind: 'role.deleted', data: { name: r.name } });
  }
}
