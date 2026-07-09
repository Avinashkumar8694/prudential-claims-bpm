// Process validation rules — the engine-native equivalent of jBPM/BPMN diagram validation, adapted to
// the nodejs engine model. Each rule inspects the EngineProcess graph and returns typed Problems.
// Errors block publish/deploy; warnings are advisory. See docs/08 + docs/09.
import type { EngineFlow, EngineNode, EngineProcess } from '../../sdk/index.js';

export type Severity = 'error' | 'warning';
export interface Problem { rule: string; severity: Severity; message: string; nodeId?: string; flowId?: string; }

export interface GraphCtx {
  process: EngineProcess;
  nodes: EngineNode[];
  flows: EngineFlow[];
  byId: Map<string, EngineNode>;
  outgoing: Map<string, EngineFlow[]>;
  incoming: Map<string, EngineFlow[]>;
  starts: EngineNode[];
  ends: EngineNode[];
  reachable: Set<string>;
  boundaryByHost: Map<string, EngineNode[]>;
}

const isStart = (n: EngineNode) => n.type === 'start';
const isEnd = (n: EngineNode) => n.type === 'end';
const isBoundary = (n: EngineNode) => n.type === 'boundary';
const isEventSub = (n: EngineNode) => n.type === 'subprocess' && !!(n as any).on?.error;
const label = (n: EngineNode) => n.name || n.id || n.type;

function buildCtx(process: EngineProcess): GraphCtx {
  const nodes = process.nodes || [];
  const flows = process.flows || [];
  const byId = new Map(nodes.map((n) => [n.id!, n]));
  const outgoing = new Map<string, EngineFlow[]>();
  const incoming = new Map<string, EngineFlow[]>();
  for (const f of flows) {
    (outgoing.get(f.from) || outgoing.set(f.from, []).get(f.from)!).push(f);
    (incoming.get(f.to) || incoming.set(f.to, []).get(f.to)!).push(f);
  }
  const onList = (n: EngineNode): string[] => { const on = (n as any).on; return Array.isArray(on) ? on : (on ? [on] : []); };
  const boundaryByHost = new Map<string, EngineNode[]>();
  for (const n of nodes) if (isBoundary(n)) {
    for (const host of onList(n)) (boundaryByHost.get(host) || boundaryByHost.set(host, []).get(host)!).push(n);
  }
  const starts = nodes.filter(isStart);
  const ends = nodes.filter(isEnd);

  // reachability from starts (event-subprocesses + process-global error catches are always reachable;
  // node-attached boundaries are reachable when their host is)
  const reachable = new Set<string>();
  const globalCatches = nodes.filter((n) => isBoundary(n) && onList(n).includes('*'));
  const queue: string[] = [...starts.map((n) => n.id!), ...nodes.filter(isEventSub).map((n) => n.id!), ...globalCatches.map((n) => n.id!)];
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id) || !byId.has(id)) continue;
    reachable.add(id);
    for (const f of outgoing.get(id) || []) queue.push(f.to);
    for (const b of boundaryByHost.get(id) || []) queue.push(b.id!);
  }
  return { process, nodes, flows, byId, outgoing, incoming, starts, ends, reachable, boundaryByHost };
}

export interface Rule { id: string; description: string; run(ctx: GraphCtx): Problem[]; }
const P = (rule: string, severity: Severity, message: string, extra: Partial<Problem> = {}): Problem => ({ rule, severity, message, ...extra });
const deg = (ctx: GraphCtx, id: string) => ({ in: (ctx.incoming.get(id) || []).length, out: (ctx.outgoing.get(id) || []).length });

export const RULES: Rule[] = [
  { id: 'start-exists', description: 'Process must have at least one start node', run: (c) => c.starts.length ? [] : [P('start-exists', 'error', 'Process has no start node')] },
  { id: 'end-exists', description: 'Process must have at least one end node', run: (c) => c.ends.length ? [] : [P('end-exists', 'error', 'Process has no end node')] },
  { id: 'single-start', description: 'Prefer a single start node', run: (c) => c.starts.length > 1 ? [P('single-start', 'warning', `Process has ${c.starts.length} start nodes`)] : [] },

  { id: 'unique-ids', description: 'Node ids must be unique', run: (c) => {
    const seen = new Set<string>(), dupes = new Set<string>();
    for (const n of c.nodes) { if (seen.has(n.id!)) dupes.add(n.id!); seen.add(n.id!); }
    return [...dupes].map((id) => P('unique-ids', 'error', `Duplicate node id "${id}"`, { nodeId: id }));
  } },

  { id: 'flow-endpoints', description: 'Every connection must link two existing nodes', run: (c) => {
    const out: Problem[] = [];
    for (const f of c.flows) {
      if (!c.byId.has(f.from)) out.push(P('flow-endpoints', 'error', `Connection source "${f.from}" does not exist`, { flowId: f.id }));
      if (!c.byId.has(f.to)) out.push(P('flow-endpoints', 'error', `Connection target "${f.to}" does not exist`, { flowId: f.id }));
      if (f.from === f.to) out.push(P('flow-endpoints', 'warning', `Connection loops a node onto itself (${f.from})`, { flowId: f.id }));
    }
    return out;
  } },

  { id: 'start-connections', description: 'Start has one+ outgoing and no incoming', run: (c) => {
    const out: Problem[] = [];
    for (const n of c.starts) { const d = deg(c, n.id!);
      if (d.out === 0) out.push(P('start-connections', 'error', `Start "${label(n)}" has no outgoing connection`, { nodeId: n.id }));
      if (d.in > 0) out.push(P('start-connections', 'error', `Start "${label(n)}" must not have incoming connections`, { nodeId: n.id }));
    }
    return out;
  } },

  { id: 'end-connections', description: 'End has one+ incoming and no outgoing', run: (c) => {
    const out: Problem[] = [];
    for (const n of c.ends) { const d = deg(c, n.id!);
      if (d.in === 0) out.push(P('end-connections', 'error', `End "${label(n)}" has no incoming connection`, { nodeId: n.id }));
      if (d.out > 0) out.push(P('end-connections', 'error', `End "${label(n)}" must not have outgoing connections`, { nodeId: n.id }));
    }
    return out;
  } },

  { id: 'node-connected', description: 'Activities/gateways/events must be connected (no floating nodes)', run: (c) => {
    const out: Problem[] = [];
    for (const n of c.nodes) {
      if (isStart(n) || isEnd(n) || isEventSub(n)) continue;
      const d = deg(c, n.id!);
      if (isBoundary(n)) { if (d.out === 0) out.push(P('node-connected', 'error', `Boundary "${label(n)}" has no outgoing (handler) connection`, { nodeId: n.id })); continue; }
      if (d.in === 0 && d.out === 0) out.push(P('node-connected', 'error', `Node "${label(n)}" is not connected`, { nodeId: n.id }));
      else if (d.in === 0) out.push(P('node-connected', 'error', `Node "${label(n)}" has no incoming connection`, { nodeId: n.id }));
      else if (d.out === 0) out.push(P('node-connected', 'error', `Node "${label(n)}" has no outgoing connection`, { nodeId: n.id }));
    }
    return out;
  } },

  { id: 'reachable', description: 'Every node must be reachable from a start', run: (c) => {
    const out: Problem[] = [];
    for (const n of c.nodes) {
      if (isStart(n) || isEventSub(n)) continue;
      const d = deg(c, n.id!);
      if ((d.in > 0 || d.out > 0) && !c.reachable.has(n.id!)) out.push(P('reachable', 'error', `Node "${label(n)}" is not reachable from a start`, { nodeId: n.id }));
    }
    return out;
  } },

  { id: 'boundary-host', description: 'Error/boundary catch must attach to existing node(s) or all (*)', run: (c) => {
    const out: Problem[] = [];
    for (const n of c.nodes) if (isBoundary(n)) {
      const hosts = (() => { const on = (n as any).on; return Array.isArray(on) ? on : (on ? [on] : []); })();
      if (hosts.length === 0) { out.push(P('boundary-host', 'error', `Catch "${label(n)}" is not attached to any node (pick nodes or "all")`, { nodeId: n.id })); continue; }
      for (const h of hosts) if (h !== '*' && !c.byId.has(h)) out.push(P('boundary-host', 'error', `Catch "${label(n)}" attaches to missing node "${h}"`, { nodeId: n.id }));
    }
    return out;
  } },

  { id: 'node-config', description: 'Per-type required configuration', run: (c) => {
    const out: Problem[] = [];
    for (const n of c.nodes) {
      const a = n as any;
      switch (n.type) {
        case 'script': if (!a.code || !String(a.code).trim()) out.push(P('node-config', 'error', `Script "${label(n)}" has no code`, { nodeId: n.id })); break;
        case 'http': if (!a.url) out.push(P('node-config', 'error', `Service task "${label(n)}" has no URL`, { nodeId: n.id })); break;
        case 'call': if (!a.process) out.push(P('node-config', 'error', `Call activity "${label(n)}" has no called process`, { nodeId: n.id })); break;
        case 'forEach': if (!a.process) out.push(P('node-config', 'error', `Multi-instance "${label(n)}" has no process`, { nodeId: n.id }));
          if (!a.over) out.push(P('node-config', 'error', `Multi-instance "${label(n)}" has no collection`, { nodeId: n.id })); break;
        case 'rule': if (!a.ruleflowGroup && !a.dmn) out.push(P('node-config', 'error', `Business rule "${label(n)}" references neither a ruleflow group nor a DMN decision`, { nodeId: n.id })); break;
        case 'send': if (!a.message) out.push(P('node-config', 'error', `Send task "${label(n)}" has no message`, { nodeId: n.id })); break;
        case 'receive': if (!a.message) out.push(P('node-config', 'error', `Receive task "${label(n)}" has no message`, { nodeId: n.id })); break;
        case 'gateway': if (!a.mode) out.push(P('node-config', 'error', `Gateway "${label(n)}" has no mode`, { nodeId: n.id })); break;
      }
    }
    return out;
  } },

  { id: 'event-trigger', description: 'Catch/throw/boundary events must define a trigger', run: (c) => {
    const out: Problem[] = [];
    const hasTrigger = (e: any) => e && (e.signal != null || e.message != null || e.error != null || e.escalation != null || e.condition != null || e.timer != null);
    for (const n of c.nodes) {
      const a = n as any;
      if ((n.type === 'catch' || n.type === 'throw' || n.type === 'boundary') && !hasTrigger(a.event))
        out.push(P('event-trigger', 'error', `${n.type} event "${label(n)}" has no trigger defined`, { nodeId: n.id }));
      // timer completeness
      const timer = a.event?.timer || (n.type === 'start' && a.on?.timer);
      if (timer && typeof timer === 'object' && !timer.duration && !timer.cycle && !timer.date)
        out.push(P('event-trigger', 'error', `Timer on "${label(n)}" has no duration/cycle/date`, { nodeId: n.id }));
    }
    return out;
  } },

  { id: 'gateway-branching', description: 'Diverging exclusive/inclusive gateways should resolve deterministically', run: (c) => {
    const out: Problem[] = [];
    for (const n of c.nodes) {
      const a = n as any;
      if (n.type !== 'gateway' || (a.mode !== 'exclusive' && a.mode !== 'inclusive')) continue;
      const outs = c.outgoing.get(n.id!) || [];
      if (outs.length <= 1) continue;
      const hasDefault = outs.some((f) => f.id && f.id === a.default);
      const uncond = outs.filter((f) => !f.when);
      if (!hasDefault && uncond.length === 0) out.push(P('gateway-branching', 'warning', `Gateway "${label(n)}" has no default flow; instances may reach no branch`, { nodeId: n.id }));
      if (!hasDefault && uncond.length > 1) out.push(P('gateway-branching', 'warning', `Gateway "${label(n)}" has multiple unconditional branches`, { nodeId: n.id }));
    }
    return out;
  } },

  { id: 'usertask-assignment', description: 'User task should have an actor or group', run: (c) => {
    const out: Problem[] = [];
    for (const n of c.nodes) if (n.type === 'userTask' && !(n as any).group && !(n as any).assignee)
      out.push(P('usertask-assignment', 'warning', `User task "${label(n)}" has no group or assignee`, { nodeId: n.id }));
    return out;
  } },

  { id: 'condition-lang', description: 'Flow conditions must be js to execute in the Node runtime', run: (c) => {
    const out: Problem[] = [];
    for (const f of c.flows) if (f.when && f.lang && f.lang !== 'js')
      out.push(P('condition-lang', 'warning', `Connection condition is "${f.lang}" and will not evaluate at runtime (use js)`, { flowId: f.id }));
    return out;
  } },

  { id: 'node-name', description: 'Nodes should be named', run: (c) => c.nodes.filter((n) => !n.name || !n.name.trim()).map((n) => P('node-name', 'warning', `${n.type} "${n.id}" has no name`, { nodeId: n.id })) },
];

export interface ValidationResult { ok: boolean; errors: Problem[]; warnings: Problem[]; problems: Problem[]; }

export function validateProcess(process: EngineProcess): ValidationResult {
  const ctx = buildCtx(process);
  const problems = RULES.flatMap((r) => r.run(ctx));
  const errors = problems.filter((p) => p.severity === 'error');
  const warnings = problems.filter((p) => p.severity === 'warning');
  return { ok: errors.length === 0, errors, warnings, problems };
}
