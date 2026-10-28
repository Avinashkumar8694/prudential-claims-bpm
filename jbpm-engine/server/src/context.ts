// AppContext bundles the injectable dependencies every service/engine needs. Constructed once at boot
// (and freshly per-test with a MemoryStore + fakeClock for determinism).
import type { Store } from './store/repository.ts';
import { systemClock, newId as defaultNewId, type Clock } from './infra/ids.ts';
import { Collections, type AuditEvent } from './domain.ts';

export interface AppContext {
  store: Store;
  clock: Clock;
  newId: () => string;
  tenantId: string;
  audit: (e: Omit<AuditEvent, 'id' | 'tenantId' | 'at'>) => Promise<void>;
}

export function makeContext(opts: { store: Store; tenantId: string; clock?: Clock; newId?: () => string }): AppContext {
  const clock = opts.clock || systemClock;
  const newId = opts.newId || (() => defaultNewId());
  const ctx: AppContext = {
    store: opts.store,
    clock,
    newId,
    tenantId: opts.tenantId,
    audit: async (e) => {
      const ev: AuditEvent = { id: newId(), tenantId: opts.tenantId, at: clock(), ...e };
      await opts.store.repo<AuditEvent>(Collections.audit).put(ev);
    },
  };
  return ctx;
}
