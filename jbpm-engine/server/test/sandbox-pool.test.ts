// Bounded per-workspace isolate pool: state isolation, bounded creation, queueing, recycling, eviction, fairness.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { runScript, evalCondition, sandboxStats, configureSandbox, sandboxConfig } from '../src/engine/sandbox.ts';

const saved = { ...sandboxConfig() };
beforeEach(() => configureSandbox({ ...saved }));
afterEach(() => configureSandbox({ ...saved }));
const run = (code: string, tenantId: string, vars: Record<string, unknown> = {}, quota?: number, timeout = 2000) =>
  runScript(code, vars, timeout, { tenantId, maxConcurrentScripts: quota }).then(() => vars);
const burn = (ms: number) => `var t = Date.now(); while (Date.now() - t < ${ms}) {}`;
const code = (e: unknown) => (e as { code?: string })?.code;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('POOL-1 state set by one script (globalThis, Object/Array/String prototypes) is invisible to the next, same isolate and across workspaces', async () => {
  const poison = 'globalThis.leak = 42; Object.prototype.p = "pwn"; Array.prototype.q = 1; String.prototype.zz = function(){return 1}; Math.max = function(){return -1}; JSON.stringify = function(){return "x"}; leak2 = 7;';
  await run(poison, 'pool-a', {}, 1);
  const probe = 'vars.out = [typeof globalThis.leak, typeof ({}).p, typeof [].q, typeof "s".zz, Math.max(1,2), typeof leak2].join(",")';
  const same = await run(probe, 'pool-a', {}, 1);
  assert.strictEqual(same.out, 'undefined,undefined,undefined,undefined,2,undefined', 'same pooled isolate, fresh context');
  assert.strictEqual(sandboxStats().isolatesAlive['pool-a'], 1, 'it really was the same (single) isolate');
  const other = await run(probe, 'pool-b');
  assert.strictEqual(other.out, 'undefined,undefined,undefined,undefined,2,undefined', 'other workspace');
  const v = await run('', 'pool-a', { n: 1 }); // and the engine's own variables are untouched by the poison
  assert.deepStrictEqual(v, { n: 1 });
});

test('POOL-2 2000 parallel executions in one workspace: all correct, isolates ≤ pool size, ≤ global ceiling, RSS bounded', async () => {
  configureSandbox({ queueMax: 5000, queueTimeoutMs: 60_000 }); // the default queue (1000) would, by design, reject part of a 2000-burst
  const before = sandboxStats();
  const rss0 = process.memoryUsage().rss;
  let peakRss = rss0, peakIsolates = 0;
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); peakIsolates = Math.max(peakIsolates, sandboxStats().totalIsolates); }, 5);
  const N = 2000;
  const results = await Promise.all(Array.from({ length: N }, (_, i) => run('vars.out = vars.n * 2 + 1', 'pool-load', { n: i })));
  clearInterval(sampler);
  results.forEach((r, i) => assert.strictEqual(r.out, i * 2 + 1));
  const after = sandboxStats();
  assert.ok(after.created - before.created <= sandboxConfig().poolDefaultSize, `created ${after.created - before.created}`);
  assert.ok(peakIsolates <= sandboxConfig().maxIsolates, `peak isolates ${peakIsolates}`);
  assert.ok(after.isolatesAlive['pool-load'] <= sandboxConfig().poolDefaultSize);
  assert.ok((peakRss - rss0) / 1048576 < 500, `RSS growth ${(peakRss - rss0) / 1048576}MB`);
});

test('POOL-3 queue overflow and queue timeout surface as QUOTA_EXCEEDED; queued work still completes in order', async () => {
  configureSandbox({ queueMax: 3, queueTimeoutMs: 5000 });
  const running = run(burn(150), 'pool-q', {}, 1);                       // occupies the only isolate
  await sleep(20);
  const queued = Array.from({ length: 3 }, (_, i) => run('vars.i = ' + i, 'pool-q', {}, 1));
  await assert.rejects(run('1', 'pool-q', {}, 1), (e) => code(e) === 'QUOTA_EXCEEDED' && /queue full/.test((e as Error).message));
  await running;
  assert.deepStrictEqual((await Promise.all(queued)).map((v) => v.i), [0, 1, 2]);
  assert.strictEqual(sandboxStats().queued['pool-q'], undefined);

  configureSandbox({ queueMax: 1000, queueTimeoutMs: 60 });
  const hog = run(burn(400), 'pool-qt', {}, 1);
  await sleep(20);
  await assert.rejects(run('1', 'pool-qt', {}, 1), (e) => code(e) === 'QUOTA_EXCEEDED' && /waiting for a script slot/.test((e as Error).message));
  await hog;
  assert.ok(sandboxStats().queueTimeouts >= 1);
  // a condition hitting a full queue throws (never silently "false")
  configureSandbox({ queueMax: 0 });
  const hog2 = run(burn(150), 'pool-qc', {}, 1);
  await sleep(20);
  await assert.rejects(evalCondition('true', 'js', {}, 500, undefined, { tenantId: 'pool-qc', maxConcurrentScripts: 1 }), (e) => code(e) === 'QUOTA_EXCEEDED');
  await hog2;
});

test('POOL-4 a timeout or an OOM recycles only that isolate; concurrent and following runs are unaffected', async () => {
  const r0 = sandboxStats().recycled;
  const good = run(burn(120) + ' vars.ok = 1', 'pool-r', {}, 2);       // other isolate of the same workspace
  await assert.rejects(run('while(true){}', 'pool-r', {}, 2, 80), /timed out/i);
  assert.strictEqual((await good).ok, 1, 'neighbour run survived the other isolate\'s timeout');
  assert.strictEqual(sandboxStats().recycled - r0, 1);
  await assert.rejects(run('var a=[]; while(true) a.push(new Array(1e6).fill(1));', 'pool-r', {}, 2, 5000));
  assert.ok(sandboxStats().recycled - r0 >= 2);
  for (let i = 0; i < 5; i++) assert.strictEqual((await run('vars.v = 5', 'pool-r', {}, 2)).v, 5);
  configureSandbox({ maxRuns: 3 });
  const c0 = sandboxStats().created;
  for (let i = 0; i < 7; i++) await run('1', 'pool-mr', {}, 1);
  assert.ok(sandboxStats().created - c0 >= 2, 'recycled after maxRuns and replaced transparently');
});

test('POOL-5 idle isolates are evicted (stats return to zero)', async () => {
  configureSandbox({ idleMs: 40 });
  await Promise.all(Array.from({ length: 6 }, () => run(burn(10), 'pool-idle', {}, 3)));
  assert.ok(sandboxStats().isolatesAlive['pool-idle'] >= 1);
  await sleep(150);
  assert.strictEqual(sandboxStats().isolatesAlive['pool-idle'], undefined);
});

test('POOL-6 two workspaces under load are served fairly under a tiny global ceiling and never share an isolate', async () => {
  configureSandbox({ maxIsolates: 2, idleMs: 60_000 });
  let peak = 0, done = 0, doneAtB = -1;
  const sampler = setInterval(() => { peak = Math.max(peak, sandboxStats().totalIsolates); }, 2);
  const a = Array.from({ length: 60 }, (_, i) => run(burn(8) + ' vars.t = "A"', 'fair-a', { i }, 4).then((v) => { done++; assert.strictEqual(v.t, 'A'); }));
  await sleep(10);
  const b = Array.from({ length: 6 }, () => run(burn(8) + ' vars.t = "B"', 'fair-b', {}, 4).then((v) => { done++; assert.strictEqual(v.t, 'B'); }));
  await Promise.all(b); doneAtB = done;
  await Promise.all(a);
  clearInterval(sampler);
  assert.ok(peak <= 2, `peak ${peak}`);
  assert.ok(doneAtB < 66 - 25, `B was served while A still had a backlog (done at B finish: ${doneAtB})`);
  const alive = sandboxStats().isolatesAlive;
  assert.ok(!('fair-a' in alive && 'fair-b' in alive && alive['fair-a'] + alive['fair-b'] > 2));
});
