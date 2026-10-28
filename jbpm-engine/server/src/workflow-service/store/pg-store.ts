// Real Postgres-backed WorkflowServiceStore: its own `workflow_service` schema, real typed tables
// (see entities.ts), used when STORE=pg — see docs/usage_docs/14-workflow-instance-management.md for
// why this module gets real tables while the rest of the app stays on the generic kv_store blob
// pattern (../../store/pg-store.ts).
import 'reflect-metadata';
import { DataSource, type Repository as OrmRepository } from 'typeorm';
import type { Repository } from '../../store/repository.ts';
import type {
  WorkflowDefinition, WorkflowInstance, WorkflowInstanceAudit, WorkflowInstanceComment, SavedQuery,
  QueryDefinition, QueryFilter,
} from '../domain.ts';
import { evaluateQuery, type QueryRunResult } from '../query-eval.ts';
import type { TypedQueryEntity, WorkflowServiceStore } from './types.ts';
import {
  SCHEMA, WORKFLOW_SERVICE_ENTITIES,
  WorkflowDefinitionRow, WorkflowInstanceRow, WorkflowInstanceAuditRow, WorkflowInstanceCommentRow, SavedQueryRow,
} from './entities.ts';

// ---- row <-> domain conversion (Date columns <-> ISO strings, matching domain.ts's `string` fields) ----
const iso = (d: Date) => d.toISOString();
const toDate = (s: string) => new Date(s);

function defToRow(d: WorkflowDefinition): WorkflowDefinitionRow {
  return { ...d, dataSchema: d.dataSchema, createdAt: toDate(d.createdAt), updatedAt: toDate(d.updatedAt) } as unknown as WorkflowDefinitionRow;
}
function defFromRow(r: WorkflowDefinitionRow): WorkflowDefinition {
  return { ...r, dataSchema: r.dataSchema as Record<string, unknown>, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) } as WorkflowDefinition;
}
function instToRow(i: WorkflowInstance): WorkflowInstanceRow {
  return { ...i, data: i.data, startError: i.startError ?? null, createdAt: toDate(i.createdAt), updatedAt: toDate(i.updatedAt) } as unknown as WorkflowInstanceRow;
}
function instFromRow(r: WorkflowInstanceRow): WorkflowInstance {
  const out: WorkflowInstance = { ...r, data: r.data as Record<string, unknown>, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) } as WorkflowInstance;
  if (r.startError == null) delete (out as any).startError;
  return out;
}
function auditToRow(a: WorkflowInstanceAudit): WorkflowInstanceAuditRow {
  return { ...a, data: a.data ?? null, at: toDate(a.at) } as unknown as WorkflowInstanceAuditRow;
}
function auditFromRow(r: WorkflowInstanceAuditRow): WorkflowInstanceAudit {
  const out: WorkflowInstanceAudit = { ...r, at: iso(r.at) } as WorkflowInstanceAudit;
  if (r.data == null) delete (out as any).data; else out.data = r.data as Record<string, unknown>;
  return out;
}
function commentToRow(c: WorkflowInstanceComment): WorkflowInstanceCommentRow {
  return { ...c, at: toDate(c.at) } as unknown as WorkflowInstanceCommentRow;
}
function commentFromRow(r: WorkflowInstanceCommentRow): WorkflowInstanceComment {
  return { ...r, at: iso(r.at) } as WorkflowInstanceComment;
}
function queryToRow(q: SavedQuery): SavedQueryRow {
  return { ...q, ownerId: q.ownerId ?? null, definition: q.definition, createdAt: toDate(q.createdAt) } as unknown as SavedQueryRow;
}
function queryFromRow(r: SavedQueryRow): SavedQuery {
  const out: SavedQuery = { ...r, definition: r.definition as QueryDefinition, createdAt: iso(r.createdAt) } as SavedQuery;
  if (r.ownerId == null) delete (out as any).ownerId;
  return out;
}

/** Generic Repository<T> adapter over one TypeORM repo — `query(pred)` fetches every row for the
 *  tenant-agnostic table and filters in JS, same "opaque predicate, can't push to SQL" contract the
 *  rest of this codebase already accepts for its generic store (see ../../store/pg-store.ts's own
 *  doc comment) — callers still check `tenantId` themselves, same convention as everywhere else.
 *  Real SQL only happens in runTypedQuery below, where it actually matters. */
function makeRepo<TDomain extends { id: string }, TRow extends { id: string }>(
  orm: () => Promise<OrmRepository<TRow>>, toRow: (d: TDomain) => TRow, fromRow: (r: TRow) => TDomain,
): Repository<TDomain> {
  return {
    async get(id) { const r = await (await orm()).findOneBy({ id } as any); return r ? fromRow(r) : undefined; },
    async list() { return (await (await orm()).find()).map(fromRow); },
    async query(pred) { return (await (await orm()).find()).map(fromRow).filter(pred); },
    async put(entity) { await (await orm()).save(toRow(entity)); return entity; },
    async delete(id) { const res = await (await orm()).delete({ id } as any); return !!res.affected; },
  };
}

// ---- allowlisted field -> SQL column/jsonb-path translation, per queryable entity ----
// Never accepts an arbitrary column name from `definition.filters[].field` — anything not in this map
// is silently dropped (not errored, to keep a query builder UI from breaking on a stray field), so a
// crafted filter can never reach raw SQL beyond these exact, hand-written expressions.
type ColumnMap = Record<string, (alias: string) => string>;
const COLUMNS: Record<TypedQueryEntity, ColumnMap> = {
  workflowInstance: {
    workflowDefinitionId: (a) => `${a}.workflow_definition_id`, workflowName: (a) => `${a}.workflow_name`,
    status: (a) => `${a}.status`, piid: (a) => `${a}.piid`, deploymentId: (a) => `${a}.deployment_id`,
    createdAt: (a) => `${a}.created_at`, updatedAt: (a) => `${a}.updated_at`,
  },
  workflowInstanceAudit: { workflowInstanceId: (a) => `${a}.workflow_instance_id`, actor: (a) => `${a}.actor`, kind: (a) => `${a}.kind`, at: (a) => `${a}.at` },
  workflowInstanceComment: { workflowInstanceId: (a) => `${a}.workflow_instance_id`, author: (a) => `${a}.author`, at: (a) => `${a}.at` },
};
// dotted `data.<key>` (or `data.<a>.<b>`) fields translate to a jsonb path expression instead of a
// plain column — the one case COLUMNS above can't express as a fixed map, handled separately below.
function dataJsonPath(alias: string, field: string): string | undefined {
  if (!field.startsWith('data.')) return undefined;
  const parts = field.slice(5).split('.').filter(Boolean);
  if (!parts.length || parts.some((p) => !/^[a-zA-Z0-9_]+$/.test(p))) return undefined;   // reject anything not a plain identifier
  return `${alias}.data#>>'{${parts.join(',')}}'`;
}
const OP_SQL: Record<string, string> = { eq: '=', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };

function applyFilters(qb: any, alias: string, entity: TypedQueryEntity, filters: QueryFilter[] | undefined): void {
  const map = COLUMNS[entity];
  (filters || []).forEach((f, i) => {
    const col = map[f.field]?.(alias) ?? dataJsonPath(alias, f.field);
    if (!col) return;   // not allowlisted — silently ignored, never interpolated
    const p = `p${i}`;
    if (f.op === 'in' && Array.isArray(f.value)) { qb.andWhere(`${col} IN (:...${p})`, { [p]: f.value }); return; }
    if (f.op === 'contains') { qb.andWhere(`${col} ILIKE :${p}`, { [p]: `%${f.value}%` }); return; }
    const sqlOp = OP_SQL[f.op];
    if (!sqlOp) return;
    qb.andWhere(`${col} ${sqlOp} :${p}`, { [p]: f.value });
  });
}

export class WorkflowServicePgStore implements WorkflowServiceStore {
  private ds?: DataSource;
  private dsPromise?: Promise<DataSource>;
  constructor(private url: string) {}

  private ensureDataSource(): Promise<DataSource> {
    if (this.ds) return Promise.resolve(this.ds);
    if (!this.dsPromise) {
      this.dsPromise = (async () => {
        // a throwaway connection just to create the schema before the real DataSource (which assumes
        // it already exists — TypeORM's `synchronize` creates tables, never schemas) connects to it.
        const bootstrap = new DataSource({ type: 'postgres', url: this.url, entities: [] });
        await bootstrap.initialize();
        await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
        await bootstrap.destroy();
        const ds = new DataSource({ type: 'postgres', url: this.url, entities: WORKFLOW_SERVICE_ENTITIES, synchronize: true, logging: false });
        await ds.initialize();
        this.ds = ds;
        return ds;
      })();
    }
    return this.dsPromise;
  }
  private orm<T extends object>(entity: any) { return async () => (await this.ensureDataSource()).getRepository<T>(entity); }
  async close(): Promise<void> { if (this.ds) await this.ds.destroy(); }

  definitions(): Repository<WorkflowDefinition> { return makeRepo(this.orm<WorkflowDefinitionRow>(WorkflowDefinitionRow), defToRow, defFromRow); }
  instances(): Repository<WorkflowInstance> { return makeRepo(this.orm<WorkflowInstanceRow>(WorkflowInstanceRow), instToRow, instFromRow); }
  audits(): Repository<WorkflowInstanceAudit> { return makeRepo(this.orm<WorkflowInstanceAuditRow>(WorkflowInstanceAuditRow), auditToRow, auditFromRow); }
  comments(): Repository<WorkflowInstanceComment> { return makeRepo(this.orm<WorkflowInstanceCommentRow>(WorkflowInstanceCommentRow), commentToRow, commentFromRow); }
  savedQueries(): Repository<SavedQuery> { return makeRepo(this.orm<SavedQueryRow>(SavedQueryRow), queryToRow, queryFromRow); }

  async runTypedQuery(entity: TypedQueryEntity, tenantId: string, definition: QueryDefinition): Promise<QueryRunResult> {
    const rowEntity = entity === 'workflowInstance' ? WorkflowInstanceRow : entity === 'workflowInstanceAudit' ? WorkflowInstanceAuditRow : WorkflowInstanceCommentRow;
    const fromRow = entity === 'workflowInstance' ? instFromRow : entity === 'workflowInstanceAudit' ? auditFromRow : commentFromRow;
    const ds = await this.ensureDataSource();
    const alias = 't';
    const qb = ds.getRepository(rowEntity as any).createQueryBuilder(alias)
      // tenant scoping is the FIRST clause, built from a value the caller (query-engine-service)
      // resolved from ctx.tenantId — nothing below this line can widen it, since applyFilters only
      // ever ANDs additional conditions on, never replaces or ORs around this one.
      .where(`${alias}.tenant_id = :tenantId`, { tenantId });
    applyFilters(qb, alias, entity, definition.filters);
    const rows = (await qb.getMany()).map((r: any) => fromRow(r));
    // groupBy/metric run in JS on the already tenant-+-filter-scoped result set — see query-eval.ts's
    // own doc comment for why this keeps both backends' semantics identical by construction.
    return evaluateQuery(rows as unknown as Record<string, unknown>[], { ...definition, filters: [] });
  }
}
