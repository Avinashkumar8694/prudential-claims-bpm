import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { makeContext } from '../src/context.ts';
import { newId, fakeClock } from '../src/infra/ids.ts';
import { ExecutionEngine } from '../src/engine/execution-engine.ts';
import { runDueTimers } from '../src/engine/timer-executor.ts';
import { Collections, type Deployment, type TimerJob } from '../src/domain.ts';
import type { EngineNode, EngineProcess } from '../src/sdk/index.ts';

function makeSetup() {
  const store = new MemoryStore();
  const clock = fakeClock();
  const makeCtx = (tenantId: string) => makeContext({ store, tenantId, clock: clock.clock, newId });
  const ctx = makeCtx('t1');
  const engine = new ExecutionEngine(ctx, () => {});
  const runDue = () => runDueTimers({ store, makeCtx, now: clock.clock });
  return { store, makeCtx, ctx, engine, advance: clock.advance, runDue };
}

// Persisted into the store (not just held in memory) — runDueTimers, unlike engine.start()/resumeToken()
// which are handed a Deployment object directly, has to rediscover it via inst.deploymentId on its own,
// exactly like InstancesService/TasksService do.
async function deploymentWith(store: MemoryStore, proc: EngineProcess): Promise<Deployment> {
  const dep: Deployment = {
    id: newId(), tenantId: 't1', workflowId: 'wf1', versionId: 'v1', branchId: 'b1',
    environment: 'test', status: 'active', engine: { id: 'e1', name: 'e', processes: [proc] },
    env: {}, tags: [], deployedAt: '2025-01-01T00:00:00.000Z', deployedBy: 'tester',
  };
  await store.repo<Deployment>(Collections.deployments).put(dep);
  return dep;
}

test('a due duration timer is fired by the executor and the instance completes', async () => {
  const { store, ctx, engine, advance, runDue } = makeSetup();
  const proc: EngineProcess = {
    id: 'p1', nodes: [
      { id: 'start', type: 'start' } as EngineNode,
      { id: 'wait', type: 'catch', event: { timer: { duration: 'PT1H' } } } as EngineNode,
      { id: 'end', type: 'end' } as EngineNode,
    ],
    flows: [{ from: 'start', to: 'wait' }, { from: 'wait', to: 'end' }],
  };
  const dep = await deploymentWith(store, proc);
  const inst = await engine.start(dep, {}, 'tester');
  assert.strictEqual(inst.status, 'waiting');

  const before = await runDue();
  assert.strictEqual(before, 0, 'not due yet');

  advance(61 * 60 * 1000); // 61 minutes — past the 1-hour duration
  const fired = await runDue();
  assert.strictEqual(fired, 1);

  const resumed = await ctx.store.repo<import('../src/domain.ts').Instance>(Collections.instances).get(inst.id);
  assert.strictEqual(resumed!.status, 'completed');

  const jobs = await store.repo<TimerJob>(Collections.timers).query((j) => j.instanceId === inst.id);
  assert.strictEqual(jobs[0]!.status, 'fired');
});

test('a cycle timer reschedules itself until its count is exhausted', async () => {
  const { store, engine, advance, runDue } = makeSetup();
  const proc: EngineProcess = {
    id: 'p1', nodes: [
      { id: 'start', type: 'start' } as EngineNode,
      { id: 'wait', type: 'catch', event: { message: 'never' } } as EngineNode,
      { id: 'b1', type: 'boundary', on: 'wait', event: { timer: { cycle: 'R2/PT10M' } }, interrupting: false } as EngineNode,
      { id: 'loopEnd', type: 'end' } as EngineNode,
    ],
    flows: [{ from: 'start', to: 'wait' }, { from: 'b1', to: 'loopEnd' }],
  };
  const dep = await deploymentWith(store, proc);
  const inst = await engine.start(dep, {}, 'tester');
  assert.strictEqual(inst.status, 'waiting');

  advance(11 * 60 * 1000);
  assert.strictEqual(await runDue(), 1);
  let jobs = await store.repo<TimerJob>(Collections.timers).query((j) => j.nodeId === 'b1');
  assert.strictEqual(jobs.length, 1);
  assert.strictEqual(jobs[0]!.status, 'scheduled', 'first firing reschedules (count=2, fired=1)');
  assert.strictEqual(jobs[0]!.fired, 1);

  advance(11 * 60 * 1000);
  assert.strictEqual(await runDue(), 1);
  jobs = await store.repo<TimerJob>(Collections.timers).query((j) => j.nodeId === 'b1');
  assert.strictEqual(jobs[0]!.status, 'fired', 'second firing exhausts count=2');
  assert.strictEqual(jobs[0]!.fired, 2);

  advance(11 * 60 * 1000);
  assert.strictEqual(await runDue(), 0, 'no longer scheduled — nothing left to fire');
});

test('a stale job whose instance already completed is retired without firing', async () => {
  const { store, engine, runDue } = makeSetup();
  const proc: EngineProcess = {
    id: 'p1', nodes: [{ id: 'start', type: 'start' } as EngineNode, { id: 'end', type: 'end' } as EngineNode],
    flows: [{ from: 'start', to: 'end' }],
  };
  const dep = await deploymentWith(store, proc);
  const inst = await engine.start(dep, {}, 'tester');
  assert.strictEqual(inst.status, 'completed');

  await store.repo<TimerJob>(Collections.timers).put({
    id: newId(), tenantId: 't1', instanceId: inst.id, tokenId: 'gone', nodeId: 'end',
    kind: 'duration', dueAt: '2000-01-01T00:00:00.000Z', fired: 0, status: 'scheduled',
  });
  assert.strictEqual(await runDue(), 0);
  const jobs = await store.repo<TimerJob>(Collections.timers).query((j) => j.instanceId === inst.id);
  assert.strictEqual(jobs[0]!.status, 'cancelled');
});
