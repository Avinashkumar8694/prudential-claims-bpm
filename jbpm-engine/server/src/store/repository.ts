// Storage abstraction. Domain services depend only on Repository<T>; swap file/pg/memory freely.
export interface Entity { id: string; tenantId?: string; }

export interface Repository<T extends Entity> {
  get(id: string): Promise<T | undefined>;
  list(): Promise<T[]>;
  query(pred: (t: T) => boolean): Promise<T[]>;
  put(entity: T): Promise<T>;
  delete(id: string): Promise<boolean>;
}

export interface Store {
  repo<T extends Entity>(collection: string): Repository<T>;
}
