// Sandbox for script tasks and flow conditions. Dev-grade isolation via node:vm (docs/07 mandates
// isolated-vm for prod) for the `js` dialect. `java` never runs as transpiled JavaScript — it's sent
// to the persistent JVM sidecar (java-sidecar.ts / jbpm-engine/java-runtime) and compiled+executed as
// real Java, so scripts converted unmodified from a real jBPM project behave exactly as they do there.
// Other dialects (e.g. mvel) are not evaluated.
//
// `js` scripts/conditions get THREE equivalent ways to read/write a process variable, all backed by
// the same underlying `vars` record (never three sources of truth):
//  1. `kcontext.getVariable(n)`/`.setVariable(n,v)` — real jBPM's own API, always available.
//  2. a bare name (`caseId`) — matches real jBPM's OWN convention: `JavaScriptAction`/
//     `JavaScriptReturnValueEvaluator` bind every process variable as a bare global via
//     `engine.put(key, value)`, in BOTH scripts and conditions (confirmed against jBPM source).
//  3. `vars.caseId` / `vars.caseId = v` — this engine's own, simpler, Node-idiomatic addition (not a
//     jBPM concept) for users who don't want to think in jBPM terms at all. Plain property access —
//     `vars` is literally the same object `kcontext.setVariable` mutates, so no Proxy/rehoming is
//     needed (unlike the Jackson-style accessor methods java-compat.ts had to be careful about).
//
// `kcontext.getProcessInstance()`/`.getNodeInstance()`/`.getKieRuntime()` mirror real jBPM's
// ProcessInstance/NodeInstance/KieRuntime surface (see java-runtime/src/bpmscript/KContext.java for
// the Java-dialect twin and the source citations backing each method) — same shape in both dialects,
// built from the same threaded-through data (see gateway/handler.ts, script/handler.ts).
//
// `instance` / `node` are this engine's OWN additive sugar over that same data (not jBPM concepts at
// all — no `kcontext` prefix, plain properties, this engine's own status vocabulary) for scripts that
// don't want to think in jBPM terms even for process/node introspection, not just variables. See
// buildInstanceGlobal/buildNodeGlobal below, and bpmn-sdk/src/engine.ts's jsInstanceNodePreamble for
// how a script using them still exports to plain, real-jBPM-runnable text.
import vm from 'node:vm';
import { executeJava, executeJavaCondition, type ActiveNodeInstance, type PendingAction } from './java-sidecar.ts';
import { installJsCompat } from './js-compat.ts';
import { acquireScriptSlot } from '../infra/quotas.ts';

/** matches real jBPM's org.kie.api.runtime.process.ProcessInstance state constants — see
 *  KContext.ProcessInstance's STATE_* fields (java-runtime) for the Java-dialect twin. */
export const PROCESS_INSTANCE_STATE = { PENDING: 0, ACTIVE: 1, COMPLETED: 2, ABORTED: 3, SUSPENDED: 4 } as const;

/** this engine's own instance status string -> real jBPM's ProcessInstance.STATE_* int. "waiting"
 *  maps to ACTIVE because real jBPM's top-level instance state doesn't distinguish "active" from
 *  "blocked at a node" — that's a per-node-instance concept, not a whole-instance one. "failed" maps
 *  to ABORTED — real jBPM has no distinct persisted state for an unrecoverable failure. */
function stateFor(status: string | undefined): number {
  switch (status) {
    case 'completed': return PROCESS_INSTANCE_STATE.COMPLETED;
    case 'aborted': case 'failed': return PROCESS_INSTANCE_STATE.ABORTED;
    case 'suspended': return PROCESS_INSTANCE_STATE.SUSPENDED;
    default: return PROCESS_INSTANCE_STATE.ACTIVE; // 'running' | 'waiting' | undefined
  }
}

/** everything about the calling instance/node a script/condition might read via kcontext — shared by
 *  ScriptOpts (scripts) and ConditionCtx (conditions) so the two don't drift out of sync. */
interface KContextInfo {
  env?: Record<string, string>;
  instanceId?: string | number;
  /** the current active token's id (node-*instance*-level id) — see HandlerCtx.tokenId. Distinct
   *  from `nodeId` below, the node *definition* id. */
  nodeInstanceId?: string;
  nodeId?: string;
  nodeName?: string;
  processId?: string;
  processName?: string;
  correlationKey?: string;
  parentInstanceId?: string;
  /** this engine's own instance status string; mapped via stateFor() above. */
  state?: string;
  /** currently-active node instances, for kcontext.getProcessInstance().getNodeInstances() — a
   *  snapshot built by the caller, not live-queried (matches real jBPM's own Collection-snapshot
   *  semantics for this same method). */
  activeNodeInstances?: ActiveNodeInstance[];
}

/** builds the same kcontext.getProcessInstance()/.getNodeInstance()/.getKieRuntime() object shapes
 *  for both runScript and evalCondition's js branches — `vars` is the live record so setVariable/
 *  signalEvent-style mutations behave identically to the rest of this engine (write straight through,
 *  no copying). `actions` collects signal/abort calls to resolve after the script/condition returns
 *  (mirrors KContext.java's pendingActions — the caller has no store access mid-script either way). */
function buildKcontext(vars: Record<string, unknown>, info: KContextInfo, actions: PendingAction[]) {
  const selfId = info.instanceId == null ? '' : String(info.instanceId);
  const instance = {
    getId: () => selfId,
    getProcessId: () => info.processId,
    getProcessName: () => info.processName,
    getCorrelationKey: () => info.correlationKey,
    getParentProcessInstanceId: () => info.parentInstanceId,
    getState: () => stateFor(info.state),
    getVariables: () => vars,
    getNodeInstances: () => (info.activeNodeInstances || []).map((n) => ({
      getId: () => n.id, getNodeId: () => n.nodeId, getNodeName: () => n.nodeName ?? '',
    })),
    // self-scoped signal — real jBPM's ProcessInstance implements EventListener, so this is
    // delivered to THIS instance only (see kieRuntime.signalEvent below for the session-wide form).
    signalEvent: (type: string, event?: unknown) => { actions.push({ kind: 'signal', type, payload: event, targetInstanceId: selfId }); },
  };
  const nodeInstance = { getId: () => info.nodeInstanceId ?? '', getNodeId: () => info.nodeId ?? '', getNodeName: () => info.nodeName ?? '' };
  const kieRuntime = {
    getEnvironment: () => ({ ...(info.env || {}) }),
    // one function handles both the session-wide broadcast (2 args) and targeted delivery (3 args) —
    // JS has no method overloading, unlike the Java-dialect twin's two signalEvent overloads.
    signalEvent: (type: string, event?: unknown, processInstanceId?: string) => {
      actions.push({ kind: 'signal', type, payload: event, targetInstanceId: processInstanceId });
    },
    abortProcessInstance: (processInstanceId: string) => { actions.push({ kind: 'abort', targetInstanceId: processInstanceId }); },
  };
  return {
    getVariable: (n: string) => vars[n],
    setVariable: (n: string, v: unknown) => { vars[n] = v; },
    getProcessInstance: () => instance,
    getNodeInstance: () => nodeInstance,
    getKieRuntime: () => kieRuntime,
  };
}

/** The Node-idiomatic alternative to `kcontext.getProcessInstance()`/`.getNodeInstance()`/
 *  `.getKieRuntime()` — same idea as `vars` vs. `kcontext.getVariable`: real jBPM has no `instance`/
 *  `node` concept, so these are this engine's own additive sugar, NOT jBPM API. Plain properties
 *  instead of getter chains, this engine's own status vocabulary ('running'/'waiting'/'completed'/...)
 *  instead of jBPM's STATE_* ints, and verb-methods for the handful of control actions a script might
 *  need. Backed by the exact same `actions` queue `buildKcontext` uses, so `instance.signal(...)` and
 *  `kcontext.getKieRuntime().signalEvent(...)` resolve identically — pick either per call, freely mixed.
 *  Exporting a script that uses `instance`/`node` prepends a preamble computing the same shape from
 *  real `kcontext` (see bpmn-sdk/src/engine.ts's jsInstanceNodePreamble) so it still runs, unmodified
 *  beyond that preamble, on a real jBPM/KIE server. */
function buildInstanceGlobal(vars: Record<string, unknown>, info: KContextInfo, actions: PendingAction[]) {
  const selfId = info.instanceId == null ? '' : String(info.instanceId);
  return {
    id: selfId,
    processId: info.processId,
    processName: info.processName,
    correlationKey: info.correlationKey,
    parentId: info.parentInstanceId,
    // this engine's own status string, NOT jBPM's STATE_* int (that's still available via
    // kcontext.getProcessInstance().getState() for anyone who needs the real jBPM constant).
    state: info.state ?? 'running',
    variables: vars,
    activeNodes: (info.activeNodeInstances || []).map((n) => ({ id: n.id, nodeId: n.nodeId, name: n.nodeName ?? '' })),
    signal: (type: string, payload?: unknown) => { actions.push({ kind: 'signal', type, payload, targetInstanceId: selfId }); },
    signalOther: (targetInstanceId: string, type: string, payload?: unknown) => { actions.push({ kind: 'signal', type, payload, targetInstanceId }); },
    broadcast: (type: string, payload?: unknown) => { actions.push({ kind: 'signal', type, payload }); },
    abort: () => { actions.push({ kind: 'abort', targetInstanceId: selfId }); },
    abortOther: (targetInstanceId: string) => { actions.push({ kind: 'abort', targetInstanceId }); },
  };
}

/** read-only twin of `kcontext.getNodeInstance()` — `id` is the node *instance* (token) id, `nodeId`
 *  the node *definition* id, matching the same distinction `kcontext.getNodeInstance()` makes. */
function buildNodeGlobal(info: KContextInfo) {
  return { id: info.nodeInstanceId ?? '', nodeId: info.nodeId ?? '', name: info.nodeName ?? '' };
}

/** resolves queued signal/abort actions against the real engine, via the callbacks HandlerCtx already
 *  exposes (c.broadcast/c.signal/c.abort) — same shape for both dialects' pending-action lists. */
async function resolveActions(actions: PendingAction[], cb: { broadcast: (name: string) => Promise<void>; signal: (id: string, name: string, payload?: unknown) => Promise<void>; abort: (id: string) => Promise<void> }): Promise<void> {
  for (const a of actions) {
    if (a.kind === 'signal' && a.type) {
      if (a.targetInstanceId) await cb.signal(a.targetInstanceId, a.type, a.payload);
      else await cb.broadcast(a.type);
    } else if (a.kind === 'abort' && a.targetInstanceId) {
      await cb.abort(a.targetInstanceId);
    }
  }
}

export interface ScriptOpts extends KContextInfo {
  /** sink for console.log lines emitted by the script (default: drop) */
  log?: (line: string) => void;
  /** script dialect; defaults to 'js'. 'java' runs in the JVM sidecar (java-sidecar.ts) — real Java,
   *  compiled once per distinct script and cached, never transpiled to JavaScript. */
  lang?: string;
  /** resolves a kcontext signalEvent/abortProcessInstance call once the script returns — the caller
   *  (script/handler.ts) wires these to HandlerCtx.broadcast/.signal/.abort. Untargeted signalEvent
   *  uses `broadcast`; targeted signalEvent uses `signal`; abortProcessInstance uses `abort`. */
  onAction?: { broadcast: (name: string) => Promise<void>; signal: (id: string, name: string, payload?: unknown) => Promise<void>; abort: (id: string) => Promise<void> };
  /** declared process variable types (name -> structureRef) — `lang:'java'` only. Real jBPM's Java
   *  script/onEntry/onExit dialect ALSO binds declared process variables as bare identifiers, via the
   *  same unbound-identifier mechanism (JavaActionBuilder) conditions use — confirmed against jBPM's
   *  own build-time codegen; not an extension this engine invented. This map is what makes the
   *  binding possible on the JVM-sidecar side (see java-sidecar.ts's executeJava). */
  varTypes?: Record<string, string>;
  /** per-tenant concurrent-script quota (SystemSettings.maxConcurrentScripts; 0/undefined =
   *  unlimited) — checked here, the single choke point both dialects and both call sites (script
   *  task, HTTP task exit-script) funnel through, so it can't be bypassed by adding a new caller. */
  tenantId?: string;
  maxConcurrentScripts?: number;
}

export async function runScript(code: string, vars: Record<string, unknown>, timeoutMs: number, opts: ScriptOpts = {}): Promise<void> {
  const release = opts.tenantId ? acquireScriptSlot(opts.tenantId, opts.maxConcurrentScripts) : undefined;
  try {
    await runScriptBody(code, vars, timeoutMs, opts);
  } finally {
    release?.();
  }
}

async function runScriptBody(code: string, vars: Record<string, unknown>, timeoutMs: number, opts: ScriptOpts): Promise<void> {
  if (opts.lang === 'java') {
    const result = await executeJava({
      code, vars, env: opts.env, instanceId: opts.instanceId, varTypes: opts.varTypes,
      nodeInstanceId: opts.nodeInstanceId, nodeId: opts.nodeId, nodeName: opts.nodeName,
      processId: opts.processId, processName: opts.processName, correlationKey: opts.correlationKey,
      parentInstanceId: opts.parentInstanceId, state: opts.state, activeNodeInstances: opts.activeNodeInstances,
    });
    Object.assign(vars, result.vars);
    if (result.logs) {
      const log = opts.log || (() => {});
      for (const line of result.logs.split('\n')) if (line) log(line);
    }
    if (opts.onAction) await resolveActions(result.pendingActions, opts.onAction);
    return;
  }
  const actions: PendingAction[] = [];
  const kcontext = buildKcontext(vars, opts, actions);
  const log = opts.log || (() => {});
  // bare-name binding first (spread), THEN the fixed globals — so kcontext/vars/instance/node/env/
  // console always win over a same-named process variable, matching real jBPM's own bare-name
  // convention while keeping this engine's reserved globals safe from being shadowed.
  const sandbox: Record<string, unknown> = {
    ...vars,
    kcontext, vars,
    instance: buildInstanceGlobal(vars, opts, actions),
    node: buildNodeGlobal(opts),
    env: { ...(opts.env || {}) },
    console: { log: (...a: unknown[]) => log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) },
  };
  installJsCompat(sandbox);
  vm.createContext(sandbox);
  // snapshot bare-name values BEFORE running, so afterward we can sync back only what a bare-name
  // ASSIGNMENT actually changed — see the comment below for why this must be change-detected, not
  // "copy everything back".
  const before: Record<string, unknown> = {};
  for (const k of Object.keys(sandbox)) if (!RESERVED_SANDBOX_KEYS.has(k)) before[k] = sandbox[k];
  // Wrapped in an IIFE so a `var`/`let`/`const` the script declares stays a LOCAL of that function
  // (never touching the global sandbox object) while an un-declared BARE assignment (`status = x`,
  // no keyword) still falls through the scope chain to the global object exactly as before — this
  // is what makes it possible to tell "deliberate bare-name process-variable write" apart from
  // "scratch local variable": without the wrapper, `var list = new java.util.ArrayList()` is
  // indistinguishable from `status = "x"` (both land as sandbox properties), and syncing back `list`
  // too tries to persist a live shim object with methods on it, which isn't serializable — caught by
  // this file's own test (engine-js-compat.test.ts).
  vm.runInContext(`(function(){\n${code}\n})()`, sandbox, { timeout: timeoutMs });
  // Sync bare-name writes back into `vars` — but ONLY keys whose sandbox value actually changed (or
  // is brand new), never unconditionally: a DECLARED variable's value already sitting in `sandbox`
  // (from the initial spread) is a snapshot, separate from `vars` itself. If the script instead used
  // kcontext.setVariable(name, v) for that same name, that call writes `vars[name]` directly — while
  // `sandbox[name]` stays at its untouched, now-stale snapshot value. Copying it back unconditionally
  // would silently clobber the fresh kcontext write with the stale one (caught by an existing test:
  // engine-flow.test.ts's `kcontext.setVariable("greeted", true)` on a variable declared as `bool`).
  for (const k of Object.keys(sandbox)) {
    if (RESERVED_SANDBOX_KEYS.has(k)) continue;
    if (!(k in before) || !Object.is(sandbox[k], before[k])) vars[k] = sandbox[k];
  }
  if (opts.onAction) await resolveActions(actions, opts.onAction);
}

const RESERVED_SANDBOX_KEYS = new Set(['kcontext', 'vars', 'instance', 'node', 'env', 'console', 'Java', 'java']);

/** deployment/instance context for a condition — same shape ScriptOpts carries for scripts, kept
 *  separate since a condition doesn't take the full ScriptOpts bag (no log sink). Conditions CAN
 *  queue signal/abort actions too (kcontext is the same object either way) — pass `onAction` if the
 *  caller wants those resolved; a gateway condition ignoring it just means an unusual side-effecting
 *  condition silently drops the queued action, matching how the java-dialect condition path already
 *  behaves (conditions aren't expected to have side effects, but nothing stops a script author). */
export interface ConditionCtx extends KContextInfo {
  onAction?: ScriptOpts['onAction'];
}

/** Evaluate a boolean flow condition. `js` runs natively; `java` runs in the JVM sidecar (real Java,
 *  never transpiled); other dialects (e.g. mvel) → false. Any failure (bad script, sidecar down,
 *  timeout) evaluates to false rather than throwing, matching this function's existing contract.
 *  `varTypes` (declared process variable types, name -> structureRef) lets a `java` condition bind
 *  every process variable as a bare, typed local identifier, matching real jBPM's Java condition
 *  dialect (see java-sidecar.ts's executeJavaCondition) — irrelevant for `js`, which binds bare names
 *  unconditionally (matching real jBPM's own JS convention, no static typing involved either way). */
export async function evalCondition(expr: string | undefined, lang: string | undefined, vars: Record<string, unknown>, timeoutMs = 500, varTypes?: Record<string, string>, ctx: ConditionCtx = {}): Promise<boolean> {
  if (!expr) return true;
  if (lang && lang !== 'js' && lang !== 'java') return false;
  if (lang === 'java') {
    try {
      const result = await executeJavaCondition({
        code: expr, vars, varTypes, env: ctx.env, instanceId: ctx.instanceId,
        nodeInstanceId: ctx.nodeInstanceId, nodeId: ctx.nodeId, nodeName: ctx.nodeName,
        processId: ctx.processId, processName: ctx.processName, correlationKey: ctx.correlationKey,
        parentInstanceId: ctx.parentInstanceId, state: ctx.state, activeNodeInstances: ctx.activeNodeInstances,
      });
      return result;
    } catch { return false; }
  }
  // kcontext was previously missing from JS conditions entirely — a real gap, since real jBPM's
  // ProcessContext is available in every script/condition, not just scripts.
  const actions: PendingAction[] = [];
  const kcontext = buildKcontext(vars, ctx, actions);
  const sandbox: Record<string, unknown> = {
    ...vars, kcontext, vars,
    instance: buildInstanceGlobal(vars, ctx, actions),
    node: buildNodeGlobal(ctx),
    env: { ...(ctx.env || {}) },
  };
  installJsCompat(sandbox);
  vm.createContext(sandbox);
  try {
    const body = /return\b/.test(expr) ? expr : `return (${expr});`;
    const result = !!vm.runInContext(`(function(){ ${body} })()`, sandbox, { timeout: timeoutMs });
    if (ctx.onAction) await resolveActions(actions, ctx.onAction);
    return result;
  } catch { return false; }
}
