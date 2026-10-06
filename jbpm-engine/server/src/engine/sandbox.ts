// Runs a Script task's body / a flow's `when` condition / any node's onEntry/onExit. `js` executes
// natively here (real Node vm isolation + a hard wall-clock timeout — a genuine interrupt, not just a
// Promise race, so a synchronous infinite loop actually gets killed). `java` is NOT available in this
// build: the JVM sidecar this used to delegate to (a persistent Java process compiling/running scripts
// through a small bpmscript.Server) had its own TypeScript-side client and Java sources lost along with
// the rest of this project's source tree; only the already-compiled java-runtime/out/*.class files
// survived. Re-wiring java-sidecar.ts to spawn and talk to that compiled server is real, doable future
// work — deliberately deferred so the primary (JS) path is solid and fully tested first, per explicit
// instruction. A `lang:'java'` script fails LOUDLY with a clear, catchable error — never silently runs
// as JavaScript (that would be a correctness bug, not a graceful degradation).
import vm from 'node:vm';

export interface ConditionCtx {
  instanceId?: string;
  instanceInfo?: { id: string; state: string };
  nodeInfo?: { nodeId: string; nodeName?: string };
}

export interface ScriptOpts extends ConditionCtx {
  lang?: string;
  varTypes?: Record<string, string>;
  log?: (line: string) => void;
  onAction?: unknown;
  tenantId?: string;
  maxConcurrentScripts?: number;
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// A crude, per-tenant concurrency gate — real protection against one tenant's runaway scripts starving
// everyone else lives in a job queue; this is the "at least don't let it be unbounded" version.
const inFlight = new Map<string, number>();
function acquireScriptSlot(tenantId: string, max?: number): (() => void) | undefined {
  if (!max) return undefined;
  const cur = inFlight.get(tenantId) || 0;
  if (cur >= max) { const e: Error & { code?: string } = new Error(`too many concurrent scripts for tenant (max ${max})`); e.code = 'QUOTA_EXCEEDED'; throw e; }
  inFlight.set(tenantId, cur + 1);
  return () => inFlight.set(tenantId, (inFlight.get(tenantId) || 1) - 1);
}

function buildKcontext(vars: Record<string, unknown>, info: ConditionCtx) {
  return {
    getVariable: (name: string) => vars[name],
    setVariable: (name: string, value: unknown) => { vars[name] = value; },
    getProcessInstance: () => ({ getId: () => info.instanceInfo?.id, getState: () => info.instanceInfo?.state }),
  };
}

function runJs(code: string, vars: Record<string, unknown>, timeoutMs: number, opts: ScriptOpts): unknown {
  const logs: string[] = [];
  const varNames = Object.keys(vars).filter((n) => IDENT_RE.test(n));
  const preamble = varNames.map((n) => `let ${n} = __vars[${JSON.stringify(n)}];`).join('\n');
  const epilogue = varNames.map((n) => `__vars[${JSON.stringify(n)}] = ${n};`).join('\n');
  const kcontext = buildKcontext(vars, opts);
  const sandbox: Record<string, unknown> = {
    __vars: vars,
    kcontext,
    vars,
    instance: opts.instanceInfo || {},
    node: opts.nodeInfo || {},
    console: { log: (...args: unknown[]) => logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')) },
  };
  const context = vm.createContext(sandbox);
  const src = `(function(){\n${preamble}\nlet __result = (function(){\n${code}\n})();\n${epilogue}\nreturn __result;\n})()`;
  try {
    const script = new vm.Script(src, { filename: 'script.js' });
    const result = script.runInContext(context, { timeout: timeoutMs, displayErrors: true });
    if (opts.log) for (const l of logs) opts.log(l);
    return result;
  } catch (e) {
    if (opts.log) for (const l of logs) opts.log(l);
    throw e;
  }
}

async function runScriptBody(code: string, vars: Record<string, unknown>, timeoutMs: number, opts: ScriptOpts): Promise<void> {
  if (opts.lang === 'java') {
    const e: Error & { code?: string } = new Error('Java-dialect scripts are not available in this build (the JVM sidecar has not been reconnected — see sandbox.ts\'s own doc comment)');
    e.code = 'JAVA_SIDECAR_UNAVAILABLE';
    throw e;
  }
  runJs(code, vars, timeoutMs, opts);
}

export async function runScript(code: string, vars: Record<string, unknown>, timeoutMs: number, opts: ScriptOpts = {}): Promise<void> {
  const release = opts.tenantId ? acquireScriptSlot(opts.tenantId, opts.maxConcurrentScripts) : undefined;
  try {
    await runScriptBody(code, vars, timeoutMs, opts);
  } finally {
    release?.();
  }
}

/** Evaluate a boolean expression (gateway/flow `when`, a Condition Catch/Boundary's `event.condition`).
 *  `js` runs the expression as a return value; `java` is unavailable, same stance as runScript. */
export async function evalCondition(
  expr: string | undefined, lang: string | undefined, vars: Record<string, unknown>,
  timeoutMs = 500, varTypes?: Record<string, string>, ctx: ConditionCtx = {},
): Promise<boolean> {
  if (!expr) return false;
  if (lang === 'java') {
    const e: Error & { code?: string } = new Error('Java-dialect conditions are not available in this build (see sandbox.ts\'s own doc comment)');
    e.code = 'JAVA_SIDECAR_UNAVAILABLE';
    throw e;
  }
  const result = runJs(expr.trim().startsWith('return') ? expr : `return (${expr});`, { ...vars }, timeoutMs, { ...ctx });
  return !!result;
}
