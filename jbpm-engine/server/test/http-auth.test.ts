// End-to-end proof that the HTTP layer actually enforces auth: no token -> 401, wrong permission ->
// 403, valid token + granted permission -> 200. Runs a real listening server (MemoryStore-backed) and
// issues real fetch() requests — every other test in this suite calls service classes directly and
// never exercises requireAuth/requirePermission at all, so this is the only coverage for that wiring.
import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createApp } from '../src/app.ts';
import { MemoryStore } from '../src/store/memory-store.ts';
import { makeContext } from '../src/context.ts';
import { config } from '../src/infra/config.ts';
import { IamService } from '../src/modules/iam/service.ts';

let server: http.Server;
let base: string;

test.before(async () => {
  const store = new MemoryStore();
  await new IamService(makeContext({ store, tenantId: config.defaultTenant })).ensureSeeded('bootstrap-pw-123');
  await new IamService(makeContext({ store, tenantId: config.defaultTenant })).createUser({ username: 'viewer-vic', password: 'password123', roles: ['viewer'] }, 'admin');
  const { app } = createApp(store);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api`;
});
test.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const body = await res.json() as any;
  assert.strictEqual(res.status, 200, `login failed: ${JSON.stringify(body)}`);
  return body.token;
}

test('health check needs no auth', async () => {
  const res = await fetch(`${base}/health`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json() as any).ok, true);
});

test('a protected route with no Authorization header is rejected with 401', async () => {
  const res = await fetch(`${base}/workflows`);
  assert.strictEqual(res.status, 401);
});

test('an invalid/garbage token is rejected with 401', async () => {
  const res = await fetch(`${base}/workflows`, { headers: { authorization: 'Bearer not-a-real-token' } });
  assert.strictEqual(res.status, 401);
});

test('wrong username/password is rejected with 401 at login', async () => {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'wrong' }) });
  assert.strictEqual(res.status, 401);
});

test('a valid token with the admin role can list workflows (workflow:view via the * wildcard)', async () => {
  const token = await login('admin', 'bootstrap-pw-123');
  const res = await fetch(`${base}/workflows`, { headers: { authorization: `Bearer ${token}` } });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual((await res.json() as any).items, []);
});

test('a viewer role can GET workflows but is forbidden (403) from POSTing a new one', async () => {
  const token = await login('viewer-vic', 'password123');
  const getRes = await fetch(`${base}/workflows`, { headers: { authorization: `Bearer ${token}` } });
  assert.strictEqual(getRes.status, 200, 'viewer has workflow:view');

  const postRes = await fetch(`${base}/workflows`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Nope' }),
  });
  assert.strictEqual(postRes.status, 403, 'viewer lacks workflow:edit');
});

test('a viewer role is forbidden from admin-only IAM routes', async () => {
  const token = await login('viewer-vic', 'password123');
  const res = await fetch(`${base}/users`, { headers: { authorization: `Bearer ${token}` } });
  assert.strictEqual(res.status, 403);
});

test('the admin role can create a workflow end-to-end over real HTTP', async () => {
  const token = await login('admin', 'bootstrap-pw-123');
  const res = await fetch(`${base}/workflows`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'HTTP E2E WF' }),
  });
  assert.strictEqual(res.status, 201);
  const body = await res.json() as any;
  assert.strictEqual(body.name, 'HTTP E2E WF');
});
