// The dev/test-tier WorkflowServiceStore — composed over whatever generic Store this process is
// already using (FileStore or MemoryStore, see ../../store/), reusing its existing per-collection
// namespacing (FileStore already writes each collection to its own subdirectory) rather than
// inventing a parallel file layout. Every basic-CRUD method is a one-line delegate; the only real
// logic here is runTypedQuery, which fetches this tenant's rows via the SAME `store.repo().query()`
// path every other read in this codebase already uses, then hands them to the shared, backend-
// agnostic evaluator (query-eval.ts) — the tenant filter is baked into the fetch predicate itself, so
// nothing `definition.filters` contains can ever see a row outside `tenantId` to begin with.
import type { Store } from '../../store/repository.ts';
import type {
  WorkflowDefinition, WorkflowInstance, WorkflowInstanceAudit, WorkflowInstanceComment, SavedQuery,
  QueryDefinition,
} from '../domain.ts';
import { evaluateQuery, type QueryRunResult } from '../query-eval.ts';
import type { TypedQueryEntity, WorkflowServiceStore } from './types.ts';

const COLLECTIONS = {
  workflowDefinition: 'workflow_definition',
  workflowInstance: 'workflow_instance',
  workflowInstanceAudit: 'workflow_instance_audit',
  workflowInstanceComment: 'workflow_instance_comment',
  savedQuery: 'saved_query',
} as const;

export class GenericWorkflowServiceStore implements WorkflowServiceStore {
  constructor(private store: Store) {}
  definitions() { return this.store.repo<WorkflowDefinition>(COLLECTIONS.workflowDefinition); }
  instances() { return this.store.repo<WorkflowInstance>(COLLECTIONS.workflowInstance); }
  audits() { return this.store.repo<WorkflowInstanceAudit>(COLLECTIONS.workflowInstanceAudit); }
  comments() { return this.store.repo<WorkflowInstanceComment>(COLLECTIONS.workflowInstanceComment); }
  savedQueries() { return this.store.repo<SavedQuery>(COLLECTIONS.savedQuery); }

  async runTypedQuery(entity: TypedQueryEntity, tenantId: string, definition: QueryDefinition): Promise<QueryRunResult> {
    const repo = entity === 'workflowInstance' ? this.instances() : entity === 'workflowInstanceAudit' ? this.audits() : this.comments();
    const rows = await repo.query((r) => r.tenantId === tenantId);
    return evaluateQuery(rows as unknown as Record<string, unknown>[], definition);
  }
}
