// WorkflowServicePgStore against a REAL Postgres (see docker-compose.yml — `npm run docker:up` first).
// Opt-in: `npm run test:pg`, not part of the default `npm test` glob. Verifies the real `workflow_service`
// schema actually gets created, CRUD round-trips through real typed columns (not a jsonb blob), and —
// most importantly — that the tenant-isolation guarantee holds against REAL SQL, not just the in-memory
// evaluator already covered by test/workflow-instance.test.ts.
import { test } from 'node:test';
import assert from 'node:assert';
import { WorkflowServicePgStore } from '../../src/workflow-service/store/pg-store.ts';
import { config } from '../../src/infra/config.ts';
import type { WorkflowDefinition, WorkflowInstance } from '../../src/workflow-service/domain.ts';

const PG_URL = config.pgUrl!;
const suffix = `pgtest${Date.now()}`;

let store: WorkflowServicePgStore;
test.before(async () => { store = new WorkflowServicePgStore(PG_URL); });
test.after(async () => { await store.close(); });

function def(id: string, tenantId: string, name: string): WorkflowDefinition {
  const now = new Date().toISOString();
  return { id, tenantId, name, deploymentId: 'dep1', dataSchema: {}, schemaValidationEnabled: false, createdAt: now, createdBy: 'a', updatedAt: now, updatedBy: 'a' };
}
function inst(id: string, tenantId: string, workflowDefinitionId: string, name: string, secret: string): WorkflowInstance {
  const now = new Date().toISOString();
  return { id, tenantId, workflowDefinitionId, workflowName: name, deploymentId: 'dep1', data: { secret }, status: 'active', piid: null, createdAt: now, createdBy: 'a', updatedAt: now, updatedBy: 'a' };
}

// `name` carries a real UNIQUE(tenantId, name) constraint (see entities.ts) — against a real,
// persistent Postgres this test suite doesn't tear down after itself, so BOTH tenantId and name must
// be suffixed per run, not just `id`, or a second run collides with the first run's still-there rows.
test('the workflow_service schema and its tables exist after the first real query (bootstrap)', async () => {
  await store.definitions().put(def(`${suffix}-d1`, `${suffix}-t1`, `${suffix}-wf1`));
  const rows = await store.definitions().query((d) => d.tenantId === `${suffix}-t1`);
  assert.ok(rows.some((r) => r.id === `${suffix}-d1`));
});

test('workflow_instance round-trips real typed columns (not a jsonb blob) through Postgres', async () => {
  const d = def(`${suffix}-d2`, `${suffix}-t1`, `${suffix}-wf2`);
  await store.definitions().put(d);
  const i = inst(`${suffix}-i1`, `${suffix}-t1`, d.id, `${suffix}-wf2`, 'plain-value');
  await store.instances().put(i);
  const back = await store.instances().get(i.id);
  assert.deepStrictEqual(back, i);
});

test('runTypedQuery filters via real SQL, and tenant scoping holds even against a crafted filter', async () => {
  const dA = def(`${suffix}-dA`, `${suffix}-tenantA`, 'isoA');
  const dB = def(`${suffix}-dB`, `${suffix}-tenantB`, 'isoB');
  await store.definitions().put(dA);
  await store.definitions().put(dB);
  const iA = inst(`${suffix}-iA`, dA.tenantId, dA.id, 'isoA', 'tenantA-secret');
  const iB = inst(`${suffix}-iB`, dB.tenantId, dB.id, 'isoB', 'tenantB-secret');
  await store.instances().put(iA);
  await store.instances().put(iB);

  // tenant B queries for tenant A's exact known secret — the SQL tenant_id clause must win regardless.
  const leak = await store.runTypedQuery('workflowInstance', dB.tenantId, { entity: 'workflowInstance', filters: [{ field: 'data.secret', op: 'eq', value: 'tenantA-secret' }] });
  assert.strictEqual((leak.rows || []).length, 0);

  // sanity: the same filter shape against tenant A's own scope finds its row via the jsonb path expr.
  const found = await store.runTypedQuery('workflowInstance', dA.tenantId, { entity: 'workflowInstance', filters: [{ field: 'data.secret', op: 'eq', value: 'tenantA-secret' }] });
  assert.strictEqual((found.rows || []).length, 1);
  assert.strictEqual((found.rows![0] as any).id, iA.id);

  // a non-allowlisted field name is silently dropped, never interpolated into SQL.
  const noCrash = await store.runTypedQuery('workflowInstance', dB.tenantId, { entity: 'workflowInstance', filters: [{ field: "id'; DROP TABLE workflow_instance; --", op: 'eq', value: 'x' }] });
  assert.strictEqual((noCrash.rows || []).length, 1, 'the unrecognized field was ignored, not executed — tenant B still just sees its own row');
});
