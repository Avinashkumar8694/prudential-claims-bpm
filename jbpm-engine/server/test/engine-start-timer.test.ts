// Start-timer / cron scheduled starts: activating a deployment whose start node carries a timer
// trigger schedules a start job; when the scheduler tick() passes its due time a fresh instance is
// created. A recurring (R/…) cycle reschedules the next occurrence. Deactivating cancels the schedule.
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { fakeClock } from '../src/infra/ids.ts';
import { makeContext } from '../src/context.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { VersionService } from '../src/modules/versions/service.ts';
import { DeploymentService } from '../src/modules/deployments/service.ts';
import { InstanceService } from '../src/modules/instances/service.ts';
import { TimerService } from '../src/modules/timers/service.ts';
import { Collections, type TimerJob } from '../src/domain.ts';

function newCtx() {
  let n = 0;
  const fc = fakeClock();
  const store = new MemoryStore();
  return { store, ctx: makeContext({ store, tenantId: 't1', clock: fc.clock, newId: () => `id${++n}` }) };
}

const engineOf = (key: string, timer: unknown) => ({
  id: key, name: key,
  processes: [{
    id: `${key}.process`, name: key, package: 'com.acme', vars: [],
    nodes: [
      { id: 'start', type: 'start', name: 'Start', on: { timer } },
      { id: 'work', type: 'script', lang: 'js', code: '/* noop */' },
      { id: 'end', type: 'end', name: 'End' },
    ],
    flows: [{ from: 'start', to: 'work' }, { from: 'work', to: 'end' }],
  }],
});

async function publishDeploy(ctx: any, timer: unknown, activate = true) {
  const wf = await new WorkflowService(ctx).create({ name: 'Nightly' }, 'alice');
  const verSvc = new VersionService(ctx);
  const draft = await verSvc.saveDraft(wf.defaultBranchId, engineOf(wf.key, timer) as any, 'alice');
  const { published } = await verSvc.publish(draft.id, 'alice', 'v1');
  const dep = await new DeploymentService(ctx).deploy(published.id, { environment: 'prod', activate }, 'alice');
  return { wf, dep };
}

test('one-shot start timer schedules a job and fires a new instance at its due time', async () => {
  const { store, ctx } = newCtx();
  await publishDeploy(ctx, 'PT1H');   // fire once, 1h after activation
  const timers = new TimerService(ctx);
  const instSvc = new InstanceService(ctx);

  const scheduled = await store.repo<TimerJob>(Collections.timers).query((t) => t.kind === 'start' && t.status === 'scheduled');
  assert.strictEqual(scheduled.length, 1, 'a start job was scheduled on activation');

  // before due: nothing fires
  assert.strictEqual(await timers.tick('2020-01-01T00:30:00.000Z'), 0);
  assert.strictEqual((await instSvc.list({})).length, 0);

  // after due: one instance is created and runs to completion
  const fired = await timers.tick('2999-01-01T00:00:00.000Z');
  assert.strictEqual(fired, 1);
  const instances = await instSvc.list({});
  assert.strictEqual(instances.length, 1, 'the scheduler started an instance');
  assert.strictEqual(instances[0]!.status, 'completed');
  assert.strictEqual(instances[0]!.startedBy, 'timer');
});

test('recurring start (R/…) reschedules the next occurrence after firing', async () => {
  const { store, ctx } = newCtx();
  await publishDeploy(ctx, 'R/PT1H');
  const timers = new TimerService(ctx);
  const repo = store.repo<TimerJob>(Collections.timers);

  await timers.tick('2999-01-01T00:00:00.000Z');
  const scheduled = await repo.query((t) => t.kind === 'start' && t.status === 'scheduled');
  assert.strictEqual(scheduled.length, 1, 'next occurrence rescheduled');
  const fired = await repo.query((t) => t.kind === 'start' && t.status === 'fired');
  assert.strictEqual(fired.length, 1, 'the first occurrence is marked fired');
});

test('deactivating the deployment cancels its scheduled starts', async () => {
  const { store, ctx } = newCtx();
  const { dep } = await publishDeploy(ctx, 'PT1H');
  const repo = store.repo<TimerJob>(Collections.timers);
  assert.strictEqual((await repo.query((t) => t.status === 'scheduled')).length, 1);

  await new DeploymentService(ctx).undeploy(dep.id, 'alice');
  assert.strictEqual((await repo.query((t) => t.status === 'scheduled')).length, 0, 'schedule cancelled on undeploy');
});
