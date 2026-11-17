/**
 * ASCEND's deterministic daily scheduler. See docs/04-scheduler.md for the specification.
 *
 * `planDay` is a pure function: the same input always produces the same plan. Every placed block
 * carries a human-readable reason, nothing is ever dropped silently (anything not placed appears in
 * `unscheduled` with a reason), and fixed commitments and kept blocks are never moved.
 */
import {
  MINUTE,
  addDays,
  diffDays,
  localToUtc,
  minDate,
  roundUpToStep,
  utcToLocalDate,
  weekday,
  type LocalDate,
} from './time.ts';

export const ALGORITHM_VERSION = 'sched-1.0.0';

export type PreferredWindow = 'any' | 'morning' | 'afternoon' | 'evening' | 'work' | 'study';
export type AvailabilityKind = 'work' | 'study' | 'training' | 'protected_free' | 'no_scheduling';
export type BlockKind = 'task' | 'habit' | 'break' | 'protected_free' | 'training' | 'focus' | 'custom';
export type BlockStatus = 'planned' | 'in_progress' | 'done' | 'partial' | 'missed' | 'skipped' | 'unplanned';
export type BlockOrigin = 'auto' | 'manual' | 'ai';

export interface SchedulerPrefs {
  dayStartMinutes: number;
  dayEndMinutes: number;
  defaultTaskMinutes: number;
  maxFocusMinutesPerDay: number;
  maxBlockMinutes: number;
  breakAfterMinutes: number;
  breakMinutes: number;
  bufferMinutes: number;
  minFreeMinutesPerDay: number;
}

export const DEFAULT_SCHEDULER_PREFS: SchedulerPrefs = {
  dayStartMinutes: 7 * 60,
  dayEndMinutes: 22 * 60 + 30,
  defaultTaskMinutes: 30,
  maxFocusMinutesPerDay: 6 * 60,
  maxBlockMinutes: 90,
  breakAfterMinutes: 90,
  breakMinutes: 15,
  bufferMinutes: 10,
  minFreeMinutesPerDay: 120,
};

export interface AvailabilityWindow {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  kind: AvailabilityKind;
}

export interface FixedEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  busy: boolean;
  kind: string;
}

export interface ExistingBlock {
  id: string;
  start: number;
  end: number;
  kind: BlockKind;
  taskId: string | null;
  habitId: string | null;
  title: string;
  origin: BlockOrigin;
  isLocked: boolean;
  status: BlockStatus;
}

export interface SchedulableTask {
  id: string;
  title: string;
  priority: number;
  status: 'inbox' | 'planned' | 'in_progress';
  dueDate: LocalDate | null;
  doDate: LocalDate | null;
  estimatedMinutes: number | null;
  /** Minutes of work already recorded against this task (focus sessions, completed blocks). */
  recordedMinutes: number;
  splittable: boolean;
  minChunkMinutes: number;
  preferredWindow: PreferredWindow;
  /** 1-based position of the linked goal in the user's priority list (active goals only). */
  goalRank: number | null;
  goalTitle?: string | null;
  milestoneDeadline: LocalDate | null;
  /** Availability window implied by the task's category (e.g. academics → study hours). */
  contextWindow: 'study' | 'work' | 'training' | null;
  createdAt: string;
}

export interface SchedulableHabit {
  id: string;
  name: string;
  durationMinutes: number | null;
  preferredWindow: PreferredWindow;
  preferredTimeMinutes: number | null;
  rank: string;
}

export interface PlanInput {
  date: LocalDate;
  timeZone: string;
  now: number;
  prefs: SchedulerPrefs;
  windows: readonly AvailabilityWindow[];
  /** Events overlapping the planning day and the look-ahead horizon (recurrences already expanded). */
  events: readonly FixedEvent[];
  /** Existing schedule blocks for the planning day. */
  blocks: readonly ExistingBlock[];
  tasks: readonly SchedulableTask[];
  /** Habits that are due on the planning day and not yet logged. */
  habits: readonly SchedulableHabit[];
  horizonDays?: number;
}

export interface PlannedBlock {
  key: string;
  kind: 'task' | 'habit' | 'break';
  taskId: string | null;
  habitId: string | null;
  title: string;
  start: number;
  end: number;
  reason: string;
}

export type UnscheduledReason = 'day_full' | 'no_slot' | 'partially_scheduled' | 'outside_day';

export interface UnscheduledItem {
  kind: 'task' | 'habit';
  id: string;
  title: string;
  neededMinutes: number;
  scheduledMinutes: number;
  reason: UnscheduledReason;
  message: string;
}

export interface PlanWarning {
  code: 'overload_today' | 'deadline_at_risk' | 'day_over';
  message: string;
  taskIds: string[];
}

export interface PlanMetrics {
  focusMinutes: number;
  habitMinutes: number;
  breakMinutes: number;
  freeMinutesKept: number;
  focusBudgetMinutes: number;
}

export interface PlanResult {
  date: LocalDate;
  blocks: PlannedBlock[];
  /** Existing blocks that were preserved as-is (locked, manual, started, done, past). */
  kept: ExistingBlock[];
  unscheduled: UnscheduledItem[];
  untimedHabitIds: string[];
  warnings: PlanWarning[];
  metrics: PlanMetrics;
  atRiskTaskIds: string[];
  algorithmVersion: string;
}

interface Interval {
  start: number;
  end: number;
}

const STEP_MINUTES = 5;
const MIN_USEFUL_SLOT = 15 * MINUTE;
const NAMED_WINDOWS: Record<'morning' | 'afternoon' | 'evening', [number, number]> = {
  morning: [6 * 60, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 22 * 60],
};
const WORK_EVENT_KINDS = new Set(['work', 'class']);

// ───────────────────────────── interval helpers ─────────────────────────────

function normalize(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

function subtract(base: Interval[], remove: Interval[]): Interval[] {
  let result = normalize(base);
  for (const r of normalize(remove)) {
    const next: Interval[] = [];
    for (const b of result) {
      if (r.end <= b.start || r.start >= b.end) {
        next.push(b);
        continue;
      }
      if (r.start > b.start) next.push({ start: b.start, end: r.start });
      if (r.end < b.end) next.push({ start: r.end, end: b.end });
    }
    result = next;
  }
  return result;
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) for (const y of b) {
    const start = Math.max(x.start, y.start);
    const end = Math.min(x.end, y.end);
    if (end > start) out.push({ start, end });
  }
  return normalize(out);
}

function total(intervals: Interval[]): number {
  return intervals.reduce((s, i) => s + (i.end - i.start), 0);
}

function minutes(ms: number): number {
  return Math.round(ms / MINUTE);
}

// ───────────────────────────── day frame ─────────────────────────────

function dayBounds(date: LocalDate, input: Pick<PlanInput, 'timeZone' | 'prefs'>): Interval {
  const start = localToUtc(date, input.prefs.dayStartMinutes, input.timeZone);
  const end = localToUtc(date, Math.min(input.prefs.dayEndMinutes, 24 * 60), input.timeZone);
  return { start, end: Math.max(start, end) };
}

function windowRanges(
  date: LocalDate,
  input: Pick<PlanInput, 'timeZone' | 'windows'>,
  kinds: AvailabilityKind[],
): Interval[] {
  const wd = weekday(date);
  return normalize(
    input.windows
      .filter((w) => w.weekday === wd && kinds.includes(w.kind))
      .map((w) => ({
        start: localToUtc(date, w.startMinutes, input.timeZone),
        end: localToUtc(date, w.endMinutes, input.timeZone),
      })),
  );
}

function namedRange(date: LocalDate, timeZone: string, name: 'morning' | 'afternoon' | 'evening'): Interval[] {
  const [s, e] = NAMED_WINDOWS[name];
  return [{ start: localToUtc(date, s, timeZone), end: localToUtc(date, e, timeZone) }];
}

function preferredRanges(
  date: LocalDate,
  input: Pick<PlanInput, 'timeZone' | 'windows'>,
  pref: PreferredWindow,
): Interval[] | null {
  switch (pref) {
    case 'any':
      return null;
    case 'morning':
    case 'afternoon':
    case 'evening':
      return namedRange(date, input.timeZone, pref);
    case 'work':
      return windowRanges(date, input, ['work']);
    case 'study':
      return windowRanges(date, input, ['study']);
  }
}

/** Blocks that a re-plan is allowed to replace: future, automatic, unlocked and not started. */
export function isReplaceable(block: ExistingBlock, now: number): boolean {
  return block.origin === 'auto' && !block.isLocked && block.status === 'planned' && block.start >= now;
}

function obstaclesFor(
  date: LocalDate,
  input: Pick<PlanInput, 'timeZone' | 'windows' | 'events' | 'prefs'>,
  keptBlocks: readonly ExistingBlock[],
): Interval[] {
  const buffer = input.prefs.bufferMinutes * MINUTE;
  const obstacles: Interval[] = [];
  for (const e of input.events) {
    if (!e.busy) continue;
    obstacles.push({ start: e.start - buffer, end: e.end + buffer });
  }
  for (const b of keptBlocks) {
    if (b.status === 'unplanned' || b.status === 'skipped') continue;
    obstacles.push({ start: b.start, end: b.end });
  }
  obstacles.push(...windowRanges(date, input, ['protected_free', 'no_scheduling']));
  return obstacles;
}

function freeIntervals(frame: Interval, obstacles: Interval[]): Interval[] {
  return subtract([frame], obstacles).filter((i) => i.end - i.start >= MIN_USEFUL_SLOT);
}

// ───────────────────────────── scoring ─────────────────────────────

export function effectiveDueDate(task: Pick<SchedulableTask, 'dueDate' | 'milestoneDeadline'>): LocalDate | null {
  return minDate(task.dueDate, task.milestoneDeadline);
}

export interface ScoreBreakdown {
  total: number;
  priority: number;
  urgency: number;
  risk: number;
  goal: number;
  commitment: number;
}

export function scoreTask(task: SchedulableTask, date: LocalDate, atRisk: boolean): ScoreBreakdown {
  const priority = ({ 1: 40, 2: 25, 3: 12, 4: 0 } as Record<number, number>)[task.priority] ?? 12;
  const due = effectiveDueDate(task);
  let urgency = 0;
  if (due) {
    const days = diffDays(date, due);
    urgency = days < 0 ? 50 : days === 0 ? 45 : Math.max(0, 40 - 6 * days);
  }
  const risk = atRisk ? 15 : 0;
  const goal = task.goalRank ? Math.max(0, 20 - 4 * (task.goalRank - 1)) : 0;
  let commitment = 0;
  if (task.doDate === date) commitment += 30;
  if (task.status === 'in_progress') commitment += 8;
  return { total: priority + urgency + risk + goal + commitment, priority, urgency, risk, goal, commitment };
}

function dueLabel(task: SchedulableTask, date: LocalDate): string | null {
  const due = effectiveDueDate(task);
  if (!due) return null;
  const days = diffDays(date, due);
  if (days < 0) return 'overdue';
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}

// ───────────────────────────── planning state ─────────────────────────────

class DayState {
  free: Interval[];
  work: Interval[];
  readonly breakAfter: number;
  readonly breakGap: number;

  constructor(free: Interval[], work: Interval[], prefs: SchedulerPrefs) {
    this.free = free;
    this.work = normalize(work);
    this.breakAfter = prefs.breakAfterMinutes * MINUTE;
    this.breakGap = prefs.breakMinutes * MINUTE;
  }

  /** Length of the continuous work run that [s, e) would belong to (gaps shorter than a break count as work). */
  runLength(s: number, e: number): number {
    let rs = s;
    let re = e;
    let changed = true;
    while (changed) {
      changed = false;
      for (const w of this.work) {
        if (w.end > rs - this.breakGap && w.start < re + this.breakGap && (w.start < rs || w.end > re)) {
          rs = Math.min(rs, w.start);
          re = Math.max(re, w.end);
          changed = true;
        }
      }
    }
    return re - rs;
  }

  findSlot(duration: number, ranges: Interval[] | null, isWork: boolean, notBefore: number): Interval | null {
    const candidates = ranges ? intersect(this.free, ranges) : this.free;
    for (const c of candidates) {
      let s = roundUpToStep(Math.max(c.start, notBefore), STEP_MINUTES);
      while (s + duration <= c.end) {
        if (!isWork || this.runLength(s, s + duration) <= Math.max(this.breakAfter, duration)) {
          return { start: s, end: s + duration };
        }
        s += STEP_MINUTES * MINUTE;
      }
    }
    return null;
  }

  isFree(slot: Interval): boolean {
    return this.free.some((f) => f.start <= slot.start && f.end >= slot.end);
  }

  occupy(slot: Interval, isWork: boolean): void {
    this.free = subtract(this.free, [slot]);
    if (isWork) this.work = normalize([...this.work, slot]);
  }

  freeTotal(): number {
    return total(this.free);
  }
}

// ───────────────────────────── main entry point ─────────────────────────────

export function planDay(input: PlanInput): PlanResult {
  const { date, prefs, timeZone } = input;
  const nowStep = roundUpToStep(input.now, STEP_MINUTES);
  const bounds = dayBounds(date, input);
  const frame: Interval = { start: Math.max(bounds.start, nowStep), end: bounds.end };
  const isToday = utcToLocalDate(input.now, timeZone) === date;
  const dayLength = bounds.end - bounds.start;

  const kept = input.blocks.filter((b) => !isReplaceable(b, input.now));
  const previous = input.blocks.filter((b) => isReplaceable(b, input.now));

  const blocks: PlannedBlock[] = [];
  const unscheduled: UnscheduledItem[] = [];
  const warnings: PlanWarning[] = [];
  const untimedHabitIds: string[] = [];

  const dayEvents = input.events.filter((e) => e.end > bounds.start && e.start < bounds.end);
  const obstacles = obstaclesFor(date, { ...input, events: dayEvents }, kept);
  const workSeed: Interval[] = [
    ...kept
      .filter((b) => (b.kind === 'task' || b.kind === 'focus') && b.status !== 'unplanned' && b.status !== 'skipped')
      .map((b) => ({ start: b.start, end: b.end })),
    ...dayEvents.filter((e) => WORK_EVENT_KINDS.has(e.kind)).map((e) => ({ start: e.start, end: e.end })),
  ];
  const state = new DayState(frame.end > frame.start ? freeIntervals(frame, obstacles) : [], workSeed, prefs);

  if (frame.end <= frame.start) {
    warnings.push({
      code: 'day_over',
      message: 'Your planning day has ended. Remaining work can be planned for tomorrow.',
      taskIds: [],
    });
  }

  // ── 1. Habits ──
  const keptHabitIds = new Set(kept.filter((b) => b.habitId).map((b) => b.habitId as string));
  const habitOrder = [...input.habits].sort((a, b) => {
    const at = a.preferredTimeMinutes !== null ? 0 : 1;
    const bt = b.preferredTimeMinutes !== null ? 0 : 1;
    if (at !== bt) return at - bt;
    const aw = a.preferredWindow === 'any' ? 1 : 0;
    const bw = b.preferredWindow === 'any' ? 1 : 0;
    if (aw !== bw) return aw - bw;
    return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1;
  });
  let habitMinutes = 0;
  for (const h of habitOrder) {
    if (keptHabitIds.has(h.id)) continue;
    if (!h.durationMinutes) {
      untimedHabitIds.push(h.id);
      continue;
    }
    const duration = h.durationMinutes * MINUTE;
    let slot: Interval | null = null;
    let where = '';
    if (h.preferredTimeMinutes !== null) {
      const s = localToUtc(date, h.preferredTimeMinutes, timeZone);
      const exact = { start: s, end: s + duration };
      if (state.isFree(exact)) {
        slot = exact;
        where = 'at your preferred time';
      }
    }
    if (!slot) {
      const ranges = preferredRanges(date, input, h.preferredWindow);
      if (ranges) {
        slot = state.findSlot(duration, ranges, false, frame.start);
        if (slot) where = `in the ${h.preferredWindow}`;
      }
    }
    if (!slot) {
      slot = state.findSlot(duration, null, false, frame.start);
      if (slot) where = 'in the first free slot';
    }
    if (slot) {
      state.occupy(slot, false);
      habitMinutes += h.durationMinutes;
      blocks.push({
        key: `habit:${h.id}:${slot.start}`,
        kind: 'habit',
        taskId: null,
        habitId: h.id,
        title: h.name,
        start: slot.start,
        end: slot.end,
        reason: `Habit due today · ${where}`,
      });
    } else {
      unscheduled.push({
        kind: 'habit',
        id: h.id,
        title: h.name,
        neededMinutes: h.durationMinutes,
        scheduledMinutes: 0,
        reason: frame.end <= frame.start ? 'outside_day' : 'no_slot',
        message: `No free ${h.durationMinutes}-minute gap today.`,
      });
    }
  }

  // ── 2. Focus budget (protects free time) ──
  const keptTaskMinutes = minutes(
    total(
      normalize(
        kept
          .filter((b) => (b.kind === 'task' || b.kind === 'focus') && b.status !== 'unplanned' && b.status !== 'skipped' && b.status !== 'missed')
          .map((b) => ({ start: b.start, end: b.end })),
      ),
    ),
  );
  const remainingShare = dayLength > 0 ? Math.max(0, Math.min(1, (bounds.end - frame.start) / dayLength)) : 0;
  const minFreeEffective = Math.round(prefs.minFreeMinutesPerDay * (isToday ? remainingShare : 1));
  const focusBudget = Math.max(
    0,
    Math.min(prefs.maxFocusMinutesPerDay - keptTaskMinutes, minutes(state.freeTotal()) - minFreeEffective),
  );

  // ── 3. Candidate tasks & needs ──
  const keptMinutesByTask = new Map<string, number>();
  for (const b of kept) {
    if (!b.taskId || b.status === 'unplanned' || b.status === 'skipped' || b.status === 'missed' || b.status === 'done') continue;
    keptMinutesByTask.set(b.taskId, (keptMinutesByTask.get(b.taskId) ?? 0) + minutes(b.end - b.start));
  }
  const candidates = input.tasks.filter((t) => !t.doDate || t.doDate <= date);
  const needs = new Map<string, number>();
  for (const t of candidates) {
    const estimate = t.estimatedMinutes ?? prefs.defaultTaskMinutes;
    let need = estimate - t.recordedMinutes - (keptMinutesByTask.get(t.id) ?? 0);
    if (need <= 0 && !keptMinutesByTask.has(t.id) && t.recordedMinutes >= estimate) {
      // Over its estimate but not finished: plan a short finishing session rather than nothing.
      need = Math.min(estimate, Math.max(t.minChunkMinutes, 25));
    }
    needs.set(t.id, Math.max(0, roundUpToStep(need * MINUTE, STEP_MINUTES) / MINUTE));
  }

  // ── 4. Look-ahead: deadline feasibility (earliest deadline first) ──
  const horizonDays = input.horizonDays ?? 7;
  const atRisk = new Set<string>();
  {
    const capacity: number[] = [];
    for (let i = 0; i < horizonDays; i++) {
      if (i === 0) {
        capacity.push(focusBudget);
        continue;
      }
      const d = addDays(date, i);
      const b = dayBounds(d, input);
      const evs = input.events.filter((e) => e.end > b.start && e.start < b.end);
      const free = freeIntervals(b, obstaclesFor(d, { ...input, events: evs }, []));
      capacity.push(
        Math.max(0, Math.min(prefs.maxFocusMinutesPerDay, minutes(total(free)) - prefs.minFreeMinutesPerDay - habitMinutes)),
      );
    }
    const dated = candidates
      .map((t) => ({ t, due: effectiveDueDate(t) }))
      .filter((x): x is { t: SchedulableTask; due: LocalDate } => x.due !== null && diffDays(date, x.due) < horizonDays)
      .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.t.id < b.t.id ? -1 : 1));
    let cumulativeNeed = 0;
    let firstWarning: { due: LocalDate; need: number; cap: number } | null = null;
    for (let i = 0; i < dated.length; i++) {
      const { t, due } = dated[i] as { t: SchedulableTask; due: LocalDate };
      cumulativeNeed += needs.get(t.id) ?? 0;
      const lastIndex = Math.max(0, diffDays(date, due));
      const cap = capacity.slice(0, lastIndex + 1).reduce((s, c) => s + c, 0);
      const nextDue = dated[i + 1]?.due;
      if (nextDue === due) continue; // evaluate once per deadline date
      if (cumulativeNeed > cap) {
        for (const x of dated.slice(0, i + 1)) atRisk.add(x.t.id);
        if (!firstWarning) firstWarning = { due, need: cumulativeNeed, cap };
      }
    }
    if (firstWarning) {
      const days = diffDays(date, firstWarning.due);
      const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
      warnings.push({
        code: 'deadline_at_risk',
        message: `Work due ${when} needs about ${formatHours(firstWarning.need)}, but only about ${formatHours(
          firstWarning.cap,
        )} of planning time is free before then.`,
        taskIds: [...atRisk].sort(),
      });
    }
  }

  // ── 5. Score & order ──
  const scored = candidates
    .map((t) => ({ t, score: scoreTask(t, date, atRisk.has(t.id)) }))
    .sort((a, b) => {
      if (b.score.total !== a.score.total) return b.score.total - a.score.total;
      const ad = effectiveDueDate(a.t) ?? '9999-12-31';
      const bd = effectiveDueDate(b.t) ?? '9999-12-31';
      if (ad !== bd) return ad < bd ? -1 : 1;
      if (a.t.createdAt !== b.t.createdAt) return a.t.createdAt < b.t.createdAt ? -1 : 1;
      return a.t.id < b.t.id ? -1 : 1;
    });

  // ── 6. Overload check for must-do work ──
  const mustDo = scored.filter(({ t }) => {
    const due = effectiveDueDate(t);
    return (due !== null && due <= date) || t.doDate === date;
  });
  const mustDoNeed = mustDo.reduce((s, { t }) => s + (needs.get(t.id) ?? 0), 0);
  if (frame.end > frame.start && mustDoNeed > focusBudget) {
    warnings.push({
      code: 'overload_today',
      message: `Work that must happen today needs about ${formatHours(mustDoNeed)}; today has about ${formatHours(
        focusBudget,
      )} of planning time after protecting your free time.`,
      taskIds: mustDo.map(({ t }) => t.id),
    });
  }

  // ── 7. Place tasks ──
  let focusUsed = 0;
  const maxChunk = Math.min(prefs.maxBlockMinutes, prefs.breakAfterMinutes);
  for (const { t, score } of scored) {
    let remaining = needs.get(t.id) ?? 0;
    const needed = remaining;
    if (remaining <= 0) continue;
    const reasonParts = [`P${t.priority}`];
    const due = dueLabel(t, date);
    if (due) reasonParts.push(due);
    if (t.goalRank) reasonParts.push(`Goal #${t.goalRank}${t.goalTitle ? ` ${t.goalTitle}` : ''}`);
    if (t.doDate === date) reasonParts.push('planned for today');
    if (score.risk) reasonParts.push('deadline at risk');

    const tiers: { ranges: Interval[] | null; label: string | null }[] = [];
    const pref = preferredRanges(date, input, t.preferredWindow);
    if (pref) tiers.push({ ranges: pref, label: `in your ${t.preferredWindow === 'work' || t.preferredWindow === 'study' ? `${t.preferredWindow} hours` : t.preferredWindow}` });
    if (t.contextWindow) {
      const ctx = windowRanges(date, input, [t.contextWindow]);
      if (ctx.length) tiers.push({ ranges: ctx, label: `in your ${t.contextWindow} hours` });
    }
    tiers.push({ ranges: null, label: null });

    const place = (slot: Interval, extra: string | null): void => {
      state.occupy(slot, true);
      const m = minutes(slot.end - slot.start);
      focusUsed += m;
      remaining -= m;
      blocks.push({
        key: `task:${t.id}:${slot.start}`,
        kind: 'task',
        taskId: t.id,
        habitId: null,
        title: t.title,
        start: slot.start,
        end: slot.end,
        reason: [...reasonParts, ...(extra ? [extra] : [])].join(' · '),
      });
    };

    // Stability: keep previous automatic placements that are still valid.
    for (const prev of previous.filter((b) => b.taskId === t.id).sort((a, b) => a.start - b.start)) {
      if (remaining <= 0) break;
      const len = Math.min(minutes(prev.end - prev.start), remaining, focusBudget - focusUsed);
      if (len < Math.min(t.minChunkMinutes, remaining)) continue;
      const slot = { start: prev.start, end: prev.start + len * MINUTE };
      if (slot.start >= frame.start && state.isFree(slot) && state.runLength(slot.start, slot.end) <= state.breakAfter) {
        place(slot, 'kept from your current plan');
      }
    }

    const splittable = t.splittable || remaining > maxChunk;
    const minChunk = Math.min(Math.max(STEP_MINUTES, t.minChunkMinutes), remaining);
    let blockedByBudget = false;
    while (remaining > 0) {
      const budgetLeft = focusBudget - focusUsed;
      if (budgetLeft < Math.min(minChunk, remaining)) {
        blockedByBudget = true;
        break;
      }
      const want = splittable ? Math.min(remaining, maxChunk, budgetLeft) : remaining;
      if (!splittable && want > budgetLeft) {
        blockedByBudget = true;
        break;
      }
      let placed = false;
      const sizes: number[] = [];
      if (splittable) for (let s = want; s >= minChunk; s -= STEP_MINUTES) sizes.push(s);
      else sizes.push(want);
      outer: for (const tier of tiers) {
        for (const size of sizes) {
          const slot = state.findSlot(size * MINUTE, tier.ranges, true, frame.start);
          if (slot) {
            place(slot, tier.label);
            placed = true;
            break outer;
          }
        }
      }
      if (!placed) break;
    }

    if (remaining > 0) {
      const scheduledMinutes = needed - remaining;
      const reason: UnscheduledReason =
        frame.end <= frame.start ? 'outside_day' : scheduledMinutes > 0 ? 'partially_scheduled' : blockedByBudget ? 'day_full' : 'no_slot';
      const message =
        reason === 'outside_day'
          ? 'The planning day is over.'
          : reason === 'day_full'
            ? `Today's planning limit is reached (${formatHours(focusBudget)} after protecting free time).`
            : reason === 'partially_scheduled'
              ? `${scheduledMinutes} of ${needed} minutes fit today.`
              : `No free ${needed}-minute slot today.`;
      unscheduled.push({
        kind: 'task',
        id: t.id,
        title: t.title,
        neededMinutes: needed,
        scheduledMinutes,
        reason,
        message,
      });
    }
  }

  // ── 8. Label breaks that pacing created ──
  let breakMinutes = 0;
  {
    const work = normalize([
      ...state.work,
      ...blocks.filter((b) => b.kind === 'task').map((b) => ({ start: b.start, end: b.end })),
    ]);
    const breakLen = prefs.breakMinutes * MINUTE;
    for (let i = 0; i + 1 < work.length; i++) {
      const a = work[i] as Interval;
      const b = work[i + 1] as Interval;
      const gap = b.start - a.end;
      const runBefore = (() => {
        let start = a.start;
        for (let j = i - 1; j >= 0; j--) {
          const p = work[j] as Interval;
          if (start - p.end < breakLen) start = p.start;
          else break;
        }
        return a.end - start;
      })();
      const breakSlot = { start: a.end, end: a.end + breakLen };
      const touchesPlanned = blocks.some((x) => x.kind === 'task' && (x.start === b.start || x.end === a.end));
      if (
        touchesPlanned &&
        gap >= breakLen &&
        gap <= breakLen + 2 * STEP_MINUTES * MINUTE &&
        runBefore >= 45 * MINUTE &&
        state.isFree(breakSlot)
      ) {
        state.occupy(breakSlot, false);
        breakMinutes += prefs.breakMinutes;
        blocks.push({
          key: `break:${breakSlot.start}`,
          kind: 'break',
          taskId: null,
          habitId: null,
          title: 'Break',
          start: breakSlot.start,
          end: breakSlot.end,
          reason: `Break after ${formatHours(minutes(runBefore))} of focused work`,
        });
      }
    }
  }

  blocks.sort((a, b) => a.start - b.start || a.key.localeCompare(b.key));
  return {
    date,
    blocks,
    kept,
    unscheduled,
    untimedHabitIds,
    warnings,
    atRiskTaskIds: [...atRisk].sort(),
    metrics: {
      focusMinutes: focusUsed + keptTaskMinutes,
      habitMinutes,
      breakMinutes,
      freeMinutesKept: minutes(state.freeTotal()),
      focusBudgetMinutes: focusBudget,
    },
    algorithmVersion: ALGORITHM_VERSION,
  };
}

/**
 * The earliest free slot of `durationMinutes` on the input's day at or after `notBefore`, given an
 * existing plan. Used by the missed-work flow ("next free slot today").
 */
export function findFreeSlot(
  input: PlanInput,
  plan: Pick<PlanResult, 'blocks'>,
  durationMinutes: number,
  notBefore: number = input.now,
): { start: number; end: number } | null {
  const bounds = dayBounds(input.date, input);
  const frame = { start: Math.max(bounds.start, roundUpToStep(notBefore, STEP_MINUTES)), end: bounds.end };
  if (frame.end <= frame.start) return null;
  const kept = input.blocks.filter((b) => b.status !== 'unplanned' && b.status !== 'skipped');
  const obstacles = [
    ...obstaclesFor(input.date, input, kept),
    ...plan.blocks.map((b) => ({ start: b.start, end: b.end })),
  ];
  const free = freeIntervals(frame, obstacles);
  const d = durationMinutes * MINUTE;
  for (const f of free) {
    const s = roundUpToStep(f.start, STEP_MINUTES);
    if (s + d <= f.end) return { start: s, end: s + d };
  }
  return null;
}

export function formatHours(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
}
