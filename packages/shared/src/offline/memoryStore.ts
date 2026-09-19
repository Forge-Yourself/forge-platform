import type { KvStore, KvTable, KvWrite } from './types';

/** KvStore for tests. structuredClone so callers can never mutate stored rows by reference. */
export class MemoryKvStore implements KvStore {
  private readonly tables = new Map<KvTable, Map<string, unknown>>();

  private table(name: KvTable): Map<string, unknown> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  async get<T>(table: KvTable, key: string): Promise<T | null> {
    const v = this.table(table).get(key);
    return v === undefined ? null : (structuredClone(v) as T);
  }

  async all<T>(table: KvTable): Promise<Array<{ key: string; value: T }>> {
    return [...this.table(table).entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => ({ key, value: structuredClone(value) as T }));
  }

  async write(batch: readonly KvWrite[]): Promise<void> {
    for (const w of batch) {
      if (w.value === null) this.table(w.table).delete(w.key);
      else this.table(w.table).set(w.key, structuredClone(w.value));
    }
  }

  async clear(): Promise<void> {
    this.tables.clear();
  }
}
