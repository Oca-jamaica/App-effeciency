/**
 * Habit scheduling rules and consistency statistics.
 *
 * Philosophy (from the product brief): long-term consistency matters more than streaks. A missed day
 * lowers the consistency percentage slightly; it never erases history.
 */
import {
  addDays,
  compareDates,
  diffDays,
  enumerateDates,
  startOfMonth,
  startOfWeek,
  weekday,
  daysInMonth,
  type LocalDate,
} from './time.ts';

export type FrequencyKind = 'daily' | 'weekdays' | 'times_per_week' | 'times_per_month' | 'every_n_days';
export type HabitStatus = 'active' | 'paused' | 'archived';
export type HabitLogStatus = 'done' | 'partial' | 'skipped';

export interface HabitRule {
  frequencyKind: FrequencyKind;
  daysOfWeek: number[] | null;
  timesPerPeriod: number | null;
  intervalDays: number | null;
  startDate: LocalDate;
  endDate: LocalDate | null;
  status: HabitStatus;
  pausedUntil: LocalDate | null;
}

export interface HabitLogEntry {
  logDate: LocalDate;
  status: HabitLogStatus;
}

export function validateHabitRule(rule: HabitRule): string | null {
  switch (rule.frequencyKind) {
    case 'daily':
      return null;
    case 'weekdays':
      if (!rule.daysOfWeek?.length) return 'Choose at least one day.';
      if (rule.daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Invalid day.';
      return null;
    case 'times_per_week':
      if (!rule.timesPerPeriod || rule.timesPerPeriod < 1 || rule.timesPerPeriod > 7) return 'Choose 1–7 times per week.';
      return null;
    case 'times_per_month':
      if (!rule.timesPerPeriod || rule.timesPerPeriod < 1 || rule.timesPerPeriod > 31) return 'Choose 1–31 times per month.';
      return null;
    case 'every_n_days':
      if (!rule.intervalDays || rule.intervalDays < 2 || rule.intervalDays > 365) return 'Choose an interval of 2–365 days.';
      return null;
  }
}

/** Whether the habit is active (not paused, archived, before start or after end) on `date`. */
export function isHabitActiveOn(rule: HabitRule, date: LocalDate): boolean {
  if (rule.status === 'archived') return false;
  if (date < rule.startDate) return false;
  if (rule.endDate && date > rule.endDate) return false;
  if (rule.status === 'paused') {
    // A pause with an end date resumes automatically after it; without one it stays paused.
    if (!rule.pausedUntil || date <= rule.pausedUntil) return false;
  }
  return true;
}

function doneValue(status: HabitLogStatus): number {
  return status === 'done' ? 1 : status === 'partial' ? 0.5 : 0;
}

function indexLogs(logs: readonly HabitLogEntry[]): Map<LocalDate, HabitLogStatus> {
  const m = new Map<LocalDate, HabitLogStatus>();
  for (const l of logs) m.set(l.logDate, l.status);
  return m;
}

function countDone(logs: Map<LocalDate, HabitLogStatus>, from: LocalDate, to: LocalDate): number {
  let n = 0;
  for (const [d, s] of logs) if (d >= from && d <= to && s !== 'skipped') n += doneValue(s) > 0 ? 1 : 0;
  return n;
}

function lastDoneBefore(logs: Map<LocalDate, HabitLogStatus>, date: LocalDate): LocalDate | null {
  let best: LocalDate | null = null;
  for (const [d, s] of logs) if (d < date && s !== 'skipped' && (best === null || d > best)) best = d;
  return best;
}

/**
 * Whether the habit should be done on `date`, given its logs. A habit already logged on `date`
 * (done, partial or deliberately skipped) is not "due" any more.
 */
export function isHabitDue(
  rule: HabitRule,
  date: LocalDate,
  logs: readonly HabitLogEntry[],
  weekStartsOn = 1,
): boolean {
  if (!isHabitActiveOn(rule, date)) return false;
  const byDate = indexLogs(logs);
  if (byDate.has(date)) return false;
  return isScheduledOn(rule, date, byDate, weekStartsOn);
}

/** The rule itself, ignoring whether today is already logged. */
function isScheduledOn(
  rule: HabitRule,
  date: LocalDate,
  byDate: Map<LocalDate, HabitLogStatus>,
  weekStartsOn: number,
): boolean {
  switch (rule.frequencyKind) {
    case 'daily':
      return true;
    case 'weekdays':
      return (rule.daysOfWeek ?? []).includes(weekday(date));
    case 'every_n_days': {
      const n = rule.intervalDays ?? 2;
      const anchor = lastDoneBefore(byDate, date);
      if (!anchor) return diffDays(rule.startDate, date) % n === 0 || diffDays(rule.startDate, date) >= n;
      return diffDays(anchor, date) >= n;
    }
    case 'times_per_week':
    case 'times_per_month': {
      const target = rule.timesPerPeriod ?? 1;
      const periodStart =
        rule.frequencyKind === 'times_per_week' ? startOfWeek(date, weekStartsOn) : startOfMonth(date);
      const periodEnd =
        rule.frequencyKind === 'times_per_week'
          ? addDays(periodStart, 6)
          : addDays(periodStart, daysInMonth(date) - 1);
      const effectiveStart = periodStart < rule.startDate ? rule.startDate : periodStart;
      const doneSoFar = countDone(byDate, effectiveStart, addDays(date, -1));
      const needed = target - doneSoFar;
      if (needed <= 0) return false;
      const remainingDays = diffDays(date, periodEnd) + 1;
      if (remainingDays <= needed) return true;
      const preferred = rule.daysOfWeek;
      if (preferred?.length) return preferred.includes(weekday(date));
      const periodLength = diffDays(periodStart, periodEnd) + 1;
      const gap = Math.max(1, Math.floor(periodLength / target));
      const last = lastDoneBefore(byDate, date);
      if (!last || last < effectiveStart) {
        // Nothing yet this period: start on the first available day.
        return true;
      }
      return diffDays(last, date) >= gap;
    }
  }
}

export interface ConsistencyStats {
  /** 0–1, or null when there was nothing to do in the window yet. */
  rate: number | null;
  expected: number;
  done: number;
  windowDays: number;
}

/**
 * Consistency over the last `days` days ending at `today`. Today only counts once it has been logged,
 * so checking the app in the morning never shows an artificial dip. Skips (planned rest) are excluded
 * from both sides of the ratio.
 */
export function consistency(
  rule: HabitRule,
  logs: readonly HabitLogEntry[],
  today: LocalDate,
  days: number,
): ConsistencyStats {
  const byDate = indexLogs(logs);
  const todayLogged = byDate.has(today);
  const end = todayLogged ? today : addDays(today, -1);
  let start = addDays(today, -(days - 1));
  if (start < rule.startDate) start = rule.startDate;
  if (compareDates(start, end) > 0) return { rate: null, expected: 0, done: 0, windowDays: 0 };
  const windowDays = diffDays(start, end) + 1;

  let expected = 0;
  let done = 0;
  let skipped = 0;
  for (const d of enumerateDates(start, end)) {
    const s = byDate.get(d);
    if (s === 'skipped') skipped += 1;
    else if (s) done += doneValue(s);
  }

  switch (rule.frequencyKind) {
    case 'daily':
      expected = windowDays - skipped;
      break;
    case 'weekdays': {
      const set = new Set(rule.daysOfWeek ?? []);
      for (const d of enumerateDates(start, end)) if (set.has(weekday(d)) && byDate.get(d) !== 'skipped') expected += 1;
      // Extra sessions on non-scheduled days are welcome but cannot push consistency above 100%.
      break;
    }
    case 'times_per_week':
      expected = ((rule.timesPerPeriod ?? 1) * windowDays) / 7 - skipped;
      break;
    case 'times_per_month':
      expected = ((rule.timesPerPeriod ?? 1) * windowDays) / 30.44 - skipped;
      break;
    case 'every_n_days':
      expected = windowDays / (rule.intervalDays ?? 2) - skipped;
      break;
  }
  expected = Math.max(0, expected);
  if (expected < 0.5) return { rate: done > 0 ? 1 : null, expected, done, windowDays };
  return { rate: Math.min(1, done / expected), expected, done, windowDays };
}

export interface RunStats {
  current: number;
  best: number;
  unit: 'days' | 'weeks' | 'months';
}

/**
 * Current and best runs of meeting the habit's schedule. For daily/weekday habits the unit is days
 * (only scheduled days count; skips neither break nor extend a run). For weekly/monthly targets the
 * unit is weeks/months in which the target was met. Every-N-days habits count completed intervals.
 */
export function runs(
  rule: HabitRule,
  logs: readonly HabitLogEntry[],
  today: LocalDate,
  weekStartsOn = 1,
): RunStats {
  const byDate = indexLogs(logs);
  if (rule.frequencyKind === 'times_per_week' || rule.frequencyKind === 'times_per_month') {
    const weekly = rule.frequencyKind === 'times_per_week';
    const target = rule.timesPerPeriod ?? 1;
    const periodOf = (d: LocalDate) => (weekly ? startOfWeek(d, weekStartsOn) : startOfMonth(d));
    const next = (p: LocalDate) => (weekly ? addDays(p, 7) : addDays(p, daysInMonth(p)));
    const currentPeriod = periodOf(today);
    let best = 0;
    let streak = 0;
    let current = 0;
    for (let p = periodOf(rule.startDate); p <= currentPeriod; p = next(p)) {
      const end = weekly ? addDays(p, 6) : addDays(p, daysInMonth(p) - 1);
      const met = countDone(byDate, p, end) >= target;
      if (p === currentPeriod) {
        // The running period extends a streak once met, but does not break it while still open.
        current = met ? streak + 1 : streak;
        if (met) streak += 1;
      } else {
        streak = met ? streak + 1 : 0;
        current = streak;
      }
      best = Math.max(best, streak);
    }
    return { current, best, unit: weekly ? 'weeks' : 'months' };
  }

  // Day-based habits: walk scheduled days from the start.
  let best = 0;
  let streak = 0;
  const scheduledDays: LocalDate[] = [];
  for (const d of enumerateDates(rule.startDate, today)) {
    if (rule.frequencyKind === 'weekdays' && !(rule.daysOfWeek ?? []).includes(weekday(d))) continue;
    scheduledDays.push(d);
  }
  if (rule.frequencyKind === 'every_n_days') {
    const n = rule.intervalDays ?? 2;
    const doneDates = [...byDate.entries()]
      .filter(([, s]) => s !== 'skipped')
      .map(([d]) => d)
      .sort();
    let prev: LocalDate | null = null;
    for (const d of doneDates) {
      streak = prev && diffDays(prev, d) <= n ? streak + 1 : 1;
      best = Math.max(best, streak);
      prev = d;
    }
    const alive = prev !== null && diffDays(prev, today) <= n;
    return { current: alive ? streak : 0, best, unit: 'days' };
  }
  let current = 0;
  for (const d of scheduledDays) {
    const s = byDate.get(d);
    if (s === 'done' || s === 'partial') {
      streak += 1;
    } else if (s === 'skipped') {
      // planned rest: neither breaks nor extends
    } else if (d === today) {
      // today still open
    } else {
      streak = 0;
    }
    best = Math.max(best, streak);
    current = streak;
  }
  return { current, best, unit: 'days' };
}

/** Human description such as "3× a week" or "Mon, Wed, Fri". */
export function describeFrequency(rule: Pick<HabitRule, 'frequencyKind' | 'daysOfWeek' | 'timesPerPeriod' | 'intervalDays'>): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = (rule.daysOfWeek ?? []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  switch (rule.frequencyKind) {
    case 'daily':
      return 'Every day';
    case 'weekdays':
      if (days.join() === '1,2,3,4,5') return 'Weekdays';
      if (days.length === 7) return 'Every day';
      return days.map((d) => names[d]).join(', ');
    case 'times_per_week':
      return `${rule.timesPerPeriod ?? 1}× a week${days.length ? ` (prefers ${days.map((d) => names[d]).join(', ')})` : ''}`;
    case 'times_per_month':
      return `${rule.timesPerPeriod ?? 1}× a month`;
    case 'every_n_days':
      return `Every ${rule.intervalDays ?? 2} days`;
  }
}

/** Month grid helper for the history calendar. */
export function monthStatus(
  rule: HabitRule,
  logs: readonly HabitLogEntry[],
  month: LocalDate,
): { date: LocalDate; status: HabitLogStatus | null; scheduled: boolean }[] {
  const byDate = indexLogs(logs);
  const first = startOfMonth(month);
  const n = daysInMonth(month);
  const out: { date: LocalDate; status: HabitLogStatus | null; scheduled: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const d = addDays(first, i);
    const scheduled =
      isHabitActiveOn(rule, d) &&
      (rule.frequencyKind !== 'weekdays' || (rule.daysOfWeek ?? []).includes(weekday(d)));
    out.push({ date: d, status: byDate.get(d) ?? null, scheduled });
  }
  return out;
}
