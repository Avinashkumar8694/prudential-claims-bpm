import { runScript, sandboxStats } from '../src/engine/sandbox.ts';

const N = Number(process.env.N || 2000);
const QUOTA = process.env.QUOTA ? Number(process.env.QUOTA) : undefined;
const mb = (b: number) => Math.round(b / 1048576);

let peakRss = 0, peakHeap = 0;
const sampler = setInterval(() => { const m = process.memoryUsage(); peakRss = Math.max(peakRss, m.rss); peakHeap = Math.max(peakHeap, m.heapUsed); }, 10);

const baseRss = process.memoryUsage().rss;
// realistic short script: reads input, computes, writes output
const code = 'let s = 0; for (let i = 0; i < 20000; i++) s += i % 7; kcontext.setVariable("out", kcontext.getVariable("n") * 2 + s);';

// warm the one-time runtime snapshot so it is not counted against the burst
await runScript(code, { n: 1 }, 2000, { tenantId: 'warm' });

const t0 = performance.now();
const lat: number[] = [];
let ok = 0, wrong = 0; const errors: Record<string, number> = {};
await Promise.all(Array.from({ length: N }, async (_, i) => {
  const vars: Record<string, unknown> = { n: i };
  const s = performance.now();
  try {
    await runScript(code, vars, 2000, { tenantId: 'ws-1', maxConcurrentScripts: QUOTA, scriptOverflowMode: process.env.MODE });
    lat.push(performance.now() - s);
    (vars.out === i * 2 + (vars.out as number) - i * 2 && typeof vars.out === 'number') ? ok++ : wrong++;
    if ((vars.out as number) - i * 2 !== (vars.out as number) - i * 2) wrong++;
  } catch (e) { const k = (e as Error).message.slice(0, 60); errors[k] = (errors[k] || 0) + 1; }
}));
const wall = performance.now() - t0;
clearInterval(sampler);
lat.sort((a, b) => a - b);
const pct = (p: number) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * p))].toFixed(0) : '-';
console.log(JSON.stringify({
  requests: N, quotaPerWorkspace: QUOTA ?? 'unlimited', succeeded: ok, wrongResult: wrong, failed: N - ok - wrong, errors,
  wallMs: Math.round(wall), throughputPerSec: Math.round(N / (wall / 1000)),
  latencyMs: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: lat.length ? lat[lat.length - 1].toFixed(0) : '-' },
  isolates: { maxConcurrentlyRunning: sandboxStats().peakRunning['ws-1'], effectiveConcurrency: sandboxStats().effectiveConcurrency['ws-1'], created: sandboxStats().created, recycled: sandboxStats().recycled, queueRejected: sandboxStats().queueRejected },
  rssMB: { before: mb(baseRss), peak: mb(peakRss), growth: mb(peakRss - baseRss) }, peakHeapMB: mb(peakHeap),
}, null, 1));
process.exit(0);
