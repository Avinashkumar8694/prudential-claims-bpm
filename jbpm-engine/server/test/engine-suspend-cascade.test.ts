// Suspend cascade: pausing a parent pauses the whole subtree; a paused tree does no work — completing
// a task on a suspended child is refused, and its completion cannot wake the suspended parent. Resume
// restores the whole tree and normal completion then flows through.
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { fakeClock } from '../src/infra/ids.ts';
import { makeContext } from '../src/context.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { VersionService } from '../src/modules/versions/service.ts';
import { DeploymentService } from '../src/modules/deployments/service.ts';
import { InstanceService } from '../src/modules/instances/service.ts';
import { TaskService } from '../src/modules/tasks/service.ts';
import { Collections, type Task } from '../src/domain.ts';

function newCtx() {
  let n = 0;
  const store = new MemoryStore();
  return { store, ctx: makeContext({ store, tenantId: 't1', clock: fakeClock().clock, newId: () => `id${++n}` }) };
}

const childEngine = (key: string) => ({
  id: key, name: key,
  processes: [{
    id: `${key}.process`, name: key, package: 'com.acme', vars: [],
    nodes: [
      { id: 'cs', type: 'start', name: 'Start' },
      { id: 'wait', type: 'userTask', name: 'Wait', group: 'ops' },
      { id: 'ce', type: 'end', name: 'End' },
    ],
    flows: [{ from: 'cs', to: 'wait' }, { from: 'wait', to: 'ce' }],
  }],
});
const parentEngine = (key: string, childProcId: string) => ({
  id: key, name: key,
  processes: [{
    id: `${key}.process`, name: key, package: 'com.acme', vars: [],
    nodes: [
      { id: 'ps', type: 'start', name: 'Start' },
      { id: 'call', type: 'call', name: 'Call child', process: childProcId },
      { id: 'pe', type: 'end', name: 'End' },
    ],
    flows: [{ from: 'ps', to: 'call' }, { from: 'call', to: 'pe' }],
  }],
});

async function deploy(ctx: any, name: string, engineFor: (key: string) => any) {
  const wf = await new WorkflowService(ctx).create({ name }, 'alice');
  const verSvc = new VersionService(ctx);
  const draft = await verSvc.saveDraft(wf.defaultBranchId, { ...engineFor(wf.key), id: wf.key } as any, 'alice');
  const { published } = await verSvc.publish(draft.id, 'alice', 'v1');
  await new DeploymentService(ctx).deploy(published.id, { environment: 'prod', activate: true }, 'alice');
  return { wf, procId: `${wf.key}.process` };
}

test('suspending a parent suspends its active child; the tree does no work until resume', async () => {
  const { store, ctx } = newCtx();
  const child = await deploy(ctx, 'Child', childEngine);
  const parent = await deploy(ctx, 'Parent', (k) => parentEngine(k, child.procId));
  const instSvc = new InstanceService(ctx);
  const taskSvc = new TaskService(ctx);

  const p = await instSvc.start({ workflowId: parent.wf.id, environment: 'prod' }, 'bob');
  const kid = (await instSvc.related(p.id)).children[0]!;
  assert.strictEqual(kid.status, 'waiting');

  await instSvc.suspend(p.id, 'alice');
  assert.strictEqual((await instSvc.get(p.id)).status, 'suspended');
  assert.strictEqual((await instSvc.get(kid.id)).status, 'suspended', 'child paused with the parent');

  // completing the child's task while suspended is refused → parent cannot be woken behind your back
  const task = (await store.repo<Task>(Collections.tasks).query((t) => t.status === 'created'))[0]!;
  await assert.rejects(taskSvc.complete(task.id, { ok: true }, 'carol'), /suspended/);
  assert.strictEqual((await instSvc.get(p.id)).status, 'suspended', 'parent stayed suspended');

  // resume the tree, then the same completion flows through and both finish
  await instSvc.resumeInstance(p.id, 'alice');
  assert.strictEqual((await instSvc.get(kid.id)).status, 'waiting');
  assert.strictEqual((await instSvc.get(p.id)).status, 'waiting');

  await taskSvc.complete(task.id, { ok: true }, 'carol');
  assert.strictEqual((await instSvc.get(kid.id)).status, 'completed');
  assert.strictEqual((await instSvc.get(p.id)).status, 'completed', 'parent resumed by the child after resume');
});
