// The storage contract this whole module is written against — two implementations: a real Postgres
// schema with typed tables (pg-store.ts, used when STORE=pg) and a generic one composed over the
// existing file/memory Store (generic-store.ts, used otherwise) — see index.ts's resolveWorkflowServiceStore.
import type { Repository } from '../../store/repository.ts';
import type {
  WorkflowDefinition, WorkflowInstance, WorkflowInstanceAudit, WorkflowInstanceComment, SavedQuery,
  QueryDefinition,
} from '../domain.ts';
import type { QueryRunResult } from '../query-eval.ts';

export type TypedQueryEntity = 'workflowInstance' | 'workflowInstanceAudit' | 'workflowInstanceComment';

export interface WorkflowServiceStore {
  definitions(): Repository<WorkflowDefinition>;
  instances(): Repository<WorkflowInstance>;
  audits(): Repository<WorkflowInstanceAudit>;
  comments(): Repository<WorkflowInstanceComment>;
  savedQueries(): Repository<SavedQuery>;
  /** `tenantId` is supplied by the CALLER (query-engine-service), always from `ctx.tenantId`, never
   *  from request input — every implementation must apply it before anything in `definition` runs,
   *  and must apply it in a way `definition`'s own filters cannot override (see each implementation's
   *  own doc comment for exactly how). This is the one method in the whole module where that
   *  guarantee is load-bearing enough to spell out at the interface level, not just in a service. */
  runTypedQuery(entity: TypedQueryEntity, tenantId: string, definition: QueryDefinition): Promise<QueryRunResult>;
}
