import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { makeContext } from '../src/context.ts';
import { newId, fakeClock } from '../src/infra/ids.ts';
import { Collections, type Role } from '../src/domain.ts';
import { IamService, verifyToken } from '../src/modules/iam/service.ts';
import { hashPassword, verifyPassword } from '../src/infra/passwords.ts';
import { ApiError } from '../src/infra/errors.ts';

function makeIam() {
  const store = new MemoryStore();
  const ctx = makeContext({ store, tenantId: 't1', clock: fakeClock().clock, newId });
  return { ctx, iam: new IamService(ctx), store };
}

test('password hashing round-trips and rejects a wrong password', () => {
  const stored = hashPassword('correct horse battery staple');
  assert.ok(verifyPassword('correct horse battery staple', stored));
  assert.ok(!verifyPassword('wrong password', stored));
});

test('login issues a verifiable token and rejects bad credentials / inactive users', async () => {
  const { iam } = makeIam();
  await iam.createUser('alice', 'hunter2', ['author'], ['adjusters'], 'admin');

  const { token, user } = await iam.login('alice', 'hunter2');
  assert.strictEqual(user.username, 'alice');
  const claims = verifyToken(token);
  assert.strictEqual(claims.username, 'alice');
  assert.strictEqual(claims.tenantId, 't1');

  await assert.rejects(() => iam.login('alice', 'wrong'), (e: unknown) => e instanceof ApiError && e.status === 401);

  const users = await iam.listUsers();
  await iam.setActive(users[0]!.id, false, 'admin');
  await assert.rejects(() => iam.login('alice', 'hunter2'), (e: unknown) => e instanceof ApiError && e.status === 401);
});

test('permission checks match the real role/permission-string convention (resource:action, "*" for admin)', async () => {
  const { ctx, iam } = makeIam();
  const roles: Role[] = [
    { id: newId(), tenantId: 't1', name: 'admin', permissions: ['*'] },
    { id: newId(), tenantId: 't1', name: 'author', permissions: ['workflow:view', 'workflow:edit'] },
    { id: newId(), tenantId: 't1', name: 'worker', permissions: ['task:manage'] },
  ];
  for (const r of roles) await ctx.store.repo<Role>(Collections.roles).put(r);

  const admin = { id: 'u1', tenantId: 't1', username: 'admin', groups: [], roles: ['admin'] };
  const author = { id: 'u2', tenantId: 't1', username: 'author', groups: [], roles: ['author'] };
  const nobody = { id: 'u3', tenantId: 't1', username: 'nobody', groups: [], roles: [] };

  assert.ok(await iam.hasPermission(admin, 'anything:at-all'));
  assert.ok(await iam.hasPermission(author, 'workflow:edit'));
  assert.ok(!(await iam.hasPermission(author, 'task:manage')));
  assert.ok(!(await iam.hasPermission(nobody, 'workflow:view')));
});

test('verifyToken rejects a garbage token', () => {
  assert.throws(() => verifyToken('not-a-real-token'), (e: unknown) => e instanceof ApiError && e.status === 401);
});
