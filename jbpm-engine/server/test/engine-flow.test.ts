// End-to-end (in-process, deterministic): author a workflow, publish, deploy + activate, run an
// instance that waits at a user task, complete the task, and assert it finishes. Plus the deployment
// active-pointer swap. Uses MemoryStore + a fake clock + a counting id generator.
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.js';
import { fakeClock } from '../src/infra/ids.js';
import { makeContext } from '../src/context.js';
import { WorkflowService } from '../src/modules/workflows/service.js';
import { VersionService } from '../src/modules/versions/service.js';
import { DeploymentService } from '../src/modules/deployments/service.js';
import { InstanceService } from '../src/modules/instances/service.js';
import { TaskService } from '../src/modules/tasks/service.js';
import { Collections, type Task } from '../src/domain.js';

function newCtx() {
  let n = 0;
  const fc = fakeClock();
  const store = new MemoryStore();
  return { store, ctx: makeContext({ store, tenantId: 't1', clock: fc.clock, newId: () => `id${++n}` }), fc };
}

const engineOf = (key: string, name: string) => ({
  id: key, name,
  processes: [{
    id: `${key}.process`, name, package: 'com.acme',
    vars: [{ name: 'greeted', type: 'bool' }],
    nodes: [
      { id: 'start', type: 'start', name: 'Start' },
      { id: 'greet', type: 'script', lang: 'js', code: 'kcontext.setVariable("greeted", true);' },
      { id: 'review', type: 'userTask', name: 'Review', group: 'ops' },
      { id: 'end', type: 'end', name: 'End' },
    ],
    flows: [
      { from: 'start', to: 'greet' }, { from: 'greet', to: 'review' }, { from: 'review', to: 'end' },
    ],
  }],
});

test('lifecycle: author → publish → deploy+activate → run → wait → complete → done', async () => {
  const { store, ctx } = newCtx();
  const wfSvc = new WorkflowService(ctx);
  const verSvc = new VersionService(ctx);
  const depSvc = new DeploymentService(ctx);
  const instSvc = new InstanceService(ctx);
  const taskSvc = new TaskService(ctx);

  const wf = await wfSvc.create({ name: 'Employee Directory' }, 'alice');
  assert.strictEqual(wf.key, 'employee-directory');

  // save engine JSON to the branch's head draft, then publish
  const draft = await verSvc.saveDraft(wf.defaultBranchId, engineOf(wf.key, wf.name) as any, 'alice');
  const { published } = await verSvc.publish(draft.id, 'alice', 'v1.0.0');
  assert.strictEqual(published.state, 'published');

  // validate the published engine model via the SDK
  const val = await verSvc.validate(published.id);
  assert.ok(val.ok, 'engine model validates: ' + JSON.stringify(val.errors));

  // deploy + activate to prod
  const dep = await depSvc.deploy(published.id, { environment: 'prod', tags: ['v1.0.0'], activate: true }, 'alice');
  assert.strictEqual(dep.status, 'active');
  assert.deepStrictEqual([...dep.tags].sort(), ['prod', 'v1.0.0']);

  // start an instance → runs script, then waits at the user task
  const inst = await instSvc.start({ workflowId: wf.id, environment: 'prod', variables: { seed: 1 } }, 'bob');
  assert.strictEqual(inst.status, 'waiting');
  assert.strictEqual(inst.variables.greeted, true, 'js script ran in the sandbox');
  assert.ok(inst.tokens.some((t) => t.nodeId === 'review' && t.state === 'waiting'));

  // a user task was created
  const tasks = await store.repo<Task>(Collections.tasks).query((t) => t.instanceId === inst.id);
  assert.strictEqual(tasks.length, 1);
  assert.strictEqual(tasks[0]!.status, 'created');

  // complete the task → instance resumes and completes
  await taskSvc.complete(tasks[0]!.id, { decision: 'approve' }, 'carol');
  const done = await instSvc.get(inst.id);
  assert.strictEqual(done.status, 'completed');
  assert.strictEqual(done.variables.decision, 'approve', 'task outputs merged into variables');
  assert.ok(done.history.some((h) => h.nodeId === 'end'), 'reached the end node');
});

test('deployment active-pointer swaps atomically within an environment', async () => {
  const { ctx } = newCtx();
  const wfSvc = new WorkflowService(ctx);
  const verSvc = new VersionService(ctx);
  const depSvc = new DeploymentService(ctx);

  const wf = await wfSvc.create({ name: 'Claims' }, 'alice');
  const d1 = await verSvc.saveDraft(wf.defaultBranchId, engineOf(wf.key, wf.name) as any, 'alice');
  const p1 = (await verSvc.publish(d1.id, 'alice', 'v1')).published;
  // publish opens a new draft head; save + publish again for a second version
  const d2 = await verSvc.saveDraft(wf.defaultBranchId, engineOf(wf.key, wf.name) as any, 'alice');
  const p2 = (await verSvc.publish(d2.id, 'alice', 'v2')).published;

  const depA = await depSvc.deploy(p1.id, { environment: 'staging', activate: true }, 'alice');
  const depB = await depSvc.deploy(p2.id, { environment: 'staging' }, 'alice');
  assert.strictEqual((await depSvc.get(depA.id)).status, 'active');
  assert.strictEqual((await depSvc.get(depB.id)).status, 'inactive');

  await depSvc.activate(depB.id, 'alice');
  assert.strictEqual((await depSvc.get(depA.id)).status, 'inactive', 'previous active was deactivated');
  assert.strictEqual((await depSvc.get(depB.id)).status, 'active');

  // rollback to A
  await depSvc.rollback('staging', depA.id, 'alice');
  assert.strictEqual((await depSvc.get(depA.id)).status, 'active');
  assert.strictEqual((await depSvc.get(depB.id)).status, 'inactive');
});
