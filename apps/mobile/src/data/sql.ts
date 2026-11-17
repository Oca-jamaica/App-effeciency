/**
 * The minimal SQL surface the data layer needs. Implemented by expo-sqlite in the app and by
 * node:sqlite in tests, so the whole data layer (store, sync, repositories) is testable off-device.
 *
 * Concurrency: every top-level call is serialised through a lock, so an unrelated async write can never
 * interleave with an open transaction. Code inside `transaction` must use the `tx` handle it receives.
 */
export type SqlValue = string | number | null;

export interface SqlRunResult {
  changes: number;
}

export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<SqlRunResult>;
  all<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  first<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
}

export interface SqlDb extends SqlExecutor {
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

/** Raw, unlocked driver operations; `createSqlDb` adds locking and transactions on top. */
export interface SqlDriver extends SqlExecutor {
  close?(): Promise<void>;
}

class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async lock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export function createSqlDb(driver: SqlDriver): SqlDb {
  const mutex = new Mutex();
  return {
    exec: (sql) => mutex.lock(() => driver.exec(sql)),
    run: (sql, params) => mutex.lock(() => driver.run(sql, params)),
    all: (sql, params) => mutex.lock(() => driver.all(sql, params)),
    first: (sql, params) => mutex.lock(() => driver.first(sql, params)),
    transaction: (fn) =>
      mutex.lock(async () => {
        await driver.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(driver);
          await driver.exec('COMMIT');
          return result;
        } catch (err) {
          await driver.exec('ROLLBACK');
          throw err;
        }
      }),
  };
}
