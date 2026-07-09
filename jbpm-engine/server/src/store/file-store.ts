// File-backed store: <dataDir>/<collection>/<id>.json. Loads lazily into memory, writes through.
// Zero-setup durability for dev; same Repository interface as memory/pg.
import fs from 'node:fs';
import path from 'node:path';
import type { Entity, Repository, Store } from './repository.ts';

class FileRepo<T extends Entity> implements Repository<T> {
  private cache = new Map<string, T>();
  private loaded = false;
  constructor(private dir: string) {}

  private ensureLoaded() {
    if (this.loaded) return;
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try { const e = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as T; this.cache.set(e.id, e); }
      catch { /* skip corrupt file */ }
    }
    this.loaded = true;
  }
  private file(id: string) { return path.join(this.dir, `${id}.json`); }

  async get(id: string) { this.ensureLoaded(); return this.cache.get(id); }
  async list() { this.ensureLoaded(); return [...this.cache.values()]; }
  async query(pred: (t: T) => boolean) { this.ensureLoaded(); return [...this.cache.values()].filter(pred); }
  async put(entity: T) {
    this.ensureLoaded();
    this.cache.set(entity.id, structuredClone(entity));
    const tmp = this.file(entity.id) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(entity, null, 2));
    fs.renameSync(tmp, this.file(entity.id));   // atomic-ish write
    return entity;
  }
  async delete(id: string) {
    this.ensureLoaded();
    const existed = this.cache.delete(id);
    try { fs.unlinkSync(this.file(id)); } catch { /* already gone */ }
    return existed;
  }
}

export class FileStore implements Store {
  private repos = new Map<string, FileRepo<any>>();
  constructor(private dataDir: string) {}
  repo<T extends Entity>(collection: string): Repository<T> {
    let r = this.repos.get(collection);
    if (!r) { r = new FileRepo<T>(path.join(this.dataDir, collection)); this.repos.set(collection, r); }
    return r as Repository<T>;
  }
}
