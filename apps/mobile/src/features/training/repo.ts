/** Workouts (exercises, plans, sessions, sets, personal records) and sport development (sessions, skills). */
import { z } from 'zod';
import { personalRecords, recordsBrokenBy, type PersonalRecords, type SetRecord } from '@ascend/domain';
import type { Store } from '../../data/store.ts';
import { rankAtEnd } from '../../data/ranks.ts';
import type {
  Exercise, Skill, SkillProgress, Sport, TrainingSession, TrainingSessionSkill, WorkoutPlan, WorkoutPlanItem, WorkoutSession, WorkoutSet,
} from '../../data/types.ts';
import { optionalText, parseOrThrow, requiredTitle, ValidationError } from '../../data/validation.ts';

// ───────────────────────────── exercises ─────────────────────────────

export const exerciseInput = z.object({
  name: requiredTitle(120),
  kind: z.enum(['strength', 'cardio', 'mobility', 'skill', 'other']).default('strength'),
  muscle_group: optionalText(60),
  equipment: optionalText(60),
  weight_unit: z.enum(['kg', 'lb']).default('kg'),
  notes: optionalText(2000),
});

export async function listExercises(store: Store): Promise<Exercise[]> {
  return store.list<Exercise>('exercises', { orderBy: 'name COLLATE NOCASE' });
}

export async function createExercise(store: Store, input: z.input<typeof exerciseInput>): Promise<Exercise> {
  const v = parseOrThrow(exerciseInput, input);
  const clash = await store.list<Exercise>('exercises', { where: 'lower(name) = lower(?)', params: [v.name] });
  if (clash.length) throw new ValidationError({ name: 'You already have an exercise with this name' });
  return store.insert<Exercise>('exercises', { ...v, muscle_group: v.muscle_group ?? null, equipment: v.equipment ?? null, notes: v.notes ?? null });
}

/** A starter set the user can add with one tap. They become the user's own, fully editable exercises. */
export const STARTER_EXERCISES: z.input<typeof exerciseInput>[] = [
  { name: 'Back squat', muscle_group: 'Legs', equipment: 'Barbell' },
  { name: 'Bench press', muscle_group: 'Chest', equipment: 'Barbell' },
  { name: 'Deadlift', muscle_group: 'Back', equipment: 'Barbell' },
  { name: 'Overhead press', muscle_group: 'Shoulders', equipment: 'Barbell' },
  { name: 'Pull-up', muscle_group: 'Back', equipment: 'Bodyweight' },
  { name: 'Dumbbell row', muscle_group: 'Back', equipment: 'Dumbbell' },
  { name: 'Walking lunge', muscle_group: 'Legs', equipment: 'Dumbbell' },
  { name: 'Plank', kind: 'mobility', muscle_group: 'Core', equipment: 'Bodyweight' },
  { name: 'Run', kind: 'cardio', equipment: 'None' },
  { name: 'Sprint intervals', kind: 'cardio', equipment: 'None' },
];

export async function addStarterExercises(store: Store): Promise<number> {
  const existing = new Set((await listExercises(store)).map((e) => e.name.toLowerCase()));
  let added = 0;
  await store.write(async (tx) => {
    for (const e of STARTER_EXERCISES) {
      if (existing.has(e.name.toLowerCase())) continue;
      const v = parseOrThrow(exerciseInput, e);
      await tx.insert('exercises', { ...v, muscle_group: v.muscle_group ?? null, equipment: v.equipment ?? null, notes: null });
      added++;
    }
  });
  return added;
}

// ───────────────────────────── plans ─────────────────────────────

export interface PlanWithItems {
  plan: WorkoutPlan;
  items: (WorkoutPlanItem & { exercise: Exercise | null })[];
}

export async function listPlans(store: Store): Promise<PlanWithItems[]> {
  const [plans, items, exercises] = await Promise.all([
    store.list<WorkoutPlan>('workout_plans', { orderBy: 'rank COLLATE BINARY' }),
    store.list<WorkoutPlanItem>('workout_plan_items', { orderBy: 'position' }),
    listExercises(store),
  ]);
  const byId = new Map(exercises.map((e) => [e.id, e]));
  return plans.map((plan) => ({ plan, items: items.filter((i) => i.plan_id === plan.id).map((i) => ({ ...i, exercise: byId.get(i.exercise_id) ?? null })) }));
}

export async function createPlan(
  store: Store,
  name: string,
  items: { exerciseId: string; sets: number; reps: number | null; weight: number | null }[],
  goalId: string | null = null,
): Promise<WorkoutPlan> {
  const n = parseOrThrow(requiredTitle(120), name);
  if (!items.length) throw new ValidationError({ items: 'Add at least one exercise' });
  const rank = await rankAtEnd(store, 'workout_plans');
  return store.write(async (tx) => {
    const plan = await tx.insert<WorkoutPlan>('workout_plans', { name: n, goal_id: goalId, rank });
    for (const [i, it] of items.entries()) {
      if (it.sets < 1 || it.sets > 20) throw new ValidationError({ items: 'Sets must be between 1 and 20' });
      await tx.insert('workout_plan_items', { plan_id: plan.id, exercise_id: it.exerciseId, position: i + 1, target_sets: it.sets, target_reps: it.reps, target_weight: it.weight });
    }
    return plan;
  });
}

export async function deletePlan(store: Store, id: string): Promise<void> {
  await store.remove('workout_plans', id);
}

// ───────────────────────────── sessions & sets ─────────────────────────────

export async function startWorkout(store: Store, planId: string | null, title?: string): Promise<WorkoutSession> {
  const plan = planId ? await store.get<WorkoutPlan>('workout_plans', planId) : null;
  return store.insert<WorkoutSession>('workout_sessions', { plan_id: planId, title: (title?.trim() || plan?.name || 'Workout').slice(0, 120), started_at: store.now().toISOString() });
}

export async function openWorkout(store: Store): Promise<WorkoutSession | null> {
  const [s] = await store.list<WorkoutSession>('workout_sessions', { where: 'ended_at IS NULL', orderBy: 'started_at DESC', limit: 1 });
  return s ?? null;
}

function toRecord(s: WorkoutSet): SetRecord {
  return { exerciseId: s.exercise_id, sessionId: s.session_id, reps: s.reps, weight: s.weight, isWarmup: s.is_warmup, completedAt: s.completed_at };
}

/** Logs a set and reports any personal records it breaks. */
export async function addSet(
  store: Store,
  sessionId: string,
  exerciseId: string,
  input: { reps: number | null; weight: number | null; isWarmup?: boolean; durationSeconds?: number | null; distanceM?: number | null },
): Promise<{ set: WorkoutSet; records: ReturnType<typeof recordsBrokenBy> }> {
  if (input.reps !== null && (!Number.isInteger(input.reps) || input.reps < 0 || input.reps > 1000)) throw new ValidationError({ reps: 'Enter reps between 0 and 1000' });
  if (input.weight !== null && (!Number.isFinite(input.weight) || input.weight < 0 || input.weight > 2000)) throw new ValidationError({ weight: 'Enter a weight between 0 and 2000' });
  if (input.reps === null && !input.durationSeconds && !input.distanceM) throw new ValidationError({ reps: 'Enter reps, time or distance' });
  const previous = await store.list<WorkoutSet>('workout_sets', { where: 'exercise_id = ?', params: [exerciseId] });
  const inSession = previous.filter((s) => s.session_id === sessionId).length;
  const set = await store.insert<WorkoutSet>('workout_sets', {
    session_id: sessionId,
    exercise_id: exerciseId,
    set_index: inSession + 1,
    reps: input.reps,
    weight: input.weight,
    duration_seconds: input.durationSeconds ?? null,
    distance_m: input.distanceM ?? null,
    is_warmup: input.isWarmup ?? false,
    completed_at: store.now().toISOString(),
  });
  return { set, records: previous.length ? recordsBrokenBy(previous.map(toRecord), toRecord(set)) : [] };
}

export async function deleteSet(store: Store, id: string): Promise<void> {
  await store.remove('workout_sets', id);
}

export async function finishWorkout(store: Store, sessionId: string, effort: number | null, notes: string | null): Promise<void> {
  if (effort !== null && (effort < 1 || effort > 10)) throw new ValidationError({ perceived_effort: 'Effort is 1–10' });
  await store.update('workout_sessions', sessionId, { ended_at: store.now().toISOString(), perceived_effort: effort, notes: notes?.trim() || null });
}

export async function deleteWorkout(store: Store, sessionId: string): Promise<void> {
  await store.remove('workout_sessions', sessionId);
}

export interface WorkoutDetail {
  session: WorkoutSession;
  groups: { exercise: Exercise; sets: WorkoutSet[] }[];
  volume: number;
}

export async function loadWorkout(store: Store, sessionId: string): Promise<WorkoutDetail | null> {
  const session = await store.get<WorkoutSession>('workout_sessions', sessionId);
  if (!session || session.deleted_at) return null;
  const [sets, exercises] = await Promise.all([
    store.list<WorkoutSet>('workout_sets', { where: 'session_id = ?', params: [sessionId], orderBy: 'completed_at, set_index' }),
    listExercises(store),
  ]);
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const order: string[] = [];
  for (const s of sets) if (!order.includes(s.exercise_id)) order.push(s.exercise_id);
  return {
    session,
    groups: order.filter((id) => byId.has(id)).map((id) => ({ exercise: byId.get(id)!, sets: sets.filter((s) => s.exercise_id === id) })),
    volume: sets.filter((s) => !s.is_warmup).reduce((v, s) => v + (s.reps ?? 0) * (s.weight ?? 0), 0),
  };
}

export async function listWorkouts(store: Store, limit = 50): Promise<WorkoutSession[]> {
  return store.list<WorkoutSession>('workout_sessions', { orderBy: 'started_at DESC', limit });
}

export async function exerciseHistory(store: Store, exerciseId: string): Promise<{ records: PersonalRecords; sessions: { session: WorkoutSession; sets: WorkoutSet[] }[] }> {
  const sets = await store.list<WorkoutSet>('workout_sets', { where: 'exercise_id = ?', params: [exerciseId], orderBy: 'completed_at DESC' });
  const ids = [...new Set(sets.map((s) => s.session_id))];
  const sessions = ids.length
    ? await store.list<WorkoutSession>('workout_sessions', { where: `id IN (${ids.map(() => '?').join(',')})`, params: ids, orderBy: 'started_at DESC' })
    : [];
  return { records: personalRecords(sets.map(toRecord)), sessions: sessions.map((session) => ({ session, sets: sets.filter((s) => s.session_id === session.id).reverse() })) };
}

// ───────────────────────────── sport & skills ─────────────────────────────

export async function listSports(store: Store): Promise<Sport[]> {
  return store.list<Sport>('sports', { orderBy: 'name COLLATE NOCASE' });
}

export async function createSport(store: Store, name: string, position: string | null = null): Promise<Sport> {
  const n = parseOrThrow(requiredTitle(80), name);
  const clash = await store.list<Sport>('sports', { where: 'lower(name) = lower(?)', params: [n] });
  if (clash.length) return clash[0]!;
  return store.insert<Sport>('sports', { name: n, position: position?.trim() || null });
}

export async function listSkills(store: Store): Promise<Skill[]> {
  return store.list<Skill>('skills', { orderBy: 'rank COLLATE BINARY' });
}

export async function createSkill(store: Store, input: { name: string; parentId?: string | null; level?: number; targetLevel?: number | null; goalId?: string | null; description?: string | null }): Promise<Skill> {
  const n = parseOrThrow(requiredTitle(120), input.name);
  const level = input.level ?? 0;
  if (level < 0 || level > 10) throw new ValidationError({ level: 'Level is 0–10' });
  const rank = await rankAtEnd(store, 'skills');
  return store.insert<Skill>('skills', {
    name: n,
    parent_id: input.parentId ?? null,
    level,
    target_level: input.targetLevel ?? null,
    goal_id: input.goalId ?? null,
    description: input.description?.trim() || null,
    rank,
  });
}

/** Records a new self-assessed level, keeping the history. */
export async function setSkillLevel(store: Store, skillId: string, level: number, note: string | null, source: SkillProgress['source'] = 'manual', sourceId: string | null = null): Promise<void> {
  if (!Number.isInteger(level) || level < 0 || level > 10) throw new ValidationError({ level: 'Level is 0–10' });
  await store.write(async (tx) => {
    await tx.update('skills', skillId, { level });
    await tx.insert('skill_progress_entries', { skill_id: skillId, level, note: note?.trim() || null, source, source_id: sourceId, recorded_at: tx.nowIso() });
  });
}

export const trainingInput = z.object({
  sport_id: z.string().uuid({ message: 'Choose a sport' }),
  session_type: z.enum(['technical', 'tactical', 'match', 'conditioning', 'recovery', 'other']).default('technical'),
  started_at: z.string().min(10),
  duration_minutes: z.number().int().min(1, 'At least 1 minute').max(600),
  intensity: z.number().int().min(1).max(10).nullable().optional(),
  performance_rating: z.number().int().min(1).max(10).nullable().optional(),
  focus: optionalText(300),
  notes: optionalText(5000),
  goal_id: z.string().uuid().nullable().optional(),
  schedule_block_id: z.string().uuid().nullable().optional(),
});

/** Logs a training session and the skills worked on (each with an optional 1–10 rating). */
export async function logTraining(
  store: Store,
  input: z.input<typeof trainingInput>,
  skills: { skillId: string; minutes?: number | null; rating?: number | null; note?: string | null }[] = [],
): Promise<TrainingSession> {
  const v = parseOrThrow(trainingInput, input);
  for (const s of skills) if (s.rating != null && (s.rating < 1 || s.rating > 10)) throw new ValidationError({ skills: 'Skill ratings are 1–10' });
  return store.write(async (tx) => {
    const session = await tx.insert<TrainingSession>('training_sessions', {
      ...v,
      intensity: v.intensity ?? null,
      performance_rating: v.performance_rating ?? null,
      focus: v.focus ?? null,
      notes: v.notes ?? null,
      goal_id: v.goal_id ?? null,
      schedule_block_id: v.schedule_block_id ?? null,
    });
    for (const s of skills) {
      await tx.insert('training_session_skills', { training_session_id: session.id, skill_id: s.skillId, minutes: s.minutes ?? null, rating: s.rating ?? null, note: s.note?.trim() || null });
    }
    if (v.schedule_block_id) await tx.update('schedule_blocks', v.schedule_block_id, { status: 'done', actual_minutes: v.duration_minutes, completed_at: tx.nowIso() });
    return session;
  });
}

export async function listTraining(store: Store, sportId?: string, limit = 50): Promise<(TrainingSession & { skills: TrainingSessionSkill[] })[]> {
  const sessions = await store.list<TrainingSession>('training_sessions', { where: sportId ? 'sport_id = ?' : undefined, params: sportId ? [sportId] : [], orderBy: 'started_at DESC', limit });
  if (!sessions.length) return [];
  const links = await store.list<TrainingSessionSkill>('training_session_skills', { where: `training_session_id IN (${sessions.map(() => '?').join(',')})`, params: sessions.map((s) => s.id) });
  return sessions.map((s) => ({ ...s, skills: links.filter((l) => l.training_session_id === s.id) }));
}

export interface SkillHistoryPoint {
  at: string;
  kind: 'level' | 'training';
  value: number;
  note: string | null;
}

/** A skill's development over time: self-assessed levels plus ratings from training sessions. */
export async function skillHistory(store: Store, skillId: string): Promise<SkillHistoryPoint[]> {
  const [levels, links] = await Promise.all([
    store.list<SkillProgress>('skill_progress_entries', { where: 'skill_id = ? AND level IS NOT NULL', params: [skillId] }),
    store.list<TrainingSessionSkill>('training_session_skills', { where: 'skill_id = ? AND rating IS NOT NULL', params: [skillId] }),
  ]);
  const sessions = links.length
    ? await store.list<TrainingSession>('training_sessions', { where: `id IN (${links.map(() => '?').join(',')})`, params: links.map((l) => l.training_session_id) })
    : [];
  const when = new Map(sessions.map((s) => [s.id, s.started_at]));
  return [
    ...levels.map((l) => ({ at: l.recorded_at, kind: 'level' as const, value: l.level!, note: l.note })),
    ...links.filter((l) => when.has(l.training_session_id)).map((l) => ({ at: when.get(l.training_session_id)!, kind: 'training' as const, value: l.rating!, note: l.note })),
  ].sort((a, b) => (a.at < b.at ? -1 : 1));
}
