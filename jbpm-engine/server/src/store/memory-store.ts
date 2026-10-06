import type { Store, Repo } from './types.ts';

/** In-process, non-persistent store — used by every test in this project (fast, fully isolated per
 *  `new MemoryStore()`) and available as a runtime option via STORE=memory. */
export class MemoryStore implements Store {
  private collections = new Map<string, Map<string, unknown>>();
  private coll(name: string): Map<string, unknown> {
    let m = this.collections.get(name);
    if (!m) { m = new Map(); this.collections.set(name, m); }
    return m;
  }
  repo<T extends { id: string }>(collection: string): Repo<T> {
    const coll = this.coll(collection) as Map<string, T>;
    return {
      async get(id) { return coll.get(id); },
      async put(entity) { coll.set(entity.id, entity); return entity; },
      async delete(id) { coll.delete(id); },
      async query(pred) { return [...coll.values()].filter(pred); },
    };
  }
}
