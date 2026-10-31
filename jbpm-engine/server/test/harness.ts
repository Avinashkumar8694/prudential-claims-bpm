// Shared test harness: a real listening server over a MemoryStore, token helpers, workspaces and role members.
import http from 'node:http';
import { createApp } from '../src/app.ts';
import { MemoryStore } from '../src/store/memory-store.ts';
import { makeContext } from '../src/context.ts';
import { config } from '../src/infra/config.ts';
import { IamService } from '../src/modules/iam/service.ts';
import { TenantService } from '../src/modules/tenants/service.ts';
import { signToken } from '../src/infra/auth.ts';
import { Collections, type TenantMember } from '../src/domain.ts';

export const ROLE_NAMES = ['viewer', 'worker', 'operator', 'developer', 'author', 'release', 'admin'] as const;

/** local-source token for a principal that exists only as a workspace seat (no IAM row) */
export const tokenFor = (name: string, extra: Record<string, unknown> = {}) =>
  signToken({ sub: name, username: name, roles: [], groups: [], email: name, emailVerified: true, ...extra } as any);

export async function boot(opts: { adminPassword?: string } = {}) {
  const store = new MemoryStore();
  const ctx = makeContext({ store, tenantId: config.defaultTenant });
  await new IamService(ctx).ensureSeeded(opts.adminPassword ?? 'bootstrap-pw-123');
  const tenants = new TenantService(ctx);
  await tenants.seedDefaultsIfEmpty();
  const { app } = createApp(store);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;

  const call = async (method: string, path: string, o: { token?: string; tenant?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method, redirect: 'manual',
      headers: { ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.tenant ? { 'x-tenant-id': o.tenant } : {}), ...o.headers },
      ...(o.body !== undefined ? { body: typeof o.body === 'string' ? o.body : JSON.stringify(o.body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let body: any; try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
    return { status: res.status, body, headers: res.headers };
  };

  /** a workspace owned by `<slug>-owner`, plus one active member per role */
  const workspace = async (slug: string, roles: readonly string[] = ROLE_NAMES) => {
    const ownerEmail = `${slug}-owner@example.com`;
    const t = await tenants.signup({ name: slug, slug, ownerEmail });
    const tokens: Record<string, string> = { owner: tokenFor(ownerEmail) };
    for (const r of roles) {
      const email = `${slug}-${r}@example.com`;
      await store.repo<TenantMember>(Collections.tenantMembers).put({ id: `m-${slug}-${r}`, tenantId: t.id, userId: email, email, role: r, status: 'active', joinedAt: new Date().toISOString() });
      tokens[r] = tokenFor(email);
    }
    return { id: t.id, slug, tokens, ctx: makeContext({ store, tenantId: t.id }) };
  };

  return { store, base, call, workspace, tenants, ctx, close: () => new Promise<void>((r) => server.close(() => r())) };
}
