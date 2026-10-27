// Execution errors: a persisted, queryable, acknowledgeable failure log.
//
// Why this exists separately from `Instance.error`: that field holds only the most recent failure
// for one instance. It can't be listed across instances, can't be acknowledged, and is overwritten
// by the next failure — so it can render a badge but can't back an operational work queue. This
// module is the append-only log the Execution Errors screen reads.
import type { AppContext } from '../../context.ts';
import { Collections, type ExecutionError } from '../../domain.ts';
import { notFound } from '../../infra/errors.ts';

export interface ErrorQuery {
  type?: ExecutionError['type'][];
  instanceId?: string;
  taskId?: string;
  jobId?: string;
  workflowId?: string;
  processId?: string;
  nodeId?: string;
  /** undefined = either; true/false filters on ack state (the screen defaults to false) */
  acknowledged?: boolean;
  /** ISO bounds, inclusive */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export class ErrorService {
  constructor(private ctx: AppContext) {}
  private repo() { return this.ctx.store.repo<ExecutionError>(Collections.errors); }

  /**
   * Record a failure. Identical (instanceId, nodeId, message) triples increment `occurrences` on the
   * existing row instead of appending a new one — a node retried 40 times should be one line in the
   * operator's queue, not forty.
   */
  async record(e: Omit<ExecutionError, 'id' | 'tenantId' | 'at' | 'occurrences' | 'acknowledged'>): Promise<ExecutionError> {
    const existing = (await this.repo().query((x) =>
      x.instanceId === e.instanceId && x.nodeId === e.nodeId && x.message === e.message && !x.acknowledged,
    ))[0];
    if (existing) {
      existing.occurrences += 1;
      existing.at = this.ctx.clock();
      await this.repo().put(existing);
      return existing;
    }
    const rec: ExecutionError = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, at: this.ctx.clock(),
      occurrences: 1, acknowledged: false, ...e,
    };
    await this.repo().put(rec);
    await this.ctx.audit({
      actor: 'system', kind: 'error.recorded',
      instanceId: e.instanceId, nodeId: e.nodeId,
      data: { type: e.type, message: e.message },
    });
    return rec;
  }

  async list(q: ErrorQuery = {}): Promise<{ items: ExecutionError[]; total: number }> {
    const all = await this.repo().query((e) => {
      if (q.type?.length && !q.type.includes(e.type)) return false;
      if (q.instanceId && e.instanceId !== q.instanceId) return false;
      if (q.taskId && e.taskId !== q.taskId) return false;
      if (q.jobId && e.jobId !== q.jobId) return false;
      if (q.workflowId && e.workflowId !== q.workflowId) return false;
      if (q.processId && e.processId !== q.processId) return false;
      if (q.nodeId && e.nodeId !== q.nodeId) return false;
      if (q.acknowledged !== undefined && e.acknowledged !== q.acknowledged) return false;
      if (q.from && e.at < q.from) return false;
      if (q.to && e.at > q.to) return false;
      return true;
    });
    all.sort((a, b) => (a.at < b.at ? 1 : -1)); // newest first
    const offset = q.offset ?? 0;
    const limit = q.limit ?? 20;
    return { items: all.slice(offset, offset + limit), total: all.length };
  }

  async get(id: string): Promise<ExecutionError> {
    const e = await this.repo().get(id);
    if (!e) throw notFound('ExecutionError');
    return e;
  }

  /** Take ownership. Idempotent — re-acknowledging keeps the original actor/timestamp. */
  async acknowledge(id: string, actor: string): Promise<ExecutionError> {
    const e = await this.get(id);
    if (e.acknowledged) return e;
    e.acknowledged = true;
    e.acknowledgedBy = actor;
    e.acknowledgedAt = this.ctx.clock();
    await this.repo().put(e);
    await this.ctx.audit({ actor, kind: 'error.acknowledged', instanceId: e.instanceId, data: { errorId: id } });
    return e;
  }

  async acknowledgeMany(ids: string[], actor: string): Promise<{ id: string; ok: boolean; reason?: string }[]> {
    const out: { id: string; ok: boolean; reason?: string }[] = [];
    for (const id of ids) {
      try { await this.acknowledge(id, actor); out.push({ id, ok: true }); }
      catch (err) { out.push({ id, ok: false, reason: (err as Error).message }); }
    }
    return out;
  }

  /** Counts for the nav badge and the Home KPI tile. */
  async summary(): Promise<{ total: number; unacknowledged: number; last24h: number }> {
    const all = await this.repo().query(() => true);
    const dayAgo = new Date(Date.parse(this.ctx.clock()) - 86_400_000).toISOString();
    return {
      total: all.length,
      unacknowledged: all.filter((e) => !e.acknowledged).length,
      last24h: all.filter((e) => e.at >= dayAgo).length,
    };
  }
}
