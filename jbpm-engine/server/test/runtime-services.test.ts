// The full stack, end to end: author a workflow through the service layer, publish, deploy, start an
// instance through InstancesService, and complete its task through TasksService — proving the service
// layer and the execution engine agree on every handoff (tokenId, deploymentId, ownership rules).
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { makeContext } from '../src/context.ts';
import { newId, fakeClock } from '../src/infra/ids.ts';
import { ApiError } from '../src/infra/errors.ts';
import { WorkflowsService } from '../src/modules/workflows/service.ts';
import { BranchesService } from '../src/modules/branches/service.ts';
import { VersionsService } from '../src/modules/versions/service.ts';
import { DeploymentsService } from '../src/modules/deployments/service.ts';
import { InstancesService } from '../src/modules/instances/service.ts';
import { TasksService } from '../src/modules/tasks/service.ts';
import type { EngineNode, EngineProcess } from '../src/sdk/index.ts';

function makeStack() {
  const store = new MemoryStore();
  const ctx = makeContext({ store, tenantId: 't1', clock: fakeClock().clock, newId });
  return {
    ctx,
    workflows: new WorkflowsService(ctx),
    branches: new BranchesService(ctx),
    versions: new VersionsService(ctx),
    deployments: new DeploymentsService(ctx),
    instances: new InstancesService(ctx),
    tasks: new TasksService(ctx),
  };
}

const REVIEW_PROCESS: EngineProcess = {
  id: 'review', name: 'Review',
  vars: [{ name: 'decision', type: 'String' }],
  nodes: [
    { id: 'start', type: 'start' } as EngineNode,
    { id: 'review', type: 'userTask', name: 'Review claim', group: 'adjusters' } as EngineNode,
    { id: 'end', type: 'end' } as EngineNode,
  ],
  flows: [{ from: 'start', to: 'review' }, { from: 'review', to: 'end' }],
};

async function deployedWorkflow(stack: ReturnType<typeof makeStack>) {
  const wf = await stack.workflows.create('Claim Review', undefined, 'author');
  const branch = (await stack.branches.list(wf.id))[0]!;
  const draft = (await stack.versions.list(branch.id))[0]!;
  await stack.versions.saveDraft(draft.id, { id: 'e1', name: 'Engine', processes: [REVIEW_PROCESS] }, 'author');
  const { version } = await stack.versions.publish(draft.id, 'author');
  const dep = await stack.deployments.deploy(version.id, 'test', 'author');
  return { wf, dep };
}

test('start via workflowId+environment resolves the active deployment', async () => {
  const stack = makeStack();
  const { wf } = await deployedWorkflow(stack);
  const inst = await stack.instances.start({ workflowId: wf.id, environment: 'test' }, 'alice');
  assert.strictEqual(inst.status, 'waiting');
  assert.strictEqual(inst.workflowId, wf.id);
});

test('starting with no deploymentId and no workflowId+environment is rejected', async () => {
  const stack = makeStack();
  await assert.rejects(() => stack.instances.start({}, 'alice'), (e: unknown) => e instanceof ApiError && e.code === 'VALIDATION');
});

test('a group task is claimable only by a group member, and only the claimant can complete it', async () => {
  const stack = makeStack();
  const { dep } = await deployedWorkflow(stack);
  const inst = await stack.instances.start({ deploymentId: dep.id }, 'alice');
  const task = (await stack.tasks.list({ instanceId: inst.id }))[0]!;
  assert.strictEqual(task.status, 'created');
  assert.strictEqual(task.group, 'adjusters');

  await assert.rejects(() => stack.tasks.claim(task.id, { username: 'bob', groups: ['sales'] }));
  const claimed = await stack.tasks.claim(task.id, { username: 'carol', groups: ['adjusters'] });
  assert.strictEqual(claimed.assignee, 'carol');
  assert.strictEqual(claimed.status, 'reserved');

  await assert.rejects(() => stack.tasks.complete(task.id, { decision: 'approved' }, { username: 'dave', groups: ['adjusters'] }));

  const resumed = await stack.tasks.complete(task.id, { decision: 'approved' }, { username: 'carol', groups: ['adjusters'] });
  assert.strictEqual(resumed.status, 'completed');
  assert.strictEqual(resumed.variables.decision, 'approved');
});

test('editVariables is refused on a terminal instance and merges on a waiting one', async () => {
  const stack = makeStack();
  const { dep } = await deployedWorkflow(stack);
  const inst = await stack.instances.start({ deploymentId: dep.id }, 'alice');
  const updated = await stack.instances.editVariables(inst.id, { note: 'escalated' }, 'alice');
  assert.strictEqual(updated.variables.note, 'escalated');

  const task = (await stack.tasks.list({ instanceId: inst.id }))[0]!;
  await stack.tasks.claim(task.id, { username: 'carol', groups: ['adjusters'] });
  const done = await stack.tasks.complete(task.id, { decision: 'approved' }, { username: 'carol', groups: ['adjusters'] });
  assert.strictEqual(done.status, 'completed');
  await assert.rejects(() => stack.instances.editVariables(inst.id, { x: 1 }, 'alice'), (e: unknown) => e instanceof ApiError && e.code === 'CONFLICT');
});

test('abort moves a waiting instance to aborted and exits its open task', async () => {
  const stack = makeStack();
  const { dep } = await deployedWorkflow(stack);
  const inst = await stack.instances.start({ deploymentId: dep.id }, 'alice');
  const aborted = await stack.instances.abort(inst.id, 'admin');
  assert.strictEqual(aborted.status, 'aborted');
  const task = (await stack.tasks.list({ instanceId: inst.id }))[0]!;
  assert.strictEqual(task.status, 'exited');
});
