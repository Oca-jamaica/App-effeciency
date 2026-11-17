// Test-only driver backed by Node's built-in SQLite.
import { DatabaseSync } from 'node:sqlite';
import { createSqlDb, type SqlDb, type SqlValue } from './sql.ts';

export function openMemoryDb(path = ':memory:'): SqlDb {
  const db = new DatabaseSync(path);
  return createSqlDb({
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params = []) => {
      const r = db.prepare(sql).run(...(params as SqlValue[]));
      return { changes: Number(r.changes) };
    },
    all: async <T>(sql: string, params: readonly SqlValue[] = []) => db.prepare(sql).all(...(params as SqlValue[])) as T[],
    first: async <T>(sql: string, params: readonly SqlValue[] = []) =>
      (db.prepare(sql).get(...(params as SqlValue[])) as T | undefined) ?? null,
  });
}
