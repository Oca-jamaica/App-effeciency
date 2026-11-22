import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localToUtc } from '@ascend/domain';
import { openMemoryDb } from '../../data/nodeDriver.ts';
import { migrateLocalSchema } from '../../data/localSchema.ts';
import { Store } from '../../data/store.ts';
import { createHabit, setHabitLog } from '../habits/repo.ts';
import { planNotifications } from './plan.ts';

const TZ = 'Europe/London';
const TODAY = '2026-11-23'; // Monday

async function setup() {
  const db = openMemoryDb();
  await migrateLocalSchema(db);
  const now = localToUtc(TODAY, 8 * 60, TZ);
  const store = new Store({ db, userId: randomUUID(), newId: randomUUID, now: () => new Date(now) });
  await store.insert('user_preferences', {
    theme: 'system', day_start: '07:00', day_end: '22:30', default_task_minutes: 30, max_focus_minutes_per_day: 360, max_block_minutes: 90,
    break_after_minutes: 90, break_minutes: 15, buffer_minutes: 10, min_free_minutes_per_day: 120, schedule_inbox_with_deadline: true, ai_enabled: false,
    ai_auto_apply_low_risk: false, ai_daily_briefing: true, ai_access_journal: false, ai_access_decisions: false, ai_access_notes: true, ai_access_memory: true,
    ai_access_sleep: false, quiet_hours_start: '22:00', quiet_hours_end: '07:00', max_notifications_per_day: 2, notify_block_start: false,
  });
  return { store, now };
}

test('habit reminders only on due days, not once done, and never in quiet hours', async () => {
  const { store, now } = await setup();
  const gym = await createHabit(store, { name: 'Gym', frequency_kind: 'weekdays', days_of_week: [1, 3, 5], start_date: '2026-11-01', reminder_times: ['17:30'] });
  await createHabit(store, { name: 'Late read', frequency_kind: 'daily', start_date: '2026-11-01', reminder_times: ['23:00'] });
  let plan = await planNotifications(store, now, TZ);
  const gymDays = plan.filter((p) => p.title === 'Gym').map((p) => new Date(p.at).toISOString().slice(0, 10));
  assert.deepEqual(gymDays, ['2026-11-23', '2026-11-25', '2026-11-27']);
  assert.equal(plan.filter((p) => p.title === 'Late read').length, 0, '23:00 falls in quiet hours');
  await setHabitLog(store, gym.id, TODAY, 'done');
  plan = await planNotifications(store, now, TZ);
  assert.ok(!plan.some((p) => p.title === 'Gym' && new Date(p.at).toISOString().startsWith(TODAY)), 'no nagging once done');
});

test('explicit reminders always fire; other notifications respect the daily cap', async () => {
  const { store, now } = await setup();
  for (const n of ['A', 'B', 'C']) await createHabit(store, { name: n, frequency_kind: 'daily', start_date: '2026-11-01', reminder_times: ['12:00'] });
  await store.insert('reminders', { title: 'Call the dentist', remind_at: new Date(localToUtc(TODAY, 23 * 60 + 15, TZ)).toISOString() });
  const plan = await planNotifications(store, now, TZ);
  const today = plan.filter((p) => new Date(p.at).toISOString().startsWith(TODAY) || p.title === 'Call the dentist');
  assert.ok(today.some((p) => p.title === 'Call the dentist'), 'a reminder you set is kept even in quiet hours');
  assert.equal(plan.filter((p) => p.kind === 'habit' && new Date(p.at).toISOString().startsWith(TODAY)).length, 1, 'cap of 2 per day, the reminder uses one');
  assert.ok(plan.length <= 60);
});

test('focus timer end is scheduled while running, not while paused', async () => {
  const { store, now } = await setup();
  const running = { sessionId: 's', startedAt: now - 10 * 60_000, pausedAt: null, pausedMs: 0, plannedMinutes: 25 };
  const plan = await planNotifications(store, now, TZ, running);
  assert.equal(plan.find((p) => p.kind === 'focus')?.at, now + 15 * 60_000);
  assert.equal((await planNotifications(store, now, TZ, { ...running, pausedAt: now })).filter((p) => p.kind === 'focus').length, 0);
});
