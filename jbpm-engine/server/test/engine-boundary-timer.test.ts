// A timer boundary on a waiting host fires via the scheduler: interrupting cancels the host and runs
// the recovery path; completing the host before it fires cancels the timer.
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
import { TimerService } from '../src/modules/timers/service.ts';
import { Collections, type Task } from '../src/domain.ts';

function ctxAt(iso: string) { let n = 0; const store = new MemoryStore(); const fc = fakeClock(iso); return { store, fc, ctx: makeContext({ store, tenantId: 't1', clock: fc.clock, newId: () => `id${++n}` }) }; }
async function deployTimerReview(ctx: any) {
  const wf = await new WorkflowService(ctx).create({ name: 'SLA ' + Math.random().toString(36).slice(2) }, 'a');
  const draft = await new VersionService(ctx).saveDraft(wf.defaultBranchId, { id: wf.key, name: wf.name, processes: [{
    id: `${wf.key}.process`, name: wf.name, package: 'com.acme', vars: [],
    nodes: [{ id: 's', type: 'start' }, { id: 'review', type: 'userTask', name: 'Review', group: 'ops' },
      { id: 'sla', type: 'boundary', name: 'SLA', on: ['review'], event: { timer: { duration: 'PT1H' } }, interrupting: true },
      { id: 'esc', type: 'manual', name: 'Escalate' }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'review' }, { id: 'f2', from: 'review', to: 'e' }, { id: 'f3', from: 'sla', to: 'esc' }, { id: 'f4', from: 'esc', to: 'e' }],
  }] } as any, 'a');
  const pub = await new VersionService(ctx).publish(draft.id, 'a');
  await new DeploymentService(ctx).deploy(pub.published.id, { environment: 'prod', activate: true }, 'a');
  return wf;
}

test('timer boundary fires while the user task waits → interrupting → escalation path', async () => {
  const { ctx } = ctxAt('2025-01-01T00:00:00.000Z');
  const wf = await deployTimerReview(ctx);
  const inst = await new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(inst.status, 'waiting');
  // not due yet
  assert.strictEqual(await new TimerService(ctx).tick('2025-01-01T00:30:00.000Z'), 0);
  // due (1h later) → boundary fires, cancels the task, runs escalation → complete
  assert.strictEqual(await new TimerService(ctx).tick('2025-01-01T01:00:01.000Z'), 1);
  const done = await new InstanceService(ctx).get(inst.id);
  assert.strictEqual(done.status, 'completed');
  assert.ok(done.history.some((h) => h.nodeId === 'esc'), 'escalation ran');
});

test('a non-interrupting boundary timer with a cycle recurs, and stops after its ISO repeat count', async () => {
  const { ctx } = ctxAt('2025-01-01T00:00:00.000Z');
  const wf = await new WorkflowService(ctx).create({ name: 'Recurring Reminder' }, 'a');
  const draft = await new VersionService(ctx).saveDraft(wf.defaultBranchId, { id: wf.key, name: wf.name, processes: [{
    id: `${wf.key}.process`, name: wf.name, package: 'com.acme', vars: [],
    nodes: [
      { id: 's', type: 'start' }, { id: 'review', type: 'userTask', name: 'Review', group: 'ops' },
      { id: 'sla', type: 'boundary', name: 'Reminder', on: ['review'], interrupting: false, event: { timer: { cycle: 'R3/PT1H' } } },
      { id: 'remind', type: 'script', lang: 'js', code: "kcontext.setVariable('reminders', (kcontext.getVariable('reminders')||0) + 1);" },
      { id: 'remEnd', type: 'end' }, { id: 'e', type: 'end' },
    ],
    flows: [{ from: 's', to: 'review' }, { from: 'review', to: 'e' }, { from: 'sla', to: 'remind' }, { from: 'remind', to: 'remEnd' }],
  }] } as any, 'a');
  const pub = await new VersionService(ctx).publish(draft.id, 'a');
  await new DeploymentService(ctx).deploy(pub.published.id, { environment: 'prod', activate: true }, 'a');

  const instSvc = new InstanceService(ctx);
  const inst = await instSvc.start({ workflowId: wf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(inst.status, 'waiting');
  const timers = new TimerService(ctx);

  assert.strictEqual(await timers.tick('2025-01-01T01:00:01.000Z'), 1, '1st reminder fires');
  assert.strictEqual((await instSvc.get(inst.id)).status, 'waiting', 'non-interrupting: host task untouched');
  assert.strictEqual((await instSvc.get(inst.id)).variables.reminders, 1);

  assert.strictEqual(await timers.tick('2025-01-01T02:00:01.000Z'), 1, '2nd reminder fires (rescheduled)');
  assert.strictEqual((await instSvc.get(inst.id)).variables.reminders, 2);

  assert.strictEqual(await timers.tick('2025-01-01T03:00:01.000Z'), 1, '3rd reminder fires — R3 limit reached');
  assert.strictEqual((await instSvc.get(inst.id)).variables.reminders, 3);

  assert.strictEqual(await timers.tick('2025-01-01T04:00:01.000Z'), 0, 'no 4th reminder — repeat count exhausted, not rescheduled');
  assert.strictEqual((await instSvc.get(inst.id)).status, 'waiting', 'host task still never cancelled');
});

test('completing the task before the SLA cancels the boundary timer (no escalation)', async () => {
  const { ctx, store } = ctxAt('2025-01-01T00:00:00.000Z');
  const wf = await deployTimerReview(ctx);
  const inst = await new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod' }, 'bob');
  const task = (await store.repo<Task>(Collections.tasks).query((t) => t.instanceId === inst.id))[0]!;
  await new TaskService(ctx).complete(task.id, {}, 'carol');    // completes review → cancels SLA timer
  const fired = await new TimerService(ctx).tick('2025-01-01T02:00:00.000Z');
  assert.strictEqual(fired, 0, 'SLA timer was cancelled');
  const done = await new InstanceService(ctx).get(inst.id);
  assert.strictEqual(done.status, 'completed');
  assert.ok(!done.history.some((h) => h.nodeId === 'esc'), 'no escalation');
});
