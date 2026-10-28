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
import { TaskService } from '../src/modules/tasks/service.ts';
import { Collections, type Task } from '../src/domain.ts';

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

test('throw escalation resumes a catch configured for escalation (not just plain signal)', async () => {
  // Escalation has no dedicated WaitSpec kind — it buckets into 'signal' on both the catch side (see
  // catch/handler.ts) and the throw/end-throw side (see throw/handler.ts, end/handler.ts). This is the
  // one case none of the other signal/message tests in this file exercise: a catch node configured
  // with event.escalation specifically, not event.signal — the catch handler was previously missing
  // this branch entirely and fell through to a plain 'condition' wait that broadcast() never resolves,
  // so the waiter parked forever no matter how many times the matching escalation was thrown.
  const ctx = newCtx();
  const waiter = await deploy(ctx, 'Escalation Waiter', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
    nodes: [{ id: 's', type: 'start' }, { id: 'w', type: 'catch', name: 'Await Delay', event: { escalation: 'Delay' } }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'w' }, { id: 'f2', from: 'w', to: 'e' }] }] }));
  const thrower = await deploy(ctx, 'Escalation Thrower', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
    nodes: [{ id: 's', type: 'start' }, { id: 't', type: 'throw', name: 'Fire Delay', event: { escalation: 'Delay' } }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 't' }, { id: 'f2', from: 't', to: 'e' }] }] }));

  const inst = new InstanceService(ctx);
  const a = await inst.start({ workflowId: waiter.id, environment: 'prod' }, 'bob');
  assert.strictEqual(a.status, 'waiting');
  assert.strictEqual(a.tokens[0]!.waitFor?.kind, 'signal', 'escalation catch waits via the signal-bucket kind, not a dead-end condition wait');
  await inst.start({ workflowId: thrower.id, environment: 'prod' }, 'bob');

  const after = await inst.get(a.id);
  assert.strictEqual(after.status, 'completed', 'waiter resumed by the broadcast escalation');
});

test('an end event with a signal/message/escalation throw broadcasts before completing', async () => {
  const ctx = newCtx();
  const waiter = await deploy(ctx, 'End-Throw Waiter', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
    nodes: [{ id: 's', type: 'start' }, { id: 'w', type: 'catch', name: 'Await Done', event: { signal: 'Done' } }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'w' }, { id: 'f2', from: 'w', to: 'e' }] }] }));
  const thrower = await deploy(ctx, 'End-Throw Thrower', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
    nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end', name: 'Signal Done', throw: { signal: 'Done' } }],
    flows: [{ id: 'f1', from: 's', to: 'e' }] }] }));

  const inst = new InstanceService(ctx);
  const a = await inst.start({ workflowId: waiter.id, environment: 'prod' }, 'bob');
  assert.strictEqual(a.status, 'waiting');
  const b = await inst.start({ workflowId: thrower.id, environment: 'prod' }, 'bob');
  assert.strictEqual(b.status, 'completed', 'the throwing instance completes normally after broadcasting');

  const after = await inst.get(a.id);
  assert.strictEqual(after.status, 'completed', 'waiter resumed by the end-event\'s broadcast signal');
});

test('a signal/message start event begins a NEW instance when a matching signal is broadcast', async () => {
  const ctx = newCtx();
  const listener = await deploy(ctx, 'Signal-Start Listener', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
    nodes: [{ id: 's', type: 'start', on: { signal: 'Kickoff' } }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'e' }] }] }));
  const thrower = await deploy(ctx, 'Kickoff Thrower', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
    nodes: [{ id: 's', type: 'start' }, { id: 't', type: 'throw', name: 'Fire Kickoff', event: { signal: 'Kickoff' } }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 't' }, { id: 'f2', from: 't', to: 'e' }] }] }));

  const inst = new InstanceService(ctx);
  assert.strictEqual((await inst.list({ workflowId: listener.id })).length, 0, 'no listener instance exists yet');
  await inst.start({ workflowId: thrower.id, environment: 'prod' }, 'bob');

  const spawned = await inst.list({ workflowId: listener.id });
  assert.strictEqual(spawned.length, 1, 'broadcasting the signal started a fresh listener instance');
  assert.strictEqual(spawned[0]!.status, 'completed');
  assert.strictEqual(spawned[0]!.startedBy, 'signal');
});

test('correlationKey scopes signal delivery to the ONE matching instance, not every waiter on that name', async () => {
  const ctx = newCtx();
  const waiter = await deploy(ctx, 'Correlated Waiter', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [{ name: 'claimId', type: 'string' }],
    nodes: [{ id: 's', type: 'start' }, { id: 'w', type: 'catch', name: 'Await Payment', event: { signal: 'PaymentReceived' } }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'w' }, { id: 'f2', from: 'w', to: 'e' }] }] }));
  const thrower = await deploy(ctx, 'Correlated Thrower', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [{ name: 'claimId', type: 'string' }],
    nodes: [{ id: 's', type: 'start' }, { id: 't', type: 'throw', name: 'Fire Payment', event: { signal: 'PaymentReceived', correlationKey: '$claimId' } }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 't' }, { id: 'f2', from: 't', to: 'e' }] }] }));

  const inst = new InstanceService(ctx);
  // three instances of the SAME process, all waiting on the same signal name, each with a distinct
  // instance-level correlationKey (the pre-existing start() option — broadcast() matches against it).
  const a = await inst.start({ workflowId: waiter.id, environment: 'prod', correlationKey: 'claim-A' }, 'bob');
  const b = await inst.start({ workflowId: waiter.id, environment: 'prod', correlationKey: 'claim-B' }, 'bob');
  const c = await inst.start({ workflowId: waiter.id, environment: 'prod', correlationKey: 'claim-C' }, 'bob');
  assert.strictEqual(a.status, 'waiting'); assert.strictEqual(b.status, 'waiting'); assert.strictEqual(c.status, 'waiting');

  // a payment webhook for claim-B fires — only B should resume
  await inst.start({ workflowId: thrower.id, environment: 'prod', variables: { claimId: 'claim-B' } }, 'bob');

  assert.strictEqual((await inst.get(a.id)).status, 'waiting', 'claim-A is unrelated — must not resume');
  assert.strictEqual((await inst.get(b.id)).status, 'completed', 'claim-B matched the correlation key — resumes');
  assert.strictEqual((await inst.get(c.id)).status, 'waiting', 'claim-C is unrelated — must not resume');
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

test('multi-instance parallel:true runs items concurrently but still collects results in item order', async () => {
  const ctx = newCtx();
  await deploy(ctx, 'Par Item Worker', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [{ name: 'item', type: 'int' }, { name: 'r', type: 'int' }],
    nodes: [{ id: 's', type: 'start' }, { id: 'sc', type: 'script', name: 'x10', code: 'kcontext.setVariable("r", (kcontext.getVariable("item")||0) * 10);' }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'sc' }, { id: 'f2', from: 'sc', to: 'e' }] }] }));
  const parent = await deploy(ctx, 'Par Batch', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [{ name: 'items', type: 'list' }, { name: 'results', type: 'list' }],
    nodes: [{ id: 's', type: 'start' }, { id: 'mi', type: 'forEach', name: 'Per item', process: 'par-item-worker.process', over: 'items', as: 'item', itemResult: 'r', collectInto: 'results', parallel: true }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'mi' }, { id: 'f2', from: 'mi', to: 'e' }] }] }));

  const p = await new InstanceService(ctx).start({ workflowId: parent.id, environment: 'prod', variables: { items: [1, 2, 3, 4] } }, 'bob');
  assert.strictEqual(p.status, 'completed');
  assert.deepStrictEqual(p.variables.results, [10, 20, 30, 40], 'results stay in item order even though items ran concurrently');
});

test('multi-instance fails the whole node (does not silently drop the result) when one item does not complete', async () => {
  const ctx = newCtx();
  await deploy(ctx, 'Flaky Item Worker', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [{ name: 'item', type: 'int' }],
    nodes: [{ id: 's', type: 'start' }, { id: 'sc', type: 'script', lang: 'js', code: "if (kcontext.getVariable('item') === 2) throw new Error('boom');" }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'sc' }, { id: 'f2', from: 'sc', to: 'e' }] }] }));
  const parent = await deploy(ctx, 'Flaky Batch', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [{ name: 'items', type: 'list' }],
    nodes: [{ id: 's', type: 'start' }, { id: 'mi', type: 'forEach', name: 'Per item', process: 'flaky-item-worker.process', over: 'items', as: 'item' }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'mi' }, { id: 'f2', from: 'mi', to: 'e' }] }] }));

  const p = await new InstanceService(ctx).start({ workflowId: parent.id, environment: 'prod', variables: { items: [1, 2, 3] } }, 'bob');
  assert.strictEqual(p.status, 'failed', 'a failing item fails the whole multi-instance node, not a silently incomplete result');
});

test('multi-instance parallel:true parks (not fails) when a per-item child waits on a human task, then resumes once every sibling completes', async () => {
  const ctx = newCtx();
  await deploy(ctx, 'Approver', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [{ name: 'item', type: 'int' }, { name: 'decision', type: 'string' }],
    nodes: [{ id: 's', type: 'start' }, { id: 't', type: 'userTask', name: 'Approve', group: 'ops' }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 't' }, { id: 'f2', from: 't', to: 'e' }] }] }));
  const parent = await deploy(ctx, 'Approval Batch', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [{ name: 'items', type: 'list' }, { name: 'results', type: 'list' }],
    nodes: [{ id: 's', type: 'start' }, { id: 'mi', type: 'forEach', name: 'Per item', process: 'approver.process', over: 'items', as: 'item', itemResult: 'decision', collectInto: 'results', parallel: true }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'mi' }, { id: 'f2', from: 'mi', to: 'e' }] }] }));

  const instSvc = new InstanceService(ctx);
  const taskSvc = new TaskService(ctx);
  const p = await instSvc.start({ workflowId: parent.id, environment: 'prod', variables: { items: [1, 2] } }, 'bob');
  assert.strictEqual(p.status, 'waiting', 'parks instead of failing while children are still running their own task');
  assert.ok(p.tokens.some((t) => t.waitFor?.kind === 'multiInstance'), 'forEach token records a multiInstance wait');

  const rel = await instSvc.related(p.id);
  assert.strictEqual(rel.children.length, 2, 'both items start their child immediately (parallel)');
  const tasks = await ctx.store.repo<Task>(Collections.tasks).query((t) => rel.children.some((c) => c.id === t.instanceId));
  assert.strictEqual(tasks.length, 2);

  await taskSvc.complete(tasks[0]!.id, { decision: 'ok-1' }, 'carol');
  assert.strictEqual((await instSvc.get(p.id)).status, 'waiting', 'still waiting on the second sibling');

  await taskSvc.complete(tasks[1]!.id, { decision: 'ok-2' }, 'carol');
  const done = await instSvc.get(p.id);
  assert.strictEqual(done.status, 'completed', 'resumes once every sibling has settled');
  assert.strictEqual((done.variables.results as unknown[]).length, 2, 'collected both results');
  assert.ok((done.variables.results as string[]).includes('ok-1') && (done.variables.results as string[]).includes('ok-2'));
});

test('multi-instance sequential (default) starts the next item only once the previous child\'s task is completed', async () => {
  const ctx = newCtx();
  await deploy(ctx, 'Seq Approver', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [{ name: 'item', type: 'int' }, { name: 'decision', type: 'string' }],
    nodes: [{ id: 's', type: 'start' }, { id: 't', type: 'userTask', name: 'Approve', group: 'ops' }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 't' }, { id: 'f2', from: 't', to: 'e' }] }] }));
  const parent = await deploy(ctx, 'Seq Approval Batch', (key, name) => ({ id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [{ name: 'items', type: 'list' }, { name: 'results', type: 'list' }],
    nodes: [{ id: 's', type: 'start' }, { id: 'mi', type: 'forEach', name: 'Per item', process: 'seq-approver.process', over: 'items', as: 'item', itemResult: 'decision', collectInto: 'results' }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'mi' }, { id: 'f2', from: 'mi', to: 'e' }] }] }));

  const instSvc = new InstanceService(ctx);
  const taskSvc = new TaskService(ctx);
  const p = await instSvc.start({ workflowId: parent.id, environment: 'prod', variables: { items: [1, 2, 3] } }, 'bob');
  assert.strictEqual(p.status, 'waiting');
  assert.strictEqual((await instSvc.related(p.id)).children.length, 1, 'sequential starts only the first item up front');

  for (let i = 0; i < 3; i++) {
    const rel = await instSvc.related(p.id);
    assert.strictEqual(rel.children.length, i + 1, `item ${i + 1} started only after the previous one settled`);
    const openTask = (await ctx.store.repo<Task>(Collections.tasks).query((t) => t.instanceId === rel.children[i]!.id && t.status === 'created'))[0]!;
    await taskSvc.complete(openTask.id, { decision: `ok-${i + 1}` }, 'carol');
  }

  const done = await instSvc.get(p.id);
  assert.strictEqual(done.status, 'completed', 'resumes once the last item in sequence completes');
  assert.deepStrictEqual(done.variables.results, ['ok-1', 'ok-2', 'ok-3'], 'results collected in item order');
});
