// End-to-end engine tests: build a tiny EngineProcess by hand (no BPMN2 round-trip involved — that's
// bpmn-sdk's own job), run it through the real ExecutionEngine + MemoryStore, and assert on the
// resulting Instance (status/variables/history) plus persisted Tasks/Timers where relevant.
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { makeContext } from '../src/context.ts';
import { newId, fakeClock } from '../src/infra/ids.ts';
import { ExecutionEngine, type EngineEvent } from '../src/engine/execution-engine.ts';
import { Collections, type Deployment, type Task, type TimerJob } from '../src/domain.ts';
import type { EngineNode, EngineProcess } from '../src/sdk/index.ts';

function makeDeployment(processes: EngineProcess[]): Deployment {
  return {
    id: newId(), tenantId: 't1', workflowId: 'wf1', versionId: 'v1', branchId: 'b1',
    environment: 'test', status: 'active',
    engine: { id: 'e1', name: 'test-engine', processes },
    env: {}, tags: [], deployedAt: '2025-01-01T00:00:00.000Z', deployedBy: 'tester',
  };
}

function makeEngine() {
  const store = new MemoryStore();
  const { clock, advance } = fakeClock();
  const ctx = makeContext({ store, tenantId: 't1', clock, newId });
  const events: EngineEvent[] = [];
  const engine = new ExecutionEngine(ctx, (e) => events.push(e));
  return { store, ctx, events, engine, advance };
}

test('linear flow: start -> script -> end completes and applies script variables', async () => {
  const { engine, events } = makeEngine();
  const nodes: EngineNode[] = [
    { id: 'start', type: 'start' } as any,
    { id: 'setAmount', type: 'script', code: 'amount = 42;' } as any,
    { id: 'end', type: 'end' } as any,
  ];
  const proc: EngineProcess = {
    id: 'p1', vars: [{ name: 'amount', type: 'Integer' }], nodes,
    flows: [{ from: 'start', to: 'setAmount' }, { from: 'setAmount', to: 'end' }],
  };
  const dep = makeDeployment([proc]);
  const inst = await engine.start(dep, {}, 'tester');

  assert.strictEqual(inst.status, 'completed');
  assert.strictEqual(inst.variables.amount, 42);
  assert.strictEqual(inst.tokens.length, 0);
  assert.strictEqual(inst.history.length, 3);
  assert.deepStrictEqual(inst.history.map((h) => h.nodeId), ['start', 'setAmount', 'end']);
  assert.ok(inst.history.every((h) => h.exitedAt), 'every visit should have exited');
  assert.ok(events.some((e) => e.kind === 'instance.completed'));
});

test('exclusive gateway branches on the flow condition, not the default', async () => {
  const { engine } = makeEngine();
  const nodes: EngineNode[] = [
    { id: 'start', type: 'start' } as any,
    { id: 'gw', type: 'gateway', mode: 'exclusive', default: 'toLow' } as any,
    { id: 'endHigh', type: 'end' } as any,
    { id: 'endLow', type: 'end' } as any,
  ];
  const proc: EngineProcess = {
    id: 'p1', nodes,
    flows: [
      { from: 'start', to: 'gw' },
      { id: 'toHigh', from: 'gw', to: 'endHigh', when: 'amount > 100' },
      { id: 'toLow', from: 'gw', to: 'endLow' },
    ],
  };
  const dep = makeDeployment([proc]);

  const high = await engine.start(dep, { amount: 500 }, 'tester');
  assert.strictEqual(high.status, 'completed');
  assert.deepStrictEqual(high.history.map((h) => h.nodeId), ['start', 'gw', 'endHigh']);

  const low = await engine.start(dep, { amount: 5 }, 'tester');
  assert.strictEqual(low.status, 'completed');
  assert.deepStrictEqual(low.history.map((h) => h.nodeId), ['start', 'gw', 'endLow']);
});

test('user task parks the instance waiting and resuming it completes the process', async () => {
  const { engine, store } = makeEngine();
  const nodes: EngineNode[] = [
    { id: 'start', type: 'start' } as any,
    { id: 'review', type: 'userTask', name: 'Review', assignee: 'alice' } as any,
    { id: 'end', type: 'end' } as any,
  ];
  const proc: EngineProcess = {
    id: 'p1', nodes,
    flows: [{ from: 'start', to: 'review' }, { from: 'review', to: 'end' }],
  };
  const dep = makeDeployment([proc]);
  const inst = await engine.start(dep, {}, 'tester');

  assert.strictEqual(inst.status, 'waiting');
  assert.strictEqual(inst.tokens.length, 1);
  assert.strictEqual(inst.tokens[0]!.waitFor?.kind, 'task');

  const tasks = await store.repo<Task>(Collections.tasks).query((t) => t.instanceId === inst.id);
  assert.strictEqual(tasks.length, 1);
  assert.strictEqual(tasks[0]!.assignee, 'alice');
  assert.strictEqual(tasks[0]!.status, 'reserved');

  const resumed = await engine.resumeToken(inst, dep, inst.tokens[0]!.id, { decision: 'approved' });
  assert.strictEqual(resumed.status, 'completed');
  assert.strictEqual(resumed.variables.decision, 'approved');
});

test('a script error is caught by a global error boundary instead of failing the instance', async () => {
  const { engine } = makeEngine();
  const nodes: EngineNode[] = [
    { id: 'start', type: 'start' } as any,
    { id: 'risky', type: 'script', code: 'throw new Error("boom");' } as any,
    { id: 'end', type: 'end' } as any,
    { id: 'errBoundary', type: 'boundary', on: '*', event: { error: '*' }, interrupting: true } as any,
    { id: 'recoveryEnd', type: 'end' } as any,
  ];
  const proc: EngineProcess = {
    id: 'p1', nodes,
    flows: [
      { from: 'start', to: 'risky' }, { from: 'risky', to: 'end' },
      { from: 'errBoundary', to: 'recoveryEnd' },
    ],
  };
  const dep = makeDeployment([proc]);
  const inst = await engine.start(dep, {}, 'tester');

  assert.strictEqual(inst.status, 'completed');
  assert.deepStrictEqual(inst.history.map((h) => h.nodeId), ['start', 'risky', 'errBoundary', 'recoveryEnd']);
  assert.ok((inst.variables.errorInfo as any)?.message?.includes('boom'));
});

test('a script error with no matching catch fails the instance', async () => {
  const { engine } = makeEngine();
  const nodes: EngineNode[] = [
    { id: 'start', type: 'start' } as any,
    { id: 'risky', type: 'script', code: 'throw new Error("no catch here");' } as any,
    { id: 'end', type: 'end' } as any,
  ];
  const proc: EngineProcess = { id: 'p1', nodes, flows: [{ from: 'start', to: 'risky' }, { from: 'risky', to: 'end' }] };
  const dep = makeDeployment([proc]);
  const inst = await engine.start(dep, {}, 'tester');

  assert.strictEqual(inst.status, 'failed');
  assert.ok(inst.error?.message.includes('no catch here'));
  assert.strictEqual(inst.error?.nodeId, 'risky');
});

test('a timer catch schedules a TimerJob and firing it resumes the instance', async () => {
  const { engine, store } = makeEngine();
  const nodes: EngineNode[] = [
    { id: 'start', type: 'start' } as any,
    { id: 'wait', type: 'catch', event: { timer: { duration: 'PT1H' } } } as any,
    { id: 'end', type: 'end' } as any,
  ];
  const proc: EngineProcess = { id: 'p1', nodes, flows: [{ from: 'start', to: 'wait' }, { from: 'wait', to: 'end' }] };
  const dep = makeDeployment([proc]);
  const inst = await engine.start(dep, {}, 'tester');

  assert.strictEqual(inst.status, 'waiting');
  const jobs = await store.repo<TimerJob>(Collections.timers).query((j) => j.instanceId === inst.id && j.status === 'scheduled');
  assert.strictEqual(jobs.length, 1);
  assert.strictEqual(jobs[0]!.kind, 'duration');

  const resumed = await engine.fireTimerJob(inst, dep, 'wait', inst.tokens[0]!.id);
  assert.strictEqual(resumed.status, 'completed');
});

test('a terminate end with terminateAll wipes every token and marks the instance', async () => {
  const { engine } = makeEngine();
  const nodes: EngineNode[] = [
    { id: 'start', type: 'start' } as any,
    { id: 'gw', type: 'gateway', mode: 'parallel' } as any,
    { id: 'branchA', type: 'script', code: 'a = 1;' } as any,
    { id: 'endA', type: 'end' } as any,
    { id: 'branchB', type: 'end', result: 'terminate', terminateAll: true } as any,
  ];
  const proc: EngineProcess = {
    id: 'p1', nodes,
    flows: [
      { from: 'start', to: 'gw' },
      { from: 'gw', to: 'branchA' }, { from: 'branchA', to: 'endA' },
      { from: 'gw', to: 'branchB' },
    ],
  };
  const dep = makeDeployment([proc]);
  const inst = await engine.start(dep, {}, 'tester');

  assert.strictEqual(inst.status, 'completed');
  assert.strictEqual(inst.terminateAll, true);
  assert.strictEqual(inst.tokens.length, 0);
});
