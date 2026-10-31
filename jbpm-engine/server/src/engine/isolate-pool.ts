// Bounded, tenant-keyed pool of V8 isolates for js scripts/conditions (see sandbox.ts for the caller).
//
//  * One pool per tenant (workspace) — an isolate is NEVER shared across tenants.
//  * One isolate runs ONE execution at a time, so a timeout / OOM kill only ever hits the run that caused it.
//  * Pool size (= per-workspace parallelism) = clamp(maxConcurrentScripts || SCRIPT_POOL_DEFAULT_SIZE, 1, 16).
//    Isolates are created lazily, reused across ALL of that workspace's processes, evicted after an idle period.
//  * Excess demand waits in a bounded FIFO queue per tenant (SCRIPT_QUEUE_MAX / SCRIPT_QUEUE_TIMEOUT_MS →
//    QUOTA_EXCEEDED) instead of spawning more isolates.
//  * A global ceiling (SCRIPT_MAX_ISOLATES) caps total isolates; when it is reached, waiting tenants are
//    served round-robin and may reclaim another tenant's IDLE isolate, so one noisy workspace can't starve others.
//  * Isolates are recycled after a timeout, OOM/dispose, a near-full heap, or SCRIPT_ISOLATE_MAX_RUNS runs.
//  * Every execution gets a FRESH context (new global scope / realm) inside the pooled isolate and releases it
//    afterwards, so no globalThis write or prototype pollution survives into the next script.
import os from 'node:os';
import ivm from 'isolated-vm';
import { ISOLATE_RUNTIME_SOURCE } from './isolate-runtime.ts';
import { quotaExceeded } from '../infra/errors.ts';

export interface SandboxConfig {
  poolDefaultSize: number;
  maxIsolates: number;
  queueMax: number;
  queueTimeoutMs: number;
  idleMs: number;
  maxRuns: number;
  memoryMb: number;
}

const num = (v: string | undefined, d: number) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : d; };
const cfg: SandboxConfig = {
  poolDefaultSize: num(process.env.SCRIPT_POOL_DEFAULT_SIZE, 4),
  maxIsolates: num(process.env.SCRIPT_MAX_ISOLATES, Math.max(8, 2 * os.cpus().length)),
  queueMax: num(process.env.SCRIPT_QUEUE_MAX, 1000),
  queueTimeoutMs: num(process.env.SCRIPT_QUEUE_TIMEOUT_MS, 5000),
  idleMs: num(process.env.SCRIPT_ISOLATE_IDLE_MS, 60_000),
  maxRuns: num(process.env.SCRIPT_ISOLATE_MAX_RUNS, 1000),
  memoryMb: 64,
};
/** test hook: override limits at runtime (existing idle isolates keep their old idle timers). */
export function configureSandbox(patch: Partial<SandboxConfig>): void { Object.assign(cfg, patch); }
export function sandboxConfig(): Readonly<SandboxConfig> { return cfg; }

const MAX_POOL = 16;
const clampSize = (n: number) => Math.min(MAX_POOL, Math.max(1, Math.floor(n)));

interface Pooled { isolate: ivm.Isolate; tenant: string; runs: number; idleTimer?: NodeJS.Timeout }
interface Waiter { resolve: (p: Pooled) => void; reject: (e: unknown) => void; timer: NodeJS.Timeout }
interface TenantPool { id: string; size: number; all: Set<Pooled>; idle: Pooled[]; queue: Waiter[] }

const tenants = new Map<string, TenantPool>();
let total = 0;
let rr = 0;
const totals = { created: 0, recycled: 0, evictedIdle: 0, queueRejected: 0, queueTimeouts: 0, executions: 0 };

let snapshot: ivm.ExternalCopy<ArrayBuffer> | null | undefined;
/** the runtime is run once into a V8 startup snapshot; each fresh context then starts from it (cheap) rather
 *  than re-evaluating the shim source. Falls back to evaluating the source per context if snapshots fail. */
function getSnapshot(): ivm.ExternalCopy<ArrayBuffer> | null {
  if (snapshot === undefined) {
    try { snapshot = ivm.Isolate.createSnapshot([{ code: ISOLATE_RUNTIME_SOURCE }]); } catch { snapshot = null; }
  }
  return snapshot;
}

export function sandboxStats() {
  const alive: Record<string, number> = {};
  const queued: Record<string, number> = {};
  let queuedTotal = 0;
  for (const t of tenants.values()) {
    if (t.all.size) alive[t.id] = t.all.size;
    if (t.queue.length) queued[t.id] = t.queue.length;
    queuedTotal += t.queue.length;
  }
  return { isolatesAlive: alive, totalIsolates: total, idle: [...tenants.values()].reduce((a, t) => a + t.idle.length, 0), queued: queued, queuedTotal, ...totals };
}

function poolOf(id: string, requestedSize: number | undefined): TenantPool {
  let t = tenants.get(id);
  if (!t) { t = { id, size: clampSize(cfg.poolDefaultSize), all: new Set(), idle: [], queue: [] }; tenants.set(id, t); }
  // quota applies as pool size; an unset quota leaves the tenant's last-known size (default on first sight)
  if (requestedSize) t.size = clampSize(requestedSize);
  return t;
}

function dispose(p: Pooled, why: 'recycled' | 'idle' | 'dead'): void {
  const t = tenants.get(p.tenant);
  if (p.idleTimer) clearTimeout(p.idleTimer);
  if (t) { t.all.delete(p); const i = t.idle.indexOf(p); if (i >= 0) t.idle.splice(i, 1); }
  total--;
  if (why === 'recycled') totals.recycled++; else if (why === 'idle') totals.evictedIdle++;
  try { if (!p.isolate.isDisposed) p.isolate.dispose(); } catch { /* already gone */ }
  if (t && !t.all.size && !t.queue.length) tenants.delete(p.tenant);
}

function create(t: TenantPool): Pooled {
  const snap = getSnapshot();
  const p: Pooled = { isolate: new ivm.Isolate({ memoryLimit: cfg.memoryMb, ...(snap ? { snapshot: snap } : {}) }), tenant: t.id, runs: 0 };
  t.all.add(p); total++; totals.created++;
  return p;
}

/** hand out capacity to waiting tenants, one assignment per tenant per round (round-robin fairness). */
function pump(): void {
  let progressed = true;
  while (progressed) {
    progressed = false;
    const waiting = [...tenants.values()].filter((t) => t.queue.length);
    if (!waiting.length) return;
    for (let k = 0; k < waiting.length; k++) {
      const t = waiting[(rr + k) % waiting.length];
      const w = t.queue[0];
      if (!w) continue;
      let p = t.idle.pop();
      if (p?.idleTimer) { clearTimeout(p.idleTimer); p.idleTimer = undefined; }
      if (!p && t.all.size < t.size) {
        if (total >= cfg.maxIsolates) reclaimIdleFromOthers(t.id);
        if (total < cfg.maxIsolates) p = create(t);
      }
      if (!p) continue;
      t.queue.shift();
      clearTimeout(w.timer);
      w.resolve(p);
      progressed = true;
    }
    rr++;
  }
}

/** at the global ceiling: free one IDLE isolate of the tenant holding the most idle ones (never a busy one). */
function reclaimIdleFromOthers(forTenant: string): void {
  // loop: the ceiling may have been lowered below the number of live isolates
  while (total >= cfg.maxIsolates && reclaimOne(forTenant)) { /* keep freeing idle isolates */ }
}
function reclaimOne(forTenant: string): boolean {
  let best: TenantPool | undefined;
  for (const o of tenants.values()) if (o.id !== forTenant && o.idle.length && (!best || o.idle.length > best.idle.length)) best = o;
  const victim = best?.idle[0];
  if (!victim) return false;
  dispose(victim, 'idle');
  return true;
}

async function acquire(tenantId: string, size?: number): Promise<Pooled> {
  const t = poolOf(tenantId, size);
  if (!t.queue.length) {
    const p = t.idle.pop();
    if (p) { if (p.idleTimer) { clearTimeout(p.idleTimer); p.idleTimer = undefined; } return p; }
    if (t.all.size < t.size) {
      if (total >= cfg.maxIsolates) reclaimIdleFromOthers(t.id);
      if (total < cfg.maxIsolates) return create(t);
    }
  }
  if (t.queue.length >= cfg.queueMax) {
    totals.queueRejected++;
    throw quotaExceeded(`script queue full for this workspace (max ${cfg.queueMax} waiting)`, { quota: 'scriptQueue', max: cfg.queueMax });
  }
  return new Promise<Pooled>((resolve, reject) => {
    const w: Waiter = {
      resolve, reject,
      timer: setTimeout(() => {
        const i = t.queue.indexOf(w);
        if (i >= 0) t.queue.splice(i, 1);
        totals.queueTimeouts++;
        if (!t.all.size && !t.queue.length) tenants.delete(t.id);
        reject(quotaExceeded(`timed out after ${cfg.queueTimeoutMs}ms waiting for a script slot in this workspace`, { quota: 'scriptQueueTimeout', timeoutMs: cfg.queueTimeoutMs }));
      }, cfg.queueTimeoutMs),
    };
    t.queue.push(w);
  });
}

function release(p: Pooled, recycle: boolean): void {
  const t = tenants.get(p.tenant);
  p.runs++;
  if (!t || recycle || p.isolate.isDisposed || p.runs >= cfg.maxRuns) { dispose(p, 'recycled'); pump(); return; }
  t.idle.push(p);
  p.idleTimer = setTimeout(() => dispose(p, 'idle'), cfg.idleMs);
  p.idleTimer.unref();
  pump();
}

/** Runs `fn` with a fresh context inside a pooled isolate of `tenantId`. `fn` must not retain the context. */
export async function withIsolate<T>(tenantId: string, poolSize: number | undefined, fn: (isolate: ivm.Isolate, context: ivm.Context) => Promise<T>): Promise<T> {
  const p = await acquire(tenantId, poolSize);
  totals.executions++;
  let context: ivm.Context | undefined;
  let recycle = false;
  try {
    context = await p.isolate.createContext();
    if (!getSnapshot()) await (await p.isolate.compileScript(ISOLATE_RUNTIME_SOURCE)).run(context);
    return await fn(p.isolate, context);
  } catch (e) {
    // timeout or OOM/dispose: this isolate is suspect — replace it. Ordinary script errors keep it.
    if (p.isolate.isDisposed || /timed out|memory limit|disposed/i.test((e as Error)?.message || '')) recycle = true;
    throw e;
  } finally {
    try { context?.release(); } catch { /* isolate gone */ }
    try {
      if (!p.isolate.isDisposed && p.isolate.getHeapStatisticsSync().used_heap_size > cfg.memoryMb * 1048576 * 0.6) recycle = true;
    } catch { recycle = true; }
    release(p, recycle);
  }
}
