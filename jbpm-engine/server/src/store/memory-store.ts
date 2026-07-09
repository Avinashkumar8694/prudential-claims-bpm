// In-memory store — used by tests and as the FileStore's cache layer.
import type { Entity, Repository, Store } from './repository.js';

class MemoryRepo<T extends Entity> implements Repository<T> {
  private map = new Map<string, T>();
  async get(id: string) { return this.map.get(id); }
  async list() { return [...this.map.values()]; }
  async query(pred: (t: T) => boolean) { return [...this.map.values()].filter(pred); }
  async put(entity: T) { this.map.set(entity.id, structuredClone(entity)); return entity; }
  async delete(id: string) { return this.map.delete(id); }
}

export class MemoryStore implements Store {
  private repos = new Map<string, MemoryRepo<any>>();
  repo<T extends Entity>(collection: string): Repository<T> {
    let r = this.repos.get(collection);
    if (!r) { r = new MemoryRepo<T>(); this.repos.set(collection, r); }
    return r as Repository<T>;
  }
}
