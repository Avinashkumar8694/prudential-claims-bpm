// Token-based interpreter over the SDK engine JSON. See docs/08-execution-engine.md.
// Deterministic core (clock/newId injected). Persists the instance after runToQuiescence.
import type { AppContext } from '../context.ts';
import { Collections, type Deployment, type Instance, type NodeVisit, type TimerJob } from '../domain.ts';
import type { EngineFlow, EngineNode, EngineProcess } from '../sdk/index.ts';
import { NODE_HANDLERS, CHILD_OUTPUT_MAPPERS, type HandlerCtx, type HandlerResult } from './nodes/index.ts';
import { varTypesOf, kcontextInfoOf, onActionOf } from './nodes/kcontext-info.ts';
// Aliased (not `boundary`) since fireBoundary()'s own parameter below is already named `boundary`.
import * as boundaryHandler from './nodes/boundary/handler.ts';
import { computeDue } from './duration.ts';
import { runScript } from './sandbox.ts';
import { config } from '../infra/config.ts';

// Error codes the Node runtime raises (documented in docs/14-error-handling.md); user codes also
// allowed. Re-exported from nodes/boundary/handler.ts, which owns error-catch matching logic now.
export const ENGINE_ERRORS = boundaryHandler.ENGINE_ERRORS;
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
    // Embedded sub-process: a composite id "parentProcess::nodeId" resolves to a synthetic process
    // built from that subprocess node's own nodes/flows, so it runs as a nested instance.
    if (processId && processId.includes('::')) {
      const [parentId, nodeId] = processId.split('::');
      const parent = list.find((x) => x.id === parentId) || list[0];
      const sub = parent?.nodes.find((n) => n.id === nodeId) as any;
      if (!sub) throw new Error('embedded sub-process not found');
      return { id: processId, name: sub.name || 'Sub-process', nodes: sub.nodes || [], flows: sub.flows || [] } as EngineProcess;
    }
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
        try { result = await this.handle(node, inst, p, joins, dep, token.id); }
        catch (e) { result = { error: (e as Error).message, errorCode: 'RUNTIME_ERROR' }; }

        if (result.vars) Object.assign(inst.variables, result.vars);
        visit.exitedAt = this.ctx.clock();
        visit.outcome = result.outcome || (result.wait ? 'waiting' : result.end || (result.error ? 'error' : 'done'));
        this.emit({ kind: 'node.exited', instanceId: inst.id, nodeId: node.id!, tokenId: token.id });

        if (result.wait) {
          token.state = 'waiting'; token.waitFor = result.wait;
          if (result.wait.kind === 'timer' && result.wait.dueAt) await this.scheduleTimer(inst, token.id, node.id!, result.wait.dueAt);
          // schedule any timer boundary events attached to this (now waiting) host node — WHICH
          // boundaries match is boundary/handler.ts's own decision; scheduling the actual TimerJob
          // still needs this.ctx.newId()/clock() and the timer repo, so that part stays here.
          for (const b of boundaryHandler.boundaryTimerHosts(p.nodes, node.id!)) {
            const spec = (b as any).event.timer;
            const cycle = typeof spec === 'object' ? spec.cycle : undefined;
            await this.scheduleTimer(inst, token.id, b.id!, computeDue(spec, this.ctx.clock()), cycle);
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
        // an activity that completed normally and has a compensation boundary → remember its handler.
        // WHICH boundaries match is boundary/handler.ts's decision; resolving the boundary's outgoing
        // flow to find the actual handler node needs this.outgoing (flow-list access boundary's
        // module doesn't have), so that resolution stays here.
        for (const b of boundaryHandler.compensationBoundaries(p.nodes, node.id!)) {
          const target = this.outgoing(p, b.id!)[0]?.to;
          if (target) (inst.compensations ||= []).push({ host: node.id!, handler: target });
        }
        // consume current token, then spawn successors — never past a self-abort a script just
        // triggered mid-handler (inst.status no longer 'running'): an aborted instance must not
        // keep accumulating new tokens just because the node it aborted from "completed normally"
        // from the handler's own point of view.
        this.removeToken(inst, token.id);
        if (result.end === 'complete' || result.consume || inst.status !== 'running') { /* no successors */ }
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
    // Reached a terminal state → no orphans: abort any still-active child instances (e.g. a terminate
    // end / failure left parallel call-activities or sub-processes running).
    if (inst.status === 'completed' || inst.status === 'aborted' || inst.status === 'failed') {
      await this.cancelTimersForInstance(inst.id);
      await this.abortDescendants(inst.id);
    }
    // Notify the parent's waiting call/sub-process token: completed → resume; aborted/failed → propagate.
    if (inst.parentInstanceId) {
      if (inst.status === 'completed') await this.tryResumeParent(inst);
      else if (inst.status === 'aborted' || inst.status === 'failed') await this.tryFailParent(inst);
    }
    return inst;
  }

  /** Abort every still-active descendant instance (recursively), cancelling their timers. An
   *  `independent` child (see `Instance.independent`) is skipped — its lifecycle isn't tied to its
   *  parent's, so it keeps running standalone instead of being cascade-torn-down. */
  private async abortDescendants(parentId: string): Promise<void> {
    const children = await this.inst().query((c) =>
      c.tenantId === this.ctx.tenantId && c.parentInstanceId === parentId &&
      (c.status === 'running' || c.status === 'waiting' || c.status === 'suspended'));
    for (const child of children) {
      if (child.independent) continue;
      child.status = 'aborted'; child.tokens = []; child.endedAt = this.ctx.clock();
      await this.cancelTimersForInstance(child.id);
      await this.inst().put(child);
      this.emit({ kind: 'instance.updated', instanceId: child.id });
      await this.abortDescendants(child.id);
    }
  }

  /** Public entry: abort an instance and its whole subtree; also unblock a waiting parent. */
  async abortInstance(inst: Instance): Promise<Instance> {
    if (inst.status === 'completed' || inst.status === 'aborted') return inst;
    inst.status = 'aborted'; inst.tokens = []; inst.endedAt = this.ctx.clock();
    await this.cancelTimersForInstance(inst.id);
    await this.inst().put(inst);
    this.emit({ kind: 'instance.updated', instanceId: inst.id });
    await this.abortDescendants(inst.id);
    if (inst.parentInstanceId) await this.tryFailParent(inst);
    return inst;
  }

  /** A child instance aborted/failed → remove the parent's waiting token and raise an error there
   *  (routes to an error boundary if one is attached, otherwise the parent fails and cascades). */
  private async tryFailParent(child: Instance): Promise<void> {
    const parent = await this.inst().get(child.parentInstanceId!);
    if (!parent || parent.status === 'completed' || parent.status === 'aborted' || parent.status === 'failed') return;
    const token = parent.tokens.find((t) => t.state === 'waiting' && t.waitFor?.kind === 'child' && t.waitFor?.ref === child.id);
    if (!token) return;
    const pdep = await this.deps().get(parent.deploymentId);
    if (!pdep) return;
    const p = this.pick(pdep, parent.processId);
    this.removeToken(parent, token.id);
    // Same code family the sync completion path in call/handler.ts and subprocess/handler.ts raises
    // for the identical failure, just detected later (the child instead parked in a wait) — kept in
    // sync so a boundary/global catch sees the same code regardless of which path the child took.
    const callNode = p.nodes.find((n) => n.id === token.nodeId) as any;
    const prefix = callNode?.type === 'call' ? 'CALL' : 'SUBPROCESS';
    const code = `${prefix}_${child.status === 'aborted' ? 'ABORTED' : 'ERROR'}`;
    if (this.raiseError(parent, p, token.nodeId, code, `child instance ${child.status}: ${child.id}`)) {
      parent.status = 'running';
      await this.runToQuiescence(parent, pdep);   // handler token → runs recovery, then settles (may cascade)
    } else {
      parent.status = 'failed';
      parent.error = { nodeId: token.nodeId, message: `child instance ${child.status}`, at: this.ctx.clock() };
      parent.endedAt = this.ctx.clock();
      await this.inst().put(parent);
      this.emit({ kind: 'instance.failed', instanceId: parent.id });
      await this.abortDescendants(parent.id);
      if (parent.parentInstanceId) await this.tryFailParent(parent);   // propagate up
    }
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
    // Mapping is node-type-specific (subprocess shares scope, call is isolated) — see each type's own
    // mapChildOutputs in nodes/index.ts's CHILD_OUTPUT_MAPPERS (same logic the sync-completion path uses).
    const mapper = callNode ? CHILD_OUTPUT_MAPPERS[callNode.type as string] : undefined;
    const vars = mapper ? mapper(callNode, child) : {};
    await this.resumeToken(parent, pdep, token.id, vars);
  }

  /** Start a child process instance linked to a parent token (call activity). `independent` decouples
   *  the child's lifecycle from the parent's — see the `Instance.independent` doc comment. */
  private async startChild(dep: Deployment, processId: string, vars: Record<string, unknown>, actor: string, parentInstanceId: string, parentTokenId: string, independent?: boolean): Promise<Instance> {
    const p = this.pick(dep, processId);
    const startNode = p.nodes.find((n) => n.type === 'start') || p.nodes[0];
    const now = this.ctx.clock();
    const child: Instance = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, deploymentId: dep.id, workflowId: dep.workflowId, processId: p.id,
      status: 'running', variables: { ...vars },
      tokens: [{ id: this.ctx.newId(), nodeId: startNode!.id!, state: 'active', enteredAt: now }],
      history: [], startedAt: now, startedBy: actor, parentInstanceId, parentTokenId,
      ...(independent ? { independent: true } : {}),
    };
    this.emit({ kind: 'instance.started', instanceId: child.id });
    return this.runToQuiescence(child, dep);
  }

  /**
   * Run compensation handlers for successfully-completed activities in reverse (LIFO) order. `ref`
   * limits compensation to a single host activity; omitted → compensate everything recorded so far.
   * Handlers execute inline (they don't spawn into the main flow); each is recorded in history.
   */
  private async compensate(inst: Instance, p: EngineProcess, dep: Deployment, ref?: string): Promise<Record<string, unknown>> {
    const all = inst.compensations || [];
    const toRun = [...all].reverse().filter((c) => !ref || c.host === ref);
    const merged: Record<string, unknown> = {};
    const nodes = this.nodeMap(p);
    for (const entry of toRun) {
      const handler = nodes.get(entry.handler);
      if (!handler) continue;
      const visit: NodeVisit = { tokenId: 'compensation', nodeId: handler.id!, type: handler.type, enteredAt: this.ctx.clock() };
      inst.history.push(visit);
      this.emit({ kind: 'node.entered', instanceId: inst.id, nodeId: handler.id!, tokenId: 'compensation' });
      let res: HandlerResult;
      try { res = await this.handle(handler, inst, p, {}, dep, 'compensation'); }
      catch (e) { res = { error: (e as Error).message }; }
      if (res.vars) { Object.assign(inst.variables, res.vars); Object.assign(merged, res.vars); }
      visit.exitedAt = this.ctx.clock(); visit.outcome = res.error ? `compensation-error: ${res.error}` : 'compensated';
      this.emit({ kind: 'node.exited', instanceId: inst.id, nodeId: handler.id!, tokenId: 'compensation' });
    }
    // consume the entries we just compensated
    inst.compensations = all.filter((c) => (ref ? c.host !== ref : false));
    return merged;
  }

  /** Broadcast a signal/message to every waiting instance in the tenant (send/throw/end-throw), and
   *  also start a fresh instance of any deployed process whose start event listens for this exact
   *  name — the process-level counterpart to a mid-flow catch/boundary (real jBPM's signal-start /
   *  message-start event). `correlationValue`, when the thrower declares one (see `EventDef.
   *  correlationKey` — a $var reference resolved on the throwing side), narrows delivery to only the
   *  instance(s) whose OWN `correlationKey` (set at `start()`) matches — otherwise EVERY instance
   *  waiting on that name resumes, which is wrong the moment more than one instance of the same
   *  process is waiting on the same message type at once (e.g. N claims all waiting on
   *  "PaymentReceived" — without this, one payment webhook would incorrectly resume all N). Signal/
   *  message-START events are never correlation-scoped: a brand-new instance has no correlationKey
   *  yet to match against. */
  private async broadcast(name: string, correlationValue?: string): Promise<void> {
    const others = await this.inst().query((i) => i.tenantId === this.ctx.tenantId && (i.status === 'waiting' || i.status === 'running'));
    for (const other of others) {
      if (correlationValue !== undefined && other.correlationKey !== correlationValue) continue;
      const hit = other.tokens.some((t) => t.state === 'waiting' && (t.waitFor?.kind === 'signal' || t.waitFor?.kind === 'message') && t.waitFor?.ref === name);
      if (!hit) continue;
      const dep = await this.deps().get(other.deploymentId);
      if (dep) await this.signalInstance(other, dep, name);
    }
    if (correlationValue === undefined) await this.startTriggeredProcesses(name);
  }

  /** Signal/message-start events: begin a new instance of every active deployment's process whose
   *  start node's `on.signal`/`on.message` matches `name`. */
  private async startTriggeredProcesses(name: string): Promise<void> {
    const active = await this.deps().query((d) => d.tenantId === this.ctx.tenantId && d.status === 'active');
    for (const dep of active) {
      for (const p of dep.engine?.processes || []) {
        const startNode = p.nodes.find((n) => n.type === 'start') as any;
        const on = startNode?.on;
        const kind = on?.signal === name ? 'signal' : on?.message === name ? 'message' : undefined;
        if (kind) await this.start(dep, {}, kind, { processId: p.id });
      }
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

  /** Deliver a signal to ONE specific instance by id — matches real jBPM's targeted
   *  kcontext.getKieRuntime().signalEvent(type, event, processInstanceId), as opposed to broadcast()'s
   *  session-wide delivery. A no-op (not an error) if the id doesn't resolve within this tenant —
   *  matches how a script/condition kcontext call has no result to fail loudly against.
   *
   *  Self-targeted (the calling instance signaling itself) is special-cased to mutate `callerInst`
   *  directly rather than re-fetching by id: the store's `.get()` returns whatever was last `.put()`,
   *  a SEPARATE object from the one `runToQuiescence`'s loop is actively stepping through in memory.
   *  Mutating a fresh fetch would get silently overwritten when the loop persists its own reference
   *  at the end of its own processing — confirmed by a real test failure before this fix existed. */
  private async signalTargeted(callerInst: Instance, callerDep: Deployment, targetInstanceId: string, name: string, payload?: unknown): Promise<void> {
    if (targetInstanceId === callerInst.id) { await this.signalInstance(callerInst, callerDep, name, payload); return; }
    const target = await this.inst().get(targetInstanceId);
    if (!target || target.tenantId !== this.ctx.tenantId) return;
    const dep = await this.deps().get(target.deploymentId);
    if (dep) await this.signalInstance(target, dep, name, payload);
  }

  /** Abort ONE specific instance by id — matches real jBPM's kcontext.getKieRuntime().
   *  abortProcessInstance(id). Reuses the same public abortInstance() the REST abort endpoint already
   *  uses (aborts the whole subtree, cancels timers), so a script-triggered abort behaves identically
   *  to an operator-triggered one. A no-op if the id doesn't resolve within this tenant. Self-targeted
   *  case: see signalTargeted's comment — same reasoning, same fix. */
  private async abortTargeted(callerInst: Instance, targetInstanceId: string): Promise<void> {
    if (targetInstanceId === callerInst.id) { await this.abortInstance(callerInst); return; }
    const target = await this.inst().get(targetInstanceId);
    if (target && target.tenantId === this.ctx.tenantId) await this.abortInstance(target);
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
  /** `cycle` (boundary timers only — see call site) lets TimerService reschedule this job for its next
   *  occurrence after firing, instead of the one-shot behavior every other timer kind wants. */
  private async scheduleTimer(inst: Instance, tokenId: string, nodeId: string, dueAt: string, cycle?: string) {
    await this.timerRepo().put({ id: this.ctx.newId(), tenantId: this.ctx.tenantId, instanceId: inst.id, tokenId, nodeId, kind: 'duration', dueAt, cycle, fired: 0, status: 'scheduled' });
  }
  /** Cancel a token's pending timers (host completed/resumed → its boundary/catch timers no longer apply). */
  private async cancelTimersForToken(inst: Instance, tokenId: string) {
    const jobs = await this.timerRepo().query((t) => t.instanceId === inst.id && t.tokenId === tokenId && t.status === 'scheduled');
    for (const j of jobs) { j.status = 'cancelled'; await this.timerRepo().put(j); }
  }
  /** Cancel every pending timer for an instance (instance reached a terminal state). */
  private async cancelTimersForInstance(instanceId: string) {
    const jobs = await this.timerRepo().query((t) => t.instanceId === instanceId && t.status === 'scheduled');
    for (const j of jobs) { j.status = 'cancelled'; await this.timerRepo().put(j); }
  }

  /** Event-Based Gateway race: `resolvedNodeId` just resolved its wait (timer/message/signal fired) —
   *  if it's reached directly (single incoming flow) from a `mode:'event'` gateway, every OTHER branch
   *  forked from that same gateway loses the race — cancel their still-waiting tokens (and any timer
   *  jobs backing them) so they never also fire. Structural match by node id, like boundaryTimerHosts;
   *  doesn't disambiguate concurrent activations of the same event gateway (e.g. inside a loop), same
   *  simplification the join-count logic elsewhere in this engine already accepts. */
  private async cancelEventGatewaySiblings(inst: Instance, p: EngineProcess, resolvedNodeId: string): Promise<void> {
    const incoming = this.incoming(p, resolvedNodeId);
    if (incoming.length !== 1) return;
    const gateway = this.nodeMap(p).get(incoming[0]!.from);
    if (!gateway || gateway.type !== 'gateway' || (gateway as any).mode !== 'event') return;
    const siblingTargets = new Set(this.outgoing(p, gateway.id!).map((f) => f.to));
    siblingTargets.delete(resolvedNodeId);
    for (const s of inst.tokens.filter((t) => t.state === 'waiting' && siblingTargets.has(t.nodeId))) {
      await this.cancelTimersForToken(inst, s.id);
      this.removeToken(inst, s.id);
    }
  }
  /** Fire a due timer job: boundary timer → activate the boundary; else resume the (catch) token.
   *  Public — called externally from modules/instances/service.ts's timer-poll path. */
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

  // ---- error handling: route a raised error to a matching error-catch (boundary, or an event
  // sub-process with an error start — jBPM's other common "global error handler" idiom) ----
  // WHICH node matches (isErrorCatch/catchErrorName/isGlobalCatch/isCatchAll/globalNameMatches/
  // findErrorHandler) is nodes/boundary/handler.ts's decision — see its own doc comment for the full
  // "why" (jBPM error-code naming vs. this runtime's fixed ENGINE_ERRORS vocabulary). Only the
  // orchestration that ACTS on a match (mutating instance/token state) stays here.

  /** Route an error to a matching error-catch; returns true if handled (a handler token was spawned). */
  private raiseError(inst: Instance, p: EngineProcess, failingNodeId: string, code: string, message: string): boolean {
    const handler = boundaryHandler.findErrorHandler(p.nodes, failingNodeId, code);
    if (!handler) return false;
    inst.variables[ERROR_VAR] = { code, node: failingNodeId, message };
    // a global catch (on: '*', or any event sub-process error-catch) is interrupting for the whole
    // instance → cancel all other tokens. A host-specific boundary only ever cancels its own host,
    // which the caller has already done before raiseError runs.
    if (boundaryHandler.isGlobalCatch(handler)) inst.tokens = [];
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
  private buildCtx(node: EngineNode, inst: Instance, p: EngineProcess, joins: Record<string, Set<string>>, dep: Deployment, tokenId: string): HandlerCtx {
    return {
      node, inst, proc: p, dep, app: this.ctx, joins, tokenId,
      outgoing: (id) => this.outgoing(p, id),
      incoming: (id) => this.incoming(p, id),
      emit: (e) => this.emit(e),
      startChild: (d, pid, vars, tok, independent) => this.startChild(d, pid, vars, inst.startedBy, inst.id, tok, independent),
      broadcast: (name, correlationValue) => this.broadcast(name, correlationValue),
      signal: (targetInstanceId, name, payload) => this.signalTargeted(inst, dep, targetInstanceId, name, payload),
      abort: (targetInstanceId) => this.abortTargeted(inst, targetInstanceId),
      compensate: (ref) => this.compensate(inst, p, dep, ref),
      resolveCalled: this.resolveCalled,
    };
  }

  /** Real jBPM's generic onEntry-script/onExit-script action hooks (see bpmn-sdk's `WithLifecycle`) —
   *  any activity node type may carry `onEntry`/`onExit` (+ `onEntryLang`/`onExitLang`), executed with
   *  the exact same kcontext/vars/instance/node/meta-locals surface a script node gets (varTypesOf/
   *  kcontextInfoOf/onActionOf — see kcontext-info.ts). Mutates `inst.variables` directly (no merge
   *  step needed — same object reference `runScript` writes through). Returns an error message on
   *  failure, undefined on success; never throws (caller decides how to route the failure). */
  private async runLifecycle(node: EngineNode, kind: 'onEntry' | 'onExit', c: HandlerCtx): Promise<string | undefined> {
    const text = (node as any)[kind] as string | undefined;
    if (!text) return undefined;
    const lang = (node as any)[`${kind}Lang`] as string | undefined;
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
    if (!h) return {};   // e.g. 'boundary' — spawned by the error router, then follows its outgoing flow
    const c = this.buildCtx(node, inst, p, joins, dep, tokenId);
    const entryErr = await this.runLifecycle(node, 'onEntry', c);
    if (entryErr) return { error: entryErr, errorCode: 'SCRIPT_ERROR' };
    const result = await h(c);
    // onExit fires exactly once, when the node instance actually completes — immediately here if it
    // didn't wait/error; if it DID wait (userTask/receive/etc.), onExit instead runs in resumeToken()
    // when the wait is actually over, matching real jBPM's onExit timing (never on error/abort paths).
    if (!result.wait && !result.error) {
      const exitErr = await this.runLifecycle(node, 'onExit', c);
      if (exitErr) return { ...result, error: exitErr, errorCode: 'SCRIPT_ERROR' };
    }
    return result;
  }

  // ---- resume (wait states) ----
  /** Complete a wait node (task/timer/message/signal) and continue the instance. */
  async resumeToken(inst: Instance, dep: Deployment, tokenId: string, vars?: Record<string, unknown>): Promise<Instance> {
    if (inst.status === 'suspended') throw new Error('instance is suspended');   // nothing advances a paused tree
    const token = inst.tokens.find((t) => t.id === tokenId);
    if (!token || token.state !== 'waiting') throw new Error('token is not waiting');
    if (vars) Object.assign(inst.variables, vars);
    await this.cancelTimersForToken(inst, tokenId);   // host resumed → drop its pending boundary/catch timers
    const p = this.proc(inst, dep);
    const node = this.nodeMap(p).get(token.nodeId);
    // exit the wait node, spawn successors, resume the loop
    this.removeToken(inst, tokenId);
    if (node) await this.cancelEventGatewaySiblings(inst, p, node.id!);
    // A waiting node (userTask/receive/etc.) NOW actually completes — this is where its onExit fires
    // (handle() already ran onExit for anything that finished immediately; a waiting node never got
    // that chance, since it hadn't really "exited" yet when handle() first returned `wait`).
    if (node && (node as any).onExit) {
      const c = this.buildCtx(node, inst, p, {}, dep, tokenId);
      const exitErr = await this.runLifecycle(node, 'onExit', c);
      if (exitErr) {
        if (!this.raiseError(inst, p, node.id!, 'SCRIPT_ERROR', exitErr)) {
          inst.status = 'failed';
          inst.error = { nodeId: node.id!, message: exitErr, at: this.ctx.clock() };
          return this.runToQuiescence(inst, dep);   // status !== 'running' → settles/persists/cleans up, no looping
        }
        inst.status = 'running';
        return this.runToQuiescence(inst, dep);
      }
    }
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
