// Engine-specific structural rules, additive on top of bpmn-sdk's own validateModel (real-BPMN2
// structural checks reused via sdk/index.ts's validateEngineProcess) — this file only checks things
// that are specific to how THIS engine interprets the graph, not general BPMN2 well-formedness.
import type { EngineFlow, EngineNode, EngineProcess } from '../../sdk/index.ts';

export interface ValidationIssue { code: string; severity: 'error' | 'warning'; message: string; nodeId?: string; scope: string; }

interface Scope { nodes: EngineNode[]; flows: EngineFlow[]; label: string; }

/** A process plus every nested embedded/event sub-process's own inner {nodes,flows} — each rule below
 *  runs once per scope, so an issue inside a nested sub-process is reported against ITS OWN nodes/flows,
 *  not silently missed because it's buried inside a parent node. */
function collectScopes(proc: EngineProcess): Scope[] {
  const scopes: Scope[] = [{ nodes: proc.nodes || [], flows: proc.flows || [], label: proc.name || proc.id }];
  const walk = (nodes: EngineNode[], parentLabel: string) => {
    for (const n of nodes) {
      if (n.type !== 'subprocess') continue;
      const label = `${parentLabel} > ${n.name || n.id}`;
      scopes.push({ nodes: n.nodes || [], flows: n.flows || [], label });
      walk(n.nodes || [], label);
    }
  };
  walk(proc.nodes || [], proc.name || proc.id);
  return scopes;
}

/** An event sub-process (on.error set) is triggered by the error router, never by a sequence flow —
 *  a stray incoming/outgoing flow on one means it was probably wired like a normal embedded
 *  sub-process by mistake (see boundary/handler.ts's own doc comment on this exact idiom). */
function eventSubProcessWired(scope: Scope): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const n of scope.nodes) {
    if (n.type !== 'subprocess' || !(n as any).on?.error) continue;
    const wired = scope.flows.some((f) => f.from === n.id || f.to === n.id);
    if (wired) issues.push({ code: 'event-sub-process-wired', severity: 'error', nodeId: n.id, scope: scope.label, message: `Event sub-process "${n.name || n.id}" is triggered by its error handler, not by a sequence flow — remove its connecting flow(s), or convert it back to a normal sub-process.` });
  }
  return issues;
}

/** A gateway's `default` must reference one of its own outgoing flow ids. */
function danglingGatewayDefault(scope: Scope): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const n of scope.nodes) {
    const def = (n as any).default;
    if (n.type !== 'gateway' || !def) continue;
    const outIds = scope.flows.filter((f) => f.from === n.id).map((f) => f.id);
    if (!outIds.includes(def)) issues.push({ code: 'dangling-gateway-default', severity: 'error', nodeId: n.id, scope: scope.label, message: `Gateway "${n.name || n.id}"'s default flow does not match any of its own outgoing flows.` });
  }
  return issues;
}

/** Every node reached only via a normal sequence flow needs at least one incoming flow — start nodes
 *  and boundary events are attached by other means (a start/timer trigger, a host association) and
 *  are exempt. */
function unreachableNode(scope: Scope): ValidationIssue[] {
  const hasIncoming = new Set(scope.flows.map((f) => f.to));
  return scope.nodes
    .filter((n) => n.type !== 'start' && n.type !== 'boundary' && n.id && !hasIncoming.has(n.id))
    .map((n) => ({ code: 'unreachable-node', severity: 'warning' as const, nodeId: n.id, scope: scope.label, message: `"${n.name || n.id}" has no incoming flow — it will never run.` }));
}

/** Duplicate node ids inside one scope would make token routing ambiguous (two nodes claiming the
 *  same token destination). */
function duplicateNodeIds(scope: Scope): ValidationIssue[] {
  const counts = new Map<string, number>();
  for (const n of scope.nodes) if (n.id) counts.set(n.id, (counts.get(n.id) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1)
    .map(([id]) => ({ code: 'duplicate-node-id', severity: 'error' as const, nodeId: id, scope: scope.label, message: `Node id "${id}" is used more than once in "${scope.label}".` }));
}

const RULES: Array<(scope: Scope) => ValidationIssue[]> = [eventSubProcessWired, danglingGatewayDefault, unreachableNode, duplicateNodeIds];

export function runEngineRules(proc: EngineProcess): ValidationIssue[] {
  return collectScopes(proc).flatMap((scope) => RULES.flatMap((rule) => rule(scope)));
}

export function runEngineRulesForAll(processes: EngineProcess[]): ValidationIssue[] {
  return processes.flatMap(runEngineRules);
}
