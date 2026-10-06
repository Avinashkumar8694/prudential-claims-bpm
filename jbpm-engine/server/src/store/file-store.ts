import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Store, Repo } from './types.ts';

/** Mirrors the real on-disk layout this project's data survived the loss in: one JSON file per entity,
 *  under `<dataDir>/<collection>/<id>.json`. No in-memory cache — every call reads/writes the
 *  filesystem directly, which keeps write behavior simple and obviously correct (this is a
 *  single-process, self-hosted engine, not a distributed store) at the cost of `query()` re-reading
 *  every file in a collection each time; fine at this project's real data volumes (hundreds of files
 *  per collection, not millions). */
export class FileStore implements Store {
  constructor(private dataDir: string) {}

  repo<T extends { id: string }>(collection: string): Repo<T> {
    const dir = path.join(this.dataDir, collection);
    const fileFor = (id: string) => path.join(dir, `${id}.json`);

    const readOne = async (file: string): Promise<T | undefined> => {
      try {
        const text = await fs.readFile(file, 'utf8');
        return JSON.parse(text) as T;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw e;
      }
    };

    return {
      async get(id) { return readOne(fileFor(id)); },
      async put(entity) {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(fileFor(entity.id), JSON.stringify(entity, null, 2), 'utf8');
        return entity;
      },
      async delete(id) {
        try { await fs.unlink(fileFor(id)); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      },
      async query(pred) {
        let names: string[];
        try { names = await fs.readdir(dir); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
        const jsonNames = names.filter((n) => n.endsWith('.json'));
        const entities: (T | undefined)[] = await Promise.all(jsonNames.map((name) => readOne(path.join(dir, name))));
        return entities.filter((e): e is T => e != null && pred(e));
      },
    };
  }
}
