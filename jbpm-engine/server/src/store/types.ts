// Every store implementation (memory, file, pg) implements this same tiny contract, so service code
// never branches on which backend is active.
export interface Repo<T extends { id: string }> {
  get(id: string): Promise<T | undefined>;
  put(entity: T): Promise<T>;
  delete(id: string): Promise<void>;
  query(pred: (t: T) => boolean): Promise<T[]>;
}

export interface Store {
  repo<T extends { id: string }>(collection: string): Repo<T>;
}
