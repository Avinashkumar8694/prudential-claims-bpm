// Token-based interpreter over the SDK engine JSON. See docs/08-execution-engine.md.
// Deterministic core (clock/newId injected). Persists the instance after runToQuiescence.
import type { AppContext } from '../context.ts';
import { Collections, type Deployment, type Instance, type NodeVisit, type TimerJob } from '../domain.ts';
import type { EngineFlow, EngineNode, EngineProcess } from '../sdk/index.ts';
import { NODE_HANDLERS, type HandlerCtx, type HandlerResult } from './nodes/index.ts';
import { computeDue } from './duration.ts';

// Error codes the Node runtime raises (documented in docs/14-error-handling.md); user codes also allowed.
export const ENGINE_ERRORS = ['SCRIPT_ERROR', 'SERVICE_ERROR', 'RULE_ERROR', 'CALL_ERROR', 'RUNTIME_ERROR'] as const;
const ERROR_VAR = 'errorInfo';   // { code, node, message } bound when an error is caught

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

        let result: HandlerResult;
        try { result = await this.handle(node, inst, p, joins, dep); }
        catch (e) { result = { error: (e as Error).message, errorCode: 'RUNTIME_ERROR' }; }

        if (result.vars) Object.assign(inst.variables, result.vars);
        visit.exitedAt = this.ctx.clock();
        visit.outcome = result.outcome || (result.wait ? 'waiting' : result.end || (result.error ? 'error' : 'done'));
        this.emit({ kind: 'node.exited', instanceId: inst.id, nodeId: node.id!, tokenId: token.id });

        if (result.wait) {
          token.state = 'waiting'; token.waitFor = result.wait;
          if (result.wait.kind === 'timer' && result.wait.dueAt) await this.scheduleTimer(inst, token.id, node.id!, result.wait.dueAt);
          // schedule any timer boundary events attached to this (now waiting) host node
          for (const b of p.nodes) {
            if (b.type === 'boundary' && (b as any).event?.timer && this.onList(b).includes(node.id!)) {
              await this.scheduleTimer(inst, token.id, b.id!, computeDue((b as any).event.timer, this.ctx.clock()));
            }
          }
          continue;
        }
        if (result.error) {
          this.removeToken(inst, token.id);
          const code = result.errorCode || 'RUNTIME_ERROR';
          if (this.raiseError(inst, p, node.id!, code, result.error)) continue;   // routed to an error catch
          inst.status = 'failed'; inst.error = { nodeId: node.id!, message: result.error, at: this.ctx.clock() }; break;
        }
        if (result.end === 'terminate') { inst.tokens = []; inst.status = 'completed'; break; }
        if (result.end === 'error') {
          this.removeToken(inst, token.id);
          const code = (node as any).throw?.error || 'ERROR';
          if (this.raiseError(inst, p, node.id!, code, `error end: ${code}`)) continue;
          inst.status = 'failed'; inst.error = { nodeId: node.id!, message: `unhandled error end (${code})`, at: this.ctx.clock() }; break;
        }
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

  /** Broadcast a signal/message to every waiting instance in the tenant (send/throw). */
  private async broadcast(name: string): Promise<void> {
    const others = await this.inst().query((i) => i.tenantId === this.ctx.tenantId && (i.status === 'waiting' || i.status === 'running'));
    for (const other of others) {
      const hit = other.tokens.some((t) => t.state === 'waiting' && (t.waitFor?.kind === 'signal' || t.waitFor?.kind === 'message') && t.waitFor?.ref === name);
      if (!hit) continue;
      const dep = await this.deps().get(other.deploymentId);
      if (dep) await this.signalInstance(other, dep, name);
    }
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

  // ---- timers ----
  private timerRepo() { return this.ctx.store.repo<TimerJob>(Collections.timers); }
  private async scheduleTimer(inst: Instance, tokenId: string, nodeId: string, dueAt: string) {
    await this.timerRepo().put({ id: this.ctx.newId(), tenantId: this.ctx.tenantId, instanceId: inst.id, tokenId, nodeId, kind: 'duration', dueAt, fired: 0, status: 'scheduled' });
  }
  /** Cancel a token's pending timers (host completed/resumed → its boundary/catch timers no longer apply). */
  private async cancelTimersForToken(inst: Instance, tokenId: string) {
    const jobs = await this.timerRepo().query((t) => t.instanceId === inst.id && t.tokenId === tokenId && t.status === 'scheduled');
    for (const j of jobs) { j.status = 'cancelled'; await this.timerRepo().put(j); }
  }
  /** Fire a due timer job: boundary timer → activate the boundary; else resume the (catch) token. */
  async fireTimerJob(inst: Instance, dep: Deployment, nodeId: string, tokenId: string): Promise<Instance> {
    const node = this.nodeMap(this.proc(inst, dep)).get(nodeId);
    if (node?.type === 'boundary') return this.fireBoundary(inst, dep, node, tokenId);
    return this.resumeToken(inst, dep, tokenId);
  }
  /** A timer boundary fired: interrupting cancels the host token; then run the boundary's recovery flow. */
  private async fireBoundary(inst: Instance, dep: Deployment, boundary: EngineNode, hostTokenId: string): Promise<Instance> {
    const host = inst.tokens.find((t) => t.id === hostTokenId);
    if (!host) return inst;   // host already finished → stale timer
    if ((boundary as any).interrupting !== false) { this.removeToken(inst, hostTokenId); await this.cancelTimersForToken(inst, hostTokenId); }
    inst.tokens.push({ id: this.ctx.newId(), nodeId: boundary.id!, state: 'active', enteredAt: this.ctx.clock() });
    inst.status = 'running';
    this.emit({ kind: 'node.entered', instanceId: inst.id, nodeId: boundary.id!, tokenId: inst.tokens.at(-1)!.id });
    return this.runToQuiescence(inst, dep);
  }

  // ---- error handling: route a raised error to a matching error-catch (boundary) node ----
  /** on: string | string[]; '*' = all nodes (process-global). Normalize to a list. */
  private onList(n: EngineNode): string[] { const on = (n as any).on; return Array.isArray(on) ? on : (on ? [on] : []); }
  private isErrorCatch(n: EngineNode): boolean { const e = (n as any).event; return n.type === 'boundary' && e && Object.prototype.hasOwnProperty.call(e, 'error'); }
  private isCatchAll(n: EngineNode): boolean { const e = (n as any).event?.error; return e === '' || e === '*' || e == null || String(e).toUpperCase() === 'ANY'; }

  /** Find the best error-catch for (failing node, code): node-specific+code → node+any → global+code → global+any. */
  private findErrorHandler(p: EngineProcess, nodeId: string, code: string): EngineNode | undefined {
    const catches = p.nodes.filter((n) => this.isErrorCatch(n));
    const onNode = (n: EngineNode) => this.onList(n).includes(nodeId);
    const global = (n: EngineNode) => this.onList(n).includes('*');
    return catches.find((n) => onNode(n) && !this.isCatchAll(n) && (n as any).event.error === code)
      || catches.find((n) => onNode(n) && this.isCatchAll(n))
      || catches.find((n) => global(n) && !this.isCatchAll(n) && (n as any).event.error === code)
      || catches.find((n) => global(n) && this.isCatchAll(n));
  }

  /** Route an error to a matching error-catch; returns true if handled (a handler token was spawned). */
  private raiseError(inst: Instance, p: EngineProcess, failingNodeId: string, code: string, message: string): boolean {
    const handler = this.findErrorHandler(p, failingNodeId, code);
    if (!handler) return false;
    inst.variables[ERROR_VAR] = { code, node: failingNodeId, message };
    // a process-global (on '*') error is interrupting for the whole instance → cancel all other tokens
    if (this.onList(handler).includes('*')) inst.tokens = [];
    inst.tokens.push({ id: this.ctx.newId(), nodeId: handler.id!, state: 'active', enteredAt: this.ctx.clock() });
    this.emit({ kind: 'node.entered', instanceId: inst.id, nodeId: handler.id!, tokenId: inst.tokens.at(-1)!.id });
    return true;
  }

  private defaultTargets(p: EngineProcess, node: EngineNode, _inst: Instance): string[] {
    return this.outgoing(p, node.id!).map((f) => f.to);
  }

  // ---- node dispatch ----
  // Each node type's backend logic lives in src/engine/nodes/<type>/handler.ts (see NODE_HANDLERS).
  // The engine builds a HandlerCtx (node + instance state + capabilities) and runs the handler.
  private async handle(node: EngineNode, inst: Instance, p: EngineProcess, joins: Record<string, Set<string>>, dep: Deployment): Promise<HandlerResult> {
    const h = NODE_HANDLERS[node.type];
    if (!h) return {};   // e.g. 'boundary' — spawned by the error router, then follows its outgoing flow
    const c: HandlerCtx = {
      node, inst, proc: p, dep, app: this.ctx, joins,
      outgoing: (id) => this.outgoing(p, id),
      incoming: (id) => this.incoming(p, id),
      emit: (e) => this.emit(e),
      startChild: (d, pid, vars, tok) => this.startChild(d, pid, vars, inst.startedBy, inst.id, tok),
      broadcast: (name) => this.broadcast(name),
      resolveCalled: this.resolveCalled,
    };
    return h(c);
  }

  // ---- resume (wait states) ----
  /** Complete a wait node (task/timer/message/signal) and continue the instance. */
  async resumeToken(inst: Instance, dep: Deployment, tokenId: string, vars?: Record<string, unknown>): Promise<Instance> {
    const token = inst.tokens.find((t) => t.id === tokenId);
    if (!token || token.state !== 'waiting') throw new Error('token is not waiting');
    if (vars) Object.assign(inst.variables, vars);
    await this.cancelTimersForToken(inst, tokenId);   // host resumed → drop its pending boundary/catch timers
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
