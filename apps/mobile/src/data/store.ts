/**
 * The local store: the only writer of user data on the device.
 *
 * Every write updates the row and appends an outbox entry in one SQLite transaction, then notifies
 * subscribers of the affected tables (live queries re-run). The sync engine drains the outbox.
 */
import { tableDef, type SyncedTableName, type TableDef } from '@ascend/domain';
import { decodeRow, encodeValue, type Row } from './localSchema.ts';
import type { SqlDb, SqlExecutor, SqlValue } from './sql.ts';

export type ChangeListener = (tables: ReadonlySet<string>) => void;

export interface StoreOptions {
  db: SqlDb;
  userId: string;
  newId: () => string;
  now?: () => Date;
}

export interface WriteOptions {
  /** Extra metadata for the server (e.g. `{ reopen: true }` to deliberately un-complete a task). */
  meta?: Record<string, unknown>;
}

const SERVER_MANAGED = new Set(['id', 'user_id', 'updated_at']);

export class StoreError extends Error {}

/** A write session inside one transaction; returned rows are final once the transaction commits. */
export class StoreTx {
  readonly touched = new Set<string>();
  private readonly store: Store;
  readonly sql: SqlExecutor;

  constructor(store: Store, sql: SqlExecutor) {
    this.store = store;
    this.sql = sql;
  }

  get userId(): string {
    return this.store.userId;
  }

  newId(): string {
    return this.store.newId();
  }

  nowIso(): string {
    return this.store.now().toISOString();
  }

  async get<T extends { id: string } = Row>(table: SyncedTableName, id: string): Promise<T | null> {
    const def = tableDef(table);
    const raw = await this.sql.first<Record<string, SqlValue>>(`SELECT * FROM "${table}" WHERE id = ?`, [id]);
    return raw ? (decodeRow(def, raw) as unknown as T) : null;
  }

  async insert<T extends { id: string } = Row>(table: SyncedTableName, values: Record<string, unknown>, opts: WriteOptions = {}): Promise<T> {
    const def = tableDef(table);
    const now = this.nowIso();
    const row: Record<string, unknown> = {};
    for (const c of def.columns) row[c.name] = values[c.name] ?? null;
    row.id = (values.id as string | undefined) ?? this.newId();
    row.user_id = this.userId;
    row.created_at = (values.created_at as string | undefined) ?? now;
    row.updated_at = now;
    row.deleted_at = null;
    for (const c of def.columns) {
      if (!c.nullable && (row[c.name] === null || row[c.name] === undefined)) {
        throw new StoreError(`${table}.${c.name} is required`);
      }
    }
    for (const k of Object.keys(values)) {
      if (!def.columns.some((c) => c.name === k)) throw new StoreError(`${table} has no column ${k}`);
    }
    await this.writeRow(def, row);
    const patch: Record<string, unknown> = {};
    for (const c of def.columns) if (!SERVER_MANAGED.has(c.name)) patch[c.name] = row[c.name];
    await this.enqueue(table, row.id as string, 'upsert', patch, opts.meta);
    this.touched.add(table);
    return row as unknown as T;
  }

  async update<T extends { id: string } = Row>(
    table: SyncedTableName,
    id: string,
    changes: Record<string, unknown>,
    opts: WriteOptions = {},
  ): Promise<T> {
    const def = tableDef(table);
    const current = await this.get(table, id);
    if (!current) throw new StoreError(`${table} ${id} not found`);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(changes)) {
      const col = def.columns.find((c) => c.name === k);
      if (!col) throw new StoreError(`${table} has no column ${k}`);
      if (SERVER_MANAGED.has(k) || k === 'created_at') continue;
      if (!col.nullable && (v === null || v === undefined)) throw new StoreError(`${table}.${k} is required`);
      if (JSON.stringify(current[k] ?? null) !== JSON.stringify(v ?? null)) patch[k] = v ?? null;
    }
    if (Object.keys(patch).length === 0 && !opts.meta) return current as unknown as T;
    const next = { ...current, ...patch, updated_at: this.nowIso() };
    await this.writeRow(def, next);
    await this.enqueue(table, id, 'upsert', patch, opts.meta);
    this.touched.add(table);
    return next as unknown as T;
  }

  /** Soft delete: the row is hidden everywhere and restorable for 30 days. */
  async remove(table: SyncedTableName, id: string): Promise<void> {
    const current = await this.get(table, id);
    if (!current || current.deleted_at) return;
    const now = this.nowIso();
    await this.sql.run(`UPDATE "${table}" SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now, now, id]);
    await this.enqueue(table, id, 'delete', {}, undefined);
    this.touched.add(table);
  }

  async restore(table: SyncedTableName, id: string): Promise<void> {
    const current = await this.get(table, id);
    if (!current || !current.deleted_at) return;
    await this.sql.run(`UPDATE "${table}" SET deleted_at = NULL, updated_at = ? WHERE id = ?`, [this.nowIso(), id]);
    await this.enqueue(table, id, 'upsert', { deleted_at: null }, undefined);
    this.touched.add(table);
  }

  private async writeRow(def: TableDef, row: Record<string, unknown>): Promise<void> {
    const cols = def.columns.map((c) => `"${c.name}"`).join(', ');
    const qs = def.columns.map(() => '?').join(', ');
    await this.sql.run(
      `INSERT OR REPLACE INTO "${def.name}" (${cols}) VALUES (${qs})`,
      def.columns.map((c) => encodeValue(c.type, row[c.name])),
    );
  }

  private async enqueue(
    table: string,
    rowId: string,
    op: 'upsert' | 'delete',
    patch: Record<string, unknown>,
    meta: Record<string, unknown> | undefined,
  ): Promise<void> {
    await this.sql.run(
      'INSERT INTO _outbox (tbl, row_id, op, patch, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [table, rowId, op, JSON.stringify(patch), JSON.stringify(meta ?? {}), this.nowIso()],
    );
  }
}

export class Store {
  readonly db: SqlDb;
  readonly userId: string;
  readonly newId: () => string;
  readonly now: () => Date;
  private listeners = new Set<{ tables: Set<string> | null; fn: ChangeListener }>();
  private outboxListeners = new Set<() => void>();

  constructor(opts: StoreOptions) {
    this.db = opts.db;
    this.userId = opts.userId;
    this.newId = opts.newId;
    this.now = opts.now ?? (() => new Date());
  }

  /** Runs several writes atomically; subscribers are notified once, after commit. */
  async write<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T> {
    let tx!: StoreTx;
    const result = await this.db.transaction(async (sql) => {
      tx = new StoreTx(this, sql);
      return fn(tx);
    });
    if (tx.touched.size) {
      this.notify(tx.touched);
      for (const l of this.outboxListeners) l();
    }
    return result;
  }

  insert<T extends { id: string } = Row>(table: SyncedTableName, values: Record<string, unknown>, opts?: WriteOptions): Promise<T> {
    return this.write((tx) => tx.insert<T>(table, values, opts));
  }

  update<T extends { id: string } = Row>(table: SyncedTableName, id: string, changes: Record<string, unknown>, opts?: WriteOptions): Promise<T> {
    return this.write((tx) => tx.update<T>(table, id, changes, opts));
  }

  remove(table: SyncedTableName, id: string): Promise<void> {
    return this.write((tx) => tx.remove(table, id));
  }

  restore(table: SyncedTableName, id: string): Promise<void> {
    return this.write((tx) => tx.restore(table, id));
  }

  async get<T extends { id: string } = Row>(table: SyncedTableName, id: string): Promise<T | null> {
    const raw = await this.db.first<Record<string, SqlValue>>(`SELECT * FROM "${table}" WHERE id = ?`, [id]);
    return raw ? (decodeRow(tableDef(table), raw) as unknown as T) : null;
  }

  /**
   * Live rows of a table (soft-deleted rows excluded unless asked). `where` is a SQL fragment with `?`
   * placeholders; callers never interpolate user input into it.
   */
  async list<T extends { id: string } = Row>(
    table: SyncedTableName,
    opts: { where?: string; params?: SqlValue[]; orderBy?: string; limit?: number; includeDeleted?: boolean } = {},
  ): Promise<T[]> {
    const clauses: string[] = [];
    if (!opts.includeDeleted) clauses.push('deleted_at IS NULL');
    if (opts.where) clauses.push(`(${opts.where})`);
    const sql =
      `SELECT * FROM "${table}"` +
      (clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '') +
      (opts.orderBy ? ` ORDER BY ${opts.orderBy}` : '') +
      (opts.limit ? ` LIMIT ${Math.floor(opts.limit)}` : '');
    const raws = await this.db.all<Record<string, SqlValue>>(sql, opts.params ?? []);
    const def = tableDef(table);
    return raws.map((r) => decodeRow(def, r) as unknown as T);
  }

  /** Raw read for aggregate queries. */
  query<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return this.db.all<T>(sql, params);
  }

  subscribe(tables: readonly string[] | null, fn: ChangeListener): () => void {
    const entry = { tables: tables ? new Set(tables) : null, fn };
    this.listeners.add(entry);
    return () => this.listeners.delete(entry);
  }

  onOutboxChange(fn: () => void): () => void {
    this.outboxListeners.add(fn);
    return () => this.outboxListeners.delete(fn);
  }

  notify(tables: ReadonlySet<string>): void {
    for (const l of this.listeners) {
      if (!l.tables || [...tables].some((t) => l.tables!.has(t))) l.fn(tables);
    }
  }

  async pendingCount(): Promise<number> {
    const r = await this.db.first<{ n: number }>('SELECT COUNT(DISTINCT tbl || row_id) AS n FROM _outbox');
    return r?.n ?? 0;
  }

  async getSetting(key: string): Promise<string | null> {
    const r = await this.db.first<{ value: string }>('SELECT value FROM _kv WHERE key = ?', [key]);
    return r?.value ?? null;
  }

  /** Device-only settings. Listeners subscribed to '_kv' hear about changes. */
  async setSetting(key: string, value: string): Promise<void> {
    await this.db.run('INSERT OR REPLACE INTO _kv (key, value) VALUES (?, ?)', [key, value]);
    this.notify(new Set(['_kv']));
  }

  async removeSetting(key: string): Promise<void> {
    await this.db.run('DELETE FROM _kv WHERE key = ?', [key]);
    this.notify(new Set(['_kv']));
  }
}
