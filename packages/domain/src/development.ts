/**
 * Stage 4 domain logic: focus timer maths, workout personal records, birthdays, project progress,
 * learning progress and sleep summaries. Pure functions shared by the app and the server.
 */
import { addDays, diffDays, formatLocalDate, parseLocalDate, type LocalDate } from './time.ts';

// ───────────────────────────── focus timer ─────────────────────────────

/** Timer state as persisted on the device, so a running session survives the app being closed. */
export interface TimerState {
  sessionId: string;
  startedAt: number;
  /** When the current pause began, or null while running. */
  pausedAt: number | null;
  /** Total milliseconds spent paused before the current pause. */
  pausedMs: number;
  plannedMinutes: number | null;
}

export function timerElapsedMs(t: TimerState, now: number): number {
  const pausedNow = t.pausedAt !== null ? now - t.pausedAt : 0;
  return Math.max(0, now - t.startedAt - t.pausedMs - pausedNow);
}

export function pauseTimer(t: TimerState, now: number): TimerState {
  return t.pausedAt !== null ? t : { ...t, pausedAt: now };
}

export function resumeTimer(t: TimerState, now: number): TimerState {
  return t.pausedAt === null ? t : { ...t, pausedMs: t.pausedMs + (now - t.pausedAt), pausedAt: null };
}

/** Final figures recorded when a session stops. */
export function stopTimer(t: TimerState, now: number): { durationSeconds: number; pauseSeconds: number; endedAt: number } {
  const resumed = resumeTimer(t, now);
  return {
    durationSeconds: Math.round(timerElapsedMs(resumed, now) / 1000),
    pauseSeconds: Math.round(resumed.pausedMs / 1000),
    endedAt: now,
  };
}

/** Remaining time towards a planned length (negative once over). */
export function timerRemainingMs(t: TimerState, now: number): number | null {
  return t.plannedMinutes === null ? null : t.plannedMinutes * 60_000 - timerElapsedMs(t, now);
}

/** A break suggestion that scales with the session: about 1 minute per 5, between 5 and 20. */
export function suggestedBreakMinutes(focusMinutes: number): number {
  return Math.max(5, Math.min(20, Math.round(focusMinutes / 5)));
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ───────────────────────────── workouts ─────────────────────────────

export interface SetRecord {
  exerciseId: string;
  sessionId: string;
  reps: number | null;
  weight: number | null;
  isWarmup: boolean;
  completedAt: string | null;
}

/** Epley estimate of a one-rep max. Only meaningful for 1–12 reps. */
export function estimatedOneRepMax(weight: number, reps: number): number | null {
  if (weight <= 0 || reps <= 0 || reps > 12) return null;
  return reps === 1 ? weight : Math.round(weight * (1 + reps / 30) * 10) / 10;
}

export interface PersonalRecords {
  heaviest: { weight: number; reps: number; at: string | null } | null;
  bestOneRepMax: { value: number; weight: number; reps: number; at: string | null } | null;
  mostReps: { reps: number; weight: number | null; at: string | null } | null;
  bestSessionVolume: { volume: number; sessionId: string } | null;
}

/** Personal records for one exercise, computed from its working sets (warm-ups excluded). */
export function personalRecords(sets: readonly SetRecord[]): PersonalRecords {
  const working = sets.filter((s) => !s.isWarmup && (s.reps ?? 0) > 0);
  let heaviest: PersonalRecords['heaviest'] = null;
  let best: PersonalRecords['bestOneRepMax'] = null;
  let most: PersonalRecords['mostReps'] = null;
  const volume = new Map<string, number>();
  for (const s of working) {
    const reps = s.reps ?? 0;
    const w = s.weight ?? 0;
    if (w > 0 && (!heaviest || w > heaviest.weight || (w === heaviest.weight && reps > heaviest.reps))) heaviest = { weight: w, reps, at: s.completedAt };
    const e = w > 0 ? estimatedOneRepMax(w, reps) : null;
    if (e !== null && (!best || e > best.value)) best = { value: e, weight: w, reps, at: s.completedAt };
    if (!most || reps > most.reps) most = { reps, weight: s.weight, at: s.completedAt };
    volume.set(s.sessionId, (volume.get(s.sessionId) ?? 0) + reps * w);
  }
  let bestSessionVolume: PersonalRecords['bestSessionVolume'] = null;
  for (const [sessionId, v] of volume) if (v > 0 && (!bestSessionVolume || v > bestSessionVolume.volume)) bestSessionVolume = { volume: v, sessionId };
  return { heaviest, bestOneRepMax: best, mostReps: most, bestSessionVolume };
}

/** Which records a new set would break, compared with all earlier sets. */
export function recordsBrokenBy(previous: readonly SetRecord[], next: SetRecord): ('heaviest' | 'one_rep_max' | 'reps')[] {
  if (next.isWarmup || !next.reps) return [];
  const before = personalRecords(previous);
  const out: ('heaviest' | 'one_rep_max' | 'reps')[] = [];
  const w = next.weight ?? 0;
  if (w > 0 && (!before.heaviest || w > before.heaviest.weight)) out.push('heaviest');
  const e = w > 0 ? estimatedOneRepMax(w, next.reps) : null;
  if (e !== null && before.bestOneRepMax && e > before.bestOneRepMax.value) out.push('one_rep_max');
  if (before.mostReps && next.reps > before.mostReps.reps && (next.weight ?? 0) >= (before.mostReps.weight ?? 0)) out.push('reps');
  return out;
}

// ───────────────────────────── birthdays ─────────────────────────────

/** The next occurrence of a birthday on or after `today` (29 Feb falls back to 28 Feb in other years). */
export function nextBirthday(month: number, day: number, today: LocalDate): LocalDate {
  const { year } = parseLocalDate(today);
  for (const y of [year, year + 1]) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const d = month === 2 && day === 29 && !leap ? 28 : day;
    const candidate = formatLocalDate(y, month, d);
    if (candidate >= today) return candidate;
  }
  return formatLocalDate(year + 1, month, day);
}

export function upcomingBirthdays<T extends { birthdayMonth: number | null; birthdayDay: number | null; birthYear: number | null }>(
  people: readonly T[],
  today: LocalDate,
  withinDays: number,
): { person: T; date: LocalDate; inDays: number; turning: number | null }[] {
  const out: { person: T; date: LocalDate; inDays: number; turning: number | null }[] = [];
  for (const p of people) {
    if (!p.birthdayMonth || !p.birthdayDay) continue;
    const date = nextBirthday(p.birthdayMonth, p.birthdayDay, today);
    const inDays = diffDays(today, date);
    if (inDays > withinDays) continue;
    out.push({ person: p, date, inDays, turning: p.birthYear ? parseLocalDate(date).year - p.birthYear : null });
  }
  return out.sort((a, b) => a.inDays - b.inDays);
}

// ───────────────────────────── projects ─────────────────────────────

export interface ProjectProgressInput {
  milestones: readonly { status: string }[];
  tasks: readonly { status: string }[];
  stages: readonly { status: string }[];
}

/** Milestones count most; tasks fill in when there are none, and stages when there are neither. */
export function projectProgress(p: ProjectProgressInput): { ratio: number | null; label: string; stagesDone: number; stagesTotal: number } {
  const stagesTotal = p.stages.length;
  const stagesDone = p.stages.filter((s) => s.status === 'done').length;
  const ms = p.milestones.filter((m) => m.status !== 'skipped');
  if (ms.length) {
    const done = ms.filter((m) => m.status === 'done').length;
    return { ratio: done / ms.length, label: `${done} of ${ms.length} milestones`, stagesDone, stagesTotal };
  }
  const tasks = p.tasks.filter((t) => t.status !== 'cancelled');
  if (tasks.length) {
    const done = tasks.filter((t) => t.status === 'completed').length;
    return { ratio: done / tasks.length, label: `${done} of ${tasks.length} tasks`, stagesDone, stagesTotal };
  }
  if (stagesTotal) return { ratio: stagesDone / stagesTotal, label: `${stagesDone} of ${stagesTotal} stages`, stagesDone, stagesTotal };
  return { ratio: null, label: 'Add stages, milestones or tasks', stagesDone, stagesTotal };
}

// ───────────────────────────── learning & sleep ─────────────────────────────

export function learningProgress(current: number | null, total: number | null, unit: string): { ratio: number | null; label: string } {
  if (unit === 'percent') {
    if (current === null) return { ratio: null, label: 'Not started' };
    const r = Math.max(0, Math.min(1, current / 100));
    return { ratio: r, label: `${Math.round(r * 100)}%` };
  }
  if (current === null || !total) return { ratio: null, label: total ? `0 of ${total} ${unit}` : 'Not started' };
  return { ratio: Math.max(0, Math.min(1, current / total)), label: `${current} of ${total} ${unit}` };
}

/** Minutes between going to bed and waking (crossing midnight as needed). */
export function sleepMinutes(bed: string, wake: string): number {
  const [bh, bm] = bed.split(':').map(Number) as [number, number];
  const [wh, wm] = wake.split(':').map(Number) as [number, number];
  let mins = wh * 60 + wm - (bh * 60 + bm);
  if (mins <= 0) mins += 24 * 60;
  return mins;
}

export interface SleepSummary {
  nights: number;
  averageMinutes: number | null;
  averageEnergy: number | null;
  /** Mean energy on nights of 7h+ minus nights under 7h, when both exist: a gentle pattern, not a score. */
  energyDifferenceWithSevenHours: number | null;
}

export function sleepSummary(logs: readonly { sleepDate: LocalDate; minutes: number | null; energy: number | null }[], today: LocalDate, days = 14): SleepSummary {
  const from = addDays(today, -(days - 1));
  const recent = logs.filter((l) => l.sleepDate >= from && l.sleepDate <= today);
  const withMins = recent.filter((l) => l.minutes !== null) as { minutes: number; energy: number | null }[];
  const withEnergy = recent.filter((l) => l.energy !== null) as { minutes: number | null; energy: number }[];
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const long = recent.filter((l) => l.minutes !== null && l.minutes >= 420 && l.energy !== null).map((l) => l.energy as number);
  const short = recent.filter((l) => l.minutes !== null && l.minutes < 420 && l.energy !== null).map((l) => l.energy as number);
  const la = avg(long);
  const sa = avg(short);
  return {
    nights: recent.length,
    averageMinutes: avg(withMins.map((l) => l.minutes)),
    averageEnergy: avg(withEnergy.map((l) => l.energy)),
    energyDifferenceWithSevenHours: la !== null && sa !== null ? Math.round((la - sa) * 10) / 10 : null,
  };
}
