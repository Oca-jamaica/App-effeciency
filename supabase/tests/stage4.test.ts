import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { asUser, connect, createUser, expectError, push, randomUUID } from './support/db.ts';

let client: pg.Client;
let alice: string;
let bob: string;
const ids: Record<string, string> = {};

/** One valid row for every Stage 4 table, created by Alice through the sync API. */
function stage4Changes(owner: string) {
  for (const t of [
    'goals', 'projects', 'project_stages', 'milestones', 'skills', 'skill_progress_entries', 'learning_items', 'tasks', 'focus_sessions',
    'study_videos', 'exercises', 'workout_plans', 'workout_plan_items', 'workout_sessions', 'workout_sets', 'sports', 'training_sessions',
    'training_session_skills', 'people', 'experiences', 'journal_entries', 'decisions', 'ideas', 'sleep_logs',
  ]) ids[t] = randomUUID();
  const now = new Date().toISOString();
  const rows: [string, Record<string, unknown>][] = [
    ['goals', { title: 'Football', rank: 'a0' }],
    ['projects', { kind: 'mission', title: 'Make the first team', objective: 'Selected by March', status: 'active', rank: 'a0', goal_id: ids.goals }],
    ['project_stages', { project_id: ids.projects, title: 'Pre-season', status: 'open', rank: 'a0' }],
    ['milestones', { project_id: ids.projects, stage_id: ids.project_stages, title: 'Pass fitness test', status: 'open', rank: 'a0' }],
    ['skills', { name: 'Weak foot', level: 4, target_level: 8, rank: 'a0', goal_id: ids.goals }],
    ['skill_progress_entries', { skill_id: ids.skills, level: 5, source: 'training', recorded_at: now }],
    ['learning_items', { kind: 'book', title: 'Inverted Pyramid', status: 'in_progress', progress_current: 120, progress_total: 400, progress_unit: 'pages', skill_id: ids.skills }],
    ['tasks', { title: 'Plan pre-season', rank: 'a0', project_id: ids.projects }],
    ['focus_sessions', { kind: 'study', source: 'timer', started_at: now, ended_at: now, duration_seconds: 1500, pause_seconds: 0, task_id: ids.tasks, status: 'completed' }],
    ['study_videos', { focus_session_id: ids.focus_sessions, recorded_on: '2026-11-22', storage_path: `${owner}/${ids.study_videos}.mp4`, mime_type: 'video/mp4', size_bytes: 12_000_000, upload_status: 'ready' }],
    ['exercises', { name: `Squat ${owner.slice(0, 4)}`, kind: 'strength', weight_unit: 'kg' }],
    ['workout_plans', { name: 'Leg day', rank: 'a0' }],
    ['workout_plan_items', { plan_id: ids.workout_plans, exercise_id: ids.exercises, position: 1, target_sets: 3, target_reps: 5 }],
    ['workout_sessions', { plan_id: ids.workout_plans, title: 'Leg day', started_at: now }],
    ['workout_sets', { session_id: ids.workout_sessions, exercise_id: ids.exercises, set_index: 1, reps: 5, weight: 100, is_warmup: false, completed_at: now }],
    ['sports', { name: 'Football', position: 'Winger' }],
    ['training_sessions', { sport_id: ids.sports, session_type: 'technical', started_at: now, duration_minutes: 60, performance_rating: 7 }],
    ['training_session_skills', { training_session_id: ids.training_sessions, skill_id: ids.skills, minutes: 20, rating: 6 }],
    ['people', { name: 'Sam', birthday_month: 3, birthday_day: 14 }],
    ['experiences', { title: 'Visit Lisbon', category: 'place', status: 'someday' }],
    ['journal_entries', { entry_date: '2026-11-22', went_well: 'Good session' }],
    ['decisions', { title: 'Join the academy', status: 'decided', review_on: '2027-01-01' }],
    ['ideas', { title: 'Drill-tracking app', status: 'seed', potential: 4 }],
    ['sleep_logs', { sleep_date: '2026-11-22', duration_minutes: 450, energy: 4 }],
  ];
  return rows.map(([table, patch]) => ({ table, id: ids[table]!, op: 'upsert', patch }));
}

before(async () => {
  client = await connect();
  alice = await createUser(client);
  bob = await createUser(client);
  const results = await asUser(client, alice, (q) => push(q, stage4Changes(alice)));
  assert.deepEqual(results.filter((r) => r.status === 'rejected'), [], 'every Stage 4 fixture row is valid');
});
after(async () => {
  await client.end();
});

test('Stage 4 tables: another user sees, changes and deletes nothing', async () => {
  for (const [table, id] of Object.entries(ids)) {
    const seen = await asUser(client, bob, (q) => q(`select count(*)::int as n from public.${table} where id = $1 or user_id = $2`, [id, alice]));
    assert.equal(seen.rows[0].n, 0, `${table}: hidden`);
    const upd = await asUser(client, bob, (q) => q(`update public.${table} set deleted_at = now() where id = $1`, [id]));
    assert.equal(upd.rowCount, 0, `${table}: cannot update`);
  }
});

test('Stage 4 ownership: links to another user’s project, skill or exercise are refused', async () => {
  const results = await asUser(client, bob, (q) =>
    push(q, [
      { table: 'tasks', id: randomUUID(), op: 'upsert', patch: { title: 'x', rank: 'a0', project_id: ids.projects } },
      { table: 'training_session_skills', id: randomUUID(), op: 'upsert', patch: { training_session_id: ids.training_sessions, skill_id: ids.skills } },
      { table: 'focus_sessions', id: randomUUID(), op: 'upsert', patch: { started_at: new Date().toISOString(), task_id: ids.tasks, status: 'running' } },
    ]),
  );
  for (const r of results) assert.equal(r.code, '23503');
});

test('study videos: objects are private to the owner’s folder', async () => {
  const aPath = `${alice}/${randomUUID()}.mp4`;
  await asUser(client, alice, (q) => q(`insert into storage.objects (bucket_id, name) values ('study-videos', $1)`, [aPath]));
  const own = await asUser(client, alice, (q) => q(`select count(*)::int as n from storage.objects where name = $1`, [aPath]));
  assert.equal(own.rows[0].n, 1);
  const other = await asUser(client, bob, (q) => q(`select count(*)::int as n from storage.objects where name = $1`, [aPath]));
  assert.equal(other.rows[0].n, 0, 'bob cannot see alice’s video');
  await expectError(asUser(client, bob, (q) => q(`insert into storage.objects (bucket_id, name) values ('study-videos', $1)`, [`${alice}/sneaky.mp4`])), '42501');
  const del = await asUser(client, bob, (q) => q(`delete from storage.objects where name = $1`, [aPath]));
  assert.equal(del.rowCount, 0, 'bob cannot delete it');
  const bucket = await client.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'study-videos'`);
  assert.equal(bucket.rows[0].public, false, 'bucket is private');
  // A video row must point inside its owner's folder.
  const [r] = await asUser(client, bob, (q) =>
    push(q, [{ table: 'study_videos', id: randomUUID(), op: 'upsert', patch: { recorded_on: '2026-11-22', storage_path: `${alice}/x.mp4`, mime_type: 'video/mp4', size_bytes: 10 } }]),
  );
  assert.equal(r!.code, '23514');
});

test('milestones belong to exactly one goal or project; skills stay a tree', async () => {
  const [both] = await asUser(client, alice, (q) =>
    push(q, [{ table: 'milestones', id: randomUUID(), op: 'upsert', patch: { goal_id: ids.goals, project_id: ids.projects, title: 'x', rank: 'a0' } }]),
  );
  assert.equal(both!.code, '23514');
  const child = randomUUID();
  await asUser(client, alice, (q) => push(q, [{ table: 'skills', id: child, op: 'upsert', patch: { name: 'Shooting', parent_id: ids.skills, rank: 'a1' } }]));
  const [cycle] = await asUser(client, alice, (q) => push(q, [{ table: 'skills', id: ids.skills!, op: 'upsert', patch: { parent_id: child } }]));
  assert.equal(cycle!.status, 'rejected', 'cycle refused');
});

test('journal and sleep: one entry per day across devices', async () => {
  const [j] = await asUser(client, alice, (q) =>
    push(q, [{ table: 'journal_entries', id: randomUUID(), op: 'upsert', patch: { entry_date: '2026-11-22', learned: 'Rest matters' } }]),
  );
  assert.equal(j!.status, 'remapped');
  assert.equal(j!.new_id, ids.journal_entries);
  assert.equal(j!.row!.went_well, 'Good session', 'earlier answers kept');
  assert.equal(j!.row!.learned, 'Rest matters');
  const [s] = await asUser(client, alice, (q) => push(q, [{ table: 'sleep_logs', id: randomUUID(), op: 'upsert', patch: { sleep_date: '2026-11-22', energy: 2 } }]));
  assert.equal(s!.status, 'remapped');
});

test('uniqueness errors never reveal another user’s rows', async () => {
  const habit = randomUUID();
  await asUser(client, alice, (q) => push(q, [
    { table: 'habits', id: habit, op: 'upsert', patch: { name: 'Read', rank: 'a0', start_date: '2026-11-01' } },
    { table: 'habit_logs', id: randomUUID(), op: 'upsert', patch: { habit_id: habit, log_date: '2026-11-22' } },
  ]));
  const [r] = await asUser(client, bob, (q) => push(q, [{ table: 'habit_logs', id: randomUUID(), op: 'upsert', patch: { habit_id: habit, log_date: '2026-11-22' } }]));
  assert.equal(r!.code, '23503', 'bob only learns the habit is not his');
});
