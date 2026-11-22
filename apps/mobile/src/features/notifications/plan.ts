/**
 * Decides which local notifications to schedule for the next week. Restraint is deliberate: only
 * reminders the user asked for, quiet hours respected, a daily cap, and the iOS limit of 64 pending.
 */
import { addDays, isHabitDue, localToUtc, parseTime, utcToLocalDate, utcToLocalMinutes, type TimerState } from '@ascend/domain';
import type { Store } from '../../data/store.ts';
import type { Habit, HabitLog, Preferences, Reminder, ScheduleBlock } from '../../data/types.ts';
import { toRule } from '../habits/repo.ts';

export interface PlannedNotification {
  key: string;
  at: number;
  title: string;
  body: string;
  kind: 'reminder' | 'habit' | 'focus' | 'block';
}

export const MAX_PENDING = 60;
const HORIZON_DAYS = 7;

function inQuietHours(ms: number, tz: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const m = utcToLocalMinutes(ms, tz);
  const s = parseTime(start);
  const e = parseTime(end);
  return s <= e ? m >= s && m < e : m >= s || m < e;
}

export async function planNotifications(store: Store, now: number, tz: string, timer: TimerState | null = null): Promise<PlannedNotification[]> {
  const [prefs] = await store.list<Preferences>('user_preferences', { limit: 1 });
  const today = utcToLocalDate(now, tz);
  const until = now + HORIZON_DAYS * 86400_000;
  const out: PlannedNotification[] = [];

  // Reminders the user set explicitly always fire, even in quiet hours.
  const reminders = await store.list<Reminder>('reminders', { where: 'done_at IS NULL AND remind_at > ? AND remind_at <= ?', params: [new Date(now).toISOString(), new Date(until).toISOString()] });
  for (const r of reminders) out.push({ key: `reminder:${r.id}`, at: Date.parse(r.remind_at), title: r.title, body: 'Reminder', kind: 'reminder' });

  // Habit reminders on the days each habit is due.
  const habits = await store.list<Habit>('habits', { where: "status = 'active' AND reminder_times != '[]'" });
  if (habits.length) {
    const logs = await store.list<HabitLog>('habit_logs', { where: `habit_id IN (${habits.map(() => '?').join(',')}) AND log_date >= ?`, params: [...habits.map((h) => h.id), addDays(today, -40)] });
    for (const h of habits) {
      const entries = logs.filter((l) => l.habit_id === h.id).map((l) => ({ logDate: l.log_date, status: l.status }));
      for (let i = 0; i < HORIZON_DAYS; i++) {
        const d = addDays(today, i);
        if (!isHabitDue(toRule(h), d, entries)) continue;
        for (const t of h.reminder_times) {
          const at = localToUtc(d, parseTime(t), tz);
          if (at > now && at <= until) out.push({ key: `habit:${h.id}:${d}:${t}`, at, title: h.name, body: h.duration_minutes ? `${h.duration_minutes} minutes · due today` : 'Due today', kind: 'habit' });
        }
      }
    }
  }

  // The focus timer reaching its planned length.
  if (timer && timer.pausedAt === null && timer.plannedMinutes) {
    const at = timer.startedAt + timer.pausedMs + timer.plannedMinutes * 60_000;
    if (at > now) out.push({ key: `focus:${timer.sessionId}`, at, title: 'Focus session complete', body: 'Time for a short break.', kind: 'focus' });
  }

  // Optional: a nudge five minutes before each planned block today.
  if (prefs?.notify_block_start) {
    const blocks = await store.list<ScheduleBlock>('schedule_blocks', { where: "block_date = ? AND status = 'planned' AND kind IN ('task','habit')", params: [today] });
    for (const b of blocks) {
      const at = Date.parse(b.starts_at) - 5 * 60_000;
      if (at > now) out.push({ key: `block:${b.id}`, at, title: b.title, body: 'Starts in 5 minutes', kind: 'block' });
    }
  }

  // Quiet hours (except explicit reminders and a running timer), then the daily cap.
  const filtered = out.filter((n) => n.kind === 'reminder' || n.kind === 'focus' || !inQuietHours(n.at, tz, prefs?.quiet_hours_start ?? null, prefs?.quiet_hours_end ?? null));
  const cap = prefs?.max_notifications_per_day ?? 8;
  const byDay = new Map<string, PlannedNotification[]>();
  for (const n of filtered.sort((a, b) => a.at - b.at)) {
    const d = utcToLocalDate(n.at, tz);
    byDay.set(d, [...(byDay.get(d) ?? []), n]);
  }
  const kept: PlannedNotification[] = [];
  for (const list of byDay.values()) {
    const must = list.filter((n) => n.kind === 'reminder' || n.kind === 'focus');
    const rest = list.filter((n) => n.kind !== 'reminder' && n.kind !== 'focus').slice(0, Math.max(0, cap - must.length));
    kept.push(...must, ...rest);
  }
  return kept.sort((a, b) => a.at - b.at).slice(0, MAX_PENDING);
}
