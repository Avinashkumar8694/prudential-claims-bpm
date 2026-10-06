import jwt from 'jsonwebtoken';
import type { AppContext } from '../../context.ts';
import { Collections, type User, type Group, type Role } from '../../domain.ts';
import { unauthorized, notFound, conflict, validation } from '../../infra/errors.ts';
import { config } from '../../infra/config.ts';
import { hashPassword, verifyPassword } from '../../infra/passwords.ts';

export interface AuthedUser { id: string; tenantId: string; username: string; groups: string[]; roles: string[]; }
interface JwtClaims { sub: string; tenantId: string; username: string; groups: string[]; roles: string[]; }

/** JWT sign/verify are pure functions of `config.jwtSecret` — no store access needed, so the auth
 *  middleware can verify a token (and learn which tenant it belongs to) before it has any
 *  tenant-scoped AppContext to construct an IamService with. */
export function signToken(claims: JwtClaims): string {
  return jwt.sign(claims, config.jwtSecret, { expiresIn: '8h' });
}
export function verifyToken(token: string): AuthedUser {
  try {
    const claims = jwt.verify(token, config.jwtSecret) as JwtClaims;
    return { id: claims.sub, tenantId: claims.tenantId, username: claims.username, groups: claims.groups, roles: claims.roles };
  } catch {
    throw unauthorized('invalid or expired token');
  }
}

export class IamService {
  constructor(private ctx: AppContext) {}
  private users() { return this.ctx.store.repo<User>(Collections.users); }
  private groups() { return this.ctx.store.repo<Group>(Collections.groups); }
  private roles() { return this.ctx.store.repo<Role>(Collections.roles); }

  async login(username: string, password: string): Promise<{ token: string; user: AuthedUser }> {
    const rows = await this.users().query((u) => u.tenantId === this.ctx.tenantId && u.username === username);
    const user = rows[0];
    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) throw unauthorized('invalid username or password');
    const authed: AuthedUser = { id: user.id, tenantId: user.tenantId, username: user.username, groups: user.groups, roles: user.roles };
    const token = signToken({ sub: authed.id, tenantId: authed.tenantId, username: authed.username, groups: authed.groups, roles: authed.roles });
    await this.ctx.audit({ kind: 'user.login', actor: user.username });
    return { token, user: authed };
  }

  async listUsers(): Promise<User[]> { return (await this.users().query((u) => u.tenantId === this.ctx.tenantId)).sort((a, b) => a.username.localeCompare(b.username)); }
  async listGroups(): Promise<Group[]> { return (await this.groups().query((g) => g.tenantId === this.ctx.tenantId)).sort((a, b) => a.name.localeCompare(b.name)); }
  async listRoles(): Promise<Role[]> { return (await this.roles().query((r) => r.tenantId === this.ctx.tenantId)).sort((a, b) => a.name.localeCompare(b.name)); }

  async createUser(username: string, password: string, roleNames: string[], groupNames: string[], actor: string): Promise<User> {
    if (!username.trim() || !password) throw validation('username and password are required');
    const existing = await this.users().query((u) => u.tenantId === this.ctx.tenantId && u.username === username);
    if (existing.length) throw conflict(`username "${username}" is already taken`);
    const now = this.ctx.clock();
    const user: User = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, username: username.trim(),
      passwordHash: hashPassword(password), roles: roleNames, groups: groupNames, active: true, createdAt: now,
    };
    await this.users().put(user);
    await this.ctx.audit({ kind: 'user.created', actor, data: { username: user.username } });
    return user;
  }

  async setActive(id: string, active: boolean, actor: string): Promise<User> {
    const user = await this.users().get(id);
    if (!user || user.tenantId !== this.ctx.tenantId) throw notFound('user');
    user.active = active;
    await this.users().put(user);
    await this.ctx.audit({ kind: active ? 'user.activated' : 'user.deactivated', actor, data: { username: user.username } });
    return user;
  }

  /** A `'*'` entry on any assigned role grants everything; otherwise an exact permission-string match
   *  (e.g. "workflow:edit", "task:manage" — see the real role records) on any assigned role. */
  async hasPermission(user: AuthedUser, permission: string): Promise<boolean> {
    const granted = await this.resolvePermissions(user);
    return granted.has('*') || granted.has(permission);
  }

  /** The current user's own full permission set — lets the UI show/hide controls without needing
   *  `iam:manage` just to read role definitions (most roles don't have it). */
  async resolvePermissions(user: AuthedUser): Promise<Set<string>> {
    if (!user.roles.length) return new Set();
    const roles = await this.listRoles();
    return new Set(roles.filter((r) => user.roles.includes(r.name)).flatMap((r) => r.permissions));
  }
}
