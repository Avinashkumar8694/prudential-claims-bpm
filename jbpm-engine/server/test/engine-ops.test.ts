// Operations features: call-activity child instances (+ related navigation), signal delivery,
// and node re-trigger. Deterministic (MemoryStore + fake clock + counting ids).
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

function newCtx() {
  let n = 0;
  const store = new MemoryStore();
  return makeContext({ store, tenantId: 't1', clock: fakeClock().clock, newId: () => `id${++n}` });
}

// author engine JSON, save draft, publish, deploy + activate to prod; return { wf, deploymentId }
async function deployWorkflow(ctx: AppContext, name: string, mkEngine: (key: string, name: string) => any) {
  const wf = await new WorkflowService(ctx).create({ name }, 'alice');
  const draft = await new VersionService(ctx).saveDraft(wf.defaultBranchId, mkEngine(wf.key, wf.name), 'alice');
  const pub = await new VersionService(ctx).publish(draft.id, 'alice');
  const dep = await new DeploymentService(ctx).deploy(pub.published.id, { environment: 'prod', activate: true }, 'alice');
  return { wf, dep };
}

test('call activity spawns a linked child instance; related() + parent-resume work', async () => {
  const ctx = newCtx();
  // child: start -> userTask -> end
  await deployWorkflow(ctx, 'Child WF', (key, name) => ({
    id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
      nodes: [{ id: 'start', type: 'start' }, { id: 'approve', type: 'userTask', name: 'Approve', group: 'ops' }, { id: 'end', type: 'end' }],
      flows: [{ from: 'start', to: 'approve' }, { from: 'approve', to: 'end' }] }],
  }));
  // parent: start -> call(child) -> end  (maps child.decision -> parent.result)
  const { wf: parentWf } = await deployWorkflow(ctx, 'Parent WF', (key, name) => ({
    id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [{ name: 'result', type: 'string' }],
      nodes: [{ id: 'start', type: 'start' }, { id: 'call', type: 'call', process: 'child-wf.process', outputs: { result: 'decision' } }, { id: 'end', type: 'end' }],
      flows: [{ from: 'start', to: 'call' }, { from: 'call', to: 'end' }] }],
  }));

  const instSvc = new InstanceService(ctx);
  const parent = await instSvc.start({ workflowId: parentWf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(parent.status, 'waiting', 'parent waits for the child');
  assert.ok(parent.tokens.some((t) => t.waitFor?.kind === 'child'), 'parent token waits on a child');

  // related() surfaces the child instance
  const rel = await instSvc.related(parent.id);
  assert.strictEqual(rel.children.length, 1, 'one child instance linked');
  const child = rel.children[0]!;
  assert.strictEqual(child.parentInstanceId, parent.id);

  // complete the child's user task -> child completes -> parent resumes with mapped output
  const childTask = (await ctx.store.repo<Task>(Collections.tasks).query((t) => t.instanceId === child.id))[0]!;
  await new TaskService(ctx).complete(childTask.id, { decision: 'approved' }, 'carol');

  const parentDone = await instSvc.get(parent.id);
  assert.strictEqual(parentDone.status, 'completed', 'parent resumed + completed after child finished');
  assert.strictEqual(parentDone.variables.result, 'approved', 'child output mapped into parent variable');
});

test('independent:true call activity fires the child and continues without waiting', async () => {
  const ctx = newCtx();
  // child: start -> userTask -> end (parks at the user task — would normally block the parent)
  await deployWorkflow(ctx, 'Indep Child WF', (key, name) => ({
    id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
      nodes: [{ id: 'start', type: 'start' }, { id: 'approve', type: 'userTask', name: 'Approve', group: 'ops' }, { id: 'end', type: 'end' }],
      flows: [{ from: 'start', to: 'approve' }, { from: 'approve', to: 'end' }] }],
  }));
  const { wf: parentWf } = await deployWorkflow(ctx, 'Indep Parent WF', (key, name) => ({
    id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
      nodes: [{ id: 'start', type: 'start' }, { id: 'call', type: 'call', process: 'indep-child-wf.process', independent: true }, { id: 'end', type: 'end' }],
      flows: [{ from: 'start', to: 'call' }, { from: 'call', to: 'end' }] }],
  }));

  const instSvc = new InstanceService(ctx);
  const parent = await instSvc.start({ workflowId: parentWf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(parent.status, 'completed', 'parent does not wait for an independent child');

  const rel = await instSvc.related(parent.id);
  assert.strictEqual(rel.children.length, 1, 'the child was still dispatched');
  assert.strictEqual(rel.children[0]!.status, 'waiting', 'child keeps running independently at its own user task');
});

test('independent:true call activity: a later child failure never propagates back to the (already-completed) parent', async () => {
  const ctx = newCtx();
  // child fails synchronously (no catch) — independent dispatch must not raise this in the parent.
  await deployWorkflow(ctx, 'Indep Failing Child WF', (key, name) => ({
    id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
      nodes: [{ id: 'start', type: 'start' }, { id: 'boom', type: 'script', lang: 'js', code: "throw new Error('boom');" }, { id: 'end', type: 'end' }],
      flows: [{ from: 'start', to: 'boom' }, { from: 'boom', to: 'end' }] }],
  }));
  const { wf: parentWf } = await deployWorkflow(ctx, 'Indep Failing Parent WF', (key, name) => ({
    id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
      nodes: [{ id: 'start', type: 'start' }, { id: 'call', type: 'call', process: 'indep-failing-child-wf.process', independent: true }, { id: 'end', type: 'end' }],
      flows: [{ from: 'start', to: 'call' }, { from: 'call', to: 'end' }] }],
  }));

  const instSvc = new InstanceService(ctx);
  const parent = await instSvc.start({ workflowId: parentWf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(parent.status, 'completed', 'an independent child\'s failure does not fail the parent');

  const rel = await instSvc.related(parent.id);
  assert.strictEqual(rel.children[0]!.status, 'failed', 'the child itself still recorded its own failure');
});

test('signal delivery resumes a waiting catch-signal token', async () => {
  const ctx = newCtx();
  const { wf } = await deployWorkflow(ctx, 'Signal WF', (key, name) => ({
    id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
      nodes: [{ id: 'start', type: 'start' }, { id: 'wait', type: 'catch', event: { signal: 'Approve' } }, { id: 'end', type: 'end' }],
      flows: [{ from: 'start', to: 'wait' }, { from: 'wait', to: 'end' }] }],
  }));
  const instSvc = new InstanceService(ctx);
  const inst = await instSvc.start({ workflowId: wf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(inst.status, 'waiting');
  assert.ok(inst.tokens.some((t) => t.waitFor?.kind === 'signal' && t.waitFor?.ref === 'Approve'));

  await instSvc.signal(inst.id, 'Approve', { by: 'ops' }, 'ops');
  const done = await instSvc.get(inst.id);
  assert.strictEqual(done.status, 'completed', 'signal resumed the instance to completion');
  assert.deepStrictEqual(done.variables['Approve'], { by: 'ops' }, 'signal payload bound to a variable');
});

// Fixture has a real wait point (an unresolved signal catch) so the instance stays 'running'/'waiting'
// — not completed — while we exercise retry. A completed instance is a separate, terminal case (see
// the "rejected on a terminal instance" tests below): retrying a node there would silently resurrect
// a finished process (flip it back to 'running' and let it run further, possibly re-completing or
// failing) rather than erroring, which is exactly the bug this fixture used to paper over by using a
// process with no wait point at all — it always completed immediately, so this test never actually
// exercised "retry while still active" vs. "retry after completion" as two different cases.
test('node re-trigger drops a fresh token and re-runs the node (while the instance is still active)', async () => {
  const ctx = newCtx();
  const { wf } = await deployWorkflow(ctx, 'Retry WF', (key, name) => ({
    id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
      nodes: [
        { id: 'start', type: 'start' }, { id: 'work', type: 'manual', name: 'Work' },
        { id: 'wait', type: 'catch', event: { signal: 'NEVER' } }, { id: 'end', type: 'end' },
      ],
      flows: [{ from: 'start', to: 'work' }, { from: 'work', to: 'wait' }, { from: 'wait', to: 'end' }] }],
  }));
  const instSvc = new InstanceService(ctx);
  const inst = await instSvc.start({ workflowId: wf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(inst.status, 'waiting');
  const firstVisits = inst.history.filter((h) => h.nodeId === 'work').length;

  await instSvc.retry(inst.id, 'work', 'ops');
  const after = await instSvc.get(inst.id);
  assert.strictEqual(after.status, 'waiting', 'still parked at the signal catch — retry does not force completion');
  assert.strictEqual(after.history.filter((h) => h.nodeId === 'work').length, firstVisits + 1, 'work node ran again');
});

test('retry and signal are rejected on a terminal (completed) instance', async () => {
  const ctx = newCtx();
  const { wf } = await deployWorkflow(ctx, 'Terminal Retry WF', (key, name) => ({
    id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
      nodes: [{ id: 'start', type: 'start' }, { id: 'work', type: 'manual', name: 'Work' }, { id: 'end', type: 'end' }],
      flows: [{ from: 'start', to: 'work' }, { from: 'work', to: 'end' }] }],
  }));
  const instSvc = new InstanceService(ctx);
  const inst = await instSvc.start({ workflowId: wf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(inst.status, 'completed');
  const historyLenBefore = inst.history.length;

  await assert.rejects(instSvc.retry(inst.id, 'work', 'ops'), /completed/);
  await assert.rejects(instSvc.signal(inst.id, 'anything', undefined, 'ops'), /completed/);
  const after = await instSvc.get(inst.id);
  assert.strictEqual(after.status, 'completed', 'rejection did not mutate the instance');
  assert.strictEqual(after.history.length, historyLenBefore, 'no new history entries from the rejected calls');
});
