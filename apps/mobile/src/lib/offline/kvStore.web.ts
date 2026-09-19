/// <reference lib="dom" />
import type { KvStore, KvTable, KvWrite } from '@forge/shared';

/**
 * Web KvStore over IndexedDB. Keys are [table, key] arrays, so a table's rows
 * are one contiguous, key-ordered range. One readwrite transaction per batch
 * is what makes write() atomic.
 */
const DB_NAME = 'forge-offline';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const kvStore: KvStore = {
  async get<T>(table: KvTable, key: string): Promise<T | null> {
    const store = (await db()).transaction(STORE, 'readonly').objectStore(STORE);
    const value = await request(store.get([table, key]));
    return value === undefined ? null : (value as T);
  },
  async all<T>(table: KvTable): Promise<{ key: string; value: T }[]> {
    const store = (await db()).transaction(STORE, 'readonly').objectStore(STORE);
    const range = IDBKeyRange.bound([table, ''], [table, '￿']);
    const [keys, values] = await Promise.all([request(store.getAllKeys(range)), request(store.getAll(range))]);
    return keys.map((k, i) => ({ key: (k as [string, string])[1], value: values[i] as T }));
  },
  async write(batch: readonly KvWrite[]): Promise<void> {
    const tx = (await db()).transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const w of batch) {
      if (w.value === null) store.delete([w.table, w.key]);
      else store.put(w.value, [w.table, w.key]);
    }
    await done(tx);
  },
  async clear(): Promise<void> {
    const tx = (await db()).transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await done(tx);
  },
};
