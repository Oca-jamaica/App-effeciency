import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openMemoryDb } from '../../data/nodeDriver.ts';
import { migrateLocalSchema } from '../../data/localSchema.ts';
import { Store } from '../../data/store.ts';
import type { Goal, Milestone } from '../../data/types.ts';
import { ValidationError } from '../../data/validation.ts';
import { createGoal } from './repo.ts';

async function setup() {
  const db = openMemoryDb();
  await migrateLocalSchema(db);
  return new Store({ db, userId: randomUUID(), newId: randomUUID });
}

test('a new goal can be created with its milestones, in order, in one step', async () => {
  const store = await setup();
  const g = await createGoal(store, { title: 'Run a half marathon', deadline: '2027-04-01' }, '2026-11-28', [
    { title: 'Run 5 km without stopping', deadline: '2026-12-20' },
    { title: '', deadline: null },
    { title: '  Run 10 km  ', deadline: '2027-02-01' },
    { title: 'Race-pace long run' },
  ]);
  const ms = await store.list<Milestone>('milestones', { where: 'goal_id = ?', params: [g.id], orderBy: 'rank COLLATE BINARY' });
  assert.deepEqual(ms.map((m) => [m.title, m.deadline, m.status]), [
    ['Run 5 km without stopping', '2026-12-20', 'open'],
    ['Run 10 km', '2027-02-01', 'open'],
    ['Race-pace long run', null, 'open'],
  ], 'blank rows are ignored, order is kept');
});

test('invalid milestones stop the goal from being created at all', async () => {
  const store = await setup();
  await assert.rejects(
    createGoal(store, { title: 'Grade 7 in Maths', deadline: '2027-01-10' }, '2026-11-28', [{ title: 'Mock exam', deadline: '2027-03-01' }]),
    (e) => e instanceof ValidationError && /after the goal’s deadline/.test(e.fields.milestones ?? ''),
  );
  await assert.rejects(
    createGoal(store, { title: 'Grade 7 in Maths' }, '2026-11-28', [{ title: '', deadline: '2027-01-01' }]),
    (e) => e instanceof ValidationError && /Milestone 1/.test(e.fields.milestones ?? ''),
  );
  assert.equal((await store.list<Goal>('goals')).length, 0);
  assert.equal((await store.list<Milestone>('milestones')).length, 0);
});
