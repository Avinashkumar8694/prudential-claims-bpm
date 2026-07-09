// Send/Throw broadcast a signal to waiting instances; Multi-instance runs a child per item.
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { fakeClock } from '../src/infra/ids.ts';
import { makeContext, type AppContext } from '../src/context.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { VersionService } from '../src/modules/versions/service.ts';
import { DeploymentService } from '../src/modules/deployments/service.ts';
import { InstanceService } from '../src/modules/instances/service.ts';

const newCtx = () => { let n = 0; return makeContext({ store: new MemoryStore(), tenantId: 't1', clock: fakeClock().clock, newId: () => `id${++n}` }); };
async function deploy(ctx: AppContext, name: string, mk: (k: string, n: string) => any) {
  const wf = await new WorkflowService(ctx).create({ name }, 'a');
  const d = await new VersionService(ctx).saveDraft(wf.defaultBranchId, mk(wf.key, wf.name), 'a');
  const pub = await new VersionService(ctx).publish(d.id, 'a');
  await new DeploymentService(ctx).deploy(pub.published.id, { environment: 'prod', activate: true }, 'a');
  return wf;
}

test('throw signal resumes another instance waiting on it (cross-instance broadcast)', async () => {
  const ctx = newCtx();
  const waiter = await deploy(ctx, 'Waiter', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
    nodes: [{ id: 's', type: 'start' }, { id: 'w', type: 'catch', name: 'Await Go', event: { signal: 'Go' } }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'w' }, { id: 'f2', from: 'w', to: 'e' }] }] }));
  await deploy(ctx, 'Thrower', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
    nodes: [{ id: 's', type: 'start' }, { id: 't', type: 'throw', name: 'Fire Go', event: { signal: 'Go' } }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 't' }, { id: 'f2', from: 't', to: 'e' }] }] }));

  const inst = new InstanceService(ctx);
  const a = await inst.start({ workflowId: waiter.id, environment: 'prod' }, 'bob');
  assert.strictEqual(a.status, 'waiting');
  const t = await deploy(ctx, 'Thrower2', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
    nodes: [{ id: 's', type: 'start' }, { id: 't', type: 'throw', name: 'Fire', event: { signal: 'Go' } }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 't' }, { id: 'f2', from: 't', to: 'e' }] }] }));
  await inst.start({ workflowId: t.id, environment: 'prod' }, 'bob');

  const after = await inst.get(a.id);
  assert.strictEqual(after.status, 'completed', 'waiter resumed by the broadcast signal');
});

test('multi-instance runs a child per item and collects results', async () => {
  const ctx = newCtx();
  await deploy(ctx, 'Item Worker', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [{ name: 'item', type: 'int' }, { name: 'r', type: 'int' }],
    nodes: [{ id: 's', type: 'start' }, { id: 'sc', type: 'script', name: 'x10', code: 'kcontext.setVariable("r", (kcontext.getVariable("item")||0) * 10);' }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'sc' }, { id: 'f2', from: 'sc', to: 'e' }] }] }));
  const parent = await deploy(ctx, 'Batch', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [{ name: 'items', type: 'list' }, { name: 'results', type: 'list' }],
    nodes: [{ id: 's', type: 'start' }, { id: 'mi', type: 'forEach', name: 'Per item', process: 'item-worker.process', over: 'items', as: 'item', itemResult: 'r', collectInto: 'results' }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'mi' }, { id: 'f2', from: 'mi', to: 'e' }] }] }));

  const p = await new InstanceService(ctx).start({ workflowId: parent.id, environment: 'prod', variables: { items: [1, 2, 3] } }, 'bob');
  assert.strictEqual(p.status, 'completed');
  assert.deepStrictEqual(p.variables.results, [10, 20, 30], 'collected each child result');
});
