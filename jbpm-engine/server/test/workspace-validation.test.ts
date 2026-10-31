import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createApp } from '../src/app.ts';
import { MemoryStore } from '../src/store/memory-store.ts';
import { makeContext } from '../src/context.ts';
import { config } from '../src/infra/config.ts';
import { IamService } from '../src/modules/iam/service.ts';
import { TenantService } from '../src/modules/tenants/service.ts';

let server: http.Server;
let base: string;
let store: MemoryStore;

test.before(async () => {
  store = new MemoryStore();
  const initCtx = makeContext({ store, tenantId: config.defaultTenant });
  await new IamService(initCtx).ensureSeeded('bootstrap-pw-123');
  await new IamService(initCtx).createUser({ username: 'alice@example.com', password: 'password123', roles: ['developer'] }, 'admin');
  await new IamService(initCtx).createUser({ username: 'bob@example.com', password: 'password123', roles: ['developer'] }, 'admin');

  // Seed default tenant & plans
  await new TenantService(initCtx).seedDefaultsIfEmpty();

  const { app } = createApp(store);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api`;
});

test.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function login(username: string, password = 'password123'): Promise<string> {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = (await res.json()) as any;
  assert.strictEqual(res.status, 200, `login failed: ${JSON.stringify(body)}`);
  return body.token;
}

test('slug validation: format, length and reserved addresses', async () => {
  // Available valid slug
  const r1 = await fetch(`${base}/tenants/check/team-alpha`);
  assert.strictEqual(r1.status, 200);
  assert.strictEqual((await r1.json() as any).data.available, true);

  // Too short
  const r2 = await fetch(`${base}/tenants/check/a`);
  assert.strictEqual(r2.status, 200);
  assert.strictEqual((await r2.json() as any).data.available, false);

  // Reserved slug
  const r3 = await fetch(`${base}/tenants/check/admin`);
  assert.strictEqual(r3.status, 200);
  assert.strictEqual((await r3.json() as any).data.available, false);

  const r4 = await fetch(`${base}/tenants/check/api`);
  assert.strictEqual(r4.status, 200);
  assert.strictEqual((await r4.json() as any).data.available, false);
});

test('workspace signup validation: creates workspace and prevents conflicts', async () => {
  // 1. Invalid slug (uppercase/special characters)
  const invRes = await fetch(`${base}/tenants/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Alpha Corp', slug: 'Alpha_Corp', ownerEmail: 'alice@example.com' }),
  });
  assert.strictEqual(invRes.status, 422);

  // 2. Reserved slug rejection
  const resReserved = await fetch(`${base}/tenants/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'System Workspace', slug: 'system', ownerEmail: 'alice@example.com' }),
  });
  assert.strictEqual(resReserved.status, 422);

  // 3. Valid creation
  const okRes = await fetch(`${base}/tenants/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Alice Space', slug: 'alice-space', ownerEmail: 'alice@example.com', ownerName: 'Alice' }),
  });
  assert.strictEqual(okRes.status, 201);
  const created = (await okRes.json() as any).data;
  assert.strictEqual(created.name, 'Alice Space');
  assert.strictEqual(created.slug, 'alice-space');

  // 4. Duplicate slug returns 409 Conflict
  const dupRes = await fetch(`${base}/tenants/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Another Alice Space', slug: 'alice-space', ownerEmail: 'bob@example.com' }),
  });
  assert.strictEqual(dupRes.status, 409);
});

test('workspace access validation: members allowed, non-members blocked with 403', async () => {
  const aliceToken = await login('alice@example.com');
  const bobToken = await login('bob@example.com');
  const adminToken = await login('admin', 'bootstrap-pw-123');

  // Create workspace for Alice
  const wsRes = await fetch(`${base}/tenants/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Alice Private Org', slug: 'alice-private', ownerEmail: 'alice@example.com' }),
  });
  const aliceTenant = (await wsRes.json() as any).data;

  // Alice can access protected routes under her own workspace
  const aliceAccess = await fetch(`${base}/workflows`, {
    headers: { Authorization: `Bearer ${aliceToken}`, 'x-tenant-id': aliceTenant.id },
  });
  assert.strictEqual(aliceAccess.status, 200);

  // Bob trying to access Alice's workspace gets 403 Forbidden
  const bobAccess = await fetch(`${base}/workflows`, {
    headers: { Authorization: `Bearer ${bobToken}`, 'x-tenant-id': aliceTenant.id },
  });
  assert.strictEqual(bobAccess.status, 403);
  const bobBody = (await bobAccess.json() as any);
  assert.strictEqual(bobBody.error.message, 'You are not a member of the requested workspace.');

  // Accessing non-existent workspace returns 403
  const badWsAccess = await fetch(`${base}/workflows`, {
    headers: { Authorization: `Bearer ${aliceToken}`, 'x-tenant-id': 'non-existent-tenant-999' },
  });
  assert.strictEqual(badWsAccess.status, 403);

  // The local `admin` is NOT a platform admin (only the fixed platform-admin email is — see oidc-sso.test.ts)
  const adminAccess = await fetch(`${base}/workflows`, {
    headers: { Authorization: `Bearer ${adminToken}`, 'x-tenant-id': aliceTenant.id },
  });
  assert.strictEqual(adminAccess.status, 403);
});

test('workspace analytics: scoped per tenant; only the platform admin has platform-wide scope', async () => {
  const aliceToken = await login('alice@example.com');
  const adminToken = await login('admin', 'bootstrap-pw-123');

  // Alice can read her own workspace analytics
  const aliceAnalytics = await fetch(`${base}/query/analytics/summary`, {
    headers: { Authorization: `Bearer ${aliceToken}`, 'x-tenant-id': config.defaultTenant },
  });
  assert.strictEqual(aliceAnalytics.status, 200);
  const aliceSummary = (await aliceAnalytics.json() as any);
  assert.ok(aliceSummary.instances !== undefined);
  assert.ok(aliceSummary.tasks !== undefined);

  // Alice cannot query platform-wide scope (x-tenant-id: all) -> 403 Forbidden
  const aliceAllScope = await fetch(`${base}/query/analytics/summary`, {
    headers: { Authorization: `Bearer ${aliceToken}`, 'x-tenant-id': 'all' },
  });
  assert.strictEqual(aliceAllScope.status, 403);

  // the local admin has no platform-wide scope either
  const adminAllScope = await fetch(`${base}/query/analytics/summary`, {
    headers: { Authorization: `Bearer ${adminToken}`, 'x-tenant-id': 'all' },
  });
  assert.strictEqual(adminAllScope.status, 403);

  // Alice cannot access dedicated GET /system/stats -> 403 Forbidden
  const aliceSystemStats = await fetch(`${base}/system/stats`, {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  assert.strictEqual(aliceSystemStats.status, 403);

  // ...nor /system/stats (platform admin positive paths: oidc-sso.test.ts)
  const adminSystemStats = await fetch(`${base}/system/stats`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(adminSystemStats.status, 403);
});
