/**
 * Sync engine: pushes the outbox to Postgres (`sync_push`) and pulls changes (`sync_pull`).
 * Protocol and conflict rules: docs/02-architecture.md → "Data & sync".
 */
import { SYNCED_TABLES, tableDef } from '@ascend/domain';
import { encodeValue, normalizeServerRow, type Row } from '../localSchema.ts';
import type { SqlExecutor, SqlValue } from '../sql.ts';
import type { Store } from '../store.ts';

export interface PushChange {
  table: string;
  id: string;
  op: 'upsert' | 'delete';
  patch: Record<string, unknown>;
  meta: Record<string, unknown>;
}

export interface PushResult {
  id: string;
  status: 'applied' | 'merged' | 'remapped' | 'gone' | 'rejected';
  row?: Record<string, unknown>;
  new_id?: string;
  code?: string;
  message?: string;
}

export interface Cursor {
  ts: string | null;
  id: string | null;
}

export interface PullResponse {
  tables: Record<string, { rows: Record<string, unknown>[]; has_more: boolean }>;
  server_time: string;
}

export interface SyncTransport {
  push(changes: PushChange[]): Promise<PushResult[]>;
  pull(cursors: Record<string, Cursor>, maxRows: number): Promise<PullResponse>;
}

/** Thrown by transports for failures where retrying later is the right response (offline, timeouts, 5xx). */
export class TransientSyncError extends Error {}
/** Thrown when the session is no longer valid; the app must sign in again. */
export class AuthSyncError extends Error {}

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  pending: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  conflicts: number;
}

interface OutboxEntry {
  seq: number;
  tbl: string;
  row_id: string;
  op: 'upsert' | 'delete';
  patch: string;
  meta: string;
  attempts: number;
}

const PULL_OVERLAP_MS = 2 * 60_000;
const PUSH_BATCH = 200;
const MAX_ATTEMPTS = 8;
/** SQLSTATEs where the server data or the request may change on retry (FK parent not yet pushed, contention). */
const RETRYABLE_CODES = new Set(['23503', '40001', '40P01', '55P03', '57014', '53300']);

export class SyncEngine {
  private running: Promise<void> | null = null;
  private again = false;
  private status: SyncStatus = { phase: 'idle', pending: 0, lastSyncedAt: null, lastError: null, conflicts: 0 };
  private listeners = new Set<(s: SyncStatus) => void>();

  private readonly store: Store;
  private readonly transport: SyncTransport;
  private readonly opts: { pageSize?: number; now?: () => Date };

  constructor(store: Store, transport: SyncTransport, opts: { pageSize?: number; now?: () => Date } = {}) {
    this.store = store;
    this.transport = transport;
    this.opts = opts;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  onStatus(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  async refreshCounts(): Promise<void> {
    const pending = await this.store.pendingCount();
    const c = await this.store.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM _sync_conflicts WHERE dismissed_at IS NULL');
    const lastSyncedAt = await this.store.getSetting('last_synced_at');
    this.setStatus({ pending, conflicts: c?.n ?? 0, lastSyncedAt });
  }

  /** Runs one full cycle (push, then pull). Concurrent calls coalesce into at most one follow-up cycle. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.cycle();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async cycle(): Promise<void> {
    this.setStatus({ phase: 'syncing' });
    try {
      await this.pushAll();
      await this.pullAll();
      const now = (this.opts.now?.() ?? new Date()).toISOString();
      await this.store.setSetting('last_synced_at', now);
      this.setStatus({ phase: 'idle', lastError: null, lastSyncedAt: now });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof TransientSyncError) this.setStatus({ phase: 'offline', lastError: message });
      else this.setStatus({ phase: 'error', lastError: message });
      if (err instanceof AuthSyncError) throw err;
    } finally {
      await this.refreshCounts();
    }
  }

  // ───────────────────────────── push ─────────────────────────────

  async pushAll(): Promise<void> {
    for (let guard = 0; guard < 50; guard++) {
      const nowIso = (this.opts.now?.() ?? new Date()).toISOString();
      const entries = await this.store.db.all<OutboxEntry>(
        `SELECT seq, tbl, row_id, op, patch, meta, attempts FROM _outbox
         WHERE next_attempt_at IS NULL OR next_attempt_at <= ? ORDER BY seq LIMIT ?`,
        [nowIso, PUSH_BATCH],
      );
      if (!entries.length) return;
      const maxSeq = entries[entries.length - 1]!.seq;
      const changes = compact(entries);
      const results = await this.transport.push(changes.map((c) => c.change));
      const touched = new Set<string>();
      await this.store.db.transaction(async (tx) => {
        for (const [i, r] of results.entries()) {
          const c = changes[i];
          if (!c) continue;
          await this.applyPushResult(tx, c.change, c.attempts, r, maxSeq, nowIso);
          touched.add(c.change.table);
        }
      });
      this.store.notify(touched);
      if (entries.length < PUSH_BATCH) return;
    }
  }

  private async applyPushResult(
    tx: SqlExecutor,
    change: PushChange,
    attempts: number,
    r: PushResult,
    maxSeq: number,
    nowIso: string,
  ): Promise<void> {
    const clear = () =>
      tx.run('DELETE FROM _outbox WHERE tbl = ? AND row_id = ? AND seq <= ?', [change.table, change.id, maxSeq]);
    switch (r.status) {
      case 'applied':
      case 'merged':
        await clear();
        if (r.row) await this.writeServerRow(tx, change.table, r.row);
        if (r.status === 'merged') {
          await this.logConflict(tx, change.table, change.id, 'merged', 'A newer change on another device took precedence for some fields.', nowIso);
        }
        return;
      case 'remapped': {
        await clear();
        await tx.run(`DELETE FROM "${change.table}" WHERE id = ?`, [change.id]);
        if (r.row) await this.writeServerRow(tx, change.table, r.row);
        return;
      }
      case 'gone':
        await clear();
        return;
      case 'rejected': {
        const retryable = r.code !== undefined && RETRYABLE_CODES.has(r.code);
        if (retryable && attempts + 1 < MAX_ATTEMPTS) {
          const delayMs = Math.min(60 * 60_000, 2 ** attempts * 15_000);
          const next = new Date(Date.parse(nowIso) + delayMs).toISOString();
          await tx.run(
            'UPDATE _outbox SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE tbl = ? AND row_id = ? AND seq <= ?',
            [next, `${r.code}: ${r.message}`, change.table, change.id, maxSeq],
          );
          return;
        }
        // Permanent: stop retrying, keep the local row, and surface it in Settings → Sync.
        await clear();
        await this.logConflict(tx, change.table, change.id, 'rejected', `${r.code ?? ''} ${r.message ?? 'Rejected by server'}`.trim(), nowIso);
        return;
      }
    }
  }

  private async logConflict(tx: SqlExecutor, table: string, rowId: string, kind: string, detail: string, nowIso: string): Promise<void> {
    await tx.run('INSERT INTO _sync_conflicts (tbl, row_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?)', [
      table,
      rowId,
      kind,
      detail,
      nowIso,
    ]);
  }

  /** Writes a server row locally, re-applying any local changes that are still waiting to be pushed. */
  private async writeServerRow(tx: SqlExecutor, table: string, raw: Record<string, unknown>): Promise<void> {
    const def = tableDef(table);
    const row: Row = normalizeServerRow(def, raw);
    const pending = await tx.all<{ op: string; patch: string }>(
      'SELECT op, patch FROM _outbox WHERE tbl = ? AND row_id = ? ORDER BY seq',
      [table, row.id],
    );
    for (const p of pending) {
      if (p.op === 'delete') row.deleted_at = row.deleted_at ?? new Date().toISOString();
      else Object.assign(row, JSON.parse(p.patch) as Record<string, unknown>);
    }
    const cols = def.columns.map((c) => `"${c.name}"`).join(', ');
    const qs = def.columns.map(() => '?').join(', ');
    await tx.run(
      `INSERT OR REPLACE INTO "${table}" (${cols}) VALUES (${qs})`,
      def.columns.map((c) => encodeValue(c.type, row[c.name])) as SqlValue[],
    );
  }

  // ───────────────────────────── pull ─────────────────────────────

  async pullAll(): Promise<void> {
    const stored = await this.store.db.all<{ tbl: string; ts: string | null; id: string | null }>(
      'SELECT tbl, ts, id FROM _sync_cursors',
    );
    const saved = new Map(stored.map((c) => [c.tbl, c]));
    // Start of a cycle: step back by the overlap window to catch transactions that committed late.
    const cursors: Record<string, Cursor> = {};
    for (const t of SYNCED_TABLES) {
      const c = saved.get(t.name);
      cursors[t.name] = c?.ts ? { ts: new Date(Date.parse(c.ts) - PULL_OVERLAP_MS).toISOString(), id: null } : { ts: null, id: null };
    }
    const pageSize = this.opts.pageSize ?? 500;
    for (let guard = 0; guard < 1000; guard++) {
      const response = await this.transport.pull(cursors, pageSize);
      const touched = new Set<string>();
      let more = false;
      await this.store.db.transaction(async (tx) => {
        for (const t of SYNCED_TABLES) {
          const page = response.tables[t.name];
          if (!page) continue;
          for (const raw of page.rows) {
            await this.writeServerRow(tx, t.name, raw);
            touched.add(t.name);
          }
          const last = page.rows[page.rows.length - 1];
          if (last) {
            const ts = new Date(String(last.updated_at)).toISOString();
            // Keyset position for the next page; exact (no overlap) while paging.
            cursors[t.name] = { ts: String(last.updated_at), id: String(last.id) };
            await tx.run('INSERT OR REPLACE INTO _sync_cursors (tbl, ts, id) VALUES (?, ?, ?)', [t.name, ts, String(last.id)]);
          }
          if (page.has_more) more = true;
        }
      });
      if (touched.size) this.store.notify(touched);
      if (!more) return;
    }
  }
}

/** Collapses multiple outbox entries for one row into a single change, preserving first-write order. */
export function compact(entries: OutboxEntry[]): { change: PushChange; attempts: number }[] {
  const byRow = new Map<string, { change: PushChange; attempts: number }>();
  const order: string[] = [];
  for (const e of entries) {
    const key = `${e.tbl}:${e.row_id}`;
    const patch = JSON.parse(e.patch) as Record<string, unknown>;
    const meta = JSON.parse(e.meta) as Record<string, unknown>;
    const existing = byRow.get(key);
    if (!existing) {
      byRow.set(key, { change: { table: e.tbl, id: e.row_id, op: e.op, patch, meta }, attempts: e.attempts });
      order.push(key);
      continue;
    }
    existing.attempts = Math.max(existing.attempts, e.attempts);
    existing.change.meta = { ...existing.change.meta, ...meta };
    if (e.op === 'delete') {
      existing.change.op = 'delete';
    } else {
      existing.change.op = 'upsert';
      existing.change.patch = { ...existing.change.patch, ...patch };
    }
  }
  return order.map((k) => byRow.get(k)!);
}
