/**
 * Local SQLite schema, generated from the shared table registry (packages/domain/src/schema.ts), plus
 * the device-only tables the sync engine needs. Migrations are additive: missing tables and columns
 * are created on open, so a newer registry upgrades an older device database in place.
 */
import { SYNCED_TABLES, type ColumnDef, type ColumnType, type TableDef } from '@ascend/domain';
import type { SqlDb, SqlValue } from './sql.ts';

const SQLITE_TYPE: Record<ColumnType, string> = {
  uuid: 'TEXT',
  text: 'TEXT',
  int: 'INTEGER',
  real: 'REAL',
  bool: 'INTEGER',
  date: 'TEXT',
  time: 'TEXT',
  timestamptz: 'TEXT',
  json: 'TEXT',
  'text[]': 'TEXT',
  'int[]': 'TEXT',
  'time[]': 'TEXT',
  'date[]': 'TEXT',
};

/** Extra indexes for the queries the app runs most. */
const LOCAL_INDEXES: Record<string, string[]> = {
  goals: ['status, rank'],
  milestones: ['goal_id, rank'],
  goal_checklist_items: ['goal_id, rank'],
  goal_progress_entries: ['goal_id, recorded_at'],
  notes: ['goal_id'],
  knowledge_items: ['goal_id'],
  habits: ['status, rank'],
  habit_logs: ['habit_id, log_date', 'log_date'],
  tasks: ['status, due_date', 'goal_id', 'milestone_id', 'parent_task_id', 'do_date'],
  task_events: ['task_id, occurred_at', 'occurred_at'],
  calendar_events: ['starts_at', 'recurrence_rule'],
  reminders: ['remind_at'],
  schedule_blocks: ['block_date, starts_at', 'task_id'],
};

const DEVICE_TABLES = `
CREATE TABLE IF NOT EXISTS _outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl TEXT NOT NULL,
  row_id TEXT NOT NULL,
  op TEXT NOT NULL,
  patch TEXT NOT NULL DEFAULT '{}',
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS _outbox_row ON _outbox (tbl, row_id);
CREATE TABLE IF NOT EXISTS _sync_cursors (
  tbl TEXT PRIMARY KEY,
  ts TEXT,
  id TEXT
);
CREATE TABLE IF NOT EXISTS _sync_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl TEXT NOT NULL,
  row_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL,
  dismissed_at TEXT
);
CREATE TABLE IF NOT EXISTS _kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function columnSql(c: ColumnDef): string {
  const pk = c.name === 'id' ? ' PRIMARY KEY' : '';
  return `"${c.name}" ${SQLITE_TYPE[c.type]}${pk}`;
}

export async function migrateLocalSchema(db: SqlDb, tables: readonly TableDef[] = SYNCED_TABLES): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.exec(DEVICE_TABLES);
    for (const t of tables) {
      await tx.exec(`CREATE TABLE IF NOT EXISTS "${t.name}" (${t.columns.map(columnSql).join(', ')})`);
      const existing = await tx.all<{ name: string }>(`PRAGMA table_info("${t.name}")`);
      const have = new Set(existing.map((c) => c.name));
      for (const c of t.columns) {
        if (!have.has(c.name)) await tx.exec(`ALTER TABLE "${t.name}" ADD COLUMN ${columnSql(c)}`);
      }
      await tx.exec(`CREATE INDEX IF NOT EXISTS "${t.name}__deleted" ON "${t.name}" (deleted_at)`);
      for (const [i, cols] of (LOCAL_INDEXES[t.name] ?? []).entries()) {
        await tx.exec(`CREATE INDEX IF NOT EXISTS "${t.name}__ix${i}" ON "${t.name}" (${cols})`);
      }
    }
  });
}

// ───────────────────────────── codec ─────────────────────────────

export type Row = Record<string, unknown> & { id: string };

function isArrayType(t: ColumnType): boolean {
  return t.endsWith('[]');
}

/** JS value → SQLite value. */
export function encodeValue(type: ColumnType, value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (type === 'bool') return value ? 1 : 0;
  if (type === 'json' || isArrayType(type)) return JSON.stringify(value);
  if (type === 'int' || type === 'real') return Number(value);
  return String(value);
}

/** SQLite value → JS value. */
export function decodeValue(type: ColumnType, value: SqlValue | undefined): unknown {
  if (value === null || value === undefined) return null;
  if (type === 'bool') return value === 1 || value === '1' || value === 'true';
  if (type === 'json' || isArrayType(type)) {
    try {
      return JSON.parse(String(value));
    } catch {
      return null;
    }
  }
  if (type === 'int' || type === 'real') return Number(value);
  return value;
}

/** Server JSON (to_jsonb) value → canonical JS value as stored locally. */
export function normalizeServerValue(type: ColumnType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'timestamptz':
      return new Date(String(value)).toISOString();
    case 'time':
      return String(value).slice(0, 5);
    case 'time[]':
      return (value as string[]).map((v) => String(v).slice(0, 5));
    case 'int':
    case 'real':
      return Number(value);
    default:
      return value;
  }
}

export function decodeRow(table: TableDef, raw: Record<string, SqlValue>): Row {
  const out: Record<string, unknown> = {};
  for (const c of table.columns) out[c.name] = decodeValue(c.type, raw[c.name]);
  return out as Row;
}

export function normalizeServerRow(table: TableDef, raw: Record<string, unknown>): Row {
  const out: Record<string, unknown> = {};
  for (const c of table.columns) out[c.name] = normalizeServerValue(c.type, raw[c.name]);
  return out as Row;
}
