// PgStore against a REAL Postgres (see jbpm-engine/docker-compose.yml — `npm run docker:up` first).
// Opt-in: `npm run test:pg`, not part of the default `npm test` glob, since it needs a live database.
import { test } from 'node:test';
import assert from 'node:assert';
import { PgStore } from '../../src/store/pg-store.ts';
import { config } from '../../src/infra/config.ts';

const PG_URL = config.pgUrl!;
const COLLECTION = `test_kv_${Date.now()}`;

type Widget = { id: string; tenantId: string; name: string; count: number };

let store: PgStore;
test.before(async () => { store = new PgStore(PG_URL); });
test.after(async () => { await store.close(); });

test('put/get round-trips a full JSON document through Postgres', async () => {
  const repo = store.repo<Widget>(COLLECTION);
  const w: Widget = { id: 'w1', tenantId: 't1', name: 'Gadget', count: 3 };
  await repo.put(w);
  const back = await repo.get('w1');
  assert.deepStrictEqual(back, w);
});

test('get returns undefined for a missing id', async () => {
  const repo = store.repo<Widget>(COLLECTION);
  assert.strictEqual(await repo.get('does-not-exist'), undefined);
});

test('put on an existing id overwrites (upsert), not duplicates', async () => {
  const repo = store.repo<Widget>(COLLECTION);
  await repo.put({ id: 'w2', tenantId: 't1', name: 'v1', count: 1 });
  await repo.put({ id: 'w2', tenantId: 't1', name: 'v2', count: 2 });
  assert.deepStrictEqual(await repo.get('w2'), { id: 'w2', tenantId: 't1', name: 'v2', count: 2 });
  assert.strictEqual((await repo.list()).filter((w) => w.id === 'w2').length, 1);
});

test('query filters in-memory with an arbitrary JS predicate, same as FileStore/MemoryStore', async () => {
  const repo = store.repo<Widget>(COLLECTION);
  await repo.put({ id: 'w3', tenantId: 't2', name: 'Alpha', count: 10 });
  await repo.put({ id: 'w4', tenantId: 't2', name: 'Beta', count: 20 });
  const found = await repo.query((w) => w.tenantId === 't2' && w.count > 15);
  assert.deepStrictEqual(found.map((w) => w.id), ['w4']);
});

test('delete removes the row; a second delete reports nothing affected', async () => {
  const repo = store.repo<Widget>(COLLECTION);
  await repo.put({ id: 'w5', tenantId: 't1', name: 'Gone soon', count: 0 });
  assert.strictEqual(await repo.delete('w5'), true);
  assert.strictEqual(await repo.get('w5'), undefined);
  assert.strictEqual(await repo.delete('w5'), false);
});

test('different collections are isolated even for the same id', async () => {
  const a = store.repo<Widget>(`${COLLECTION}_a`);
  const b = store.repo<Widget>(`${COLLECTION}_b`);
  await a.put({ id: 'shared-id', tenantId: 't1', name: 'in A', count: 1 });
  await b.put({ id: 'shared-id', tenantId: 't1', name: 'in B', count: 2 });
  assert.strictEqual((await a.get('shared-id'))?.name, 'in A');
  assert.strictEqual((await b.get('shared-id'))?.name, 'in B');
});

test('a fresh PgStore instance (simulating a server restart) reads back data written by a previous one', async () => {
  const first = new PgStore(PG_URL);
  await first.repo<Widget>(`${COLLECTION}_restart`).put({ id: 'persisted', tenantId: 't1', name: 'still here', count: 42 });
  await first.close();

  const second = new PgStore(PG_URL);
  const back = await second.repo<Widget>(`${COLLECTION}_restart`).get('persisted');
  assert.deepStrictEqual(back, { id: 'persisted', tenantId: 't1', name: 'still here', count: 42 });
  await second.close();
});
