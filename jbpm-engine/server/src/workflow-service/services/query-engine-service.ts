// The generic, secured ad-hoc query engine — see domain.ts's QueryableEntity/QueryDefinition and this
// module's plan doc for the design rationale. THE ONE RULE THIS FILE EXISTS TO ENFORCE: every code
// path resolves tenant scope from `this.ctx.tenantId` (server-side, from the authenticated context)
// and NEVER from `definition` — nothing in a caller-supplied QueryDefinition can widen, override, or
// escape it. For workflowInstance/workflowInstanceAudit/workflowInstanceComment this is delegated to
// WorkflowServiceStore.runTypedQuery (real SQL, tenant clause built from this same ctx.tenantId — see
// store/pg-store.ts's own doc comment). For instance/task (the pre-existing generic blob store) it's
// enforced by fetching ONLY rows already predicate-filtered to this tenant before evaluateQuery ever
// sees them (see query-eval.ts).
import type { AppContext } from '../../context.ts';
import { Collections, type Instance, type Task } from '../../domain.ts';
import { validation, notFound, forbidden } from '../../infra/errors.ts';
import type { WorkflowServiceStore } from '../store/types.ts';
import type { QueryDefinition, QueryableEntity, SavedQuery } from '../domain.ts';
import { evaluateQuery, type QueryRunResult } from '../query-eval.ts';

const TYPED_ENTITIES: QueryableEntity[] = ['workflowInstance', 'workflowInstanceAudit', 'workflowInstanceComment'];
const MAX_LIMIT = 500;
const VALID_OPS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']);

export class QueryEngineService {
  constructor(private ctx: AppContext, private store: WorkflowServiceStore) {}

  private assertValidDefinition(def: QueryDefinition): void {
    const entities: QueryableEntity[] = [...TYPED_ENTITIES, 'instance', 'task'];
    if (!entities.includes(def.entity)) throw validation(`entity must be one of: ${entities.join(', ')}`);
    for (const f of def.filters || []) {
      if (!f.field || typeof f.field !== 'string') throw validation('every filter needs a field');
      if (!VALID_OPS.has(f.op)) throw validation(`unsupported filter op "${f.op}"`);
    }
    if (def.limit != null && (typeof def.limit !== 'number' || def.limit < 1)) throw validation('limit must be a positive number');
  }

  async run(definition: QueryDefinition): Promise<QueryRunResult> {
    this.assertValidDefinition(definition);
    const capped: QueryDefinition = { ...definition, limit: Math.min(definition.limit ?? 100, MAX_LIMIT) };

    if (TYPED_ENTITIES.includes(capped.entity)) {
      return this.store.runTypedQuery(capped.entity as any, this.ctx.tenantId, capped);
    }
    // instance/task: still on the generic blob store — fetch ONLY this tenant's rows, then evaluate.
    const collection = capped.entity === 'instance' ? Collections.instances : Collections.tasks;
    const rows = await this.ctx.store.repo<Instance | Task>(collection).query((r) => r.tenantId === this.ctx.tenantId);
    return evaluateQuery(rows as unknown as Record<string, unknown>[], capped);
  }

  // ---- saved queries ----
  async list(actor: string): Promise<SavedQuery[]> {
    return (await this.store.savedQueries().query((q) => q.tenantId === this.ctx.tenantId && (!q.ownerId || q.ownerId === actor)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string, actor: string): Promise<SavedQuery> {
    const q = await this.store.savedQueries().get(id);
    if (!q || q.tenantId !== this.ctx.tenantId || (q.ownerId && q.ownerId !== actor)) throw notFound('SavedQuery');
    return q;
  }

  async save(input: { name: string; definition: QueryDefinition; shared?: boolean }, actor: string): Promise<SavedQuery> {
    if (!input.name?.trim()) throw validation('name is required');
    this.assertValidDefinition(input.definition);
    const q: SavedQuery = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, name: input.name.trim(), definition: input.definition,
      ownerId: input.shared ? undefined : actor, createdAt: this.ctx.clock(), createdBy: actor,
    };
    await this.store.savedQueries().put(q);
    await this.ctx.audit({ actor, kind: 'savedQuery.created', data: { id: q.id, name: q.name } });
    return q;
  }

  async runSaved(id: string, actor: string): Promise<QueryRunResult> {
    const q = await this.get(id, actor);
    return this.run(q.definition);
  }

  async delete(id: string, actor: string): Promise<void> {
    const q = await this.get(id, actor);
    if (q.createdBy !== actor) throw forbidden('only the creator can delete a saved query');
    await this.store.savedQueries().delete(id);
    await this.ctx.audit({ actor, kind: 'savedQuery.deleted', data: { id } });
  }
}
