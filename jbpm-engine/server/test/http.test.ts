// Boots the REAL Express app (createApp) on an ephemeral port and drives it purely over HTTP with the
// built-in fetch — the strongest available proof that routes, auth middleware, and the service layer
// are wired together correctly, not just individually unit-tested.
import { test } from 'node:test';
import assert from 'node:assert';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { MemoryStore } from '../src/store/memory-store.ts';
import { makeContext, type AppContext } from '../src/context.ts';
import { newId, fakeClock } from '../src/infra/ids.ts';
import { hashPassword } from '../src/infra/passwords.ts';
import { Collections, type Role, type User } from '../src/domain.ts';

// Node's fetch types (unlike the DOM lib's) correctly type Response.json() as Promise<unknown> — this
// test has no dedicated response DTOs (it's exercising the wire format directly), so centralize the
// one deliberate `any` here instead of scattering casts through every call site below.
const j = (res: Response): Promise<any> => res.json();

async function bootServer() {
  const store = new MemoryStore();
  const { clock } = fakeClock();
  const makeCtx = (tenantId: string): AppContext => makeContext({ store, tenantId, clock, newId });
  const ctx = makeCtx('default');

  await ctx.store.repo<Role>(Collections.roles).put({ id: newId(), tenantId: 'default', name: 'admin', permissions: ['*'] });
  await ctx.store.repo<User>(Collections.users).put({
    id: newId(), tenantId: 'default', username: 'admin', passwordHash: hashPassword('admin-pass'),
    roles: ['admin'], groups: [], active: true, createdAt: clock(),
  });

  const app = createApp(makeCtx);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/api`;
  return { server, base };
}

async function login(base: string, username = 'admin', password = 'admin-pass') {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const body = await j(res);
  return { status: res.status, token: body.token as string | undefined, body };
}

test('the full HTTP stack: login is rejected without credentials, then the whole author->publish->deploy->run->complete lifecycle works over the wire', async () => {
  const { server, base } = await bootServer();
  try {
    const bad = await login(base, 'admin', 'wrong');
    assert.strictEqual(bad.status, 401);

    const { status, token } = await login(base);
    assert.strictEqual(status, 200);
    assert.ok(token);
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const unauthed = await fetch(`${base}/workflows`);
    assert.strictEqual(unauthed.status, 401);

    const nodeDefs = await j(await fetch(`${base}/node-defs`, { headers: auth }));
    assert.ok(Array.isArray(nodeDefs.categories) && nodeDefs.categories.includes('Events'));
    assert.ok(nodeDefs.defs.length >= 17, `expected all 17 node types, got ${nodeDefs.defs.length}`);
    const startDef = nodeDefs.defs.find((d: any) => d.engineType === 'start');
    assert.ok(startDef.palette.length > 0 && startDef.schema.length > 0);

    const created = await fetch(`${base}/workflows`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Claim Review' }) });
    assert.strictEqual(created.status, 201);
    const wf = await j(created);
    assert.strictEqual(wf.key, 'claim-review');

    const branches = await j(await fetch(`${base}/workflows/${wf.id}/branches`, { headers: auth }));
    const versions = await j(await fetch(`${base}/branches/${branches[0].id}/versions`, { headers: auth }));
    const draftId = versions[0].id;

    const process = {
      id: 'p1', name: 'Simple', vars: [{ name: 'done', type: 'Boolean' }],
      nodes: [{ id: 'start', type: 'start' }, { id: 'log', type: 'script', code: 'done = true;' }, { id: 'end', type: 'end' }],
      flows: [{ from: 'start', to: 'log' }, { from: 'log', to: 'end' }],
    };
    const saveRes = await fetch(`${base}/versions/${draftId}`, { method: 'PUT', headers: auth, body: JSON.stringify({ engine: { id: 'e1', name: 'Engine', processes: [process] } }) });
    assert.strictEqual(saveRes.status, 200);

    const publishRes = await fetch(`${base}/versions/${draftId}/publish`, { method: 'POST', headers: auth });
    assert.strictEqual(publishRes.status, 200);
    const { version } = await j(publishRes);
    assert.strictEqual(version.state, 'published');

    const deployRes = await fetch(`${base}/deployments`, { method: 'POST', headers: auth, body: JSON.stringify({ versionId: version.id, environment: 'test' }) });
    assert.strictEqual(deployRes.status, 201);
    const dep = await j(deployRes);
    assert.strictEqual(dep.status, 'active');

    const startRes = await fetch(`${base}/instances`, { method: 'POST', headers: auth, body: JSON.stringify({ deploymentId: dep.id }) });
    assert.strictEqual(startRes.status, 201);
    const inst = await j(startRes);
    assert.strictEqual(inst.status, 'completed');
    assert.strictEqual(inst.variables.done, true);

    const fetched = await j(await fetch(`${base}/instances/${inst.id}`, { headers: auth }));
    assert.strictEqual(fetched.id, inst.id);

    const notFound = await fetch(`${base}/instances/does-not-exist`, { headers: auth });
    assert.strictEqual(notFound.status, 404);
  } finally {
    server.close();
  }
});

test('a task-driven process can be claimed and completed entirely over HTTP', async () => {
  const { server, base } = await bootServer();
  try {
    const { token } = await login(base);
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const wf = await j(await fetch(`${base}/workflows`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Review Flow' }) }));
    const branches = await j(await fetch(`${base}/workflows/${wf.id}/branches`, { headers: auth }));
    const versions = await j(await fetch(`${base}/branches/${branches[0].id}/versions`, { headers: auth }));
    const process = {
      id: 'p1', vars: [{ name: 'decision', type: 'String' }],
      nodes: [{ id: 'start', type: 'start' }, { id: 'review', type: 'userTask', name: 'Review', assignee: 'admin' }, { id: 'end', type: 'end' }],
      flows: [{ from: 'start', to: 'review' }, { from: 'review', to: 'end' }],
    };
    await fetch(`${base}/versions/${versions[0].id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ engine: { id: 'e1', name: 'Engine', processes: [process] } }) });
    const { version } = await j(await fetch(`${base}/versions/${versions[0].id}/publish`, { method: 'POST', headers: auth }));
    const dep = await j(await fetch(`${base}/deployments`, { method: 'POST', headers: auth, body: JSON.stringify({ versionId: version.id, environment: 'test' }) }));
    const inst = await j(await fetch(`${base}/instances`, { method: 'POST', headers: auth, body: JSON.stringify({ deploymentId: dep.id }) }));
    assert.strictEqual(inst.status, 'waiting');

    const tasks = await j(await fetch(`${base}/tasks?instanceId=${inst.id}`, { headers: auth }));
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].status, 'reserved');
    assert.strictEqual(tasks[0].assignee, 'admin');

    const completeRes = await fetch(`${base}/tasks/${tasks[0].id}/complete`, { method: 'POST', headers: auth, body: JSON.stringify({ decision: 'approved' }) });
    assert.strictEqual(completeRes.status, 200);
    const resumed = await j(completeRes);
    assert.strictEqual(resumed.status, 'completed');
    assert.strictEqual(resumed.variables.decision, 'approved');
  } finally {
    server.close();
  }
});
