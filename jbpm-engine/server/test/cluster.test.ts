// Multi-replica behaviour: every workspace limit must hold no matter how many replicas run. Replicas are simulated as
// several Coordinators over ONE shared backend — an in-memory stand-in with a fake clock, and the real Redis backend
// too when REDIS_URL points at a server (the same contract runs against both).
import { test, after } from 'node:test';
import assert from 'node:assert';
import { Coordinator, MemoryBackend, connectRedis, setCoordinator, resetCoordinator, type SharedBackend } from '../src/infra/coordinator.ts';
import { replicaShare } from '../src/modules/platform/limits.ts';
import { PlanService } from '../src/modules/plans/plans.ts';
import { PLAN_LIMIT_KEYS } from '../src/modules/plans/plan-limits.ts';
import { boot } from './harness.ts';
import { resetPlanGates } from '../src/http/plan-gates.ts';
import { resetRateLimits } from '../src/http/rate-limit.ts';
import { MemoryStore } from '../src/store/memory-store.ts';
import { makeContext } from '../src/context.ts';
import { fakeClock } from '../src/infra/ids.ts';
import { TimerService } from '../src/modules/timers/service.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { VersionService } from '../src/modules/versions/service.ts';
import { DeploymentService } from '../src/modules/deployments/service.ts';
import { InstanceService } from '../src/modules/instances/service.ts';

const TTL = 20_000;
function fleet(n: number, backend: SharedBackend) {
  return Array.from({ length: n }, (_, i) => new Coordinator(backend, { replicaId: `pod-${String(i).padStart(2, '0')}`, leaseTtlMs: TTL, heartbeatMs: 0 }));
}
let t = 1_000_000;
const clock = { now: () => t, advance: (ms: number) => { t += ms; } };

type Maker = { name: string; make: () => Promise<{ backend: SharedBackend; reset: () => Promise<void> }> };
const opened: SharedBackend[] = [];
after(async () => { for (const b of opened) await b.close(); });
const makers: Maker[] = [{ name: 'shared in-memory', make: async () => { const b = new MemoryBackend(clock.now, true); return { backend: b, reset: async () => b.clear() }; } }];
if (process.env.REDIS_URL) {
  makers.push({ name: 'redis', make: async () => {
    const b = await connectRedis(process.env.REDIS_URL!, `orkestr-test-${Date.now()}-${Math.random().toString(36).slice(2)}:`);
    opened.push(b);
    return { backend: b, reset: async () => {} };
  } });
}

for (const m of makers) {
  // the Redis server owns its clock, so expiry-by-clock-advance is exercised on the in-memory backend only
  const fake = m.name !== 'redis';
  const T = (id: string, name: string, fn: () => Promise<void>) => test(`${id} [${m.name}] ${name}`, fn);

  T('CLU-01', 'concurrent-request slots are shared: 5 replicas × 20 attempts admit exactly the plan limit (10) in total', async () => {
    const { backend } = await m.make(); const pods = fleet(5, backend);
    const got = await Promise.all(Array.from({ length: 100 }, (_, i) => pods[i % 5].acquire('req', 'ws-a', 10)));
    assert.strictEqual(got.filter(Boolean).length, 10, 'never more than the limit, whichever replica the request lands on');
    assert.strictEqual(await pods[0].inUse('req', 'ws-a'), 10);
    await got.find(Boolean)!();
    assert.ok(await pods[3].acquire('req', 'ws-a', 10), 'a freed slot is usable from any replica');
    assert.strictEqual(await pods[2].acquire('req', 'ws-a', 10), null);
    assert.ok(await pods[2].acquire('req', 'ws-b', 10), 'another workspace is unaffected');
    for (const r of got) await r?.();
  });

  T('CLU-02', 'requests-per-minute is one budget for the whole cluster, and it resets with the window', async () => {
    const { backend } = await m.make(); const pods = fleet(4, backend);
    const hits = await Promise.all(Array.from({ length: 250 }, (_, i) => pods[i % 4].rate('ws-r', 100)));
    assert.strictEqual(hits.filter((h) => h.ok).length, 100);
    const denied = hits.find((h) => !h.ok)!;
    assert.ok(denied.retryMs > 0 && denied.retryMs <= 60_000);
    if (fake) { clock.advance(60_001); assert.ok((await pods[1].rate('ws-r', 100)).ok, 'next window starts fresh'); }
  });

  T('CLU-03', 'maxReplicas: of 10 replicas exactly 2 may serve a workspace; the others are refused', async () => {
    const { backend } = await m.make(); const pods = fleet(10, backend);
    const res = await Promise.all(pods.map((p) => p.place('ws-p', 2)));
    assert.strictEqual(res.filter((r) => r.ok).length, 2);
    assert.deepStrictEqual((await pods[0].holders('ws-p')).length, 2);
    // refused replicas stay refused while the holders are alive
    for (let i = 0; i < 3; i++) for (const p of pods) assert.strictEqual((await p.place('ws-p', 2)).ok, res[pods.indexOf(p)].ok);
    // a different workspace gets its own two slots
    assert.strictEqual((await Promise.all(pods.map((p) => p.place('ws-q', 2)))).filter((r) => r.ok).length, 2);
    // unlimited (0) lets everyone in, and everyone is counted
    const all = await Promise.all(pods.map((p) => p.place('ws-open', 0)));
    assert.ok(all.every((r) => r.ok));
    assert.strictEqual((await pods[0].holders('ws-open')).length, 10);
  });

  T('CLU-04', 'lowering maxReplicas takes effect on the next refresh on every replica: the survivors are the same ones everywhere', async () => {
    const { backend } = await m.make(); const pods = fleet(6, backend);
    await Promise.all(pods.map((p) => p.place('ws-s', 4)));
    assert.strictEqual((await pods[0].holders('ws-s')).length, 4);
    // the admin cuts it to 1 — each replica re-evaluates with the new number
    const after = await Promise.all(pods.map((p) => p.place('ws-s', 1)));
    assert.strictEqual(after.filter((r) => r.ok).length, 1);
    assert.deepStrictEqual(await pods[0].holders('ws-s'), [pods.find((_, i) => after[i].ok)!.replicaId]);
    // raising it again lets others in
    const up = await Promise.all(pods.map((p) => p.place('ws-s', 3)));
    assert.strictEqual(up.filter((r) => r.ok).length, 3);
  });

  T('CLU-05', 'a crashed replica frees its slots: leases expire and another replica takes over', async () => {
    if (!fake) return;
    const { backend } = await m.make(); const pods = fleet(3, backend);
    assert.ok((await pods[0].place('ws-c', 1)).ok);
    assert.ok(!(await pods[1].place('ws-c', 1)).ok, 'pod-00 holds the only slot');
    const slot = await pods[0].acquire('req', 'ws-c', 1);
    assert.ok(slot);
    assert.strictEqual(await pods[1].acquire('req', 'ws-c', 1), null);
    clock.advance(TTL + 1);                       // pod-00 died without releasing anything
    assert.ok((await pods[1].place('ws-c', 1)).ok, 'the slot moved to a live replica');
    assert.ok(await pods[2].acquire('req', 'ws-c', 1), 'and so did the request slot');
  });

  T('CLU-06', 'a replica that is still alive keeps its slot (renewal) and a graceful stop hands it over at once', async () => {
    const { backend } = await m.make(); const [a, b] = fleet(2, backend);
    assert.ok((await a.place('ws-g', 1)).ok);
    if (fake) { clock.advance(TTL - 1000); assert.ok((await a.place('ws-g', 1)).ok); clock.advance(TTL - 1000); assert.ok(!(await b.place('ws-g', 1)).ok, 'renewed, so still a\'s'); }
    await a.stop();
    assert.ok((await b.place('ws-g', 1)).ok, 'stop() released the slot immediately');
  });

  T('CLU-07', 'one-owner claims: of 10 replicas racing for the same timer job exactly one wins; it is free again once released', async () => {
    const { backend } = await m.make(); const pods = fleet(10, backend);
    const got = await Promise.all(pods.map((p) => p.claim('timer:job-1')));
    assert.strictEqual(got.filter(Boolean).length, 1);
    await got.find(Boolean)!();
    assert.ok(await pods[7].claim('timer:job-1'));
  });

  T('CLU-08', 'cluster mutex: concurrent read-modify-write from different replicas never loses an update', async () => {
    const { backend } = await m.make(); const pods = fleet(4, backend);
    let counter = 0;
    await Promise.all(Array.from({ length: 40 }, (_, i) => pods[i % 4].mutex('usage:ws', async () => {
      const read = counter; await new Promise((r) => setTimeout(r, 1)); counter = read + 1;
    })));
    assert.strictEqual(counter, 40);
  });
}

// ------------------------------------------------------------------------------------------ pure parts
test('CLU-09 a workspace\'s script pool is split exactly across the replicas holding it (sums to the limit, never below 1 each)', async () => {
  const backend = new MemoryBackend(clock.now, true); const pods = fleet(4, backend);
  const shareFor = async (size: number, holders: number, queue = 100) => {
    const ws = `ws-split-${size}-${holders}-${Math.random()}`;
    const live = pods.slice(0, holders);
    for (const p of live) await p.place(ws, 0);
    for (const p of live) await p.place(ws, 99);        // second look with a new max forces a refresh: everyone sees all holders
    for (const p of live) await p.place(ws, 0);
    const out = [];
    for (const p of live) { setCoordinator(p); out.push(replicaShare(ws, { scriptPoolSize: size, scriptQueueMax: queue })); }
    return out;
  };
  for (const [size, holders] of [[8, 1], [8, 2], [5, 2], [7, 3], [2, 2], [1, 3], [3, 4]] as const) {
    const s = await shareFor(size, holders);
    const total = s.reduce((a, x) => a + x.size, 0);
    assert.ok(s.every((x) => x.size >= 1));
    if (holders <= size) assert.strictEqual(total, size, `size ${size} over ${holders} replicas adds up to exactly ${size}`);
    assert.strictEqual(s.every((x) => x.clusterCap === size), holders > size, `shared slot needed only when there are more replicas (${holders}) than slots (${size})`);
    assert.ok(s.reduce((a, x) => a + x.queueMax, 0) >= 100, 'queue shares cover the whole queue');
  }
  assert.strictEqual((await shareFor(8, 2, 0))[0].queueMax, 0, 'queue 0 stays 0');
  resetCoordinator();
});

test('CLU-10 without Redis the coordinator is private and single-process: placement is always granted, mutex is a plain call', async () => {
  const c = new Coordinator(new MemoryBackend(), { replicaId: 'solo', leaseTtlMs: TTL, heartbeatMs: 0 });
  assert.strictEqual(c.shared, false);
  assert.ok((await c.place('ws', 1)).ok);
  assert.strictEqual(await c.mutex('k', async () => 7), 7);
});

test('CLU-11 Redis outage degrades to per-replica enforcement instead of failing requests', async () => {
  const broken: SharedBackend = { kind: 'redis', lease: async () => { throw new Error('ECONNREFUSED'); }, release: async () => { throw new Error('x'); }, members: async () => { throw new Error('x'); }, hit: async () => { throw new Error('x'); }, close: async () => {} };
  const c = new Coordinator(broken, { replicaId: 'a', leaseTtlMs: TTL, heartbeatMs: 0 });
  const got = await Promise.all(Array.from({ length: 5 }, () => c.acquire('req', 'ws', 3)));
  assert.strictEqual(got.filter(Boolean).length, 3, 'still limited — by the local backend');
  assert.match(c.kind, /degraded/);
  assert.ok((await c.place('ws', 1)).ok);
});

// ------------------------------------------------------------------------------------------ timers
test('CLU-12 timers fire exactly once however many replicas tick at the same moment', async () => {
  let n = 0; const store = new MemoryStore(); const fc = fakeClock('2025-01-01T00:00:00.000Z');
  const ctx = makeContext({ store, tenantId: 't1', clock: fc.clock, newId: () => `id${++n}` });
  const wf = await new WorkflowService(ctx).create({ name: 'Cluster SLA' }, 'a');
  const draft = await new VersionService(ctx).saveDraft(wf.defaultBranchId, { id: wf.key, name: wf.name, processes: [{
    id: `${wf.key}.process`, name: wf.name, package: 'com.acme', vars: [],
    nodes: [{ id: 's', type: 'start' }, { id: 'review', type: 'userTask', name: 'Review', group: 'ops' },
      { id: 'sla', type: 'boundary', name: 'SLA', on: ['review'], event: { timer: { duration: 'PT1H' } }, interrupting: true },
      { id: 'esc', type: 'manual', name: 'Escalate' }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'review' }, { id: 'f2', from: 'review', to: 'e' }, { id: 'f3', from: 'sla', to: 'esc' }, { id: 'f4', from: 'esc', to: 'e' }],
  }] } as any, 'a');
  const pub = await new VersionService(ctx).publish(draft.id, 'a');
  await new DeploymentService(ctx).deploy(pub.published.id, { environment: 'prod', activate: true }, 'a');
  const insts = [];
  for (let i = 0; i < 6; i++) insts.push(await new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod' }, 'bob'));

  const backend = new MemoryBackend(clock.now, true); const pods = fleet(5, backend);
  const firedBy = await Promise.all(pods.map((co) => new TimerService(ctx).tick('2025-01-01T01:00:01.000Z', {
    admit: async () => (await co.place('t1', 2)).ok,
    claim: (job) => co.claim(`timer:${job.id}`),
  })));
  assert.strictEqual(firedBy.reduce((a, x) => a + x, 0), 6, 'each of the 6 timers fired once in total');
  assert.ok(firedBy.filter((x) => x > 0).length <= 2, 'only the (at most 2) replicas allowed to serve the workspace did the work');
  for (const i of insts) assert.strictEqual((await new InstanceService(ctx).get(i.id)).status, 'completed');
  assert.strictEqual(await new TimerService(ctx).tick('2025-01-01T01:00:02.000Z'), 0, 'nothing left to fire');
});

// ------------------------------------------------------------------------------------------ HTTP gates
test('CLU-13 the HTTP gates use the shared state: placement 503 on a non-holder, plan limits counted across replicas, admin sets maxReplicas live', async () => {
  const h = await boot();
  try {
    const plans = new PlanService(h.store);
    const UNL = Object.fromEntries(PLAN_LIMIT_KEYS.map((k) => [k, -1]));
    await plans.update('custom', { limits: { ...UNL, maxReplicas: 1, concurrentRequests: 2, requestsPerMinute: 6 } }, 'test');
    const ws = await h.workspace('cluster-ws', ['viewer', 'operator', 'developer'], 'custom');
    const backend = new MemoryBackend(Date.now, true);
    const [podA, podB, podC] = fleet(3, backend).map((c) => { (c as any).opts.heartbeatMs = 5000; return c; });
    const list = () => h.call('GET', '/workflows', { token: ws.tokens.operator, tenant: ws.id });
    resetPlanGates(); resetRateLimits();

    setCoordinator(podA);
    const ok = await list();
    assert.strictEqual(ok.status, 200); assert.strictEqual(ok.headers.get('x-served-by'), 'pod-00');

    setCoordinator(podB);                              // same workspace, but pod-00 already holds its only slot
    const refused = await list();
    assert.strictEqual(refused.status, 503); assert.strictEqual(refused.body.error.code, 'REPLICA_NOT_ASSIGNED');
    assert.strictEqual(refused.headers.get('retry-after'), '1'); assert.strictEqual(refused.headers.get('x-served-by'), 'pod-01');

    // the platform admin raises the plan's maxReplicas to 2 — pod-01 is let in on its next look, no restart
    await plans.update('custom', { limits: { ...UNL, maxReplicas: 2, concurrentRequests: 2, requestsPerMinute: 6 } }, 'test');
    await new Promise((r) => setTimeout(r, 1100));
    assert.strictEqual((await list()).status, 200, 'pod-01 serves the workspace once the cap allows two replicas');

    // the budget is cluster-wide: pod-a already used one request, pod-b one more, ... the 6 per minute are shared
    setCoordinator(podA); await list();
    setCoordinator(podB); await list(); await list(); await list();
    const over = await list();
    assert.strictEqual(over.status, 429, 'sixth+ request in the minute is refused even though each pod alone only saw a few');
    assert.strictEqual(over.body.error.code, 'RATE_LIMITED');

    // concurrent-request slots held on ANOTHER replica count against this one
    resetPlanGates(); await plans.update('custom', { limits: { ...UNL, maxReplicas: 3, concurrentRequests: 2, requestsPerMinute: -1 } }, 'test');
    await new Promise((r) => setTimeout(r, 2100));
    const hold1 = await podC.acquire('req', ws.id, 2); const hold2 = await podC.acquire('req', ws.id, 2);
    assert.ok(hold1 && hold2);
    setCoordinator(podA);
    const busy = await list();
    assert.strictEqual(busy.status, 429); assert.match(busy.body.error.message, /concurrent API requests/);
    await hold1!();
    assert.strictEqual((await list()).status, 200, 'a slot freed on another replica is usable here');
    await hold2!();
  } finally { resetCoordinator(); await h.close(); }
});
