import { z } from 'zod';
import { consistency, isHabitDue, runs, validateHabitRule, type HabitRule } from '@ascend/domain';
import type { Store } from '../../data/store.ts';
import { rankAtEnd } from '../../data/ranks.ts';
import type { Habit, HabitLog } from '../../data/types.ts';
import { hhmm, isoDate, optionalText, parseOrThrow, requiredTitle, ValidationError } from '../../data/validation.ts';

export const habitInput = z.object({
  name: requiredTitle(120),
  description: optionalText(2000),
  category_id: z.string().uuid().nullable().optional(),
  goal_id: z.string().uuid().nullable().optional(),
  frequency_kind: z.enum(['daily', 'weekdays', 'times_per_week', 'times_per_month', 'every_n_days']),
  days_of_week: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  times_per_period: z.number().int().min(1).max(31).nullable().optional(),
  interval_days: z.number().int().min(2).max(365).nullable().optional(),
  start_date: isoDate,
  end_date: isoDate.nullable().optional(),
  duration_minutes: z.number().int().min(1).max(600).nullable().optional(),
  preferred_window: z.enum(['any', 'morning', 'afternoon', 'evening', 'work', 'study']).default('any'),
  preferred_time: hhmm.nullable().optional(),
  target_value: z.number().finite().nullable().optional(),
  target_unit: optionalText(40),
  reminder_times: z.array(hhmm).max(5).default([]),
  notes: optionalText(10000),
});
export type HabitInput = z.input<typeof habitInput>;

export function toRule(h: Pick<Habit, 'frequency_kind' | 'days_of_week' | 'times_per_period' | 'interval_days' | 'start_date' | 'end_date' | 'status' | 'paused_until'>): HabitRule {
  return {
    frequencyKind: h.frequency_kind,
    daysOfWeek: h.days_of_week,
    timesPerPeriod: h.times_per_period,
    intervalDays: h.interval_days,
    startDate: h.start_date,
    endDate: h.end_date,
    status: h.status,
    pausedUntil: h.paused_until,
  };
}

function validated(input: HabitInput) {
  const v = parseOrThrow(habitInput, input);
  const ruleError = validateHabitRule({
    frequencyKind: v.frequency_kind,
    daysOfWeek: v.days_of_week ?? null,
    timesPerPeriod: v.times_per_period ?? null,
    intervalDays: v.interval_days ?? null,
    startDate: v.start_date,
    endDate: v.end_date ?? null,
    status: 'active',
    pausedUntil: null,
  });
  if (ruleError) throw new ValidationError({ frequency_kind: ruleError });
  if (v.end_date && v.end_date < v.start_date) throw new ValidationError({ end_date: 'End date must be after the start date' });
  // Only keep the fields the chosen frequency uses, so stale values never affect scheduling.
  return {
    ...v,
    days_of_week: v.frequency_kind === 'weekdays' || v.frequency_kind === 'times_per_week' ? (v.days_of_week?.length ? [...new Set(v.days_of_week)].sort() : null) : null,
    times_per_period: v.frequency_kind === 'times_per_week' || v.frequency_kind === 'times_per_month' ? v.times_per_period ?? null : null,
    interval_days: v.frequency_kind === 'every_n_days' ? v.interval_days ?? null : null,
  };
}

export async function createHabit(store: Store, input: HabitInput): Promise<Habit> {
  const v = validated(input);
  const rank = await rankAtEnd(store, 'habits');
  return store.insert<Habit>('habits', {
    name: v.name,
    description: v.description ?? null,
    category_id: v.category_id ?? null,
    goal_id: v.goal_id ?? null,
    frequency_kind: v.frequency_kind,
    days_of_week: v.days_of_week,
    times_per_period: v.times_per_period,
    interval_days: v.interval_days,
    start_date: v.start_date,
    end_date: v.end_date ?? null,
    duration_minutes: v.duration_minutes ?? null,
    preferred_window: v.preferred_window,
    preferred_time: v.preferred_time ?? null,
    target_value: v.target_value ?? null,
    target_unit: v.target_unit ?? null,
    status: 'active',
    reminder_times: v.reminder_times,
    notes: v.notes ?? null,
    rank,
  });
}

export async function updateHabit(store: Store, id: string, input: Partial<HabitInput>): Promise<Habit> {
  const current = await store.get<Habit>('habits', id);
  if (!current) throw new Error('Habit not found');
  const v = validated({ ...current, ...input } as HabitInput);
  return store.update<Habit>('habits', id, {
    name: v.name,
    description: v.description ?? null,
    category_id: v.category_id ?? null,
    goal_id: v.goal_id ?? null,
    frequency_kind: v.frequency_kind,
    days_of_week: v.days_of_week,
    times_per_period: v.times_per_period,
    interval_days: v.interval_days,
    start_date: v.start_date,
    end_date: v.end_date ?? null,
    duration_minutes: v.duration_minutes ?? null,
    preferred_window: v.preferred_window,
    preferred_time: v.preferred_time ?? null,
    target_value: v.target_value ?? null,
    target_unit: v.target_unit ?? null,
    reminder_times: v.reminder_times,
    notes: v.notes ?? null,
  });
}

export async function pauseHabit(store: Store, id: string, until: string | null): Promise<void> {
  await store.update('habits', id, { status: 'paused', paused_until: until });
}

export async function resumeHabit(store: Store, id: string): Promise<void> {
  await store.update('habits', id, { status: 'active', paused_until: null });
}

export async function archiveHabit(store: Store, id: string): Promise<void> {
  await store.update('habits', id, { status: 'archived' });
}

export async function deleteHabit(store: Store, id: string): Promise<void> {
  await store.remove('habits', id);
}

/**
 * Sets (or clears, with `null`) the log for a habit on a date. Re-checking a day that was un-checked
 * revives the earlier row, so a habit never gets two logs for one day.
 */
export async function setHabitLog(store: Store, habitId: string, date: string, status: HabitLog['status'] | null, value?: number | null): Promise<void> {
  await store.write(async (tx) => {
    const rows = await tx.sql.all<{ id: string; deleted_at: string | null }>(
      'SELECT id, deleted_at FROM habit_logs WHERE habit_id = ? AND log_date = ? ORDER BY deleted_at IS NOT NULL, created_at',
      [habitId, date],
    );
    const live = rows.find((r) => !r.deleted_at);
    if (status === null) {
      if (live) await tx.remove('habit_logs', live.id);
      return;
    }
    const target = live ?? rows[0];
    if (target) {
      if (!live) await tx.restore('habit_logs', target.id);
      await tx.update('habit_logs', target.id, { status, value: value ?? null, logged_at: tx.nowIso() });
    } else {
      await tx.insert('habit_logs', { habit_id: habitId, log_date: date, status, value: value ?? null, logged_at: tx.nowIso() });
    }
  });
}

export async function habitLogs(store: Store, habitId: string, from?: string): Promise<HabitLog[]> {
  return store.list<HabitLog>('habit_logs', {
    where: from ? 'habit_id = ? AND log_date >= ?' : 'habit_id = ?',
    params: from ? [habitId, from] : [habitId],
    orderBy: 'log_date',
  });
}

export interface HabitToday {
  habit: Habit;
  due: boolean;
  log: HabitLog | null;
  consistency30: number | null;
}

/** Habits for a given day: what's due, what's already logged, and recent consistency. */
export async function habitsForDay(store: Store, date: string, weekStartsOn = 1): Promise<HabitToday[]> {
  const habits = await store.list<Habit>('habits', { where: "status != 'archived'", orderBy: 'rank COLLATE BINARY' });
  if (!habits.length) return [];
  const logs = await store.list<HabitLog>('habit_logs', {
    where: `habit_id IN (${habits.map(() => '?').join(',')}) AND log_date >= ?`,
    params: [...habits.map((h) => h.id), shift(date, -120)],
  });
  const byHabit = new Map<string, HabitLog[]>();
  for (const l of logs) byHabit.set(l.habit_id, [...(byHabit.get(l.habit_id) ?? []), l]);
  return habits.map((habit) => {
    const hl = byHabit.get(habit.id) ?? [];
    const entries = hl.map((l) => ({ logDate: l.log_date, status: l.status }));
    const rule = toRule(habit);
    const todayLog = hl.find((l) => l.log_date === date) ?? null;
    const dueIgnoringLog = isHabitDue(rule, date, entries.filter((e) => e.logDate !== date), weekStartsOn);
    return { habit, due: dueIgnoringLog, log: todayLog, consistency30: consistency(rule, entries, date, 30).rate };
  });
}

export async function habitStats(store: Store, habit: Habit, today: string, weekStartsOn = 1) {
  const logs = await habitLogs(store, habit.id);
  const entries = logs.map((l) => ({ logDate: l.log_date, status: l.status }));
  const rule = toRule(habit);
  return {
    logs,
    c30: consistency(rule, entries, today, 30),
    c90: consistency(rule, entries, today, 90),
    runs: runs(rule, entries, today, weekStartsOn),
    total: entries.filter((e) => e.status !== 'skipped').length,
  };
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
