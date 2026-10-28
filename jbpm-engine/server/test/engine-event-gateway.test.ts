// Event-based gateway: forks a token onto every downstream catch; whichever fires first wins the
// race and the other branches' waiting tokens (and any backing TimerJob) are cancelled.
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { fakeClock } from '../src/infra/ids.ts';
import { makeContext, type AppContext } from '../src/context.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { VersionService } from '../src/modules/versions/service.ts';
import { DeploymentService } from '../src/modules/deployments/service.ts';
import { InstanceService } from '../src/modules/instances/service.ts';
import { TimerService } from '../src/modules/timers/service.ts';
import { Collections, type TimerJob } from '../src/domain.ts';

function newCtx() {
  let n = 0;
  const store = new MemoryStore();
  return { store, ctx: makeContext({ store, tenantId: 't1', clock: fakeClock('2025-01-01T00:00:00.000Z').clock, newId: () => `id${++n}` }) };
}
async function deploy(ctx: AppContext, name: string, mk: (k: string, n: string) => any) {
  const wf = await new WorkflowService(ctx).create({ name }, 'a');
  const d = await new VersionService(ctx).saveDraft(wf.defaultBranchId, mk(wf.key, wf.name), 'a');
  const pub = await new VersionService(ctx).publish(d.id, 'a');
  await new DeploymentService(ctx).deploy(pub.published.id, { environment: 'prod', activate: true }, 'a');
  return wf;
}

test('event gateway: two racing signal catches — the first to fire wins, the other is cancelled', async () => {
  const { ctx } = newCtx();
  const wf = await deploy(ctx, 'Event GW Signal Race', (key, name) => ({
    id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
      nodes: [
        { id: 's', type: 'start' }, { id: 'gw', type: 'gateway', mode: 'event' },
        { id: 'catchA', type: 'catch', event: { signal: 'A' } }, { id: 'catchB', type: 'catch', event: { signal: 'B' } },
        { id: 'endA', type: 'end', name: 'Got A' }, { id: 'endB', type: 'end', name: 'Got B' },
      ],
      flows: [
        { from: 's', to: 'gw' }, { from: 'gw', to: 'catchA' }, { from: 'gw', to: 'catchB' },
        { from: 'catchA', to: 'endA' }, { from: 'catchB', to: 'endB' },
      ] }],
  }));
  const thrower = await deploy(ctx, 'Fire A', (key, name) => ({
    id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
      nodes: [{ id: 's', type: 'start' }, { id: 't', type: 'throw', event: { signal: 'A' } }, { id: 'e', type: 'end' }],
      flows: [{ from: 's', to: 't' }, { from: 't', to: 'e' }] }],
  }));

  const instSvc = new InstanceService(ctx);
  const inst = await instSvc.start({ workflowId: wf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(inst.status, 'waiting');
  assert.strictEqual(inst.tokens.filter((t) => t.state === 'waiting').length, 2, 'both branches are racing');

  await instSvc.start({ workflowId: thrower.id, environment: 'prod' }, 'bob');

  const done = await instSvc.get(inst.id);
  assert.strictEqual(done.status, 'completed', 'signal A resolved the race');
  assert.strictEqual(done.tokens.length, 0, 'the losing branch (catchB) left no dangling token');
  assert.strictEqual(done.history.some((h) => h.nodeId === 'endA'), true, 'flow went through the A branch');
  assert.strictEqual(done.history.some((h) => h.nodeId === 'endB'), false, 'the B branch never ran');
});

test('event gateway: a signal wins the race against a timer branch — the timer job is cancelled, not just the token', async () => {
  const { ctx, store } = newCtx();
  const wf = await deploy(ctx, 'Event GW Signal-vs-Timer', (key, name) => ({
    id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
      nodes: [
        { id: 's', type: 'start' }, { id: 'gw', type: 'gateway', mode: 'event' },
        { id: 'catchSig', type: 'catch', event: { signal: 'Go' } }, { id: 'catchTimer', type: 'catch', event: { timer: { duration: 'PT5M' } } },
        { id: 'endSig', type: 'end' }, { id: 'endTimer', type: 'end' },
      ],
      flows: [
        { from: 's', to: 'gw' }, { from: 'gw', to: 'catchSig' }, { from: 'gw', to: 'catchTimer' },
        { from: 'catchSig', to: 'endSig' }, { from: 'catchTimer', to: 'endTimer' },
      ] }],
  }));
  const thrower = await deploy(ctx, 'Fire Go', (key, name) => ({
    id: key, name, processes: [{ id: `${key}.process`, name, package: 'com.acme', vars: [],
      nodes: [{ id: 's', type: 'start' }, { id: 't', type: 'throw', event: { signal: 'Go' } }, { id: 'e', type: 'end' }],
      flows: [{ from: 's', to: 't' }, { from: 't', to: 'e' }] }],
  }));

  const instSvc = new InstanceService(ctx);
  const inst = await instSvc.start({ workflowId: wf.id, environment: 'prod' }, 'bob');
  const jobsBefore = await store.repo<TimerJob>(Collections.timers).query((t) => t.instanceId === inst.id);
  assert.strictEqual(jobsBefore.length, 1, 'the timer branch scheduled a durable job');
  assert.strictEqual(jobsBefore[0]!.status, 'scheduled');

  await instSvc.start({ workflowId: thrower.id, environment: 'prod' }, 'bob');
  const done = await instSvc.get(inst.id);
  assert.strictEqual(done.status, 'completed', 'signal resolved the race before the timer was due');
  assert.strictEqual(done.history.some((h) => h.nodeId === 'endSig'), true);

  const jobsAfter = await store.repo<TimerJob>(Collections.timers).query((t) => t.instanceId === inst.id);
  assert.strictEqual(jobsAfter[0]!.status, 'cancelled', 'the losing timer branch\'s job was cancelled, not left dangling');

  // advancing time past the (cancelled) timer's due date must not resume/error on the dead token
  const fired = await new TimerService(ctx).tick('2025-01-01T00:06:00.000Z');
  assert.strictEqual(fired, 0, 'the cancelled job never fires');
});
