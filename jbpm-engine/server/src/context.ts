import type { Store } from './store/types.ts';
import { Collections, type AuditEvent } from './domain.ts';

export interface AppContext {
  store: Store;
  tenantId: string;
  clock: () => string;
  newId: () => string;
  audit: (e: Omit<AuditEvent, 'id' | 'tenantId' | 'at'>) => Promise<void>;
}

export function makeContext(opts: { store: Store; tenantId: string; clock: () => string; newId: () => string }): AppContext {
  const ctx: AppContext = {
    store: opts.store, tenantId: opts.tenantId, clock: opts.clock, newId: opts.newId,
    audit: async (e) => {
      const event: AuditEvent = { id: opts.newId(), tenantId: opts.tenantId, at: opts.clock(), ...e };
      await opts.store.repo<AuditEvent>(Collections.audit).put(event);
    },
  };
  return ctx;
}
