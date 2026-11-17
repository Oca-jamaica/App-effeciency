import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openMemoryDb } from './nodeDriver.ts';
import { migrateLocalSchema } from './localSchema.ts';
import { Store, StoreError } from './store.ts';
import { compact } from './sync/engine.ts';

async function makeStore() {
  const db = openMemoryDb();
  await migrateLocalSchema(db);
  return new Store({ db, userId: randomUUID(), newId: randomUUID });
}

test('migration is idempotent and creates every table', async () => {
  const db = openMemoryDb();
  await migrateLocalSchema(db);
  await migrateLocalSchema(db);
  const tables = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
  for (const t of ['goals', 'tasks', 'habits', 'habit_logs', 'schedule_blocks', '_outbox', '_sync_cursors']) {
    assert.ok(tables.some((x) => x.name === t), t);
  }
});

test('insert, update, soft delete and restore round-trip with typed values', async () => {
  const store = await makeStore();
  const habit = await store.insert('habits', {
    name: 'Gym',
    frequency_kind: 'weekdays',
    days_of_week: [1, 3, 5],
    start_date: '2026-11-01',
    preferred_window: 'evening',
    status: 'active',
    reminder_times: ['18:00'],
    rank: 'a0',
  });
  const loaded = await store.get('habits', habit.id);
  assert.deepEqual(loaded?.days_of_week, [1, 3, 5]);
  assert.deepEqual(loaded?.reminder_times, ['18:00']);
  assert.equal(loaded?.user_id, store.userId);

  await store.update('habits', habit.id, { name: 'Gym session', duration_minutes: 60 });
  assert.equal((await store.get('habits', habit.id))?.name, 'Gym session');

  await store.remove('habits', habit.id);
  assert.equal((await store.list('habits')).length, 0, 'hidden after delete');
  assert.equal((await store.list('habits', { includeDeleted: true })).length, 1, 'still restorable');
  await store.restore('habits', habit.id);
  assert.equal((await store.list('habits')).length, 1);
});

test('validation: required columns and unknown columns are refused', async () => {
  const store = await makeStore();
  await assert.rejects(store.insert('goals', { title: 'No rank' }), StoreError);
  await assert.rejects(store.insert('goals', { title: 'x', rank: 'a0', status: 'active', progress_mode: 'manual', started_on: '2026-11-01', bogus: 1 }), StoreError);
});

test('every write is queued for sync; unchanged updates are not', async () => {
  const store = await makeStore();
  const goal = await store.insert('goals', { title: 'Run 10k', rank: 'a0', status: 'active', progress_mode: 'manual', started_on: '2026-11-01' });
  await store.update('goals', goal.id, { title: 'Run 10k' });
  await store.update('goals', goal.id, { deadline: '2027-04-01' });
  await store.remove('goals', goal.id);
  const outbox = await store.db.all<{ op: string; patch: string }>('SELECT op, patch FROM _outbox ORDER BY seq');
  assert.deepEqual(outbox.map((o) => o.op), ['upsert', 'upsert', 'delete']);
  assert.deepEqual(JSON.parse(outbox[1]!.patch), { deadline: '2027-04-01' });
  assert.equal(await store.pendingCount(), 1);
});

test('transactions are atomic and notify once', async () => {
  const store = await makeStore();
  let notifications = 0;
  store.subscribe(['goals', 'milestones'], () => notifications++);
  await assert.rejects(
    store.write(async (tx) => {
      await tx.insert('goals', { title: 'A', rank: 'a0', status: 'active', progress_mode: 'manual', started_on: '2026-11-01' });
      throw new Error('boom');
    }),
  );
  assert.equal((await store.list('goals')).length, 0, 'rolled back');
  assert.equal(await store.pendingCount(), 0, 'outbox rolled back too');
  await store.write(async (tx) => {
    const g = await tx.insert('goals', { title: 'A', rank: 'a0', status: 'active', progress_mode: 'manual', started_on: '2026-11-01' });
    await tx.insert('milestones', { goal_id: g.id, title: 'M', status: 'open', rank: 'a0' });
  });
  assert.equal(notifications, 1);
});

test('outbox compaction keeps first-write order and merges patches', () => {
  const entries = [
    { seq: 1, tbl: 'goals', row_id: 'g', op: 'upsert' as const, patch: '{"title":"A","rank":"a0"}', meta: '{}', attempts: 0 },
    { seq: 2, tbl: 'tasks', row_id: 't', op: 'upsert' as const, patch: '{"title":"T","goal_id":"g"}', meta: '{}', attempts: 0 },
    { seq: 3, tbl: 'goals', row_id: 'g', op: 'upsert' as const, patch: '{"title":"B"}', meta: '{}', attempts: 0 },
    { seq: 4, tbl: 'tasks', row_id: 't', op: 'upsert' as const, patch: '{"status":"planned"}', meta: '{"reopen":true}', attempts: 0 },
    { seq: 5, tbl: 'tasks', row_id: 'x', op: 'upsert' as const, patch: '{"title":"X"}', meta: '{}', attempts: 0 },
    { seq: 6, tbl: 'tasks', row_id: 'x', op: 'delete' as const, patch: '{}', meta: '{}', attempts: 0 },
  ];
  const out = compact(entries);
  assert.deepEqual(out.map((c) => `${c.change.table}:${c.change.id}`), ['goals:g', 'tasks:t', 'tasks:x']);
  assert.deepEqual(out[0]!.change.patch, { title: 'B', rank: 'a0' });
  assert.deepEqual(out[1]!.change.meta, { reopen: true });
  assert.equal(out[2]!.change.op, 'delete');
});
