// Postgres-backed store (TypeORM). Same generic "one JSON document per id" model as FileStore — just
// a single `kv_store` table (collection, id) -> jsonb, instead of a directory of .json files — so it
// stays a genuine drop-in for the Repository<T>/Store interface with zero schema-per-collection setup
// (matching FileStore's own "zero-setup" framing, just with a real DB behind it: durable, safe under
// concurrent writers, shareable across multiple server processes instead of a local directory).
//
// query(pred) fetches every row for the collection and applies the JS predicate in memory, exactly
// like FileStore/MemoryStore do — `pred` is an opaque closure the DB can't introspect, so this is the
// only correct option (not a shortcut); tenant_id is still extracted into a real, indexed column so a
// direct SQL/ops look at the table isn't just an opaque blob.
import 'reflect-metadata';
import { DataSource, Entity as TypeOrmEntity, PrimaryColumn, Column, Index } from 'typeorm';
import type { Entity as DomainEntity, Repository, Store } from './repository.ts';

@TypeOrmEntity({ name: 'kv_store' })
@Index(['collection', 'tenantId'])
class KvRow {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  collection!: string;

  @PrimaryColumn({ type: 'varchar', length: 128 })
  id!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  tenantId!: string | null;

  @Column({ type: 'jsonb' })
  data!: unknown;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}

class PgRepo<T extends DomainEntity> implements Repository<T> {
  constructor(private collection: string, private getDs: () => Promise<DataSource>) {}
  private async orm() { return (await this.getDs()).getRepository(KvRow); }

  async get(id: string): Promise<T | undefined> {
    const row = await (await this.orm()).findOneBy({ collection: this.collection, id });
    return row ? (row.data as T) : undefined;
  }
  async list(): Promise<T[]> {
    const rows = await (await this.orm()).findBy({ collection: this.collection });
    return rows.map((r) => r.data as T);
  }
  async query(pred: (t: T) => boolean): Promise<T[]> {
    return (await this.list()).filter(pred);
  }
  async put(entity: T): Promise<T> {
    await (await this.orm()).upsert(
      { collection: this.collection, id: entity.id, tenantId: entity.tenantId ?? null, data: entity, updatedAt: new Date() },
      ['collection', 'id'],
    );
    return entity;
  }
  async delete(id: string): Promise<boolean> {
    const res = await (await this.orm()).delete({ collection: this.collection, id });
    return !!res.affected;
  }
}

export class PgStore implements Store {
  private ds?: DataSource;
  private dsPromise?: Promise<DataSource>;
  private repos = new Map<string, PgRepo<any>>();
  constructor(private url: string) {}

  /** Lazily connects on first actual use (same idiom as FileRepo's own ensureLoaded()) — constructing
   *  a PgStore never itself requires an event loop tick or a reachable database. */
  private ensureDataSource(): Promise<DataSource> {
    if (this.ds) return Promise.resolve(this.ds);
    if (!this.dsPromise) {
      this.dsPromise = new DataSource({
        type: 'postgres', url: this.url, entities: [KvRow],
        // One trivial, schema-less table — safe to auto-create/reconcile; a real multi-table relational
        // rollout would want real migrations, but there's nothing here for synchronize to drift on.
        synchronize: true, logging: false,
      }).initialize().then((ds) => (this.ds = ds));
    }
    return this.dsPromise;
  }

  repo<T extends DomainEntity>(collection: string): Repository<T> {
    let r = this.repos.get(collection);
    if (!r) { r = new PgRepo<T>(collection, () => this.ensureDataSource()); this.repos.set(collection, r); }
    return r as Repository<T>;
  }

  async close(): Promise<void> { if (this.ds) await this.ds.destroy(); }
}
