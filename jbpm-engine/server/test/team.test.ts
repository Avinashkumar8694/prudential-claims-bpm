// Workspace team management (payment-ms model): invite → accept, role rules, canManage, single owner,
// ownership transfer, leave, pending-invite management, expiry, and the platform-admin seat.
import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createApp } from '../src/app.ts';
import { MemoryStore } from '../src/store/memory-store.ts';
import { makeContext } from '../src/context.ts';
import { config } from '../src/infra/config.ts';
import { IamService } from '../src/modules/iam/service.ts';
import { TenantService } from '../src/modules/tenants/service.ts';
import { signToken } from '../src/infra/auth.ts';
import { PlanService } from '../src/modules/plans/plans.ts';
import { Collections, type TenantMember } from '../src/domain.ts';

let server: http.Server, base: string, store: MemoryStore, ws = '';
const tok = (name: string) => signToken({ sub: name, username: name, roles: [], groups: [], email: name, emailVerified: true });
const T = { owner: tok('owner@x.com'), admin: tok('admin@x.com'), dev: tok('dev@x.com'), viewer: tok('viewer@x.com'), invitee: tok('new@x.com'), other: tok('other@x.com') };

test.before(async () => {
  store = new MemoryStore();
  const ctx = makeContext({ store, tenantId: config.defaultTenant });
  await new IamService(ctx).ensureSeeded('bootstrap-pw-123');
  const ts = new TenantService(ctx);
  await ts.seedDefaultsIfEmpty();
  ws = (await ts.signup({ name: 'Team Co', slug: 'team-co', ownerEmail: 'owner@x.com' })).id;
  await new PlanService(store).assign(ws, 'enterprise', { planExpiresAt: null });   // these tests are about the team rules, not plan limits
  const { app } = createApp(store);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});
test.after(() => new Promise<void>((r) => server.close(() => r())));

const call = async (method: string, path: string, token: string, body?: unknown, tenant = ws) => {
  const res = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'x-tenant-id': tenant, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};
const members = () => store.repo<TenantMember>(Collections.tenantMembers).query((m) => m.tenantId === ws);
const seat = async (email: string) => (await members()).find((m) => m.email === email)!;
const addSeat = (email: string, role: string) => store.repo<TenantMember>(Collections.tenantMembers).put({ id: `s-${email}`, tenantId: ws, userId: email, email, role, status: 'active', joinedAt: new Date().toISOString() });

test('owner invites; the invite is pending, hashed at rest, and roles are validated', async () => {
  const bad = await call('POST', '/team/members/invite', T.owner, { email: 'nope', role: 'viewer' });
  assert.strictEqual(bad.status, 422);
  assert.strictEqual((await call('POST', '/team/members/invite', T.owner, { email: 'new@x.com', role: 'owner' })).status, 422, 'owner is never invitable');
  assert.strictEqual((await call('POST', '/team/members/invite', T.owner, { email: 'new@x.com', role: 'system_admin' })).status, 422);
  assert.strictEqual((await call('POST', '/team/members/invite', T.owner, { email: config.platformAdminEmail, role: 'viewer' })).status, 422);
  const ok = await call('POST', '/team/members/invite', T.owner, { email: 'New@X.com', role: 'developer' });
  assert.strictEqual(ok.status, 201);
  const { invitationToken } = ok.body.data;
  assert.ok(invitationToken.length > 30);
  const row = await seat('new@x.com');
  assert.strictEqual(row.status, 'invited');
  assert.notStrictEqual(row.invitationTokenHash, invitationToken, 'token is stored hashed');
  assert.ok(!JSON.stringify((await call('GET', '/team/members', T.owner)).body).includes(invitationToken), 'roster never exposes the token');
  assert.strictEqual((await call('GET', '/team/members/pending', T.owner)).body.data.length, 1);
  // a pending seat gives no access yet
  assert.strictEqual((await call('GET', '/workflows', T.invitee)).status, 403);
});

test('invitation lookup is public, accept needs sign-in and the matching email, token is single-use', async () => {
  const { invitationToken } = (await call('POST', '/team/members/invite', T.owner, { email: 'new@x.com', role: 'developer' })).body.data;
  const look = await fetch(`${base}/team/invitations/${invitationToken}`);
  assert.strictEqual(look.status, 200);
  const info = (await look.json() as any).data;
  assert.deepStrictEqual([info.email, info.role, info.workspace.name], ['new@x.com', 'developer', 'Team Co']);
  assert.strictEqual((await fetch(`${base}/team/invitations/garbage`)).status, 404);

  const accept = (token: string, t?: string) => fetch(`${base}/team/invitations/accept`, { method: 'POST', headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ token }) });
  assert.strictEqual((await accept(invitationToken)).status, 401, 'anonymous cannot accept');
  assert.strictEqual((await accept(invitationToken, T.other)).status, 403, 'a different email cannot use the token');
  assert.strictEqual((await accept('garbage', T.invitee)).status, 404);
  const ok = await accept(invitationToken, T.invitee);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await seat('new@x.com')).status, 'active');
  assert.strictEqual((await accept(invitationToken, T.invitee)).status, 404, 'single use');
  assert.strictEqual((await call('GET', '/workflows', T.invitee)).status, 200, 'now a member with developer rights');
  assert.strictEqual((await call('POST', '/team/members/invite', T.invitee, { email: 'z@x.com', role: 'viewer' })).status, 403, 'developers cannot invite');
  assert.strictEqual((await call('POST', '/team/members/invite', T.owner, { email: 'new@x.com', role: 'viewer' })).status, 409, 'already a member');
});

test('an expired invitation cannot be accepted or claimed', async () => {
  const { invitationToken } = (await call('POST', '/team/members/invite', T.owner, { email: 'late@x.com', role: 'viewer' })).body.data;
  const row = await seat('late@x.com');
  row.invitationExpiresAt = new Date(Date.now() - 1000).toISOString();
  await store.repo<TenantMember>(Collections.tenantMembers).put(row);
  assert.strictEqual((await fetch(`${base}/team/invitations/${invitationToken}`)).status, 404);
  const r = await fetch(`${base}/team/invitations/accept`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok('late@x.com')}` }, body: JSON.stringify({ token: invitationToken }) });
  assert.strictEqual(r.status, 404);
});

test('owner / admin / member hierarchy (canManage) and assignable roles', async () => {
  await addSeat('admin@x.com', 'admin'); await addSeat('dev@x.com', 'developer'); await addSeat('viewer@x.com', 'viewer');
  const rolesOwner = (await call('GET', '/team/roles', T.owner)).body.data.assignableRoles;
  const rolesAdmin = (await call('GET', '/team/roles', T.admin)).body.data.assignableRoles;
  assert.ok(rolesOwner.includes('admin') && !rolesOwner.includes('owner'));
  assert.ok(!rolesAdmin.includes('admin'), 'an admin cannot mint admins');

  const id = async (e: string) => (await seat(e)).id;
  assert.strictEqual((await call('POST', '/team/members/invite', T.admin, { email: 'a2@x.com', role: 'admin' })).status, 403);
  assert.strictEqual((await call('POST', '/team/members/invite', T.admin, { email: 'a2@x.com', role: 'viewer' })).status, 201);
  // admin manages non-admins; not the owner, not another admin, not themself
  assert.strictEqual((await call('PUT', `/team/members/${await id('viewer@x.com')}`, T.admin, { role: 'operator' })).status, 200);
  assert.strictEqual((await seat('viewer@x.com')).role, 'operator');
  assert.strictEqual((await call('PUT', `/team/members/${await id('owner@x.com')}`, T.admin, { role: 'viewer' })).status, 403);
  assert.strictEqual((await call('DELETE', `/team/members/${await id('owner@x.com')}`, T.admin)).status, 403);
  assert.strictEqual((await call('PUT', `/team/members/${await id('admin@x.com')}`, T.admin, { role: 'viewer' })).status, 403, 'not oneself');
  await addSeat('admin2@x.com', 'admin');
  assert.strictEqual((await call('DELETE', `/team/members/${await id('admin2@x.com')}`, T.admin)).status, 403, 'admin cannot remove an admin');
  assert.strictEqual((await call('DELETE', `/team/members/${await id('admin2@x.com')}`, T.owner)).status, 204, 'the owner can');
  // members without team:manage cannot touch anyone; role changes take effect immediately
  assert.strictEqual((await call('PUT', `/team/members/${await id('viewer@x.com')}`, T.dev, { role: 'admin' })).status, 403);
  assert.strictEqual((await call('PUT', `/team/members/${await id('dev@x.com')}`, T.owner, { role: 'viewer' })).status, 200);
  assert.strictEqual((await call('POST', '/workflows', T.dev, { name: 'x' })).status, 403, 'demoted: lost workflow:edit');
  assert.strictEqual((await call('PUT', `/team/members/${await id('dev@x.com')}`, T.owner, { role: 'owner' })).status, 422, 'a second owner is impossible');
  // suspend → no access; reinstate → access
  assert.strictEqual((await call('PUT', `/team/members/${await id('dev@x.com')}`, T.owner, { status: 'suspended' })).status, 200);
  assert.strictEqual((await call('GET', '/workflows', T.dev)).status, 403);
  assert.strictEqual((await call('PUT', `/team/members/${await id('dev@x.com')}`, T.owner, { status: 'active' })).status, 200);
  assert.strictEqual((await call('GET', '/workflows', T.dev)).status, 200);
});

test('cross-workspace: managing another workspace\'s member by id is a 404', async () => {
  const ts = new TenantService(makeContext({ store, tenantId: config.defaultTenant }));
  const other = await ts.signup({ name: 'Other Co', slug: 'other-co', ownerEmail: 'other@x.com' });
  await new PlanService(store).assign(other.id, 'enterprise', { planExpiresAt: null });
  const foreign = (await store.repo<TenantMember>(Collections.tenantMembers).query((m) => m.tenantId === other.id))[0];
  assert.strictEqual((await call('PUT', `/team/members/${foreign.id}`, T.owner, { role: 'viewer' })).status, 404);
  assert.strictEqual((await call('DELETE', `/team/members/${foreign.id}`, T.owner)).status, 404);
});

test('pending invitations: resend rotates the token, cancel removes the seat', async () => {
  const first = (await call('POST', '/team/members/invite', T.owner, { email: 'p@x.com', role: 'viewer' })).body.data;
  const mid = first.member.id;
  const again = (await call('POST', `/team/members/${mid}/resend`, T.owner)).body.data;
  assert.notStrictEqual(again.invitationToken, first.invitationToken);
  assert.strictEqual((await fetch(`${base}/team/invitations/${first.invitationToken}`)).status, 404, 'old token is dead');
  assert.strictEqual((await call('DELETE', `/team/members/${mid}/invitation`, T.owner)).status, 204);
  assert.strictEqual((await seat('p@x.com')), undefined);
});

test('leave: a member can; the owner cannot', async () => {
  await addSeat('leaver@x.com', 'worker');
  assert.strictEqual((await call('POST', '/team/leave', tok('leaver@x.com'))).status, 204);
  assert.strictEqual(await seat('leaver@x.com'), undefined);
  assert.strictEqual((await call('POST', '/team/leave', T.owner)).status, 403);
});

test('ownership transfer: owner only, to an active member; old owner becomes admin; exactly one owner remains', async () => {
  const dev = await seat('dev@x.com'), viewer = await seat('viewer@x.com');
  assert.strictEqual((await call('POST', '/team/ownership/transfer', T.admin, { memberId: dev.id })).status, 403, 'admins cannot');
  assert.strictEqual((await call('POST', '/team/ownership/transfer', T.owner, { memberId: 'nope' })).status, 404);
  await store.repo<TenantMember>(Collections.tenantMembers).put({ ...viewer, status: 'suspended' });
  assert.strictEqual((await call('POST', '/team/ownership/transfer', T.owner, { memberId: viewer.id })).status, 422, 'not to a suspended member');
  await store.repo<TenantMember>(Collections.tenantMembers).put({ ...viewer, status: 'active' });
  assert.strictEqual((await call('POST', '/team/ownership/transfer', T.owner, { memberId: dev.id })).status, 200);
  const all = await members();
  assert.deepStrictEqual(all.filter((m) => m.role === 'owner').map((m) => m.email), ['dev@x.com']);
  assert.strictEqual((await seat('owner@x.com')).role, 'admin');
  assert.strictEqual((await call('POST', '/team/ownership/transfer', T.owner, { memberId: dev.id })).status, 403, 'the former owner can no longer transfer');
  // the new owner can now manage the former owner (now an admin) and the workspace record follows
  assert.strictEqual((await call('PUT', `/team/members/${(await seat('owner@x.com')).id}`, tok('dev@x.com'), { role: 'viewer' })).status, 200);
  const t = (await store.repo<any>(Collections.tenants).query((x: any) => x.id === ws))[0];
  assert.strictEqual(t.ownerEmail, 'dev@x.com');
});
