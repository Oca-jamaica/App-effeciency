/**
 * Two simulated phones (separate SQLite databases) syncing through the real Postgres sync functions.
 * Run via `npm run db:test` (needs TEST_DATABASE_URL); skipped otherwise.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { asUser, connect, createUser, push } from '../../../../../supabase/tests/support/db.ts';
import { openMemoryDb } from '../nodeDriver.ts';
import { migrateLocalSchema } from '../localSchema.ts';
import { Store } from '../store.ts';
import { SyncEngine, TransientSyncError, type Cursor, type PullResponse, type PushChange, type PushResult, type SyncTransport } from './engine.ts';

const enabled = Boolean(process.env.TEST_DATABASE_URL);
let client: pg.Client;

class PgTransport implements SyncTransport {
  online = true;
  private readonly userId: string;
  constructor(userId: string) {
    this.userId = userId;
  }
  async push(changes: PushChange[]): Promise<PushResult[]> {
    if (!this.online) throw new TransientSyncError('offline');
    return (await asUser(client, this.userId, (q) => push(q, changes))) as PushResult[];
  }
  async pull(cursors: Record<string, Cursor>, maxRows: number): Promise<PullResponse> {
    if (!this.online) throw new TransientSyncError('offline');
    const r = await asUser(client, this.userId, (q) =>
      q('select public.sync_pull($1::jsonb, $2) as r', [JSON.stringify(cursors), maxRows]),
    );
    return r.rows[0].r as PullResponse;
  }
}

async function device(userId: string, pageSize = 500) {
  const db = openMemoryDb();
  await migrateLocalSchema(db);
  const store = new Store({ db, userId, newId: randomUUID });
  const transport = new PgTransport(userId);
  const engine = new SyncEngine(store, transport, { pageSize });
  return { store, transport, engine };
}

const goalValues = (title: string) => ({ title, rank: 'a0', status: 'active', progress_mode: 'milestones', started_on: '2026-11-01' });
const taskValues = (title: string, extra: Record<string, unknown> = {}) => ({
  title, rank: 'a0', status: 'planned', priority: 3, splittable: false, min_chunk_minutes: 25, preferred_window: 'any', ...extra,
});

before(async () => {
  if (enabled) client = await connect();
});
after(async () => {
  if (enabled) await client.end();
});

test('offline work is kept, pushed on reconnect, and reaches the second device', { skip: !enabled }, async () => {
  const user = await createUser(client);
  const a = await device(user);
  const b = await device(user);
  a.transport.online = false;
  const goal = await a.store.insert('goals', goalValues('Improve Economics results'));
  await a.store.insert('tasks', taskValues('Past paper 2023', { goal_id: goal.id, due_date: '2026-11-20' }));
  await a.engine.sync();
  assert.equal(a.engine.getStatus().phase, 'offline');
  assert.equal(a.engine.getStatus().pending, 2);

  a.transport.online = true;
  await a.engine.sync();
  assert.equal(a.engine.getStatus().phase, 'idle');
  assert.equal(a.engine.getStatus().pending, 0);

  await b.engine.sync();
  const tasks = await b.store.list('tasks');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]!.goal_id, goal.id);
  assert.equal(tasks[0]!.due_date, '2026-11-20');
  assert.equal((await b.store.list('categories')).length, 8, 'default categories arrived too');
  assert.equal((await b.store.list('user_preferences'))[0]!.day_start, '07:00', 'time normalised');
});

test('concurrent offline edits to different fields both survive; same field converges on the last push', { skip: !enabled }, async () => {
  const user = await createUser(client);
  const a = await device(user);
  const b = await device(user);
  const task = await a.store.insert('tasks', taskValues('Essay'));
  await a.engine.sync();
  await b.engine.sync();

  a.transport.online = false;
  b.transport.online = false;
  await a.store.update('tasks', task.id, { title: 'Essay: globalisation', priority: 1 });
  await b.store.update('tasks', task.id, { due_date: '2026-11-25', priority: 4 });
  a.transport.online = true;
  b.transport.online = true;
  await a.engine.sync();
  await b.engine.sync();
  await a.engine.sync();

  for (const d of [a, b]) {
    const t = (await d.store.get('tasks', task.id))!;
    assert.equal(t.title, 'Essay: globalisation');
    assert.equal(t.due_date, '2026-11-25');
    assert.equal(t.priority, 4, 'last push wins for the same field');
  }
});

test('delete wins over a concurrent edit, and stays restorable', { skip: !enabled }, async () => {
  const user = await createUser(client);
  const a = await device(user);
  const b = await device(user);
  const goal = await a.store.insert('goals', goalValues('Old goal'));
  await a.engine.sync();
  await b.engine.sync();
  await a.store.remove('goals', goal.id);
  await b.store.update('goals', goal.id, { title: 'Old goal (renamed)' });
  await a.engine.sync();
  await b.engine.sync();
  await a.engine.sync();
  for (const d of [a, b]) {
    assert.equal((await d.store.list('goals')).length, 0);
    const g = (await d.store.get('goals', goal.id))!;
    assert.ok(g.deleted_at);
    assert.equal(g.title, 'Old goal (renamed)', 'the edit is not lost if restored');
  }
  await b.store.restore('goals', goal.id);
  await b.engine.sync();
  await a.engine.sync();
  assert.equal((await a.store.list('goals')).length, 1);
});

test('a stale device cannot un-complete a task; the user is told', { skip: !enabled }, async () => {
  const user = await createUser(client);
  const a = await device(user);
  const b = await device(user);
  const task = await a.store.insert('tasks', taskValues('Finish milestone'));
  await a.engine.sync();
  await b.engine.sync();
  await a.store.update('tasks', task.id, { status: 'completed', completed_at: new Date().toISOString() });
  await b.store.update('tasks', task.id, { status: 'in_progress', title: 'Finish milestone 1' });
  await a.engine.sync();
  await b.engine.sync();
  const onB = (await b.store.get('tasks', task.id))!;
  assert.equal(onB.status, 'completed');
  assert.equal(onB.title, 'Finish milestone 1');
  assert.equal(b.engine.getStatus().conflicts, 1);
});

test('both devices logging the same habit day end up with one log', { skip: !enabled }, async () => {
  const user = await createUser(client);
  const a = await device(user);
  const b = await device(user);
  const habit = await a.store.insert('habits', {
    name: 'Read', frequency_kind: 'daily', start_date: '2026-11-01', preferred_window: 'any', status: 'active', reminder_times: [], rank: 'a0',
  });
  await a.engine.sync();
  await b.engine.sync();
  await a.store.insert('habit_logs', { habit_id: habit.id, log_date: '2026-11-17', status: 'done', logged_at: new Date().toISOString() });
  await b.store.insert('habit_logs', { habit_id: habit.id, log_date: '2026-11-17', status: 'done', logged_at: new Date().toISOString() });
  await a.engine.sync();
  await b.engine.sync();
  await a.engine.sync();
  const la = await a.store.list('habit_logs');
  const lb = await b.store.list('habit_logs');
  assert.equal(la.length, 1);
  assert.equal(lb.length, 1);
  assert.equal(la[0]!.id, lb[0]!.id);
});

test('initial sync of many rows pages through everything', { skip: !enabled }, async () => {
  const user = await createUser(client);
  const a = await device(user);
  await a.store.write(async (tx) => {
    for (let i = 0; i < 40; i++) await tx.insert('tasks', taskValues(`Task ${i}`, { rank: `a${i}` }));
  });
  await a.engine.sync();
  const b = await device(user, 7);
  await b.engine.sync();
  assert.equal((await b.store.list('tasks')).length, 40);
});
