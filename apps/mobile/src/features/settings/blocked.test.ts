import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localToUtc } from '@ascend/domain';
import { openMemoryDb } from '../../data/nodeDriver.ts';
import { migrateLocalSchema } from '../../data/localSchema.ts';
import { Store } from '../../data/store.ts';
import type { AvailabilityWindowRow } from '../../data/types.ts';
import { ValidationError } from '../../data/validation.ts';
import { createTask } from '../tasks/repo.ts';
import { replanDay } from '../planner/schedule.ts';
import { addAvailability, blockedTimeOn, groupAvailability, listAvailability, replaceAvailability } from './repo.ts';

const TZ = 'Europe/London';
const MONDAY = '2026-11-30';
const SATURDAY = '2026-12-05';
const at = (date: string, h: number, m = 0) => localToUtc(date, h * 60 + m, TZ);

async function setup(now: number) {
  const db = openMemoryDb();
  await migrateLocalSchema(db);
  const store = new Store({ db, userId: randomUUID(), newId: randomUUID, now: () => new Date(now) });
  await store.insert('profiles', { timezone: TZ, week_starts_on: 1 });
  await store.insert('user_preferences', {
    theme: 'system', day_start: '06:00', day_end: '22:30', default_task_minutes: 30, max_focus_minutes_per_day: 600,
    max_block_minutes: 90, break_after_minutes: 90, break_minutes: 15, buffer_minutes: 10, min_free_minutes_per_day: 60,
    schedule_inbox_with_deadline: true, ai_enabled: false, ai_auto_apply_low_risk: false, ai_daily_briefing: true,
    ai_access_journal: false, ai_access_decisions: false, ai_access_notes: true, ai_access_memory: true, ai_access_sleep: false,
    max_notifications_per_day: 8, notify_block_start: false,
  });
  return store;
}

test('named blocked time (morning routine, school) is never planned over', async () => {
  const store = await setup(at(MONDAY, 6));
  await addAvailability(store, { kind: 'no_scheduling', label: 'Morning routine', weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: '06:00', end_time: '08:00' });
  await addAvailability(store, { kind: 'no_scheduling', label: 'School', weekdays: [1, 2, 3, 4, 5], start_time: '08:30', end_time: '15:30' });
  for (let i = 0; i < 6; i++) await createTask(store, { title: `Revision ${i + 1}`, status: 'planned', estimated_minutes: 60, due_date: MONDAY });
  const plan = await replanDay(store, MONDAY, at(MONDAY, 6));
  const placed = plan.blocks.filter((b) => b.kind === 'task');
  assert.ok(placed.length > 0, 'work is still planned around the blocked time');
  for (const b of placed) {
    assert.ok(b.end <= at(MONDAY, 6) || b.start >= at(MONDAY, 8), `${b.title} overlaps the morning routine`);
    assert.ok(b.end <= at(MONDAY, 8, 30) || b.start >= at(MONDAY, 15, 30), `${b.title} overlaps school`);
  }
  const shown = await blockedTimeOn(store, MONDAY, TZ);
  assert.deepEqual(shown.map((w) => [w.title, w.start, w.end]), [
    ['Morning routine', at(MONDAY, 6), at(MONDAY, 8)],
    ['School', at(MONDAY, 8, 30), at(MONDAY, 15, 30)],
  ]);
  assert.deepEqual((await blockedTimeOn(store, SATURDAY, TZ)).map((w) => w.title), ['Morning routine'], 'school is weekdays only');
});

test('blocked time is grouped as entered and can be edited in one step', async () => {
  const store = await setup(at(MONDAY, 6));
  await addAvailability(store, { kind: 'no_scheduling', label: ' School ', weekdays: [1, 2, 3, 4, 5], start_time: '08:30', end_time: '15:30' });
  await addAvailability(store, { kind: 'study', weekdays: [1, 3], start_time: '16:00', end_time: '18:00' });
  let groups = groupAvailability(await listAvailability(store));
  assert.deepEqual(groups.map((g) => [g.label, g.kind, g.days.length]), [['School', 'no_scheduling', 5], [null, 'study', 2]], 'blocked time first, names trimmed');
  await replaceAvailability(store, groups[0]!.ids, { kind: 'no_scheduling', label: 'School', weekdays: [1, 2, 3, 4], start_time: '08:40', end_time: '15:20' });
  groups = groupAvailability(await listAvailability(store));
  assert.deepEqual([groups[0]!.start, groups[0]!.end, groups[0]!.days.sort()], ['08:40', '15:20', [1, 2, 3, 4]]);
  assert.equal((await store.list<AvailabilityWindowRow>('availability_windows')).length, 6);
  await assert.rejects(replaceAvailability(store, [], { kind: 'no_scheduling', label: 'Too late', weekdays: [1], start_time: '18:00', end_time: '17:00' }), ValidationError);
  await assert.rejects(replaceAvailability(store, [], { kind: 'no_scheduling', label: 'x'.repeat(61), weekdays: [1], start_time: '08:00', end_time: '09:00' }), ValidationError);
});
