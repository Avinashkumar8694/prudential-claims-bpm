// Boundary/error-catch matching logic. Pure, stateless functions only: deciding WHICH node matches a
// given host/error/timer situation. The actual state mutation that ACTS on that decision (pushing
// tokens, cancelling timers, running compensations) stays in execution-engine.ts, since those need
// engine capabilities (the timer repo, etc.) a plain function can't get without much larger
// context-threading.
//
// Note this file's logic isn't PURELY about 'boundary' nodes: isErrorCatch/catchErrorName/
// isGlobalCatch also recognize an event sub-process with an error start (n.type === 'subprocess',
// on.error set) as an error-catch — the other common "global error handler" idiom. This is the SAME
// 'subprocess' type a normal, sequence-flow-wired embedded sub-process uses — real jBPM's own BPMN2
// XML marks the distinction via triggeredByEvent="true" on the SAME <subProcess> element, and
// @fabrixly/bpmn-sdk's own fromEngine/toEngine round-trips that exact shape — so this project
// deliberately does NOT introduce a separate discriminated node type for it. Misuse (a node wired into
// the normal flow AND ALSO carrying on.error) is instead caught at publish time — see
// modules/validation/rules.ts's 'event-sub-process-wired' rule.
import type { EngineNode } from '../../../sdk/index.ts';

export const ENGINE_ERRORS = [
  'SCRIPT_ERROR', 'SERVICE_ERROR', 'RULE_ERROR', 'RULE_ENGINE_UNAVAILABLE', 'RUNTIME_ERROR',
  'CALL_ERROR', 'CALL_ABORTED', 'SUBPROCESS_ERROR', 'SUBPROCESS_ABORTED', 'MULTIINSTANCE_ERROR',
  'JAVA_SIDECAR_UNAVAILABLE',
] as const;

/** on: string | string[]; '*' = all nodes (process-global). Normalize to a list. */
export function onList(n: EngineNode): string[] {
  const on = (n as any).on;
  return Array.isArray(on) ? on : (typeof on === 'string' ? [on] : []);
}

export function catchErrorName(n: EngineNode): string | undefined {
  if (n.type === 'boundary') return (n as any).event?.error;
  if (n.type === 'subprocess') return (n as any).on?.error;
  return undefined;
}

export function isErrorCatch(n: EngineNode): boolean {
  if (n.type === 'boundary') { const e = (n as any).event; return !!e && Object.prototype.hasOwnProperty.call(e, 'error'); }
  if (n.type === 'subprocess') return !!(n as any).on && Object.prototype.hasOwnProperty.call((n as any).on, 'error');
  return false;
}

export function isCatchAll(n: EngineNode): boolean {
  const e = catchErrorName(n);
  return e === '' || e === '*' || e == null || String(e).toUpperCase() === 'ANY';
}

/** an event sub-process error-catch is always process-wide; a boundary is global only via on: '*' */
export function isGlobalCatch(n: EngineNode): boolean {
  return n.type === 'subprocess' || onList(n).includes('*');
}

/** A global, named catch matches a raised code if: the names match exactly; OR the raised code came
 *  from an actual node execution failure (i.e. IS one of ENGINE_ERRORS) and this catch's name is
 *  itself NOT a recognized ENGINE_ERRORS name, in which case it's treated as meaning SERVICE_ERROR
 *  (real-world imported processes overwhelmingly name their global catch-all after service failures). */
export function globalNameMatches(n: EngineNode, code: string): boolean {
  const declared = catchErrorName(n);
  if (declared === code) return true;
  const ERR = ENGINE_ERRORS as readonly string[];
  return ERR.includes(code) && declared !== undefined && !ERR.includes(declared) && code === 'SERVICE_ERROR';
}

/** Find the best error-catch for (failing node, code): host-specific (any code) → global+named →
 *  global+catch-all. */
export function findErrorHandler(nodes: EngineNode[], failingNodeId: string, code: string): EngineNode | undefined {
  const catches = nodes.filter((n) => isErrorCatch(n));
  const onNode = (n: EngineNode) => !isGlobalCatch(n) && onList(n).includes(failingNodeId);
  const globalNamed = (n: EngineNode) => isGlobalCatch(n) && !isCatchAll(n) && globalNameMatches(n, code);
  const globalCatchAll = (n: EngineNode) => isGlobalCatch(n) && isCatchAll(n);
  return catches.find(onNode) || catches.find(globalNamed) || catches.find(globalCatchAll);
}

/** Boundary nodes with a timer trigger attached to `hostNodeId`. */
export function boundaryTimerHosts(nodes: EngineNode[], hostNodeId: string): EngineNode[] {
  return nodes.filter((b) => b.type === 'boundary' && (b as any).event?.timer && onList(b).includes(hostNodeId));
}

/** Boundary nodes with a message/signal trigger attached to `hostNodeId` — given a WAITING token of
 *  their own the moment that host starts waiting, so broadcast()/signalInstance() can find and
 *  resume them exactly like any other catch. Escalation is deliberately NOT included here — resolved
 *  by a live scan instead (findEscalationHandler). */
export function messageBoundaryHosts(nodes: EngineNode[], hostNodeId: string): { node: EngineNode; kind: 'message' | 'signal'; name: string }[] {
  return nodes
    .filter((b) => b.type === 'boundary' && onList(b).includes(hostNodeId))
    .flatMap((b) => {
      const ev = (b as any).event || {};
      const name = ev.message || ev.signal;
      if (!name) return [];
      return [{ node: b, kind: (ev.message ? 'message' : 'signal') as 'message' | 'signal', name }];
    });
}

/** Boundary nodes with a CONDITION trigger attached to `hostNodeId` — given a waiting token of their
 *  own the moment that host starts waiting, so execution-engine.ts's own per-tick re-check
 *  (resolveConditionWaits) can find and resolve them. */
export function conditionBoundaryHosts(nodes: EngineNode[], hostNodeId: string): EngineNode[] {
  return nodes.filter((b) => b.type === 'boundary' && typeof (b as any).event?.condition === 'string' && onList(b).includes(hostNodeId));
}

export function catchEscalationCode(n: EngineNode): string | undefined {
  return (n as any).event?.escalation;
}
export function isEscalationCatch(n: EngineNode): boolean {
  const e = (n as any).event;
  return n.type === 'boundary' && !!e && Object.prototype.hasOwnProperty.call(e, 'escalation');
}
export function isEscalationCatchAll(n: EngineNode): boolean {
  const e = catchEscalationCode(n);
  return e === '' || e === '*' || e == null || String(e).toUpperCase() === 'ANY';
}

/** Find the boundary catching a thrown escalation: real BPMN2 scopes an escalation to ancestor
 *  activities within the SAME instance, resolved by walking outward from wherever it was thrown —
 *  approximated here by matching against whichever host node(s) currently hold an active/waiting
 *  token, same "host-specific first, then global" precedence findErrorHandler already uses for error. */
export function findEscalationHandler(nodes: EngineNode[], activeHostIds: Set<string>, code: string): EngineNode | undefined {
  const catches = nodes.filter((n) => isEscalationCatch(n));
  const hostMatches = (n: EngineNode) => onList(n).some((h) => h === '*' || activeHostIds.has(h));
  const named = (n: EngineNode) => hostMatches(n) && !isEscalationCatchAll(n) && catchEscalationCode(n) === code;
  const catchAll = (n: EngineNode) => hostMatches(n) && isEscalationCatchAll(n);
  return catches.find(named) || catches.find(catchAll);
}

/** Boundary nodes with a compensation trigger attached to `hostNodeId` — recorded when that host
 *  completes normally, so a LATER compensation throw can find and run them (LIFO). */
export function compensationBoundaries(nodes: EngineNode[], hostNodeId: string): EngineNode[] {
  return nodes.filter((b) => b.type === 'boundary' && (b as any).event?.compensation && onList(b).includes(hostNodeId));
}
