// Query / task-admin / analytics module — read-only aggregates mirroring the jBPM KIE-Server query &
// dashboard APIs (see docs/17): process-definition catalog + live stats, per-user / per-group task
// inboxes, tasks completed by a user, related tasks, referenced signals, and TAT (turn-around-time)
// analytics for tasks and process instances. Everything is tenant-scoped and derived from the store.
import type { AppContext } from '../../context.ts';
import { Collections, type Instance, type Task, type Deployment, type TimerJob, type AuditEvent } from '../../domain.ts';

type DurStats = { count: number; avgMs: number; minMs: number; maxMs: number };
const durationMs = (from?: string, to?: string) => (from && to ? Math.max(0, Date.parse(to) - Date.parse(from)) : undefined);
function stats(values: number[]): DurStats {
  if (!values.length) return { count: 0, avgMs: 0, minMs: 0, maxMs: 0 };
  const sum = values.reduce((a, b) => a + b, 0);
  return { count: values.length, avgMs: Math.round(sum / values.length), minMs: Math.min(...values), maxMs: Math.max(...values) };
}

export class QueryService {
  constructor(private ctx: AppContext) {}
  private I() { return this.ctx.store.repo<Instance>(Collections.instances); }
  private T() { return this.ctx.store.repo<Task>(Collections.tasks); }
  private D() { return this.ctx.store.repo<Deployment>(Collections.deployments); }
  private J() { return this.ctx.store.repo<TimerJob>(Collections.timers); }
  private A() { return this.ctx.store.repo<AuditEvent>(Collections.audit); }
  private mine<T extends { tenantId: string }>(xs: T[]) { return xs.filter((x) => x.tenantId === this.ctx.tenantId); }
  private allInstances() { return this.I().query((i) => i.tenantId === this.ctx.tenantId); }
  private allTasks() { return this.T().query((t) => t.tenantId === this.ctx.tenantId); }

  // ---- process definitions (across active deployments) ----
  /** Every process definition currently deployed & active, with live instance stats (jBPM def catalog). */
  async processDefinitions() {
    const active = await this.D().query((d) => d.tenantId === this.ctx.tenantId && d.status === 'active');
    const instances = await this.allInstances();
    const defs: any[] = [];
    for (const dep of active) {
      for (const p of dep.engine?.processes || []) {
        const insts = instances.filter((i) => i.processId === p.id && i.deploymentId === dep.id);
        defs.push({
          processId: p.id, name: (p as any).name || p.id, package: (p as any).package,
          deploymentId: dep.id, workflowId: dep.workflowId, environment: dep.environment,
          version: dep.versionLabel || (dep.versionNumber != null ? `v${dep.versionNumber}` : undefined),
          nodes: (p.nodes || []).length,
          instances: { total: insts.length, active: insts.filter((i) => i.status === 'running' || i.status === 'waiting').length },
        });
      }
    }
    return defs;
  }

  private async resolveProcess(processId: string) {
    const active = await this.D().query((d) => d.tenantId === this.ctx.tenantId && d.status === 'active');
    for (const dep of active) {
      const p = (dep.engine?.processes || []).find((x) => x.id === processId);
      if (p) return { dep, p };
    }
    return undefined;
  }

  /** Instances of a given process definition (across its active deployment). */
  async processInstances(processId: string, status?: string) {
    const insts = await this.allInstances();
    return insts.filter((i) => i.processId === processId && (!status || i.status === status))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** Signals/messages a process references — what it listens for (start/catch/boundary) and throws. */
  async processSignals(processId: string) {
    const found = await this.resolveProcess(processId);
    if (!found) return { processId, listensFor: [], throws: [] };
    const listens = new Set<string>(); const throws = new Set<string>();
    for (const n of found.p.nodes || []) {
      const a = n as any; const ev = a.event || {};
      const name = ev.signal || ev.message || a.on?.signal || a.on?.message;
      if (!name) continue;
      if (n.type === 'throw' || n.type === 'send' || (n.type === 'end' && a.throw)) throws.add(name);
      else listens.add(name);   // start / catch / boundary / receive
    }
    return { processId, listensFor: [...listens], throws: [...throws] };
  }

  // ---- users / task inboxes ----
  /** Derived user directory: initiators, task assignees/completers and audit actors, with work counts. */
  async users() {
    const [instances, tasks, audit] = [await this.allInstances(), await this.allTasks(), this.mine(await this.A().query(() => true))];
    const map = new Map<string, { user: string; groups: Set<string>; startedInstances: number; openTasks: number; completedTasks: number }>();
    const rec = (name?: string) => {
      if (!name) return undefined;
      if (!map.has(name)) map.set(name, { user: name, groups: new Set(), startedInstances: 0, openTasks: 0, completedTasks: 0 });
      return map.get(name)!;
    };
    for (const i of instances) { const e = rec(i.startedBy); if (e) e.startedInstances++; }
    for (const t of tasks) {
      const owner = rec(t.assignee);
      if (owner) { if (t.status === 'completed') owner.completedTasks++; else owner.openTasks++; if (t.group) owner.groups.add(t.group); }
      if (t.status === 'completed' && t.completedBy && t.completedBy !== t.assignee) { const c = rec(t.completedBy); if (c) c.completedTasks++; }
    }
    for (const a of audit) rec(a.actor);
    return [...map.values()].map((e) => ({ ...e, groups: [...e.groups] })).sort((a, b) => a.user.localeCompare(b.user));
  }

  /** Tasks owned by a user (their inbox). */
  async tasksForUser(user: string, status?: string) {
    const tasks = await this.allTasks();
    return tasks.filter((t) => t.assignee === user && (!status || t.status === status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  /** Tasks a user has completed. */
  async tasksCompletedByUser(user: string) {
    const tasks = await this.allTasks();
    return tasks.filter((t) => t.status === 'completed' && t.completedBy === user)
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  }
  /** Tasks for a group (the queue / potential-owner list). */
  async tasksForGroup(group: string, status?: string) {
    const tasks = await this.allTasks();
    return tasks.filter((t) => t.group === group && (!status || t.status === status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  /** Tasks belonging to a process instance. */
  async instanceTasks(instanceId: string) {
    const tasks = await this.allTasks();
    return tasks.filter((t) => t.instanceId === instanceId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // ---- analytics / TAT ----
  /** Task turn-around-time grouped by task name, plus a per-assignee completed breakdown. */
  async taskAnalytics() {
    const tasks = await this.allTasks();
    const byName = new Map<string, number[]>();
    const byAssignee = new Map<string, number[]>();
    for (const t of tasks) {
      const ms = durationMs(t.createdAt, t.completedAt);
      if (ms == null || t.status !== 'completed') continue;
      (byName.get(t.name) || byName.set(t.name, []).get(t.name)!).push(ms);
      const who = t.completedBy || t.assignee;
      if (who) (byAssignee.get(who) || byAssignee.set(who, []).get(who)!).push(ms);
    }
    return {
      byTask: [...byName].map(([name, v]) => ({ name, ...stats(v) })),
      byAssignee: [...byAssignee].map(([user, v]) => ({ user, ...stats(v) })),
      openByStatus: this.countBy(tasks, (t) => t.status),
    };
  }
  /** Process-instance turn-around-time grouped by process definition, plus a status mix. */
  async processAnalytics() {
    const instances = await this.allInstances();
    const byProc = new Map<string, number[]>();
    for (const i of instances) {
      const ms = durationMs(i.startedAt, i.endedAt);
      if (ms == null) continue;
      const key = i.processId || i.workflowId;
      (byProc.get(key) || byProc.set(key, []).get(key)!).push(ms);
    }
    return {
      byProcess: [...byProc].map(([processId, v]) => ({ processId, ...stats(v) })),
      byStatus: this.countBy(instances, (i) => i.status),
    };
  }
  /** Dashboard counts across instances, tasks, deployments and jobs. */
  async summary() {
    const [instances, tasks, deployments, jobs] = [await this.allInstances(), await this.allTasks(),
      await this.D().query((d) => d.tenantId === this.ctx.tenantId), await this.J().query((j) => j.tenantId === this.ctx.tenantId)];
    return {
      instances: { total: instances.length, byStatus: this.countBy(instances, (i) => i.status) },
      tasks: { total: tasks.length, byStatus: this.countBy(tasks, (t) => t.status) },
      deployments: { total: deployments.length, active: deployments.filter((d) => d.status === 'active').length },
      jobs: { scheduled: jobs.filter((j) => j.status === 'scheduled').length, fired: jobs.filter((j) => j.status === 'fired').length },
    };
  }
  /** Scheduled/fired timer jobs (jBPM "jobs" admin list). */
  async jobs(status?: string) {
    return (await this.J().query((j) => j.tenantId === this.ctx.tenantId && (!status || j.status === status)))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }

  private countBy<T>(xs: T[], key: (x: T) => string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const x of xs) { const k = key(x); out[k] = (out[k] || 0) + 1; }
    return out;
  }
}
