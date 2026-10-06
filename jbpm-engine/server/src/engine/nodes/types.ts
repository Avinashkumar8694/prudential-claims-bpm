// Shared contract every node handler implements. Kept deliberately small: a handler is a pure-ish
// function from (node + read-only capabilities) to a HandlerResult describing what happened — all
// actual state mutation (tokens, timers, tasks) is applied by execution-engine.ts's own loop, never by
// a handler directly touching `inst` beyond what HandlerCtx exposes.
import type { EngineNode, EngineFlow, EngineProcess } from '../../sdk/index.ts';
import type { Instance, Deployment } from '../../domain.ts';
import type { AppContext } from '../../context.ts';

export interface WaitSpec { kind: 'timer' | 'task' | 'message' | 'signal' | 'condition' | 'child' | 'multiInstance'; ref?: string; dueAt?: string; }

export interface HandlerResult {
  /** Merged into inst.variables after this node completes. */
  vars?: Record<string, unknown>;
  /** Explicit successor node ids — omit to use the process's own outgoing flows (defaultTargets). */
  next?: string[];
  /** Park the token — the engine schedules/registers whatever the WaitSpec.kind implies. */
  wait?: WaitSpec;
  /** A human-readable trace string for this node visit (history/logs). */
  outcome?: string;
  /** This node's own token is consumed with no successors spawned at all (rare — most "done" paths
   *  either wait or fall through to defaultTargets). */
  consume?: boolean;
  /** The whole (sub)process ends here — 'complete' is a normal end; 'terminate'/'error' are special. */
  end?: 'complete' | 'terminate' | 'error';
  /** Only meaningful alongside end:'terminate' — escalate the terminate all the way to the root
   *  instance instead of just this (sub)process (see execution-engine.ts's terminateAll handling). */
  terminateAll?: boolean;
  /** A recoverable failure — routed to a matching error-catch if one exists, else fails the instance. */
  error?: string;
  errorCode?: string;
}

export interface HandlerCtx {
  node: EngineNode;
  inst: Instance;
  proc: EngineProcess;
  dep: Deployment;
  app: AppContext;
  joins: Record<string, Set<string>>;
  tokenId: string;
  outgoing: (nodeId: string) => EngineFlow[];
  incoming: (nodeId: string) => EngineFlow[];
  emit: (e: { kind: string; [k: string]: unknown }) => void;
  startChild: (dep: Deployment, processId: string, vars: Record<string, unknown>, parentTokenId: string, independent?: boolean) => Promise<Instance>;
  /** Untargeted broadcast — 'message' resolves to the single oldest waiter; 'signal' fans out to
   *  every waiter AND every matching signal-start. `correlationKey`, when given, narrows delivery to
   *  only the waiting instance(s) whose OWN correlationKey (set at instance-start) matches — a real,
   *  documented part of this engine's EventDef/EngineSend contract (see sdk's own EventDef type),
   *  not a jBPM XML attribute; omit for the default "every/oldest matching waiter" behavior. */
  broadcast: (name: string, kind: 'signal' | 'message', correlationKey?: string) => Promise<void>;
  /** Deliver a signal to ONE specific instance by id — matches real jBPM's targeted
   *  KieRuntime.signalEvent(type, event, processInstanceId). */
  signal: (targetInstanceId: string, name: string, payload?: unknown) => Promise<void>;
  /** Abort ONE specific instance by id. */
  abort: (targetInstanceId: string) => Promise<void>;
  /** Run recorded compensation handlers — every completed one (ref omitted) or just one (ref = a
   *  specific host node id), LIFO. Returns the compensation handler's own output variables. */
  compensate: (ref?: string) => Promise<Record<string, unknown>>;
  /** Route a thrown escalation within this SAME instance's own boundary/event-subprocess scope chain
   *  — never a cross-instance broadcast. Returns whether anything caught it (false = uncaught, which
   *  is NOT an error — the throwing path just continues). */
  escalate: (code: string) => Promise<boolean>;
  /** Resolve a called-process id to its active deployment. `workflowId`, when the author pinned one via
   *  the processRef picker, disambiguates when more than one active deployment declares a process with
   *  the exact same bare id (e.g. two independently-authored projects both using "reviewProcess"). */
  resolveCalled?: (processId: string, workflowId?: string) => Promise<{ dep: Deployment; processId: string } | undefined>;
}

export type NodeHandler = (c: HandlerCtx) => HandlerResult | Promise<HandlerResult>;
