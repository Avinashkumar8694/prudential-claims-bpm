// Timer catch waits, persists a durable TimerJob, and resumes when the scheduler fires it.
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.js';
import { fakeClock } from '../src/infra/ids.js';
import { makeContext } from '../src/context.js';
import { WorkflowService } from '../src/modules/workflows/service.js';
import { VersionService } from '../src/modules/versions/service.js';
import { DeploymentService } from '../src/modules/deployments/service.js';
import { InstanceService } from '../src/modules/instances/service.js';
import { TimerService } from '../src/modules/timers/service.js';
import { Collections, type TimerJob } from '../src/domain.js';
import { parseDuration, computeDue } from '../src/engine/duration.js';

test('parseDuration / computeDue', () => {
  assert.strictEqual(parseDuration('PT5M'), 300000);
  assert.strictEqual(parseDuration('P1DT2H'), (26 * 60 * 60) * 1000);
  assert.strictEqual(computeDue({ duration: 'PT5M' }, '2025-01-01T00:00:00.000Z'), '2025-01-01T00:05:00.000Z');
  assert.strictEqual(computeDue({ cycle: 'R/PT1H' }, '2025-01-01T00:00:00.000Z'), '2025-01-01T01:00:00.000Z');
});

test('catch-timer waits, schedules a durable timer, and the scheduler resumes it', async () => {
  let n = 0;
  const store = new MemoryStore();
  const ctx = makeContext({ store, tenantId: 't1', clock: fakeClock('2025-01-01T00:00:00.000Z').clock, newId: () => `id${++n}` });

  const wf = await new WorkflowService(ctx).create({ name: 'Timer WF' }, 'a');
  const draft = await new VersionService(ctx).saveDraft(wf.defaultBranchId, { id: wf.key, name: wf.name, processes: [{
    id: `${wf.key}.process`, name: wf.name, package: 'com.acme', vars: [],
    nodes: [{ id: 's', type: 'start' }, { id: 'wait', type: 'catch', name: 'Wait 5m', event: { timer: { duration: 'PT5M' } } }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'wait' }, { id: 'f2', from: 'wait', to: 'e' }],
  }] } as any, 'a');
  const pub = await new VersionService(ctx).publish(draft.id, 'a');
  await new DeploymentService(ctx).deploy(pub.published.id, { environment: 'prod', activate: true }, 'a');

  const inst = await new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(inst.status, 'waiting', 'waiting at the timer');
  const jobs = await store.repo<TimerJob>(Collections.timers).query((t) => t.instanceId === inst.id);
  assert.strictEqual(jobs.length, 1);
  assert.strictEqual(jobs[0]!.dueAt, '2025-01-01T00:05:00.000Z', 'due 5 minutes after start');
  assert.strictEqual(jobs[0]!.status, 'scheduled');

  // not due yet
  assert.strictEqual(await new TimerService(ctx).tick('2025-01-01T00:04:00.000Z'), 0);
  assert.strictEqual((await new InstanceService(ctx).get(inst.id)).status, 'waiting');

  // due → fires → instance resumes and completes
  const fired = await new TimerService(ctx).tick('2025-01-01T00:06:00.000Z');
  assert.strictEqual(fired, 1);
  const done = await new InstanceService(ctx).get(inst.id);
  assert.strictEqual(done.status, 'completed');
  assert.ok(done.history.some((h) => h.nodeId === 'e'));
});
