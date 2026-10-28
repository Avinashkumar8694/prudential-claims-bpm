// Gateway routing — exclusive/inclusive/parallel modes, default-flow fallback semantics, and joins.
// Previously ZERO test coverage existed for inclusive gateways at all, which is how a real bug (the
// default flow being taken unconditionally, alongside whatever else matched, instead of only as a
// fallback when nothing else matched) shipped unnoticed. These tests cover both the routing logic and
// the specific bug's regression case.
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { fakeClock } from '../src/infra/ids.ts';
import { makeContext, type AppContext } from '../src/context.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { VersionService } from '../src/modules/versions/service.ts';
import { DeploymentService } from '../src/modules/deployments/service.ts';
import { InstanceService } from '../src/modules/instances/service.ts';

const newCtx = () => { let n = 0; return makeContext({ store: new MemoryStore(), tenantId: 't1', clock: fakeClock().clock, newId: () => `id${++n}` }); };

async function run(ctx: AppContext, nodes: any[], flows: any[], variables: Record<string, unknown> = {}) {
  const wf = await new WorkflowService(ctx).create({ name: 'GW ' + nodes.map((n) => n.id).join('-') }, 'a');
  const draft = await new VersionService(ctx).saveDraft(wf.defaultBranchId, { id: wf.key, name: wf.name, processes: [{ id: `${wf.key}.process`, name: wf.name, package: 'com.acme', vars: [], nodes, flows }] } as any, 'a');
  const pub = await new VersionService(ctx).publish(draft.id, 'a');
  await new DeploymentService(ctx).deploy(pub.published.id, { environment: 'prod', activate: true }, 'a');
  return new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod', variables }, 'bob');
}

test('exclusive: first matching condition wins (array order), default is fallback-only', async () => {
  const inst = await run(newCtx(),
    [
      { id: 's', type: 'start' }, { id: 'g', type: 'gateway', mode: 'exclusive', default: 'fd' },
      { id: 'a', type: 'manual' }, { id: 'b', type: 'manual' }, { id: 'd', type: 'manual' }, { id: 'e', type: 'end' },
    ],
    [
      { id: 'f1', from: 's', to: 'g' },
      { id: 'fa', from: 'g', to: 'a', lang: 'js', when: 'false' },
      { id: 'fb', from: 'g', to: 'b', lang: 'js', when: 'true' },
      { id: 'fd', from: 'g', to: 'd' },
      { id: 'f2', from: 'a', to: 'e' }, { id: 'f3', from: 'b', to: 'e' }, { id: 'f4', from: 'd', to: 'e' },
    ],
  );
  assert.strictEqual(inst.status, 'completed', JSON.stringify(inst.error));
  assert.deepStrictEqual(inst.history.map((h) => h.nodeId).filter((id) => ['a', 'b', 'd'].includes(id)), ['b'], 'only the matching flow taken, default not touched');
});

test('exclusive: falls back to the default flow when nothing matches', async () => {
  const inst = await run(newCtx(),
    [
      { id: 's', type: 'start' }, { id: 'g', type: 'gateway', mode: 'exclusive', default: 'fd' },
      { id: 'a', type: 'manual' }, { id: 'd', type: 'manual' }, { id: 'e', type: 'end' },
    ],
    [
      { id: 'f1', from: 's', to: 'g' },
      { id: 'fa', from: 'g', to: 'a', lang: 'js', when: 'false' },
      { id: 'fd', from: 'g', to: 'd' },
      { id: 'f2', from: 'a', to: 'e' }, { id: 'f3', from: 'd', to: 'e' },
    ],
  );
  assert.strictEqual(inst.status, 'completed', JSON.stringify(inst.error));
  assert.ok(inst.history.some((h) => h.nodeId === 'd'), 'default flow taken since nothing else matched');
  assert.ok(!inst.history.some((h) => h.nodeId === 'a'));
});

test('parallel: forks down every outgoing flow unconditionally, joins wait for all incoming', async () => {
  const inst = await run(newCtx(),
    [
      { id: 's', type: 'start' }, { id: 'g', type: 'gateway', mode: 'parallel' },
      { id: 'a', type: 'manual' }, { id: 'b', type: 'manual' },
      { id: 'j', type: 'gateway', mode: 'parallel' }, { id: 'e', type: 'end' },
    ],
    [
      { id: 'f1', from: 's', to: 'g' }, { id: 'f2', from: 'g', to: 'a' }, { id: 'f3', from: 'g', to: 'b' },
      { id: 'f4', from: 'a', to: 'j' }, { id: 'f5', from: 'b', to: 'j' }, { id: 'f6', from: 'j', to: 'e' },
    ],
  );
  assert.strictEqual(inst.status, 'completed', JSON.stringify(inst.error));
  assert.ok(inst.history.some((h) => h.nodeId === 'a'));
  assert.ok(inst.history.some((h) => h.nodeId === 'b'));
  // The join node gets one history entry per incoming branch that arrives (one parked "join 1/2",
  // one "join-complete") — that's expected, not a bug. What must happen exactly once is the join
  // actually COMPLETING (spawning its successor) — confirmed by 'e' being reached exactly once, not
  // once per branch.
  assert.strictEqual(inst.history.filter((h) => h.nodeId === 'e').length, 1, 'join completes exactly once — successor spawned only after BOTH branches arrived, not per-branch');
});

test('inclusive: takes ALL matching flows, not just the first', async () => {
  const inst = await run(newCtx(),
    [
      { id: 's', type: 'start' }, { id: 'g', type: 'gateway', mode: 'inclusive' },
      { id: 'a', type: 'manual' }, { id: 'b', type: 'manual' }, { id: 'c', type: 'manual' },
      { id: 'j', type: 'gateway', mode: 'inclusive' }, { id: 'e', type: 'end' },
    ],
    [
      { id: 'f1', from: 's', to: 'g' },
      { id: 'fa', from: 'g', to: 'a', lang: 'js', when: 'true' },
      { id: 'fb', from: 'g', to: 'b', lang: 'js', when: 'true' },
      { id: 'fc', from: 'g', to: 'c', lang: 'js', when: 'false' },
      { id: 'f2', from: 'a', to: 'j' }, { id: 'f3', from: 'b', to: 'j' }, { id: 'f4', from: 'c', to: 'j' }, { id: 'f5', from: 'j', to: 'e' },
    ],
  );
  assert.strictEqual(inst.status, 'completed', JSON.stringify(inst.error));
  assert.ok(inst.history.some((h) => h.nodeId === 'a'), 'flow with true condition taken');
  assert.ok(inst.history.some((h) => h.nodeId === 'b'), 'a SECOND true-condition flow also taken (not just first)');
  assert.ok(!inst.history.some((h) => h.nodeId === 'c'), 'false-condition flow not taken');
});

// Regression for the specific bug found this session: the default flow used to be included in
// `taken` UNCONDITIONALLY (`(f.id && f.id === node.default) || evalCondition(...)`), meaning it fired
// on every execution regardless of whether any other flow also matched. Reproduced directly: a
// true-condition flow ('a') plus a no-condition default flow ('d') — only 'a' should fire.
test('inclusive: the default flow is a FALLBACK ONLY — NOT taken when another flow already matched (regression)', async () => {
  const inst = await run(newCtx(),
    [
      { id: 's', type: 'start' }, { id: 'g', type: 'gateway', mode: 'inclusive', default: 'fd' },
      { id: 'a', type: 'manual' }, { id: 'd', type: 'manual' },
      { id: 'j', type: 'gateway', mode: 'inclusive' }, { id: 'e', type: 'end' },
    ],
    [
      { id: 'f1', from: 's', to: 'g' },
      { id: 'fa', from: 'g', to: 'a', lang: 'js', when: 'true' },
      { id: 'fd', from: 'g', to: 'd' },
      { id: 'f2', from: 'a', to: 'j' }, { id: 'f3', from: 'd', to: 'j' }, { id: 'f4', from: 'j', to: 'e' },
    ],
  );
  assert.strictEqual(inst.status, 'completed', JSON.stringify(inst.error));
  assert.ok(inst.history.some((h) => h.nodeId === 'a'), 'the matching flow fires');
  assert.ok(!inst.history.some((h) => h.nodeId === 'd'), 'the default must NOT fire — "a" already matched');
});

test('inclusive: falls back to the default flow only when NOTHING else matches', async () => {
  const inst = await run(newCtx(),
    [
      { id: 's', type: 'start' }, { id: 'g', type: 'gateway', mode: 'inclusive', default: 'fd' },
      { id: 'a', type: 'manual' }, { id: 'd', type: 'manual' }, { id: 'e', type: 'end' },
    ],
    [
      { id: 'f1', from: 's', to: 'g' },
      { id: 'fa', from: 'g', to: 'a', lang: 'js', when: 'false' },
      { id: 'fd', from: 'g', to: 'd' },
      { id: 'f2', from: 'a', to: 'e' }, { id: 'f3', from: 'd', to: 'e' },
    ],
  );
  assert.strictEqual(inst.status, 'completed', JSON.stringify(inst.error));
  assert.ok(inst.history.some((h) => h.nodeId === 'd'), 'default fires since nothing else matched');
  assert.ok(!inst.history.some((h) => h.nodeId === 'a'));
});
