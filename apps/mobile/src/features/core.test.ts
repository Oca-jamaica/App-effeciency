/**
 * Acceptance criteria 1–11 exercised end-to-end at the data layer: real SQLite, real repositories,
 * real scheduler. (Screens call exactly these functions.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localToUtc, utcToLocalMinutes } from '@ascend/domain';
import { openMemoryDb } from '../data/nodeDriver.ts';
import { migrateLocalSchema } from '../data/localSchema.ts';
import { Store } from '../data/store.ts';
import type { Goal, ScheduleBlock, Task } from '../data/types.ts';
import { ValidationError } from '../data/validation.ts';
import {
  addMilestone, addResource, computeProgress, createGoal, listGoals, loadGoalDetail, moveGoal, saveNote,
  setGoalStatus, setMilestoneDone, updateGoal, recordProgress,
} from './goals/repo.ts';
import { completeTask, createTask, listTasks, reopenTask, splitTask, taskHistory, updateTask } from './tasks/repo.ts';
import { createHabit, habitStats, habitsForDay, setHabitLog } from './habits/repo.ts';
import { createEvent, deleteEvent, occurrencesInRange } from './planner/events.ts';
import {
  blocksForDay, markMissedBlocks, missedOptions, moveBlock, replanDay, rescheduleMissedToDay, rescheduleMissedToSlot, setBlockLocked,
} from './planner/schedule.ts';
import { addAvailability } from './settings/repo.ts';
import { saveCapture } from './capture/repo.ts';

const TZ = 'Europe/London';
const TODAY = '2026-11-17'; // Tuesday
const at = (h: number, m = 0, date = TODAY) => localToUtc(date, h * 60 + m, TZ);

async function setup() {
  const db = openMemoryDb();
  await migrateLocalSchema(db);
  let clock = at(6);
  const store = new Store({ db, userId: randomUUID(), newId: randomUUID, now: () => new Date(clock) });
  // What the server provisions at sign-up and sync delivers.
  await store.insert('profiles', { timezone: TZ, week_starts_on: 1 });
  await store.insert('user_preferences', {
    theme: 'system', day_start: '07:00', day_end: '22:30', default_task_minutes: 30, max_focus_minutes_per_day: 360,
    max_block_minutes: 90, break_after_minutes: 90, break_minutes: 15, buffer_minutes: 10, min_free_minutes_per_day: 120,
    schedule_inbox_with_deadline: true, ai_enabled: false, ai_auto_apply_low_risk: false, ai_daily_briefing: true,
    ai_access_journal: false, ai_access_decisions: false, ai_access_notes: true, ai_access_memory: true, ai_access_sleep: false,
    max_notifications_per_day: 8, notify_block_start: false,
  });
  const academics = await store.insert('categories', { name: 'Academics', color: 'blue', icon: 'book', applies_to: [], is_default: true, rank: 'a0' });
  return { store, academicsId: academics.id, setClock: (ms: number) => (clock = ms) };
}

test('AC1–3: goals are created, edited, prioritised, and hold notes, milestones and video links', async () => {
  const { store } = await setup();
  const econ = await createGoal(store, { title: 'Improve Economics results', progress_mode: 'milestones', deadline: '2027-06-01' }, TODAY);
  const football = await createGoal(store, { title: 'Develop football ability' }, TODAY);
  const project = await createGoal(store, { title: 'Build a personal project' }, TODAY);
  await updateGoal(store, econ.id, { description: 'Target grade A' });
  assert.equal((await store.get<Goal>('goals', econ.id))!.description, 'Target grade A');

  // Drag "Build a personal project" to the top.
  const ordered = await listGoals(store);
  assert.deepEqual(ordered.map((g) => g.title), ['Improve Economics results', 'Develop football ability', 'Build a personal project']);
  await moveGoal(store, project.id, null, ordered[0]!.rank);
  assert.deepEqual((await listGoals(store)).map((g) => g.id), [project.id, econ.id, football.id]);

  await saveNote(store, { goal_id: econ.id, title: 'Strategy', body: 'Past papers every Sunday', note_type: 'strategy' });
  await addResource(store, econ.id, { title: 'Elasticity explained', url: 'youtube.com/watch?v=abc' });
  await assert.rejects(addResource(store, econ.id, { title: 'Bad', url: 'not a url' }), ValidationError);
  const m1 = await addMilestone(store, econ.id, { title: 'Unit 1 mastered', deadline: '2026-12-01' });
  await addMilestone(store, econ.id, { title: 'Unit 2 mastered' });

  let detail = (await loadGoalDetail(store, econ.id))!;
  assert.equal(detail.notes[0]!.note_type, 'strategy');
  assert.equal(detail.resources[0]!.url, 'https://youtube.com/watch?v=abc');
  assert.equal(detail.resources[0]!.kind, 'video', 'video link recognised');
  assert.equal(detail.progress.ratio, 0);

  // Completing a milestone updates goal progress and history.
  await setMilestoneDone(store, m1.id, true);
  detail = (await loadGoalDetail(store, econ.id))!;
  assert.equal(detail.progress.ratio, 0.5);
  assert.match(detail.history[0]!.note!, /Milestone completed/);

  await assert.rejects(createGoal(store, { title: '   ' }, TODAY), ValidationError);
  await setGoalStatus(store, football.id, 'archived');
  assert.equal((await listGoals(store)).length, 2);
});

test('goal progress modes: target values and manual percentages', async () => {
  const { store } = await setup();
  const run = await createGoal(store, { title: 'Run 10k under 50 min', progress_mode: 'target', target_value: 10, current_value: 4, target_unit: 'km' }, TODAY);
  assert.equal((await computeProgress(store, run)).ratio, 0);
  await recordProgress(store, run.id, 7, 'Long run');
  const g = (await store.get<Goal>('goals', run.id))!;
  assert.equal((await computeProgress(store, g)).ratio, 0.5);
  const manual = await createGoal(store, { title: 'Confidence', progress_mode: 'manual' }, TODAY);
  await recordProgress(store, manual.id, 40, null);
  assert.equal((await computeProgress(store, (await store.get<Goal>('goals', manual.id))!)).ratio, 0.4);
  await assert.rejects(recordProgress(store, manual.id, 140, null));
});

test('AC4–6: custom habits with custom frequencies; completion is logged and tracked', async () => {
  const { store } = await setup();
  const gym = await createHabit(store, { name: 'Gym', frequency_kind: 'weekdays', days_of_week: [1, 3, 5], start_date: '2026-11-01', duration_minutes: 60, preferred_window: 'evening' });
  const read = await createHabit(store, { name: 'Read', frequency_kind: 'times_per_week', times_per_period: 3, start_date: '2026-11-01', duration_minutes: 20 });
  await assert.rejects(createHabit(store, { name: 'Bad', frequency_kind: 'weekdays', days_of_week: [], start_date: TODAY }), ValidationError);

  let day = await habitsForDay(store, TODAY);
  assert.equal(day.find((h) => h.habit.id === gym.id)!.due, false, 'gym is Mon/Wed/Fri');
  assert.equal(day.find((h) => h.habit.id === read.id)!.due, true);

  await setHabitLog(store, read.id, TODAY, 'done');
  await setHabitLog(store, read.id, TODAY, null); // un-check
  await setHabitLog(store, read.id, TODAY, 'done'); // re-check revives the same row
  const logs = await store.list('habit_logs', { includeDeleted: true });
  assert.equal(logs.length, 1);
  day = await habitsForDay(store, TODAY);
  assert.equal(day.find((h) => h.habit.id === read.id)!.log!.status, 'done');
  const stats = await habitStats(store, read, TODAY);
  assert.equal(stats.total, 1);
});

test('AC7: tasks link to goals and milestones; history records changes; recurrence creates the next one', async () => {
  const { store } = await setup();
  const goal = await createGoal(store, { title: 'Economics' }, TODAY);
  const ms = await addMilestone(store, goal.id, { title: 'Unit 3' });
  const t = await createTask(store, { title: 'Past paper', milestone_id: ms.id, estimated_minutes: 60, due_date: '2026-11-20' });
  assert.equal(t.goal_id, goal.id, 'milestone implies goal');
  assert.equal(t.status, 'planned');
  const inbox = await createTask(store, { title: 'Look into summer course' });
  assert.equal(inbox.status, 'inbox');
  assert.deepEqual((await listTasks(store, 'inbox', TODAY)).map((x) => x.id), [inbox.id]);

  await updateTask(store, t.id, { due_date: '2026-11-22', estimated_minutes: 90 });
  const history = await taskHistory(store, t.id);
  assert.deepEqual(history.map((h) => h.event_type).sort(), ['created', 'due_changed', 'estimate_changed']);

  const weekly = await createTask(store, { title: 'Plan the week', recurrence_rule: 'FREQ=WEEKLY;BYDAY=SU', due_date: '2026-11-22' });
  const next = await completeTask(store, weekly.id, TODAY);
  assert.equal(next!.due_date, '2026-11-29');
  assert.equal(next!.recurrence_template_id, weekly.id);
  await reopenTask(store, weekly.id);
  assert.equal((await store.get<Task>('tasks', weekly.id))!.status, 'planned');
  const outbox = await store.db.all<{ meta: string }>("SELECT meta FROM _outbox WHERE tbl = 'tasks' AND row_id = ? ORDER BY seq DESC LIMIT 1", [weekly.id]);
  assert.deepEqual(JSON.parse(outbox[0]!.meta), { reopen: true }, 'server is told the reopen is deliberate');
});

test('AC8–9: the daily plan uses real tasks, habits and commitments, and never touches locked time', async () => {
  const { store, academicsId } = await setup();
  await addAvailability(store, { weekdays: [1, 2, 3, 4, 5], start_time: '16:00', end_time: '19:00', kind: 'study' });
  const goal = await createGoal(store, { title: 'Economics' }, TODAY);
  await createEvent(store, { title: 'School', date: TODAY, start_minutes: 8 * 60 + 30, end_minutes: 15 * 60 + 30, kind: 'class', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }, TZ);
  await createEvent(store, { title: 'Football training', date: TODAY, start_minutes: 19 * 60, end_minutes: 20 * 60 + 30, kind: 'training', is_locked: true }, TZ);
  const essay = await createTask(store, { title: 'Economics essay', goal_id: goal.id, category_id: academicsId, estimated_minutes: 90, splittable: true, due_date: '2026-11-18', priority: 2 });
  await createTask(store, { title: 'Email coach', estimated_minutes: 15, priority: 3 });
  const read = await createHabit(store, { name: 'Read', frequency_kind: 'daily', start_date: '2026-11-01', duration_minutes: 20, preferred_time: '21:30' });

  const plan = await replanDay(store, TODAY, at(6));
  const blocks = await blocksForDay(store, TODAY);
  assert.ok(blocks.length >= 3, 'blocks persisted');
  const school = [at(8, 20), at(15, 40)];
  const training = [at(18, 50), at(20, 40)];
  for (const b of blocks) {
    const s = Date.parse(b.starts_at);
    const e = Date.parse(b.ends_at);
    assert.ok(e <= school[0]! || s >= school[1]!, `${b.title} avoids school`);
    assert.ok(e <= training[0]! || s >= training[1]!, `${b.title} avoids locked training`);
  }
  const essayBlock = blocks.find((b) => b.task_id === essay.id)!;
  assert.equal(utcToLocalMinutes(Date.parse(essayBlock.starts_at), TZ), 16 * 60, 'academics go in study hours');
  assert.match(essayBlock.reason!, /Goal #1 Economics/);
  const readBlock = blocks.find((b) => b.habit_id === read.id)!;
  assert.equal(utcToLocalMinutes(Date.parse(readBlock.starts_at), TZ), 21 * 60 + 30);
  assert.equal(plan.unscheduled.length, 0);

  // Re-planning with nothing changed rewrites nothing (stable, deterministic ids).
  const outboxBefore = (await store.db.all('SELECT seq FROM _outbox')).length;
  await replanDay(store, TODAY, at(6));
  assert.equal((await store.db.all('SELECT seq FROM _outbox')).length, outboxBefore);

  // Deleting one occurrence of the recurring school event frees that day.
  const occ = await occurrencesInRange(store, TODAY, TODAY, TZ);
  await deleteEvent(store, occ.find((o) => o.event.title === 'School')!.event.id, TODAY);
  assert.equal((await occurrencesInRange(store, TODAY, TODAY, TZ)).filter((o) => o.event.title === 'School').length, 0);
  assert.equal((await occurrencesInRange(store, '2026-11-18', '2026-11-18', TZ)).filter((o) => o.event.title === 'School').length, 1);
});

test('AC10: manual overrides — moved and locked blocks survive re-planning', async () => {
  const { store } = await setup();
  const a = await createTask(store, { title: 'Deep work', estimated_minutes: 60, priority: 1 });
  await createTask(store, { title: 'Admin', estimated_minutes: 30, priority: 3 });
  await replanDay(store, TODAY, at(6));
  let blocks = await blocksForDay(store, TODAY);
  const deep = blocks.find((b) => b.task_id === a.id)!;
  await moveBlock(store, deep.id, at(14));
  await setBlockLocked(store, deep.id, true);
  await createTask(store, { title: 'Urgent thing', estimated_minutes: 60, priority: 1, due_date: TODAY });
  await replanDay(store, TODAY, at(6));
  blocks = await blocksForDay(store, TODAY);
  const moved = blocks.find((b) => b.id === deep.id)!;
  assert.equal(moved.starts_at, new Date(at(14)).toISOString());
  assert.equal(moved.origin, 'manual');
  assert.ok(moved.is_locked);
  for (const b of blocks) {
    if (b.id === deep.id) continue;
    const overlaps = Date.parse(b.starts_at) < at(15) && Date.parse(b.ends_at) > at(14);
    assert.ok(!overlaps, `${b.title} does not overlap the locked block`);
  }
});

test('AC11: unfinished work is marked missed and sensibly rescheduled — never deleted', async () => {
  const { store, setClock } = await setup();
  const t = await createTask(store, { title: 'Revise unit 2', estimated_minutes: 60, priority: 2 });
  await replanDay(store, TODAY, at(6));
  const first = (await blocksForDay(store, TODAY)).find((b) => b.task_id === t.id)!;
  // The day moves on; the block ended without being done.
  const later = Date.parse(first.ends_at) + 30 * 60_000;
  setClock(later);
  assert.equal(await markMissedBlocks(store, TODAY, later), 1);
  const missed = (await store.get<ScheduleBlock>('schedule_blocks', first.id))!;
  assert.equal(missed.status, 'missed');

  const options = await missedOptions(store, first.id, later);
  assert.ok(options.laterToday, 'a later slot today is offered');
  assert.ok(options.laterToday.start >= later);
  assert.ok(options.tomorrow, 'a slot tomorrow is offered');
  assert.equal(options.shortenTo, 30);

  await rescheduleMissedToSlot(store, first.id, options.laterToday);
  const blocks = await blocksForDay(store, TODAY);
  assert.ok(blocks.some((b) => b.task_id === t.id && b.status === 'planned' && b.origin === 'manual'));
  assert.equal((await store.get<Task>('tasks', t.id))!.status, 'planned', 'task untouched');
  assert.ok((await taskHistory(store, t.id)).some((e) => e.event_type === 'rescheduled'));

  // Alternatively: move to tomorrow, or split into smaller tasks.
  await rescheduleMissedToDay(store, first.id, '2026-11-18');
  assert.equal((await store.get<Task>('tasks', t.id))!.do_date, '2026-11-18');
  const parts = await splitTask(store, t.id, [{ title: 'Read notes', estimated_minutes: 25 }, { title: 'Practice questions', estimated_minutes: 35 }]);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => p.parent_task_id === t.id && p.goal_id === t.goal_id));
});

test('quick capture: natural language becomes the right item, linked by #tag', async () => {
  const { store } = await setup();
  await createGoal(store, { title: 'Improve Economics results' }, TODAY);
  const ctx = { today: TODAY, timeZone: TZ };
  const task = await saveCapture(store, 'Revise elasticity tomorrow 4pm 45m !p1 #economics', null, ctx);
  const saved = (await store.get<Task>('tasks', task.id))!;
  assert.equal(saved.title, 'Revise elasticity');
  assert.equal(saved.due_date, '2026-11-18');
  assert.equal(saved.due_time, '16:00');
  assert.equal(saved.estimated_minutes, 45);
  assert.equal(saved.priority, 1);
  assert.ok(saved.goal_id, 'linked to the Economics goal');
  const ev = await saveCapture(store, 'Dinner with Sam friday 7pm', 'event', ctx);
  assert.equal(ev.type, 'event');
  const idea = await saveCapture(store, 'idea: app for drills', null, ctx);
  assert.equal(idea.type, 'idea');
  const rem = await saveCapture(store, 'remind me to call coach at 6pm', null, ctx);
  assert.equal(rem.type, 'reminder');
});
