/** Bridges the preview's records to the real ASCEND domain logic (the same code the mobile app runs). */
import {
  DEFAULT_SCHEDULER_PREFS, addDays, consistency, findFreeSlot, goalProgress, isHabitDue, isReplaceable, localToUtc, parseTime, planDay, runs,
  type ExistingBlock, type HabitRule, type PlanInput, type PlanResult, type Progress,
} from '../../../packages/domain/src/index.ts';
import { TZ, eventInstants, occursOn, store, uid, type Block, type CalEvent, type Goal, type Habit, type Task } from './store.ts';

export function habitRule(h: Habit): HabitRule {
  return { frequencyKind: h.freq, daysOfWeek: h.days, timesPerPeriod: h.times, intervalDays: h.interval, startDate: h.startDate, endDate: null, status: h.status, pausedUntil: null };
}

export function habitEntries(habitId: string) {
  return store.all('hlog').filter((l) => l.habitId === habitId).map((l) => ({ logDate: l.date, status: l.status }));
}

export function habitDay(date: string) {
  return store
    .all('habit')
    .filter((h) => h.status !== 'archived')
    .sort((a, b) => a.rank - b.rank)
    .map((habit) => {
      const entries = habitEntries(habit.id);
      const log = store.get<import('./store.ts').HabitLog>(`${habit.id}_${date}`) ?? null;
      const due = isHabitDue(habitRule(habit), date, entries.filter((e) => e.logDate !== date));
      return { habit, due, log, c30: consistency(habitRule(habit), entries, date, 30), runs: runs(habitRule(habit), entries, date) };
    });
}

export function setHabitLog(habitId: string, date: string, status: 'done' | 'partial' | 'skipped' | null) {
  const id = `${habitId}_${date}`;
  if (status === null) store.remove(id);
  else store.save({ id, kind: 'hlog', habitId, date, status });
}

export function goalProgressFor(goal: Goal): Progress {
  return goalProgress({
    mode: goal.mode,
    milestones: store.all('milestone').filter((m) => m.goalId === goal.id).map((m) => ({ status: m.done ? ('done' as const) : ('open' as const) })),
    tasks: store.all('task').filter((t) => t.goalId === goal.id),
    targetValue: goal.target,
    currentValue: goal.current,
    manualPercent: goal.manual,
  });
}

export function activeGoals(): Goal[] {
  return store.all('goal').filter((g) => g.status === 'active' || g.status === 'paused').sort((a, b) => a.rank - b.rank);
}

export function eventsOn(date: string): { event: CalEvent; start: number; end: number }[] {
  return store
    .all('event')
    .filter((e) => occursOn(e, date))
    .map((event) => ({ event, ...eventInstants(event, date) }))
    .sort((a, b) => a.start - b.start);
}

function toExisting(b: Block): ExistingBlock {
  return { id: b.id, start: b.start, end: b.end, kind: b.type, taskId: b.taskId, habitId: b.habitId, title: b.title, origin: b.origin, isLocked: b.locked, status: b.status === 'missed' ? 'missed' : b.status };
}

export function blocksOn(date: string): Block[] {
  return store.all('block').filter((b) => b.date === date).sort((a, b) => a.start - b.start);
}

export function buildInput(date: string, now: number): PlanInput {
  const p = store.prefs();
  const goals = store.all('goal').filter((g) => g.status === 'active').sort((a, b) => a.rank - b.rank);
  const goalRank = new Map(goals.map((g, i) => [g.id, { rank: i + 1, title: g.title }]));
  const milestones = new Map(store.all('milestone').map((m) => [m.id, m]));
  const parents = new Set<string>();
  const doneMinutes = new Map<string, number>();
  for (const b of store.all('block')) {
    if (b.taskId && b.status === 'done') doneMinutes.set(b.taskId, (doneMinutes.get(b.taskId) ?? 0) + Math.round((b.end - b.start) / 60_000));
  }
  const tasks = store
    .all('task')
    .filter((t) => (t.status === 'planned' || t.status === 'in_progress' || (t.status === 'inbox' && t.due)) && !parents.has(t.id))
    .map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      status: t.status as 'inbox' | 'planned' | 'in_progress',
      dueDate: t.due,
      doDate: t.doDate,
      estimatedMinutes: t.estimate,
      recordedMinutes: doneMinutes.get(t.id) ?? 0,
      splittable: t.splittable,
      minChunkMinutes: 25,
      preferredWindow: t.window,
      goalRank: t.goalId ? goalRank.get(t.goalId)?.rank ?? null : null,
      goalTitle: t.goalId ? goalRank.get(t.goalId)?.title ?? null : null,
      milestoneDeadline: t.milestoneId ? (milestones.get(t.milestoneId)?.done ? null : milestones.get(t.milestoneId)?.deadline ?? null) : null,
      contextWindow: null,
      createdAt: t.createdAt,
    }));
  const habits = habitDay(date)
    .filter((h) => h.due && !h.log && h.habit.status === 'active')
    .map((h) => ({ id: h.habit.id, name: h.habit.name, durationMinutes: h.habit.duration, preferredWindow: h.habit.window, preferredTimeMinutes: h.habit.time ? parseTime(h.habit.time) : null, rank: String(h.habit.rank).padStart(6, '0') }));
  const events = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(date, i);
    for (const o of eventsOn(d)) events.push({ id: `${o.event.id}:${d}`, title: o.event.title, start: o.start, end: o.end, busy: o.event.busy, kind: o.event.type });
  }
  const windows = p.study ? p.study.days.map((weekday) => ({ weekday, startMinutes: parseTime(p.study!.from), endMinutes: parseTime(p.study!.to), kind: 'study' as const })) : [];
  return {
    date,
    timeZone: TZ,
    now,
    prefs: {
      ...DEFAULT_SCHEDULER_PREFS,
      dayStartMinutes: parseTime(p.dayStart),
      dayEndMinutes: parseTime(p.dayEnd),
      defaultTaskMinutes: p.defaultEstimate,
      maxFocusMinutesPerDay: p.maxFocus,
      minFreeMinutesPerDay: p.minFree,
      breakAfterMinutes: p.breakAfter,
      breakMinutes: p.breakLen,
      bufferMinutes: p.buffer,
      maxBlockMinutes: Math.min(90, p.breakAfter),
    },
    windows,
    events,
    blocks: blocksOn(date).map(toExisting),
    tasks,
    habits,
    horizonDays: 7,
  };
}

/** Plans today and saves only the blocks that changed. Never touches locked, manual, done or past blocks. */
export function replanToday(date: string, now: number): PlanResult {
  // Planned blocks whose time has passed become "missed" (never deleted).
  const missed = blocksOn(date).filter((b) => b.status === 'planned' && b.type !== 'break' && b.end <= now);
  if (missed.length) store.save(...missed.map((b) => ({ ...b, status: 'missed' as const })));
  const input = buildInput(date, now);
  const plan = planDay(input);
  const existing = blocksOn(date);
  const replaceable = existing.filter((b) => isReplaceable(toExisting(b), now));
  const wanted = new Map(plan.blocks.map((b) => [`b_${date}_${b.key.replace(/[^a-zA-Z0-9-]/g, '_')}`, b]));
  const removals = replaceable.filter((b) => !wanted.has(b.id)).map((b) => b.id);
  const writes: Block[] = [];
  for (const [id, b] of wanted) {
    const next: Block = { id, kind: 'block', date, start: b.start, end: b.end, type: b.kind, taskId: b.taskId, habitId: b.habitId, title: b.title, origin: 'auto', locked: false, status: 'planned', reason: b.reason };
    const cur = store.get<Block>(id);
    if (!cur || JSON.stringify(cur) !== JSON.stringify(next)) writes.push(next);
  }
  if (removals.length) store.remove(...removals);
  if (writes.length) store.save(...writes);
  return plan;
}

export function previewDay(date: string, now: number): PlanResult {
  return planDay(buildInput(date, now));
}

export function laterTodaySlot(date: string, now: number, minutes: number) {
  const input = buildInput(date, now);
  return findFreeSlot(input, { blocks: [] }, minutes, now);
}

export function moveMissedTo(block: Block, slot: { start: number; end: number }) {
  store.save({ ...block, status: 'skipped' }, { ...block, id: uid(), start: slot.start, end: slot.end, origin: 'manual', status: 'planned', reason: 'Rescheduled after a missed block' });
}

export function minutesBetween(a: number, b: number) {
  return Math.round((b - a) / 60_000);
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: TZ });
}

export function dateLabel(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, opts);
}

export function atLocal(date: string, minutes: number) {
  return localToUtc(date, minutes, TZ);
}

export function taskById(id: string | null) {
  return id ? store.get<Task>(id) : undefined;
}

export function hourLabel(date: string, hour: number): string {
  return new Date(localToUtc(date, (hour % 24) * 60, TZ)).toLocaleTimeString(undefined, { hour: 'numeric', timeZone: TZ });
}
