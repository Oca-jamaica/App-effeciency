import * as SQLite from 'expo-sqlite';
import { createSqlDb, type SqlDb, type SqlValue } from './sql.ts';

/** Opens (or creates) the per-user database on the device. */
export async function openDeviceDb(name: string): Promise<SqlDb> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;');
  return createSqlDb({
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params = []) => {
      const r = await db.runAsync(sql, params as SqlValue[]);
      return { changes: r.changes };
    },
    all: <T>(sql: string, params: readonly SqlValue[] = []) => db.getAllAsync<T>(sql, params as SqlValue[]),
    first: <T>(sql: string, params: readonly SqlValue[] = []) => db.getFirstAsync<T>(sql, params as SqlValue[]),
    close: () => db.closeAsync(),
  });
}
