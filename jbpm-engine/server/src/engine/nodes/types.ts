// Per-node handler contract. Each node type lives in its own folder (handler.ts = backend logic).
// The ExecutionEngine builds a HandlerCtx and dispatches to the registered handler; handlers are pure
// functions that return a HandlerResult (what the step loop should do next).
import type { AppContext } from '../../context.ts';
import type { Deployment, Instance, Token } from '../../domain.ts';
import type { EngineFlow, EngineProcess } from '../../sdk/index.ts';
import type { EngineEvent } from '../execution-engine.ts';

export interface HandlerResult {
  vars?: Record<string, unknown>;
  wait?: Token['waitFor'];
  end?: 'complete' | 'terminate' | 'error';
  next?: string[];        // explicit target node ids (else follow outgoing flows)
  consume?: boolean;      // remove token without spawning (e.g. join not yet satisfied)
  outcome?: string;
  error?: string;
  errorCode?: string;     // BPMN-style error code for error-boundary routing
}

/** Everything a node handler needs — the node + instance state plus engine capabilities. */
export interface HandlerCtx {
  node: any;
  inst: Instance;
  proc: EngineProcess;
  dep: Deployment;
  app: AppContext;
  joins: Record<string, Set<string>>;
  outgoing(nodeId: string): EngineFlow[];
  incoming(nodeId: string): EngineFlow[];
  emit(e: EngineEvent): void;
  startChild(dep: Deployment, processId: string, vars: Record<string, unknown>, parentTokenId: string): Promise<Instance>;
  broadcast(name: string): Promise<void>;
  /** Run compensation handlers for completed activities in reverse order (all, or a single host). */
  compensate(ref?: string): Promise<Record<string, unknown>>;
  resolveCalled?: (processId: string) => Promise<{ dep: Deployment; processId: string } | undefined>;
}

export type NodeHandler = (c: HandlerCtx) => Promise<HandlerResult> | HandlerResult;
