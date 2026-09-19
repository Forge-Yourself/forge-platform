import type { KvStore, KvTable, KvWrite } from '@forge/shared';
import * as SQLite from 'expo-sqlite';

/**
 * Native KvStore: one table, JSON values. kvStore.web.ts replaces this file on
 * web (Metro platform extensions), so expo-sqlite never enters the web bundle.
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= SQLite.openDatabaseAsync('forge-offline.db').then(async (d) => {
    await d.execAsync(
      'PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS kv (tbl TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (tbl, k));',
    );
    return d;
  });
  return dbPromise;
}

export const kvStore: KvStore = {
  async get<T>(table: KvTable, key: string): Promise<T | null> {
    const row = await (await db()).getFirstAsync<{ v: string }>('SELECT v FROM kv WHERE tbl = ? AND k = ?', table, key);
    return row ? (JSON.parse(row.v) as T) : null;
  },
  async all<T>(table: KvTable): Promise<{ key: string; value: T }[]> {
    const rows = await (await db()).getAllAsync<{ k: string; v: string }>('SELECT k, v FROM kv WHERE tbl = ? ORDER BY k', table);
    return rows.map((r) => ({ key: r.k, value: JSON.parse(r.v) as T }));
  },
  async write(batch: readonly KvWrite[]): Promise<void> {
    const d = await db();
    await d.withExclusiveTransactionAsync(async (tx) => {
      for (const w of batch) {
        if (w.value === null) await tx.runAsync('DELETE FROM kv WHERE tbl = ? AND k = ?', w.table, w.key);
        else await tx.runAsync('INSERT OR REPLACE INTO kv (tbl, k, v) VALUES (?, ?, ?)', w.table, w.key, JSON.stringify(w.value));
      }
    });
  },
  async clear(): Promise<void> {
    await (await db()).runAsync('DELETE FROM kv');
  },
};
