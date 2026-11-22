/** Stage 4 acceptance criteria (12–14, 16) and the personal-development modules, on a real SQLite store. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localToUtc } from '@ascend/domain';
import { openMemoryDb } from '../data/nodeDriver.ts';
import { migrateLocalSchema } from '../data/localSchema.ts';
import { Store } from '../data/store.ts';
import type { FocusSession, Milestone, ScheduleBlock, StudyVideo, Task } from '../data/types.ts';
import { ValidationError } from '../data/validation.ts';
import { createGoal } from './goals/repo.ts';
import { createTask } from './tasks/repo.ts';
import { discardFocus, focusMinutesSince, getTimer, listSessions, logManualSession, pauseFocus, resumeFocus, startFocus, stopFocus } from './focus/repo.ts';
import { createVideoRecord, listVideos, markUploadFailed, markUploaded, resolveMime, storagePathFor, validateVideo } from './focus/videos.ts';
import { addProjectMilestone, addStage, createProject, loadProjectDetail, setProjectMilestoneDone, setProjectStatus, setStageDone } from './projects/repo.ts';
import { addSet, addStarterExercises, createSkill, createSport, exerciseHistory, finishWorkout, listExercises, loadWorkout, logTraining, setSkillLevel, skillHistory, startWorkout } from './training/repo.ts';
import { collectionDef, listRecords, saveRecord } from './collections/defs.ts';
import { blocksForDay, buildPlanInput, replanDay } from './planner/schedule.ts';

const TZ = 'Europe/London';
const TODAY = '2026-11-22';

async function setup() {
  const db = openMemoryDb();
  await migrateLocalSchema(db);
  let clock = localToUtc(TODAY, 9 * 60, TZ);
  const store = new Store({ db, userId: randomUUID(), newId: randomUUID, now: () => new Date(clock) });
  await store.insert('profiles', { timezone: TZ, week_starts_on: 1 });
  return { store, tick: (minutes: number) => (clock += minutes * 60_000), now: () => clock };
}

test('AC14: the focus timer records sessions, excludes pauses, and survives a restart', async () => {
  const { store, tick } = await setup();
  const goal = await createGoal(store, { title: 'Economics' }, TODAY);
  const task = await createTask(store, { title: 'Revise unit 2', goal_id: goal.id, estimated_minutes: 60 });
  await startFocus(store, 'study', 25, { taskId: task.id });
  await assert.rejects(startFocus(store, 'focus', 25), /already running/);
  assert.equal((await store.get<Task>('tasks', task.id))!.status, 'in_progress', 'starting work marks the task in progress');
  tick(10);
  await pauseFocus(store);
  tick(5);
  // Simulate the app being closed and reopened: state comes back from the device database.
  const restored = await getTimer(store);
  assert.ok(restored && restored.pausedAt !== null);
  await resumeFocus(store);
  tick(15);
  const session = (await stopFocus(store, { quality: 4, notes: 'Good focus' }))!;
  assert.equal(session.status, 'completed');
  assert.equal(session.duration_seconds, 25 * 60);
  assert.equal(session.pause_seconds, 5 * 60);
  assert.equal(session.goal_id, goal.id, 'linked to the task’s goal automatically');
  assert.equal(await getTimer(store), null);
  assert.equal((await focusMinutesSince(store, `${TODAY}T00:00:00Z`)).study, 25);
});

test('AC13: study sessions link to tasks and goals, by timer or logged afterwards', async () => {
  const { store } = await setup();
  const goal = await createGoal(store, { title: 'Economics' }, TODAY);
  const task = await createTask(store, { title: 'Past paper', goal_id: goal.id });
  const s = await logManualSession(store, { kind: 'study', date: '2026-11-21', startMinutes: 16 * 60, minutes: 50, taskId: task.id, notes: 'Library' }, TZ);
  assert.equal(s.source, 'manual');
  assert.equal(s.goal_id, goal.id);
  assert.equal((await listSessions(store, { goalId: goal.id })).length, 1);
  assert.equal((await listSessions(store, { taskId: task.id, kind: 'study' })).length, 1);
  await assert.rejects(logManualSession(store, { kind: 'study', date: '2026-11-30', startMinutes: 600, minutes: 30 }, TZ), /future/);
  // Short accidental sessions are discarded, not kept as clutter.
  await startFocus(store, 'focus', null);
  await discardFocus(store);
  assert.equal((await store.list<FocusSession>('focus_sessions')).length, 1);
  // Finishing within a minute (a mis-tap) records nothing and leaves any linked plan block alone.
  await startFocus(store, 'focus', 25, { taskId: task.id });
  assert.equal(await stopFocus(store), null);
  assert.equal((await store.list<FocusSession>('focus_sessions')).length, 1);
  assert.equal(await getTimer(store), null);
});

test('the scheduler counts recorded focus time against a task’s estimate', async () => {
  const { store, now } = await setup();
  const task = await createTask(store, { title: 'Essay', estimated_minutes: 90, splittable: true });
  await logManualSession(store, { kind: 'study', date: TODAY, startMinutes: 7 * 60, minutes: 60, taskId: task.id }, TZ);
  const input = await buildPlanInput(store, TODAY, now());
  assert.equal(input.tasks.find((t) => t.id === task.id)!.recordedMinutes, 60);
  await replanDay(store, TODAY, now());
  const minutes = (await blocksForDay(store, TODAY)).filter((b: ScheduleBlock) => b.task_id === task.id).reduce((m, b) => m + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000, 0);
  assert.equal(minutes, 30, 'only the remaining 30 minutes are planned');
});

test('AC12: timelapse videos are validated, stored privately per user, and tracked through upload', async () => {
  const { store } = await setup();
  const ok = { uri: 'file:///v/clip.mov', sizeBytes: 80 * 1024 * 1024, mimeType: null, durationSeconds: 95.4, fileName: 'clip.mov' };
  assert.equal(resolveMime(ok), 'video/quicktime');
  assert.equal(validateVideo(ok), null);
  assert.match(validateVideo({ ...ok, sizeBytes: 900 * 1024 * 1024 })!, /limit is 500 MB/);
  assert.match(validateVideo({ ...ok, mimeType: 'video/webm', fileName: 'x.webm', uri: 'x.webm' })!, /MP4 and MOV/);
  assert.match(validateVideo({ ...ok, sizeBytes: null })!, /size couldn’t be read/);
  const goal = await createGoal(store, { title: 'Economics' }, TODAY);
  const v = await createVideoRecord(store, ok, { recordedOn: TODAY, sessionMinutes: 120, notes: 'Two hours on unit 3', goalId: goal.id });
  assert.equal(v.storage_path, storagePathFor(store.userId, v.id, 'video/quicktime'));
  assert.ok(v.storage_path.startsWith(`${store.userId}/`), 'inside the owner’s private folder');
  assert.equal(v.upload_status, 'uploading');
  await markUploadFailed(store, v.id, 'Network lost');
  assert.equal((await store.get<StudyVideo>('study_videos', v.id))!.upload_status, 'failed');
  await markUploaded(store, v.id);
  const [listed] = await listVideos(store, { goalId: goal.id });
  assert.equal(listed!.upload_status, 'ready');
  assert.equal(listed!.duration_seconds, 95);
  await assert.rejects(createVideoRecord(store, { ...ok, sizeBytes: 0 }, { recordedOn: TODAY, sessionMinutes: null, notes: null }));
});

test('AC16: projects and missions with stages, milestones, tasks and a completion summary', async () => {
  const { store } = await setup();
  await assert.rejects(createProject(store, { kind: 'mission', title: 'Make the first team' }), ValidationError, 'missions need an objective and deadline');
  const mission = await createProject(store, { kind: 'mission', title: 'Make the first team', objective: 'Selected by March', deadline: '2027-03-01' });
  const pre = await addStage(store, mission.id, 'Pre-season');
  await addStage(store, mission.id, 'Trials');
  const m1 = await addProjectMilestone(store, mission.id, { title: 'Pass the fitness test', stageId: pre.id });
  await addProjectMilestone(store, mission.id, { title: 'Play 3 friendlies' });
  await createTask(store, { title: 'Book physio check', project_id: mission.id });
  let d = (await loadProjectDetail(store, mission.id))!;
  assert.equal(d.progress.ratio, 0);
  await setProjectMilestoneDone(store, m1.id, true);
  await setStageDone(store, pre.id, true);
  d = (await loadProjectDetail(store, mission.id))!;
  assert.equal(d.progress.ratio, 0.5);
  assert.equal(d.progress.stagesDone, 1);
  assert.equal(d.tasks.length, 1);
  assert.equal((await store.get<Milestone>('milestones', m1.id))!.goal_id, null);
  await setProjectStatus(store, mission.id, 'completed', 'Selected for the squad after trials.');
  d = (await loadProjectDetail(store, mission.id))!;
  assert.equal(d.project.status, 'completed');
  assert.equal(d.project.completion_summary, 'Selected for the squad after trials.');
});

test('workouts: custom exercises, sets, and personal records', async () => {
  const { store, tick } = await setup();
  assert.equal(await addStarterExercises(store), 10);
  assert.equal(await addStarterExercises(store), 0, 'never duplicates');
  const squat = (await listExercises(store)).find((e) => e.name === 'Back squat')!;
  const w1 = await startWorkout(store, null, 'Legs');
  await addSet(store, w1.id, squat.id, { reps: 10, weight: 60, isWarmup: true });
  await addSet(store, w1.id, squat.id, { reps: 5, weight: 100 });
  await finishWorkout(store, w1.id, 7, null);
  tick(60 * 24 * 3);
  const w2 = await startWorkout(store, null, 'Legs');
  const { records } = await addSet(store, w2.id, squat.id, { reps: 3, weight: 110 });
  assert.deepEqual(records, ['heaviest', 'one_rep_max'], 'a new PR is reported straight away');
  await assert.rejects(addSet(store, w2.id, squat.id, { reps: null, weight: 100 }), ValidationError);
  const detail = (await loadWorkout(store, w2.id))!;
  assert.equal(detail.groups[0]!.sets.length, 1);
  const history = await exerciseHistory(store, squat.id);
  assert.equal(history.records.heaviest?.weight, 110);
  assert.equal(history.sessions.length, 2);
});

test('athletic development: training sessions develop skills over time', async () => {
  const { store } = await setup();
  const football = await createSport(store, 'Football', 'Winger');
  assert.equal((await createSport(store, 'football')).id, football.id, 'same sport is reused');
  const weakFoot = await createSkill(store, { name: 'Weak foot', level: 4, targetLevel: 8 });
  await setSkillLevel(store, weakFoot.id, 5, 'Can pass reliably');
  await logTraining(store, { sport_id: football.id, session_type: 'technical', started_at: new Date().toISOString(), duration_minutes: 60, performance_rating: 7 }, [
    { skillId: weakFoot.id, minutes: 20, rating: 6 },
  ]);
  const history = await skillHistory(store, weakFoot.id);
  assert.deepEqual(history.map((h) => [h.kind, h.value]), [['level', 5], ['training', 6]]);
  await assert.rejects(logTraining(store, { sport_id: football.id, started_at: new Date().toISOString(), duration_minutes: 0 }), ValidationError);
});

test('journal, decisions, learning, people, sleep and workspace records', async () => {
  const { store } = await setup();
  const journal = collectionDef('journal');
  await assert.rejects(saveRecord(store, journal, null, { entry_date: TODAY }, TODAY), ValidationError, 'an empty entry is refused');
  const id = await saveRecord(store, journal, null, { entry_date: TODAY, went_well: 'Scored in training' }, TODAY);
  const again = await saveRecord(store, journal, null, { entry_date: TODAY, learned: 'Sleep helps' }, TODAY);
  assert.equal(again, id, 'one entry per day');
  assert.equal((await listRecords(store, journal, { search: 'scored' })).length, 1, 'searchable');

  const learning = collectionDef('learning');
  await assert.rejects(saveRecord(store, learning, null, { title: 'Book', progress_unit: 'pages', progress_current: 500, progress_total: 300 }, TODAY), ValidationError);
  const lid = await saveRecord(store, learning, null, { title: 'Inverted Pyramid', kind: 'book', status: 'completed', progress_unit: 'pages', progress_current: 400, progress_total: 400 }, TODAY);
  const item = await store.get('learning_items', lid);
  assert.equal(item!.completed_on, TODAY);

  const people = collectionDef('people');
  await assert.rejects(saveRecord(store, people, null, { name: 'Sam', birthday_month: '2', birthday_day: 31 }, TODAY), ValidationError);
  await saveRecord(store, people, null, { name: 'Sam', birthday_month: '3', birthday_day: 14 }, TODAY);

  const sleep = collectionDef('sleep');
  const sid = await saveRecord(store, sleep, null, { sleep_date: TODAY, bed_at: '23:30', wake_at: '07:15', energy: 4 }, TODAY);
  assert.equal((await store.get('sleep_logs', sid))!.duration_minutes, 465);

  const decisions = collectionDef('decisions');
  await saveRecord(store, decisions, null, { title: 'Join the academy', review_on: '2026-11-01' }, TODAY);
  assert.equal((await listRecords(store, decisions, { filter: decisions.filters![0]!.where, today: TODAY })).length, 1, 'due for review');

  const notes = collectionDef('notes');
  await saveRecord(store, notes, null, { title: 'Project research', body: 'Competitors…', folder: 'Research', tags: ['app'] }, TODAY);
  assert.equal((await listRecords(store, notes)).length, 1);
  await assert.rejects(saveRecord(store, collectionDef('vault'), null, { title: 'Bad link', url: 'not a link' }, TODAY), ValidationError);
});
