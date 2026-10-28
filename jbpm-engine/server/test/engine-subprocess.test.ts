// Embedded sub-process execution: the node's own nodes/flows run as a nested instance sharing the
// parent's variable scope. Covers (A) a synchronous embedded graph that completes inline and merges
// its variables back, and (B) an embedded graph that waits at a user task and resumes the parent on
// completion. Deterministic: MemoryStore + fake clock + counting ids.
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
  const fc = fakeClock();
  const store = new MemoryStore();
  return { store, ctx: makeContext({ store, tenantId: 't1', clock: fc.clock, newId: () => `id${++n}` }), fc };
}

async function deploy(ctx: any, key: string, name: string, engine: any) {
  const wfSvc = new WorkflowService(ctx);
  const verSvc = new VersionService(ctx);
  const depSvc = new DeploymentService(ctx);
  const wf = await wfSvc.create({ name }, 'alice');
  const draft = await verSvc.saveDraft(wf.defaultBranchId, { ...engine, id: wf.key, name } as any, 'alice');
  const { published } = await verSvc.publish(draft.id, 'alice', 'v1');
  await depSvc.deploy(published.id, { environment: 'prod', activate: true }, 'alice');
  return wf;
}

const withSub = (key: string, inner: { nodes: any[]; flows: any[] }) => ({
  id: key, name: key,
  processes: [{
    id: `${key}.process`, name: key, package: 'com.acme',
    vars: [{ name: 'seed', type: 'int' }, { name: 'inner', type: 'int' }],
    nodes: [
      { id: 'start', type: 'start', name: 'Start' },
      { id: 'sub', type: 'subprocess', name: 'Embedded', nodes: inner.nodes, flows: inner.flows },
      { id: 'end', type: 'end', name: 'End' },
    ],
    flows: [{ from: 'start', to: 'sub' }, { from: 'sub', to: 'end' }],
  }],
});

test('embedded sub-process runs inline and merges its variables back (shared scope)', async () => {
  const { ctx } = newCtx();
  const engine = withSub('sync-sub', {
    nodes: [
      { id: 's2', type: 'start', name: 'S' },
      { id: 'calc', type: 'script', lang: 'js', code: 'kcontext.setVariable("inner", (kcontext.getVariable("seed")||0) + 1);' },
      { id: 'e2', type: 'end', name: 'E' },
    ],
    flows: [{ from: 's2', to: 'calc' }, { from: 'calc', to: 'e2' }],
  });
  const wf = await deploy(ctx, 'sync-sub', 'Sync Sub', engine);
  const instSvc = new InstanceService(ctx);
  const inst = await instSvc.start({ workflowId: wf.id, environment: 'prod', variables: { seed: 5 } }, 'bob');
  assert.strictEqual(inst.status, 'completed', 'embedded graph ran to completion inline');
  assert.strictEqual(inst.variables.inner, 6, 'inner script result merged into the parent (shared scope)');
  assert.ok(inst.history.some((h) => h.nodeId === 'end'), 'parent reached its end node');
});

test('embedded sub-process that waits at a user task suspends the parent, then resumes on completion', async () => {
  const { store, ctx } = newCtx();
  const engine = withSub('wait-sub', {
    nodes: [
      { id: 's2', type: 'start', name: 'S' },
      { id: 'review', type: 'userTask', name: 'Review', group: 'ops' },
      { id: 'e2', type: 'end', name: 'E' },
    ],
    flows: [{ from: 's2', to: 'review' }, { from: 'review', to: 'e2' }],
  });
  const wf = await deploy(ctx, 'wait-sub', 'Wait Sub', engine);
  const instSvc = new InstanceService(ctx);
  const taskSvc = new TaskService(ctx);

  const inst = await instSvc.start({ workflowId: wf.id, environment: 'prod', variables: { seed: 1 } }, 'bob');
  assert.strictEqual(inst.status, 'waiting', 'parent waits while the embedded task is open');

  // the user task belongs to the nested (child) instance
  const tasks = await store.repo<Task>(Collections.tasks).query((t) => t.status === 'created');
  assert.strictEqual(tasks.length, 1);
  await taskSvc.complete(tasks[0]!.id, { decision: 'ok' }, 'carol');

  const done = await instSvc.get(inst.id);
  assert.strictEqual(done.status, 'completed', 'parent resumed and completed after the embedded task');
  assert.strictEqual(done.variables.decision, 'ok', 'embedded task outputs merged back to the parent');
});
