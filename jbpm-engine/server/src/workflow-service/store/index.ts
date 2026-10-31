// Factory for this module's store — mirrors app.ts's resolveStore(), same STORE=pg switch, but
// produces a WorkflowServiceStore (real Postgres schema, or a generic-store wrapper over whatever
// Store the rest of the app is already using) instead of the generic Store interface.
import type { Store } from '../../store/repository.ts';
import { config } from '../../infra/config.ts';
import type { WorkflowServiceStore } from './types.ts';
import { GenericWorkflowServiceStore } from './generic-store.ts';
import { WorkflowServicePgStore } from './pg-store.ts';

// Keyed by the underlying generic Store instance (not a bare singleton) so that every test file's own
// fresh `new MemoryStore()` transparently gets its own fresh, fully isolated wrapper — no manual
// reset-between-tests step to remember, matching how every other per-test store in this codebase
// already works. The pg path stays a true process-wide singleton (a real connection pool is expensive
// to open per call) since there is exactly one Postgres URL for the server's whole lifetime.
const genericCache = new WeakMap<Store, WorkflowServiceStore>();
let pgCached: WorkflowServiceStore | undefined;

/** `genericStore` is the SAME Store instance app.ts's createApp() is already using for everything
 *  else (FileStore/MemoryStore) — reused here, not duplicated, when STORE isn't 'pg'. */
export function resolveWorkflowServiceStore(genericStore: Store): WorkflowServiceStore {
  if (config.store === 'pg' && config.pgUrl) {
    if (!pgCached) {
      pgCached = new WorkflowServicePgStore(config.pgUrl);
    }
    return pgCached!;
  }
  let s = genericCache.get(genericStore);
  if (!s) { s = new GenericWorkflowServiceStore(genericStore); genericCache.set(genericStore, s); }
  return s;
}

export type { WorkflowServiceStore, TypedQueryEntity } from './types.ts';
