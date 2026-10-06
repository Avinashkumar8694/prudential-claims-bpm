// Token-based interpreter over the SDK engine JSON. Deterministic core (clock/newId injected via
// AppContext). Persists the instance after every runToQuiescence.
import type { AppContext } from '../context.ts';
import { Collections, type Deployment, type Instance, type NodeVisit, type Task, type TimerJob, type Token } from '../domain.ts';
import type { EngineFlow, EngineNode, EngineProcess } from '../sdk/index.ts';
import { NODE_HANDLERS, CHILD_OUTPUT_MAPPERS, buildMultiInstanceResult, type HandlerCtx, type HandlerResult } from './nodes/index.ts';
import { varTypesOf, kcontextInfoOf, onActionOf } from './nodes/kcontext-info.ts';
import * as boundaryHandler from './nodes/boundary/handler.ts';
import { computeDue } from './duration.ts';
import { runScript, evalCondition } from './sandbox.ts';
import { config } from '../infra/config.ts';
import { conflict, quotaExceeded } from '../infra/errors.ts';
import { SettingsService } from '../modules/settings/service.ts';

export const ENGINE_ERRORS = boundaryHandler.ENGINE_ERRORS;
const ERROR_VAR = 'errorInfo';

export type EngineEvent = { kind: string; instanceId?: string; nodeId?: string; tokenId?: string; taskId?: string; [k: string]: unknown };

export class ExecutionEngine {
  constructor(
    private ctx: AppContext,
    private emit: (e: EngineEvent) => void,
    private resolveCalled?: (processId: string, workflowId?: string) => Promise<{ dep: Deployment; processId: string } | undefined>,
  ) {}

  private inst() { return this.ctx.store.repo<Instance>(Collections.instances); }
  private timerRepo() { return this.ctx.store.repo<TimerJob>(Collections.timers); }
  private taskRepo() { return this.ctx.store.repo<Task>(Collections.tasks); }

  proc(inst: Instance, dep: Deployment): EngineProcess {
    const list = dep.engine?.processes || [];
    return (inst.processId && list.find((p) => p.id === inst.processId)) || list[0]!;
  }
  private nodeMap(p: EngineProcess): Map<string, EngineNode> { return new Map((p.nodes || []).map((n) => [n.id!, n])); }
  outgoing(p: EngineProcess, id: string): EngineFlow[] { return (p.flows || []).filter((f) => f.from === id); }
  incoming(p: EngineProcess, id: string): EngineFlow[] { return (p.flows || []).filter((f) => f.to === id); }
  private defaultTargets(p: EngineProcess, node: EngineNode, _inst: Instance): string[] {
    return this.outgoing(p, node.id!).map((f) => f.to);
  }

  // ---- start ----
  async start(dep: Deployment, variables: Record<string, unknown>, actor: string, opts: { processId?: string; correlationKey?: string } = {}): Promise<Instance> {
    const p = opts.processId ? (dep.engine.processes || []).find((x) => x.id === opts.processId) : dep.engine.processes?.[0];
    if (!p) throw conflict(`process "${opts.processId}" not found in this deployment`);
    const now = this.ctx.clock();
    const seed: Record<string, unknown> = {};
    for (const v of p.vars || []) seed[v.name] = undefined;
    // Prefer a plain (untriggered) start node for an explicit API-driven start; fall back to whatever
    // start node exists (a process whose only start is signal/message/timer-triggered can still be
    // kicked off directly through the management API).
    const start = (p.nodes || []).find((n) => n.type === 'start' && (!('on' in n) || !(n as any).on || Object.keys((n as any).on).length === 0))
      || (p.nodes || []).find((n) => n.type === 'start');
    if (!start) throw conflict('process has no start node');
    const inst: Instance = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, deploymentId: dep.id, workflowId: dep.workflowId,
      processId: p.id, correlationKey: opts.correlationKey,
      status: 'running', variables: { ...seed, ...variables },
      tokens: [{ id: this.ctx.newId(), nodeId: start.id!, state: 'active', enteredAt: now }],
      history: [], startedAt: now, startedBy: actor,
    };
    return this.runToQuiescence(inst, dep);
  }

  private async startChildReal(dep: Deployment, processId: string, vars: Record<string, unknown>, actor: string, parentInstanceId: string, parentTokenId: string, independent?: boolean): Promise<Instance> {
    const p = (dep.engine.processes || []).find((x) => x.id === processId);
    if (!p) throw conflict(`process "${processId}" not found`);
    const now = this.ctx.clock();
    const start = (p.nodes || []).find((n) => n.type === 'start');
    if (!start) throw conflict(`process "${processId}" has no start node`);
    const child: Instance = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, deploymentId: dep.id, workflowId: dep.workflowId,
      processId: p.id, status: 'running', variables: { ...vars },
      tokens: [{ id: this.ctx.newId(), nodeId: start.id!, state: 'active', enteredAt: now }],
      history: [], startedAt: now, startedBy: actor,
      parentInstanceId, parentTokenId, ...(independent ? { independent: true } : {}),
    };
    return this.runToQuiescence(child, dep);
  }

  // ---- the main loop ----
  async runToQuiescence(inst: Instance, dep: Deployment): Promise<Instance> {
    const p = this.proc(inst, dep);
    const nodes = this.nodeMap(p);
    const joins: Record<string, Set<string>> = {};
    let guard = 0;
    let terminateAll = false;
    try {
      while (inst.status === 'running') {
        // Real jBPM's Conditional Catch/Boundary Event: re-checked passively every tick against
        // whatever the instance's variables are RIGHT NOW.
        await this.resolveConditionWaits(inst, p, nodes);
        const token = inst.tokens.find((t) => t.state === 'active');
        if (!token) break;
        if (++guard > 100000) throw new Error('step budget exceeded (possible loop)');
        const node = nodes.get(token.nodeId);
        if (!node) { this.removeToken(inst, token.id); continue; }

        const visit: NodeVisit = { tokenId: token.id, nodeId: node.id!, type: node.type, enteredAt: this.ctx.clock() };
        inst.history.push(visit);
        this.emit({ kind: 'node.entered', instanceId: inst.id, nodeId: node.id!, tokenId: token.id });

        let result: HandlerResult;
        try { result = await this.handle(node, inst, p, joins, dep, token.id); }
        catch (e) { result = { error: (e as Error).message, errorCode: (e as { code?: string }).code || 'RUNTIME_ERROR' }; }

        if (result.vars) Object.assign(inst.variables, result.vars);
        visit.exitedAt = this.ctx.clock();
        visit.outcome = result.outcome || (result.wait ? 'waiting' : result.end || (result.error ? 'error' : 'done'));
        this.emit({ kind: 'node.exited', instanceId: inst.id, nodeId: node.id!, tokenId: token.id });

        if (result.wait) {
          token.state = 'waiting'; token.waitFor = result.wait;
          try {
            if (result.wait.kind === 'timer' && result.wait.dueAt) {
              const spec = (node as any).event?.timer;
              const cycle = spec && typeof spec === 'object' ? spec.cycle : undefined;
              await this.scheduleTimer(inst, token.id, node.id!, result.wait.dueAt, cycle);
            }
            for (const b of boundaryHandler.boundaryTimerHosts(p.nodes, node.id!)) {
              const spec = (b as any).event.timer;
              const cycle = typeof spec === 'object' ? spec.cycle : undefined;
              await this.scheduleTimer(inst, token.id, b.id!, computeDue(spec, this.ctx.clock()), cycle);
            }
          } catch (e) {
            this.removeToken(inst, token.id);
            const code = (e as { code?: string }).code === 'QUOTA_EXCEEDED' ? 'QUOTA_EXCEEDED' : 'RUNTIME_ERROR';
            if (this.raiseError(inst, p, node.id!, code, (e as Error).message)) continue;
            inst.status = 'failed'; inst.error = { nodeId: node.id!, message: (e as Error).message, at: this.ctx.clock() }; break;
          }
          for (const b of boundaryHandler.messageBoundaryHosts(p.nodes, node.id!)) {
            inst.tokens.push({ id: this.ctx.newId(), nodeId: b.node.id!, state: 'waiting', waitFor: { kind: b.kind, ref: b.name }, enteredAt: this.ctx.clock() });
          }
          for (const b of boundaryHandler.conditionBoundaryHosts(p.nodes, node.id!)) {
            inst.tokens.push({ id: this.ctx.newId(), nodeId: b.id!, state: 'waiting', waitFor: { kind: 'condition' }, enteredAt: this.ctx.clock() });
          }
          continue;
        }
        if (result.error) {
          this.removeToken(inst, token.id);
          const code = result.errorCode || 'RUNTIME_ERROR';
          if (this.raiseError(inst, p, node.id!, code, result.error)) continue;
          inst.status = 'failed'; inst.error = { nodeId: node.id!, message: result.error, at: this.ctx.clock() }; break;
        }
        if (result.end === 'terminate') {
          inst.tokens = []; inst.status = 'completed'; terminateAll = result.terminateAll === true;
          if (terminateAll) inst.terminateAll = true;
          break;
        }
        if (result.end === 'error') {
          this.removeToken(inst, token.id);
          const code = (node as any).throw?.error || 'ERROR';
          if (this.raiseError(inst, p, node.id!, code, `error end: ${code}`)) continue;
          inst.status = 'failed'; inst.error = { nodeId: node.id!, message: `unhandled error end (${code})`, at: this.ctx.clock() }; break;
        }
        for (const b of boundaryHandler.compensationBoundaries(p.nodes, node.id!)) {
          const target = this.outgoing(p, b.id!)[0]?.to;
          if (target) (inst.compensations ||= []).push({ host: node.id!, handler: target });
        }
        this.removeHostToken(inst, p, token.id, node.id!);
        if (result.end === 'complete' || result.consume || inst.status !== 'running') { /* no successors */ }
        else {
          const targets = result.next ?? this.defaultTargets(p, node, inst);
          for (const t of targets) inst.tokens.push({ id: this.ctx.newId(), nodeId: t, state: 'active', enteredAt: this.ctx.clock() });
        }
      }
      if (inst.status === 'running') {
        inst.status = inst.tokens.some((t) => t.state === 'waiting') ? 'waiting' : 'completed';
      }
      if (inst.status === 'completed' || inst.status === 'aborted' || inst.status === 'failed') inst.endedAt = this.ctx.clock();
    } catch (err) {
      inst.status = 'failed';
      inst.error = { nodeId: '', message: (err as Error).message, stack: (err as Error).stack, at: this.ctx.clock() };
      inst.endedAt = this.ctx.clock();
    }
    await this.finalize(inst, terminateAll);
    return inst;
  }

  /** Resolve any waiting Condition Catch/Boundary token whose event.condition now evaluates true. A
   *  dialect the sandbox can't run (e.g. Java, unavailable in this build) fails that ONE token through
   *  the normal error-catch routing rather than aborting the whole instance. */
  private async resolveConditionWaits(inst: Instance, p: EngineProcess, nodes: Map<string, EngineNode>): Promise<void> {
    for (const t of inst.tokens) {
      if (t.state !== 'waiting' || t.waitFor?.kind !== 'condition') continue;
      const node = nodes.get(t.nodeId) as any;
      const expr = node?.event?.condition;
      if (typeof expr !== 'string' || !expr) continue;
      let matched: boolean;
      try {
        matched = await evalCondition(expr, node.event.lang, inst.variables);
      } catch (e) {
        this.removeToken(inst, t.id);
        const code = (e as { code?: string }).code || 'RUNTIME_ERROR';
        if (!this.raiseError(inst, p, node.id, code, (e as Error).message)) {
          inst.status = 'failed'; inst.error = { nodeId: node.id, message: (e as Error).message, at: this.ctx.clock() };
        }
        continue;
      }
      if (!matched) continue;
      if (node.type === 'boundary') {
        this.removeToken(inst, t.id);
        await this.activateBoundary(inst, p, node);
      } else {
        this.removeHostToken(inst, p, t.id, node.id);
        for (const target of this.defaultTargets(p, node, inst)) {
          inst.tokens.push({ id: this.ctx.newId(), nodeId: target, state: 'active', enteredAt: this.ctx.clock() });
        }
      }
    }
  }

  // ---- resume (wait states) ----
  async resumeToken(inst: Instance, dep: Deployment, tokenId: string, vars?: Record<string, unknown>): Promise<Instance> {
    if (inst.status === 'suspended') throw conflict('instance is suspended');
    const token = inst.tokens.find((t) => t.id === tokenId);
    if (!token || token.state !== 'waiting') throw conflict('token is not waiting');
    if (vars) Object.assign(inst.variables, vars);
    await this.cancelTimersForToken(inst, tokenId);
    const p = this.proc(inst, dep);
    const node = this.nodeMap(p).get(token.nodeId);
    if (node?.type === 'boundary') {
      this.removeToken(inst, tokenId);
      await this.activateBoundary(inst, p, node);
      inst.status = 'running';
      return this.runToQuiescence(inst, dep);
    }
    if (node) this.removeHostToken(inst, p, tokenId, node.id!); else this.removeToken(inst, tokenId);
    if (node) await this.cancelEventGatewaySiblings(inst, p, node.id!);
    if (node && (node as any).onExit) {
      const c = this.buildCtx(node, inst, p, {}, dep, tokenId);
      const exitErr = await this.runLifecycle(node, 'onExit', c);
      if (exitErr) {
        if (!this.raiseError(inst, p, node.id!, 'SCRIPT_ERROR', exitErr)) {
          inst.status = 'failed'; inst.error = { nodeId: node.id!, message: exitErr, at: this.ctx.clock() };
        }
        inst.status = inst.status === 'failed' ? 'failed' : 'running';
        return this.runToQuiescence(inst, dep);
      }
    }
    if (node) {
      for (const b of boundaryHandler.compensationBoundaries(p.nodes, node.id!)) {
        const target = this.outgoing(p, b.id!)[0]?.to;
        if (target) (inst.compensations ||= []).push({ host: node.id!, handler: target });
      }
      for (const t of this.defaultTargets(p, node, inst)) inst.tokens.push({ id: this.ctx.newId(), nodeId: t, state: 'active', enteredAt: this.ctx.clock() });
    }
    inst.status = 'running';
    return this.runToQuiescence(inst, dep);
  }

  private async cancelEventGatewaySiblings(inst: Instance, p: EngineProcess, resolvedNodeId: string): Promise<void> {
    const incoming = this.incoming(p, resolvedNodeId);
    for (const f of incoming) {
      const gw = this.nodeMap(p).get(f.from);
      if (gw?.type !== 'gateway' || (gw as any).mode !== 'event') continue;
      const siblingIds = new Set(this.outgoing(p, gw.id!).map((of) => of.to).filter((id) => id !== resolvedNodeId));
      for (const t of [...inst.tokens]) {
        if (siblingIds.has(t.nodeId) && t.state === 'waiting') {
          await this.cancelTimersForToken(inst, t.id);
          this.removeToken(inst, t.id);
        }
      }
    }
  }

  /** Interrupt the (single) waiting host token this boundary is attached to (if `interrupting`), then
   *  activate the boundary's own token. Non-recursive — safe to call from inside an already-running
   *  main loop (resolveConditionWaits) as well as from the wait-resume paths (which recurse into
   *  runToQuiescence themselves, afterward). */
  private async activateBoundary(inst: Instance, p: EngineProcess, boundary: EngineNode): Promise<void> {
    const hostIds = boundaryHandler.onList(boundary);
    const host = inst.tokens.find((t) => t.state === 'waiting' && hostIds.includes(t.nodeId));
    if (host && (boundary as any).interrupting !== false) {
      this.removeHostToken(inst, p, host.id, host.nodeId);
      await this.cancelTimersForToken(inst, host.id);
      await this.exitOpenTaskForToken(host.id);
    }
    inst.tokens.push({ id: this.ctx.newId(), nodeId: boundary.id!, state: 'active', enteredAt: this.ctx.clock() });
    this.emit({ kind: 'node.entered', instanceId: inst.id, nodeId: boundary.id!, tokenId: inst.tokens.at(-1)!.id });
  }

  /** A timer boundary fired — `hostTokenId` (not the boundary's own; timer boundaries never get one)
   *  is the exact host token the scheduled TimerJob recorded. */
  private async fireBoundary(inst: Instance, dep: Deployment, boundary: EngineNode, hostTokenId: string): Promise<Instance> {
    const p = this.proc(inst, dep);
    const host = inst.tokens.find((t) => t.id === hostTokenId);
    if (!host) return inst;
    if ((boundary as any).interrupting !== false) {
      this.removeHostToken(inst, p, hostTokenId, host.nodeId); await this.cancelTimersForToken(inst, hostTokenId);
      await this.exitOpenTaskForToken(hostTokenId);
    }
    inst.tokens.push({ id: this.ctx.newId(), nodeId: boundary.id!, state: 'active', enteredAt: this.ctx.clock() });
    inst.status = 'running';
    this.emit({ kind: 'node.entered', instanceId: inst.id, nodeId: boundary.id!, tokenId: inst.tokens.at(-1)!.id });
    return this.runToQuiescence(inst, dep);
  }

  // ---- error handling ----
  private raiseError(inst: Instance, p: EngineProcess, failingNodeId: string, code: string, message: string): boolean {
    const handler = boundaryHandler.findErrorHandler(p.nodes, failingNodeId, code);
    if (!handler) return false;
    inst.variables[ERROR_VAR] = { code, node: failingNodeId, message };
    if (boundaryHandler.isGlobalCatch(handler)) inst.tokens = [];
    inst.tokens.push({ id: this.ctx.newId(), nodeId: handler.id!, state: 'active', enteredAt: this.ctx.clock() });
    this.emit({ kind: 'node.entered', instanceId: inst.id, nodeId: handler.id!, tokenId: inst.tokens.at(-1)!.id });
    return true;
  }

  private async raiseEscalation(inst: Instance, p: EngineProcess, code: string): Promise<boolean> {
    const activeHostIds = new Set(inst.tokens.filter((t) => t.state === 'waiting' || t.state === 'active').map((t) => t.nodeId));
    const handler = boundaryHandler.findEscalationHandler(p.nodes, activeHostIds, code);
    if (!handler) return false;
    if ((handler as any).interrupting !== false) {
      const hostIds = boundaryHandler.onList(handler);
      const global = hostIds.includes('*');
      const hosts = inst.tokens.filter((t) => (t.state === 'waiting' || t.state === 'active') && (global || hostIds.includes(t.nodeId)));
      for (const host of hosts) {
        this.removeHostToken(inst, p, host.id, host.nodeId);
        await this.cancelTimersForToken(inst, host.id);
        await this.exitOpenTaskForToken(host.id);
      }
    }
    inst.tokens.push({ id: this.ctx.newId(), nodeId: handler.id!, state: 'active', enteredAt: this.ctx.clock() });
    this.emit({ kind: 'node.entered', instanceId: inst.id, nodeId: handler.id!, tokenId: inst.tokens.at(-1)!.id });
    return true;
  }

  // ---- compensation ----
  private async compensate(inst: Instance, p: EngineProcess, dep: Deployment, ref?: string): Promise<Record<string, unknown>> {
    const list = inst.compensations || [];
    const targets = ref ? list.filter((c) => c.host === ref) : [...list].reverse();
    const merged: Record<string, unknown> = {};
    for (const comp of targets) {
      const node = this.nodeMap(p).get(comp.handler);
      if (!node) continue;
      const tempTokenId = this.ctx.newId();
      const c = this.buildCtx(node, inst, p, {}, dep, tempTokenId);
      const h = NODE_HANDLERS[node.type];
      if (!h) continue;
      const res = await h(c);
      if (res.vars) { Object.assign(inst.variables, res.vars); Object.assign(merged, res.vars); }
    }
    inst.compensations = ref ? list.filter((c) => c.host !== ref) : [];
    return merged;
  }

  // ---- signals / messages ----
  /** Untargeted broadcast — 'message' resolves to the single oldest waiter across every instance;
   *  'signal' fans out to every waiter AND every matching signal-start (real jBPM's own default
   *  signal scope). `correlationKey`, when given, narrows delivery to only the waiting instance(s)
   *  whose OWN correlationKey matches. */
  private async broadcast(name: string, kind: 'signal' | 'message', correlationKey?: string): Promise<void> {
    const waiters = (await this.inst().query((i) =>
      i.tenantId === this.ctx.tenantId && i.status === 'waiting' &&
      i.tokens.some((t) => t.state === 'waiting' && t.waitFor?.kind === kind && t.waitFor.ref === name) &&
      (!correlationKey || i.correlationKey === correlationKey)))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const targets = kind === 'message' ? waiters.slice(0, 1) : waiters;
    for (const w of targets) {
      const dep = await this.ctx.store.repo<Deployment>(Collections.deployments).get(w.deploymentId);
      if (!dep) continue;
      const token = w.tokens.find((t) => t.state === 'waiting' && t.waitFor?.kind === kind && t.waitFor.ref === name);
      if (token) await this.resumeToken(w, dep, token.id);
    }
    await this.startTriggeredProcesses(name, kind);
  }

  /** Spawn a fresh instance per active deployment whose start node's `on.signal`/`on.message` matches
   *  (name, kind) exactly. A signal starts every matching deployment (broadcast); a message-triggered
   *  start only fires when NOTHING was already waiting for it (checked by the caller — broadcast()
   *  always calls this after resolving waiters, and a message-start is just one more potential
   *  "recipient" alongside any waiting Receive/Catch, so every matching deployment still gets to spawn
   *  once each — jBPM's own message-start semantics are point-to-point per LISTENER, not globally
   *  single-fire). */
  private async startTriggeredProcesses(name: string, kind: 'signal' | 'message'): Promise<void> {
    const active = await this.ctx.store.repo<Deployment>(Collections.deployments).query((d) => d.tenantId === this.ctx.tenantId && d.status === 'active');
    for (const dep of active) {
      for (const p of dep.engine?.processes || []) {
        for (const n of p.nodes || []) {
          if (n.type !== 'start') continue;
          const on = (n as any).on;
          const matches = kind === 'signal' ? on?.signal === name : on?.message === name;
          if (!matches) continue;
          await this.start(dep, {}, 'system', { processId: p.id });
        }
      }
    }
  }

  /** Deliver a signal to ONE specific instance by id (targeted, real jBPM's
   *  KieRuntime.signalEvent(type, event, processInstanceId)). Payload merges into variables under the
   *  signal's own name if the instance is waiting on a signal/message with this name; otherwise no-op. */
  async signalTargeted(fromInst: Instance | undefined, dep: Deployment | undefined, targetInstanceId: string, name: string, payload?: unknown): Promise<void> {
    const target = await this.inst().get(targetInstanceId);
    if (!target || target.tenantId !== this.ctx.tenantId || target.status !== 'waiting') return;
    const targetDep = await this.ctx.store.repo<Deployment>(Collections.deployments).get(target.deploymentId);
    if (!targetDep) return;
    const token = target.tokens.find((t) => t.state === 'waiting' && (t.waitFor?.kind === 'signal' || t.waitFor?.kind === 'message') && t.waitFor.ref === name);
    if (!token) return;
    const vars = payload !== undefined ? { [name]: payload } : undefined;
    await this.resumeToken(target, targetDep, token.id, vars);
  }

  private async abortTargeted(_fromInst: Instance, targetInstanceId: string): Promise<void> {
    const target = await this.inst().get(targetInstanceId);
    if (!target || target.tenantId !== this.ctx.tenantId) return;
    await this.abortInstance(target);
  }

  // ---- public instance-lifecycle operations (used by modules/instances/service.ts) ----
  // NOTE: every public method here assumes it is the ONLY in-flight operation against this specific
  // instance id — callers (the instances service) are responsible for serializing concurrent
  // operations on the same instance (e.g. two task-completions racing on sibling multi-instance
  // children), typically via a per-instance-id async mutex before loading + after persisting.

  async abortInstance(inst: Instance): Promise<Instance> {
    if (inst.status === 'completed' || inst.status === 'aborted' || inst.status === 'failed') return inst;
    inst.status = 'aborted'; inst.tokens = []; inst.endedAt = this.ctx.clock();
    await this.finalize(inst, false);
    return inst;
  }

  async retryNode(inst: Instance, dep: Deployment, nodeId: string): Promise<Instance> {
    inst.error = undefined;
    inst.tokens.push({ id: this.ctx.newId(), nodeId, state: 'active', enteredAt: this.ctx.clock() });
    inst.status = 'running';
    return this.runToQuiescence(inst, dep);
  }

  /** A variable edit (PUT /instances/:id/variables) may satisfy a condition wait that was previously
   *  false — give resolveConditionWaits its per-tick chance to notice. */
  async recheckConditions(inst: Instance, dep: Deployment): Promise<Instance> {
    if (inst.status !== 'waiting' || !inst.tokens.some((t) => t.waitFor?.kind === 'condition')) return inst;
    inst.status = 'running';
    return this.runToQuiescence(inst, dep);
  }

  async fireTimerJob(inst: Instance, dep: Deployment, nodeId: string, tokenId: string): Promise<Instance> {
    const node = this.nodeMap(this.proc(inst, dep)).get(nodeId);
    if (node?.type === 'boundary') return this.fireBoundary(inst, dep, node, tokenId);
    return this.resumeToken(inst, dep, tokenId);
  }

  // ---- descendants ----
  async abortDescendants(instanceId: string): Promise<void> {
    const children = await this.inst().query((i) => i.tenantId === this.ctx.tenantId && i.parentInstanceId === instanceId && !i.independent);
    for (const child of children) {
      if (child.status === 'running' || child.status === 'waiting' || child.status === 'suspended') await this.abortInstance(child);
    }
  }

  // ---- token/host removal helpers ----
  private removeToken(inst: Instance, tokenId: string) { inst.tokens = inst.tokens.filter((t) => t.id !== tokenId); }

  private removeHostToken(inst: Instance, p: EngineProcess, hostTokenId: string, hostNodeId: string): void {
    this.removeToken(inst, hostTokenId);
    const boundaryIds = new Set([
      ...boundaryHandler.messageBoundaryHosts(p.nodes, hostNodeId).map((b) => b.node.id!),
      ...boundaryHandler.conditionBoundaryHosts(p.nodes, hostNodeId).map((b) => b.id!),
    ]);
    if (boundaryIds.size) inst.tokens = inst.tokens.filter((t) => !(t.state === 'waiting' && boundaryIds.has(t.nodeId)));
  }

  // ---- timers ----
  private async scheduleTimer(inst: Instance, tokenId: string, nodeId: string, dueAt: string, cycle?: string): Promise<void> {
    const { maxActiveTimers } = await new SettingsService(this.ctx).get();
    if (maxActiveTimers) {
      const active = await this.timerRepo().query((t) => t.tenantId === this.ctx.tenantId && t.status === 'scheduled');
      if (active.length >= maxActiveTimers) throw quotaExceeded(`per-tenant active-timer quota exceeded (max ${maxActiveTimers})`, { quota: 'maxActiveTimers', max: maxActiveTimers, current: active.length });
    }
    const job: TimerJob = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, instanceId: inst.id, tokenId, nodeId,
      kind: cycle ? 'cycle' : 'duration', dueAt, cycle, fired: 0, status: 'scheduled',
    };
    await this.timerRepo().put(job);
  }

  private async cancelTimersForToken(inst: Instance, tokenId: string): Promise<void> {
    const jobs = await this.timerRepo().query((t) => t.tenantId === this.ctx.tenantId && t.instanceId === inst.id && t.tokenId === tokenId && t.status === 'scheduled');
    for (const j of jobs) { j.status = 'cancelled'; await this.timerRepo().put(j); }
  }
  private async cancelTimersForInstance(instanceId: string): Promise<void> {
    const jobs = await this.timerRepo().query((t) => t.tenantId === this.ctx.tenantId && t.instanceId === instanceId && t.status === 'scheduled');
    for (const j of jobs) { j.status = 'cancelled'; await this.timerRepo().put(j); }
  }

  // ---- tasks ----
  private async exitOpenTaskForToken(tokenId: string): Promise<void> {
    const tasks = await this.taskRepo().query((t) => t.tenantId === this.ctx.tenantId && t.tokenId === tokenId && t.status !== 'completed' && t.status !== 'skipped' && t.status !== 'exited' && t.status !== 'error');
    for (const t of tasks) { t.status = 'exited'; await this.taskRepo().put(t); }
  }
  private async exitOpenTasks(instanceId: string): Promise<void> {
    const tasks = await this.taskRepo().query((t) => t.tenantId === this.ctx.tenantId && t.instanceId === instanceId && t.status !== 'completed' && t.status !== 'skipped' && t.status !== 'exited' && t.status !== 'error');
    for (const t of tasks) { t.status = 'exited'; await this.taskRepo().put(t); }
  }

  // ---- terminal-state bookkeeping (persist, notify, cascade cleanup, propagate to parent) ----
  private async finalize(inst: Instance, terminateAllFlag: boolean): Promise<void> {
    await this.inst().put(inst);
    const kind = inst.status === 'failed' ? 'instance.failed' : inst.status === 'completed' ? 'instance.completed' : inst.status === 'aborted' ? 'instance.aborted' : 'instance.updated';
    this.emit({ kind, instanceId: inst.id });
    if (inst.status === 'completed' || inst.status === 'aborted' || inst.status === 'failed') {
      await this.cancelTimersForInstance(inst.id);
      await this.exitOpenTasks(inst.id);
      await this.abortDescendants(inst.id);
    }
    if (inst.parentInstanceId) {
      if (inst.status === 'completed') await this.tryResumeParent(inst, terminateAllFlag);
      else if (inst.status === 'aborted' || inst.status === 'failed') await this.tryFailParent(inst);
    }
  }

  // ---- parent/child resume propagation ----
  private async tryResumeParent(child: Instance, terminateAll = false): Promise<void> {
    if (!child.parentInstanceId || !child.parentTokenId) return;
    const parent = await this.inst().get(child.parentInstanceId);
    if (!parent) return;
    const pdep = await this.ctx.store.repo<Deployment>(Collections.deployments).get(parent.deploymentId);
    if (!pdep) return;
    const p = this.proc(parent, pdep);
    const token = parent.tokens.find((t) => t.id === child.parentTokenId && t.state === 'waiting' && t.waitFor?.kind === 'child' && t.waitFor.ref === child.id);
    if (token) {
      const callNode = this.nodeMap(p).get(token.nodeId);
      const mapper = callNode && CHILD_OUTPUT_MAPPERS[callNode.type];
      const vars = mapper ? mapper(callNode, child) : {};
      if (terminateAll) {
        this.removeHostToken(parent, p, token.id, token.nodeId);
        parent.tokens = []; parent.status = 'completed'; parent.terminateAll = true;
        await this.finalize(parent, true);
        return;
      }
      await this.resumeToken(parent, pdep, token.id, vars);
      return;
    }
    // Multi-instance sibling: the parent isn't waiting on THIS child's own token — it's waiting (or
    // still running) with a 'multiInstance' wait on the SAME parentTokenId, tracking N siblings.
    const miToken = parent.tokens.find((t) => t.id === child.parentTokenId);
    if (miToken?.waitFor?.kind !== 'multiInstance' && miToken?.state !== 'active') return;
    const node = this.nodeMap(p).get(miToken.nodeId) as any;
    if (node?.type !== 'forEach') return;
    const siblings = await this.inst().query((i) => i.tenantId === this.ctx.tenantId && i.parentInstanceId === parent.id && i.parentTokenId === miToken.id);
    const total = Array.isArray(parent.variables[node.over]) ? (parent.variables[node.over] as unknown[]).length : siblings.length;
    const result = buildMultiInstanceResult(siblings, total, node);
    if (result.wait) return; // still waiting on more siblings
    if (miToken.state !== 'waiting') return; // parent hasn't parked on this yet — nothing to resume
    if (result.end === 'terminate') {
      this.removeHostToken(parent, p, miToken.id, miToken.nodeId);
      parent.tokens = []; parent.status = 'completed'; parent.terminateAll = true;
      await this.finalize(parent, true);
      return;
    }
    if (result.error) {
      this.removeHostToken(parent, p, miToken.id, miToken.nodeId);
      if (this.raiseError(parent, p, miToken.nodeId, result.errorCode || 'MULTIINSTANCE_ERROR', result.error)) {
        parent.status = 'running';
        await this.runToQuiescence(parent, pdep);
        return;
      }
      parent.status = 'failed'; parent.error = { nodeId: miToken.nodeId, message: result.error, at: this.ctx.clock() };
      await this.finalize(parent, false);
      return;
    }
    await this.resumeToken(parent, pdep, miToken.id, result.vars);
  }

  private async tryFailParent(child: Instance): Promise<void> {
    if (!child.parentInstanceId || !child.parentTokenId) return;
    const parent = await this.inst().get(child.parentInstanceId);
    if (!parent) return;
    const pdep = await this.ctx.store.repo<Deployment>(Collections.deployments).get(parent.deploymentId);
    if (!pdep) return;
    const p = this.proc(parent, pdep);
    const token = parent.tokens.find((t) => t.id === child.parentTokenId);
    if (!token) return;
    const callNode = this.nodeMap(p).get(token.nodeId);
    const code = callNode?.type === 'call' ? 'CALL_ABORTED' : callNode?.type === 'forEach' ? 'MULTIINSTANCE_ERROR' : 'SUBPROCESS_ABORTED';
    this.removeHostToken(parent, p, token.id, token.nodeId);
    if (this.raiseError(parent, p, token.nodeId, code, `child instance ${child.status}`)) {
      parent.status = 'running';
      await this.runToQuiescence(parent, pdep);
      return;
    }
    parent.status = 'failed'; parent.error = { nodeId: token.nodeId, message: `child instance ${child.status}`, at: this.ctx.clock() };
    await this.finalize(parent, false);
  }

  // ---- node dispatch ----
  private buildCtx(node: EngineNode, inst: Instance, p: EngineProcess, joins: Record<string, Set<string>>, dep: Deployment, tokenId: string): HandlerCtx {
    return {
      node, inst, proc: p, dep, app: this.ctx, joins, tokenId,
      outgoing: (id) => this.outgoing(p, id),
      incoming: (id) => this.incoming(p, id),
      emit: (e) => this.emit(e),
      startChild: (d, pid, vars, tok, independent) => this.startChildReal(d, pid, vars, inst.startedBy, inst.id, tok, independent),
      broadcast: (name, kind, correlationKey) => this.broadcast(name, kind, correlationKey),
      signal: (targetInstanceId, name, payload) => this.signalTargeted(inst, dep, targetInstanceId, name, payload),
      abort: (targetInstanceId) => this.abortTargeted(inst, targetInstanceId),
      compensate: (ref) => this.compensate(inst, p, dep, ref),
      escalate: (code) => this.raiseEscalation(inst, p, code),
      resolveCalled: this.resolveCalled,
    };
  }

  private async runLifecycle(node: EngineNode, kind: 'onEntry' | 'onExit', c: HandlerCtx): Promise<string | undefined> {
    const text = (node as any)[kind] as string | undefined;
    if (!text) return undefined;
    const lang = (node as any)[`${kind}Lang`] as string | undefined;
    if (lang && lang !== 'js' && lang !== 'java') return undefined;
    try {
      await runScript(text, c.inst.variables, config.scriptTimeoutMs, {
        ...kcontextInfoOf(c), lang, varTypes: varTypesOf(c), onAction: onActionOf(c),
      });
      return undefined;
    } catch (e) {
      return `${kind} failed: ${(e as Error).message}`;
    }
  }

  private async handle(node: EngineNode, inst: Instance, p: EngineProcess, joins: Record<string, Set<string>>, dep: Deployment, tokenId: string): Promise<HandlerResult> {
    const h = NODE_HANDLERS[node.type];
    const c = this.buildCtx(node, inst, p, joins, dep, tokenId);
    const entryErr = await this.runLifecycle(node, 'onEntry', c);
    if (entryErr) return { error: entryErr, errorCode: 'SCRIPT_ERROR' };
    if (!h) {
      const exitErr = await this.runLifecycle(node, 'onExit', c);
      return exitErr ? { error: exitErr, errorCode: 'SCRIPT_ERROR' } : {};
    }
    const result = await h(c);
    if (!result.wait && !result.error) {
      const exitErr = await this.runLifecycle(node, 'onExit', c);
      if (exitErr) return { ...result, error: exitErr, errorCode: 'SCRIPT_ERROR' };
    }
    return result;
  }

  /** Read-only diagram state for the instance/process canvas: which nodes are currently active vs.
   *  already visited, per the token/history state. */
  diagramState(inst: Instance): { activeNodeIds: string[]; visitedNodeIds: string[]; status: string } {
    return {
      activeNodeIds: inst.tokens.map((t) => t.nodeId),
      visitedNodeIds: [...new Set(inst.history.map((h) => h.nodeId))],
      status: inst.status,
    };
  }
}
