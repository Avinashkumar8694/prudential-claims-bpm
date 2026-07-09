// Token-based interpreter over the SDK engine JSON. See docs/08-execution-engine.md.
// Deterministic core (clock/newId injected). Persists the instance after runToQuiescence.
import type { AppContext } from '../context.js';
import { Collections, type Deployment, type Instance, type NodeVisit, type Task, type Token } from '../domain.js';
import type { EngineFlow, EngineNode, EngineProcess } from '../sdk/index.js';
import { runScript, evalCondition } from './sandbox.js';
import { config } from '../infra/config.js';

interface HandlerResult {
  vars?: Record<string, unknown>;
  wait?: Token['waitFor'];
  end?: 'complete' | 'terminate' | 'error';
  next?: string[];        // explicit target node ids (else follow outgoing flows)
  consume?: boolean;      // remove token without spawning (e.g. join not yet satisfied)
  outcome?: string;
  error?: string;
}

export type EngineEvent =
  | { kind: 'instance.started' | 'instance.updated' | 'instance.completed' | 'instance.failed'; instanceId: string }
  | { kind: 'node.entered' | 'node.exited'; instanceId: string; nodeId: string; tokenId: string }
  | { kind: 'task.created'; instanceId: string; taskId: string };

export class ExecutionEngine {
  constructor(
    private ctx: AppContext,
    private emit: (e: EngineEvent) => void = () => {},
    /** resolve a called process id -> its active deployment (enables call-activity child instances) */
    private resolveCalled?: (processId: string) => Promise<{ dep: Deployment; processId: string } | undefined>,
  ) {}
  private inst() { return this.ctx.store.repo<Instance>(Collections.instances); }
  private tasks() { return this.ctx.store.repo<Task>(Collections.tasks); }
  private deps() { return this.ctx.store.repo<Deployment>(Collections.deployments); }

  // ---- process graph helpers ----
  /** The process (definition) an instance runs — selected by its processId, else the first. */
  private pick(dep: Deployment, processId?: string): EngineProcess {
    const list = dep.engine.processes || [];
    const p = (processId && list.find((x) => x.id === processId)) || list[0];
    if (!p) throw new Error('deployment has no process');
    return p;
  }
  private proc(inst: Instance, dep: Deployment): EngineProcess { return this.pick(dep, inst.processId); }
  private nodeMap(p: EngineProcess) { return new Map(p.nodes.map((n) => [n.id!, n])); }
  private outgoing(p: EngineProcess, nodeId: string): EngineFlow[] { return p.flows.filter((f) => f.from === nodeId); }
  private incoming(p: EngineProcess, nodeId: string): EngineFlow[] { return p.flows.filter((f) => f.to === nodeId); }

  // ---- lifecycle ----
  async start(dep: Deployment, variables: Record<string, unknown>, actor: string, opts: { processId?: string; correlationKey?: string } = {}): Promise<Instance> {
    const p = this.pick(dep, opts.processId);
    const startNode = p.nodes.find((n) => n.type === 'start') || p.nodes[0];
    if (!startNode) throw new Error('process has no start node');
    const now = this.ctx.clock();
    const seed: Record<string, unknown> = {};
    for (const v of p.vars || []) seed[v.name] = undefined;
    const inst: Instance = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, deploymentId: dep.id, workflowId: dep.workflowId, processId: p.id,
      correlationKey: opts.correlationKey, status: 'running', variables: { ...seed, ...variables },
      tokens: [{ id: this.ctx.newId(), nodeId: startNode.id!, state: 'active', enteredAt: now }],
      history: [], startedAt: now, startedBy: actor,
    };
    this.emit({ kind: 'instance.started', instanceId: inst.id });
    await this.runToQuiescence(inst, dep);
    return inst;
  }

  /** Advance every active token until the instance waits, completes, aborts, or fails. */
  async runToQuiescence(inst: Instance, dep: Deployment): Promise<Instance> {
    const p = this.proc(inst, dep);
    const nodes = this.nodeMap(p);
    const joins: Record<string, Set<string>> = {};
    let guard = 0;
    try {
      while (inst.status === 'running') {
        const token = inst.tokens.find((t) => t.state === 'active');
        if (!token) break;
        if (++guard > 100000) throw new Error('step budget exceeded (possible loop)');
        const node = nodes.get(token.nodeId);
        if (!node) { this.removeToken(inst, token.id); continue; }

        const visit: NodeVisit = { tokenId: token.id, nodeId: node.id!, type: node.type, enteredAt: this.ctx.clock() };
        inst.history.push(visit);
        this.emit({ kind: 'node.entered', instanceId: inst.id, nodeId: node.id!, tokenId: token.id });

        const result = await this.handle(node, inst, p, joins);

        if (result.vars) Object.assign(inst.variables, result.vars);
        visit.exitedAt = this.ctx.clock();
        visit.outcome = result.outcome || (result.wait ? 'waiting' : result.end || 'done');
        this.emit({ kind: 'node.exited', instanceId: inst.id, nodeId: node.id!, tokenId: token.id });

        if (result.wait) { token.state = 'waiting'; token.waitFor = result.wait; continue; }
        if (result.error) { inst.status = 'failed'; inst.error = { nodeId: node.id!, message: result.error, at: this.ctx.clock() }; break; }
        if (result.end === 'terminate') { inst.tokens = []; inst.status = 'completed'; break; }
        if (result.end === 'error') { inst.status = 'failed'; inst.error = { nodeId: node.id!, message: 'error end reached', at: this.ctx.clock() }; break; }
        // consume current token, then spawn successors
        this.removeToken(inst, token.id);
        if (result.end === 'complete' || result.consume) { /* no successors */ }
        else {
          const targets = result.next ?? this.defaultTargets(p, node, inst);
          for (const t of targets) inst.tokens.push({ id: this.ctx.newId(), nodeId: t, state: 'active', enteredAt: this.ctx.clock() });
        }
      }
      // settle final status
      if (inst.status === 'running') {
        inst.status = inst.tokens.some((t) => t.state === 'waiting') ? 'waiting' : 'completed';
      }
      if (inst.status === 'completed' || inst.status === 'aborted' || inst.status === 'failed') inst.endedAt = this.ctx.clock();
    } catch (err) {
      inst.status = 'failed';
      inst.error = { nodeId: '', message: (err as Error).message, stack: (err as Error).stack, at: this.ctx.clock() };
      inst.endedAt = this.ctx.clock();
    }
    await this.inst().put(inst);
    this.emit({ kind: inst.status === 'failed' ? 'instance.failed' : inst.status === 'completed' ? 'instance.completed' : 'instance.updated', instanceId: inst.id });
    // if this is a child instance that just finished, resume the parent's waiting call-activity token
    if (inst.status === 'completed' && inst.parentInstanceId) await this.tryResumeParent(inst);
    return inst;
  }

  /** A child instance completed → map its outputs into the parent and continue the parent flow. */
  private async tryResumeParent(child: Instance): Promise<void> {
    const parent = await this.inst().get(child.parentInstanceId!);
    if (!parent) return;
    const token = parent.tokens.find((t) => t.state === 'waiting' && t.waitFor?.kind === 'child' && t.waitFor?.ref === child.id);
    if (!token) return;
    const pdep = await this.deps().get(parent.deploymentId);
    if (!pdep) return;
    const callNode = this.pick(pdep, parent.processId).nodes.find((n) => n.id === token.nodeId) as any;
    const vars: Record<string, unknown> = {};
    for (const [pv, cv] of Object.entries(callNode?.outputs || {})) vars[pv] = child.variables[cv as string];
    await this.resumeToken(parent, pdep, token.id, vars);
  }

  /** Start a child process instance linked to a parent token (call activity). */
  private async startChild(dep: Deployment, processId: string, vars: Record<string, unknown>, actor: string, parentInstanceId: string, parentTokenId: string): Promise<Instance> {
    const p = this.pick(dep, processId);
    const startNode = p.nodes.find((n) => n.type === 'start') || p.nodes[0];
    const now = this.ctx.clock();
    const child: Instance = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, deploymentId: dep.id, workflowId: dep.workflowId, processId: p.id,
      status: 'running', variables: { ...vars },
      tokens: [{ id: this.ctx.newId(), nodeId: startNode!.id!, state: 'active', enteredAt: now }],
      history: [], startedAt: now, startedBy: actor, parentInstanceId, parentTokenId,
    };
    this.emit({ kind: 'instance.started', instanceId: child.id });
    return this.runToQuiescence(child, dep);
  }

  /** Deliver a signal/message to an instance: resume every token waiting on that name. */
  async signalInstance(inst: Instance, dep: Deployment, name: string, payload?: unknown): Promise<Instance> {
    const targets = inst.tokens
      .filter((t) => t.state === 'waiting' && (t.waitFor?.kind === 'signal' || t.waitFor?.kind === 'message') && t.waitFor?.ref === name)
      .map((t) => t.id);
    for (const tid of targets) {
      if (inst.tokens.find((t) => t.id === tid && t.state === 'waiting')) {
        await this.resumeToken(inst, dep, tid, payload !== undefined ? { [name]: payload } : undefined);
      }
    }
    return inst;
  }

  /** Re-trigger a node: drop a fresh active token onto it and run (retry a failed node or replay). */
  async retryNode(inst: Instance, dep: Deployment, nodeId: string): Promise<Instance> {
    inst.error = undefined;
    inst.tokens.push({ id: this.ctx.newId(), nodeId, state: 'active', enteredAt: this.ctx.clock() });
    inst.status = 'running';
    return this.runToQuiescence(inst, dep);
  }

  private removeToken(inst: Instance, tokenId: string) { inst.tokens = inst.tokens.filter((t) => t.id !== tokenId); }

  private defaultTargets(p: EngineProcess, node: EngineNode, _inst: Instance): string[] {
    return this.outgoing(p, node.id!).map((f) => f.to);
  }

  // ---- node handlers ----
  private async handle(node: EngineNode, inst: Instance, p: EngineProcess, joins: Record<string, Set<string>>): Promise<HandlerResult> {
    switch (node.type) {
      case 'start': return {};
      case 'end': {
        if ((node as any).result === 'terminate') return { end: 'terminate' };
        if ((node as any).throw?.error) return { end: 'error', outcome: 'error-throw' };
        return { end: 'complete' };
      }
      case 'manual': return {};
      case 'script': {
        const n = node as any;
        if (n.lang && n.lang !== 'js') return { outcome: 'skipped-nonjs' };
        const vars = { ...inst.variables };
        try { runScript(n.code || '', vars, config.scriptTimeoutMs); }
        catch (e) { return { error: `script failed: ${(e as Error).message}` }; }
        return { vars };
      }
      case 'gateway': return this.gateway(node as any, inst, p, joins);
      case 'userTask': {
        const n = node as any;
        const task: Task = {
          id: this.ctx.newId(), tenantId: this.ctx.tenantId, instanceId: inst.id,
          tokenId: inst.tokens.find((t) => t.nodeId === node.id)!.id, nodeId: node.id!,
          name: n.name || n.form || 'Task', formName: n.form, group: n.group || n.assignee,
          status: 'created', inputs: {}, createdAt: this.ctx.clock(),
        };
        this.tasks().put(task);
        this.emit({ kind: 'task.created', instanceId: inst.id, taskId: task.id });
        return { wait: { kind: 'task', ref: task.id } };
      }
      case 'receive': return { wait: { kind: 'message', ref: (node as any).message } };
      case 'catch': {
        const ev = (node as any).event || {};
        if (ev.timer) return { wait: { kind: 'timer', ref: node.id } };
        if (ev.message) return { wait: { kind: 'message', ref: ev.message } };
        if (ev.signal) return { wait: { kind: 'signal', ref: ev.signal } };
        return { wait: { kind: 'condition', ref: node.id } };
      }
      case 'throw': return {};                 // fire-and-continue (signal bus wired in Phase 3)
      case 'send': return {};
      case 'call': {
        const n = node as any;
        if (!this.resolveCalled || !n.process) return {};
        const resolved = await this.resolveCalled(n.process);
        if (!resolved) return { outcome: 'called-process-not-deployed' };   // graceful passthrough
        const token = inst.tokens.find((t) => t.nodeId === node.id)!;
        const childVars: Record<string, unknown> = {};
        for (const [cv, spec] of Object.entries(n.inputs || {})) {
          childVars[cv] = typeof spec === 'string' && spec.startsWith('$') ? inst.variables[spec.slice(1)] : spec;
        }
        const child = await this.startChild(resolved.dep, resolved.processId, childVars, inst.startedBy, inst.id, token.id);
        if (child.status === 'completed') {
          const vars: Record<string, unknown> = {};
          for (const [pv, cv] of Object.entries(n.outputs || {})) vars[pv] = child.variables[cv as string];
          return { vars, outcome: `called:${child.id}` };
        }
        return { wait: { kind: 'child', ref: child.id }, outcome: `called:${child.id}` };   // parent waits for the child
      }
      case 'subprocess': {
        // embedded: inline the child start into the parent scope (best-effort v1: run nested to its end)
        return {};
      }
      // http / forEach / rule / boundary: pass through in the core (implemented in later phases)
      default: return {};
    }
  }

  private gateway(node: any, inst: Instance, p: EngineProcess, joins: Record<string, Set<string>>): HandlerResult {
    const outs = this.outgoing(p, node.id);
    const ins = this.incoming(p, node.id);
    const converging = ins.length > 1 && outs.length <= 1;

    if (converging && (node.mode === 'parallel' || node.mode === 'inclusive')) {
      // join: wait until a token has arrived via each incoming flow
      const set = (joins[node.id] ||= new Set<string>());
      set.add(String(inst.history.filter((h) => h.nodeId === node.id).length)); // count arrivals
      const arrived = inst.history.filter((h) => h.nodeId === node.id).length;
      if (arrived < ins.length) return { consume: true, outcome: `join ${arrived}/${ins.length}` };
      joins[node.id] = new Set();
      return { next: outs.map((f) => f.to), outcome: 'join-complete' };
    }

    switch (node.mode) {
      case 'parallel': return { next: outs.map((f) => f.to), outcome: 'fork' };
      case 'inclusive': {
        const taken = outs.filter((f) => f.id === node.default || evalCondition(f.when, f.lang, inst.variables));
        const chosen = taken.length ? taken : outs.filter((f) => f.id === node.default);
        return { next: chosen.map((f) => f.to), outcome: 'inclusive' };
      }
      case 'event': return { consume: true, outcome: 'event-gateway-wait' }; // downstream catches carry the wait
      case 'complex':
      case 'exclusive':
      default: {
        const match = outs.find((f) => f.when && evalCondition(f.when, f.lang, inst.variables));
        const def = outs.find((f) => f.id === node.default) || outs.find((f) => !f.when);
        const chosen = match || def;
        return { next: chosen ? [chosen.to] : [], outcome: match ? 'conditional' : 'default' };
      }
    }
  }

  // ---- resume (wait states) ----
  /** Complete a wait node (task/timer/message/signal) and continue the instance. */
  async resumeToken(inst: Instance, dep: Deployment, tokenId: string, vars?: Record<string, unknown>): Promise<Instance> {
    const token = inst.tokens.find((t) => t.id === tokenId);
    if (!token || token.state !== 'waiting') throw new Error('token is not waiting');
    if (vars) Object.assign(inst.variables, vars);
    const p = this.proc(inst, dep);
    const node = this.nodeMap(p).get(token.nodeId);
    // exit the wait node, spawn successors, resume the loop
    this.removeToken(inst, tokenId);
    if (node) for (const t of this.defaultTargets(p, node, inst)) inst.tokens.push({ id: this.ctx.newId(), nodeId: t, state: 'active', enteredAt: this.ctx.clock() });
    inst.status = 'running';
    return this.runToQuiescence(inst, dep);
  }

  /** Diagram state for the live canvas highlight. */
  diagramState(inst: Instance) {
    const active = inst.tokens.map((t) => t.nodeId);
    const visited = [...new Set(inst.history.map((h) => h.nodeId))];
    return { activeNodeIds: active, visitedNodeIds: visited, status: inst.status };
  }
}
