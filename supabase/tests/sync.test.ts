import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { asUser, connect, createUser, push, randomUUID, type Query } from './support/db.ts';
import { SYNCED_TABLES } from '../../packages/domain/src/schema.ts';

let client: pg.Client;
let user: string;

before(async () => {
  client = await connect();
  user = await createUser(client, { timezone: 'Europe/London' });
});
after(async () => {
  await client.end();
});

type Page = { rows: Record<string, unknown>[]; has_more: boolean };
async function pull(q: Query, cursors: Record<string, unknown> = {}, max = 500): Promise<Record<string, Page>> {
  const r = await q('select public.sync_pull($1::jsonb, $2) as r', [JSON.stringify(cursors), max]);
  return r.rows[0].r.tables;
}

test('push creates, patches field-by-field, and soft-deletes', async () => {
  const id = randomUUID();
  const [created] = await asUser(client, user, (q) =>
    push(q, [{ table: 'goals', id, op: 'upsert', patch: { title: 'Learn Spanish', rank: 'a0', description: 'B1 by summer' } }]),
  );
  assert.equal(created!.status, 'applied');
  assert.equal(created!.row!.title, 'Learn Spanish');

  // Two devices edit different fields: both survive.
  await asUser(client, user, (q) =>
    push(q, [
      { table: 'goals', id, op: 'upsert', patch: { title: 'Learn Spanish (B1)' } },
      { table: 'goals', id, op: 'upsert', patch: { deadline: '2027-06-30' } },
    ]),
  );
  const row = await asUser(client, user, (q) => q('select title, description, deadline::text from public.goals where id = $1', [id]));
  assert.deepEqual(row.rows[0], { title: 'Learn Spanish (B1)', description: 'B1 by summer', deadline: '2027-06-30' });

  const [deleted] = await asUser(client, user, (q) => push(q, [{ table: 'goals', id, op: 'delete' }]));
  assert.equal(deleted!.status, 'applied');
  assert.ok(deleted!.row!.deleted_at, 'tombstone set');
  const [gone] = await asUser(client, user, (q) => push(q, [{ table: 'goals', id: randomUUID(), op: 'delete' }]));
  assert.equal(gone!.status, 'gone', 'deleting something the server never saw is harmless');
});

test('server controls updated_at; client created_at is kept', async () => {
  const id = randomUUID();
  const [r] = await asUser(client, user, (q) =>
    push(q, [{ table: 'tasks', id, op: 'upsert', patch: { title: 'Offline task', rank: 'a0', created_at: '2026-11-10T08:00:00Z', updated_at: '1999-01-01T00:00:00Z' } }]),
  );
  assert.equal(new Date(r!.row!.created_at as string).toISOString(), '2026-11-10T08:00:00.000Z');
  assert.ok(new Date(r!.row!.updated_at as string).getFullYear() >= 2026);
});

test('one bad change is rejected without failing the rest of the batch', async () => {
  const good = randomUUID();
  const results = await asUser(client, user, (q) =>
    push(q, [
      { table: 'tasks', id: randomUUID(), op: 'upsert', patch: { title: '', rank: 'a0' } },
      { table: 'nope', id: randomUUID(), op: 'upsert', patch: {} },
      { table: 'tasks', id: randomUUID(), op: 'explode', patch: {} },
      { table: 'tasks', id: good, op: 'upsert', patch: { title: 'Fine', rank: 'a0', priority: 1 } },
    ]),
  );
  assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected', 'rejected', 'applied']);
  assert.equal(results[0]!.code, '23514', 'check violation reported');
});

test('completion is sticky unless the device explicitly reopens', async () => {
  const id = randomUUID();
  await asUser(client, user, (q) =>
    push(q, [{ table: 'tasks', id, op: 'upsert', patch: { title: 'Essay', rank: 'a0', status: 'completed', completed_at: '2026-11-17T10:00:00Z' } }]),
  );
  // A stale offline edit from another device tries to move it back to planned while renaming it.
  const [stale] = await asUser(client, user, (q) =>
    push(q, [{ table: 'tasks', id, op: 'upsert', patch: { status: 'planned', completed_at: null, title: 'Essay draft' } }]),
  );
  assert.equal(stale!.status, 'merged');
  assert.equal(stale!.row!.status, 'completed');
  assert.equal(stale!.row!.title, 'Essay draft', 'other fields still applied');
  const [reopen] = await asUser(client, user, (q) =>
    push(q, [{ table: 'tasks', id, op: 'upsert', patch: { status: 'planned', completed_at: null }, meta: { reopen: true } }]),
  );
  assert.equal(reopen!.row!.status, 'planned');
});

test('natural keys: two devices logging the same habit day merge into one row', async () => {
  const habit = randomUUID();
  await asUser(client, user, (q) =>
    push(q, [{ table: 'habits', id: habit, op: 'upsert', patch: { name: 'Read', rank: 'a0', start_date: '2026-11-01' } }]),
  );
  const first = randomUUID();
  const second = randomUUID();
  const [a] = await asUser(client, user, (q) =>
    push(q, [{ table: 'habit_logs', id: first, op: 'upsert', patch: { habit_id: habit, log_date: '2026-11-17', status: 'partial' } }]),
  );
  assert.equal(a!.status, 'applied');
  const [b] = await asUser(client, user, (q) =>
    push(q, [{ table: 'habit_logs', id: second, op: 'upsert', patch: { habit_id: habit, log_date: '2026-11-17', status: 'done', value: 30 } }]),
  );
  assert.equal(b!.status, 'remapped');
  assert.equal(b!.new_id, first);
  assert.equal(b!.row!.status, 'done');
  const count = await asUser(client, user, (q) => q('select count(*)::int as n from public.habit_logs where habit_id = $1 and deleted_at is null', [habit]));
  assert.equal(count.rows[0].n, 1);
  // Un-check (tombstone) then re-check with a new id works.
  await asUser(client, user, (q) => push(q, [{ table: 'habit_logs', id: first, op: 'delete' }]));
  const [c] = await asUser(client, user, (q) =>
    push(q, [{ table: 'habit_logs', id: randomUUID(), op: 'upsert', patch: { habit_id: habit, log_date: '2026-11-17', status: 'done' } }]),
  );
  assert.equal(c!.status, 'applied');
});

test('pull: keyset pagination returns every row exactly once, including tombstones', async () => {
  const pager = await createUser(client);
  const ids = Array.from({ length: 23 }, () => randomUUID());
  await asUser(client, pager, (q) =>
    push(q, ids.map((id, i) => ({ table: 'tasks', id, op: 'upsert', patch: { title: `T${i}`, rank: `a${i}` } }))),
  );
  await asUser(client, pager, (q) => push(q, [{ table: 'tasks', id: ids[0], op: 'delete' }]));

  const seen = new Map<string, Record<string, unknown>>();
  let cursor: { ts: string; id: string } | null = null;
  for (let guard = 0; guard < 20; guard++) {
    const page = (await asUser(client, pager, (q) => pull(q, cursor ? { tasks: cursor } : {}, 5))).tasks!;
    for (const row of page.rows) {
      assert.ok(!seen.has(row.id as string), 'no duplicates within a paged pull');
      seen.set(row.id as string, row);
    }
    const last = page.rows[page.rows.length - 1];
    if (last) cursor = { ts: last.updated_at as string, id: last.id as string };
    if (!page.has_more) break;
  }
  assert.equal(seen.size, 23);
  assert.ok(seen.get(ids[0]!)!.deleted_at, 'tombstone delivered');
  // A pull from the final cursor returns nothing new.
  const empty = (await asUser(client, pager, (q) => pull(q, { tasks: cursor }))).tasks!;
  assert.equal(empty.rows.length, 0);
});

test('a new account pulls its provisioned profile, preferences and default categories', async () => {
  const fresh = await createUser(client, { timezone: 'America/New_York', display_name: 'Sam' });
  const tables = await asUser(client, fresh, (q) => pull(q));
  assert.equal(tables.profiles!.rows.length, 1);
  assert.equal(tables.profiles!.rows[0]!.timezone, 'America/New_York');
  assert.equal(tables.profiles!.rows[0]!.display_name, 'Sam');
  assert.equal(tables.user_preferences!.rows.length, 1);
  assert.deepEqual(
    tables.categories!.rows.map((c) => c.name),
    ['Academics', 'Fitness', 'Football & sport', 'Personal development', 'Social', 'Business', 'Projects', 'Other'],
  );
  const bad = await createUser(client, { timezone: 'Mars/Olympus_Mons' });
  const t2 = await asUser(client, bad, (q) => pull(q));
  assert.equal(t2.profiles!.rows[0]!.timezone, 'UTC', 'invalid timezone falls back to UTC');
});

test('schema parity: the app’s table registry matches Postgres exactly', async () => {
  const registered = await client.query<{ name: string }>('select name from ascend_private.sync_tables order by sync_order');
  assert.deepEqual(
    registered.rows.map((r) => r.name).sort(),
    SYNCED_TABLES.map((t) => t.name).sort(),
    'same set of synced tables',
  );
  const pgType: Record<string, string[]> = {
    uuid: ['uuid'],
    text: ['text'],
    int: ['smallint', 'integer', 'bigint'],
    real: ['numeric', 'double precision', 'real'],
    bool: ['boolean'],
    date: ['date'],
    time: ['time without time zone'],
    timestamptz: ['timestamp with time zone'],
    json: ['jsonb'],
    'text[]': ['_text'],
    'int[]': ['_int2', '_int4', '_int8'],
    'time[]': ['_time'],
    'date[]': ['_date'],
  };
  for (const t of SYNCED_TABLES) {
    const cols = await client.query<{ column_name: string; data_type: string; udt_name: string; is_nullable: string }>(
      `select column_name, data_type, udt_name, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [t.name],
    );
    const actual = new Map(cols.rows.map((c) => [c.column_name, c]));
    assert.deepEqual([...actual.keys()].sort(), t.columns.map((c) => c.name).sort(), `${t.name}: same columns`);
    for (const c of t.columns) {
      const a = actual.get(c.name)!;
      const type = a.data_type === 'ARRAY' ? a.udt_name : a.data_type;
      assert.ok(pgType[c.type]!.includes(type), `${t.name}.${c.name}: registry ${c.type} vs postgres ${type}`);
      assert.equal(a.is_nullable === 'YES', c.nullable, `${t.name}.${c.name}: nullability`);
    }
  }
});
