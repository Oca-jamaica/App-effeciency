/**
 * Connects the deterministic scheduler (packages/domain) to the user's real data: builds the planner
 * input from local tasks, habits, events and preferences, plans the day, and persists only the blocks
 * that changed. Also implements manual overrides and the missed-work options.
 */
import {
  DEFAULT_SCHEDULER_PREFS,
  addDays,
  findFreeSlot,
  formatHours,
  isReplaceable,
  localToUtc,
  parseTime,
  planDay,
  utcToLocalDate,
  utcToLocalMinutes,
  type AvailabilityWindow,
  type ExistingBlock,
  type PlanInput,
  type PlanResult,
  type SchedulableHabit,
  type SchedulableTask,
  type SchedulerPrefs,
} from '@ascend/domain';
import type { Store } from '../../data/store.ts';
import { stableId } from '../../data/ids.ts';
import type { AvailabilityWindowRow, Category, Preferences, Profile, ScheduleBlock, Task } from '../../data/types.ts';
import { activeGoalRanks } from '../goals/repo.ts';
import { habitsForDay } from '../habits/repo.ts';
import { occurrencesInRange } from './events.ts';

/** Default categories imply which preferred hours suit them; custom categories have no implication. */
const CATEGORY_WINDOWS: Record<string, 'study' | 'work' | 'training'> = {
  academics: 'study',
  business: 'work',
  projects: 'work',
  fitness: 'training',
  'football & sport': 'training',
};

export interface UserContext {
  profile: Profile | null;
  prefs: Preferences | null;
  timeZone: string;
  weekStartsOn: number;
}

export async function loadUserContext(store: Store): Promise<UserContext> {
  const [profile] = await store.list<Profile>('profiles', { limit: 1 });
  const [prefs] = await store.list<Preferences>('user_preferences', { limit: 1 });
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { profile: profile ?? null, prefs: prefs ?? null, timeZone: profile?.timezone || deviceTz || 'UTC', weekStartsOn: profile?.week_starts_on ?? 1 };
}

export function schedulerPrefs(p: Preferences | null): SchedulerPrefs {
  if (!p) return DEFAULT_SCHEDULER_PREFS;
  return {
    dayStartMinutes: parseTime(p.day_start),
    dayEndMinutes: parseTime(p.day_end),
    defaultTaskMinutes: p.default_task_minutes,
    maxFocusMinutesPerDay: p.max_focus_minutes_per_day,
    maxBlockMinutes: p.max_block_minutes,
    breakAfterMinutes: p.break_after_minutes,
    breakMinutes: p.break_minutes,
    bufferMinutes: p.buffer_minutes,
    minFreeMinutesPerDay: p.min_free_minutes_per_day,
  };
}

function toExisting(b: ScheduleBlock): ExistingBlock {
  return {
    id: b.id,
    start: Date.parse(b.starts_at),
    end: Date.parse(b.ends_at),
    kind: b.kind,
    taskId: b.task_id,
    habitId: b.habit_id,
    title: b.title,
    origin: b.origin,
    isLocked: b.is_locked,
    status: b.status,
  };
}

export async function blocksForDay(store: Store, date: string): Promise<ScheduleBlock[]> {
  return store.list<ScheduleBlock>('schedule_blocks', { where: 'block_date = ?', params: [date], orderBy: 'starts_at' });
}

export async function buildPlanInput(store: Store, date: string, now: number, ctx?: UserContext): Promise<PlanInput> {
  const c = ctx ?? (await loadUserContext(store));
  const prefs = schedulerPrefs(c.prefs);
  const horizonDays = 7;
  const [windows, categories, goalRanks, blocks, occurrences, habitDay] = await Promise.all([
    store.list<AvailabilityWindowRow>('availability_windows'),
    store.list<Category>('categories'),
    activeGoalRanks(store),
    blocksForDay(store, date),
    occurrencesInRange(store, date, addDays(date, horizonDays), c.timeZone),
    habitsForDay(store, date, c.weekStartsOn),
  ]);
  const inboxClause = c.prefs?.schedule_inbox_with_deadline === false ? '' : " OR (status = 'inbox' AND due_date IS NOT NULL)";
  const tasks = await store.list<Task>('tasks', {
    where: `archived_at IS NULL AND (status IN ('planned','in_progress')${inboxClause})
            AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_task_id = tasks.id AND c.deleted_at IS NULL AND c.status NOT IN ('cancelled'))`,
  });
  const milestoneDeadlines = new Map<string, string>();
  const msIds = [...new Set(tasks.map((t) => t.milestone_id).filter((x): x is string => !!x))];
  if (msIds.length) {
    const ms = await store.query<{ id: string; deadline: string | null; status: string }>(
      `SELECT id, deadline, status FROM milestones WHERE deleted_at IS NULL AND id IN (${msIds.map(() => '?').join(',')})`,
      msIds,
    );
    for (const m of ms) if (m.deadline && m.status === 'open') milestoneDeadlines.set(m.id, m.deadline);
  }
  // Work already recorded against each task (finished or partly finished blocks).
  const recorded = new Map<string, number>();
  if (tasks.length) {
    const rows = await store.query<{ task_id: string; minutes: number }>(
      `SELECT task_id, SUM(COALESCE(actual_minutes, CAST((julianday(ends_at) - julianday(starts_at)) * 1440 AS INTEGER))) AS minutes
       FROM schedule_blocks WHERE deleted_at IS NULL AND status IN ('done','partial') AND task_id IS NOT NULL GROUP BY task_id`,
    );
    for (const r of rows) recorded.set(r.task_id, r.minutes);
    // Work already planned on earlier days of the horizon counts too, so previews of future days never
    // double-book a task that today's plan already covers.
    const planned = await store.query<{ task_id: string; minutes: number }>(
      `SELECT task_id, SUM(CAST((julianday(ends_at) - julianday(starts_at)) * 1440 AS INTEGER)) AS minutes
       FROM schedule_blocks WHERE deleted_at IS NULL AND status IN ('planned','in_progress') AND task_id IS NOT NULL
       AND block_date < ? AND block_date >= ? GROUP BY task_id`,
      [date, utcToLocalDate(now, c.timeZone)],
    );
    for (const r of planned) recorded.set(r.task_id, (recorded.get(r.task_id) ?? 0) + r.minutes);
  }
  const catWindow = new Map(categories.map((cat) => [cat.id, CATEGORY_WINDOWS[cat.name.toLowerCase()] ?? null]));

  const schedulable: SchedulableTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    status: t.status as SchedulableTask['status'],
    dueDate: t.due_date,
    doDate: t.do_date,
    estimatedMinutes: t.estimated_minutes,
    recordedMinutes: recorded.get(t.id) ?? 0,
    splittable: t.splittable,
    minChunkMinutes: t.min_chunk_minutes,
    preferredWindow: t.preferred_window,
    goalRank: t.goal_id ? goalRanks.get(t.goal_id)?.rank ?? null : null,
    goalTitle: t.goal_id ? goalRanks.get(t.goal_id)?.title ?? null : null,
    milestoneDeadline: t.milestone_id ? milestoneDeadlines.get(t.milestone_id) ?? null : null,
    contextWindow: t.category_id ? catWindow.get(t.category_id) ?? null : null,
    createdAt: t.created_at,
  }));
  const habits: SchedulableHabit[] = habitDay
    .filter((h) => h.due && !h.log && h.habit.status === 'active')
    .map((h) => ({
      id: h.habit.id,
      name: h.habit.name,
      durationMinutes: h.habit.duration_minutes,
      preferredWindow: h.habit.preferred_window,
      preferredTimeMinutes: h.habit.preferred_time ? parseTime(h.habit.preferred_time) : null,
      rank: h.habit.rank,
    }));
  const avail: AvailabilityWindow[] = windows.map((w) => ({
    weekday: w.weekday,
    startMinutes: parseTime(w.start_time),
    endMinutes: parseTime(w.end_time),
    kind: w.kind,
  }));
  return {
    date,
    timeZone: c.timeZone,
    now,
    prefs,
    windows: avail,
    events: occurrences
      .filter((o) => !o.event.all_day || o.event.busy)
      .map((o) => ({ id: o.key, title: o.event.title, start: o.start, end: o.end, busy: o.event.busy, kind: o.event.kind })),
    blocks: blocks.map(toExisting),
    tasks: schedulable,
    habits,
    horizonDays,
  };
}

/** Deterministic id: two devices planning the same block create the same row, which merges on sync. */
function blockId(userId: string, date: string, key: string): string {
  return stableId(`${userId}|${date}|${key}`);
}

/**
 * Re-plans `date` and persists the result. Only future, automatic, unlocked, unstarted blocks are
 * replaced; everything else (locked, manual, started, done, past) is left exactly as it is.
 */
export async function replanDay(store: Store, date: string, now: number = Date.now()): Promise<PlanResult> {
  const input = await buildPlanInput(store, date, now);
  const plan = planDay(input);
  const existing = await blocksForDay(store, date);
  const replaceable = existing.filter((b) => isReplaceable(toExisting(b), now));
  const wanted = new Map(plan.blocks.map((b) => [blockId(store.userId, date, b.key), b]));
  await store.write(async (tx) => {
    for (const b of replaceable) {
      if (!wanted.has(b.id)) await tx.remove('schedule_blocks', b.id);
    }
    for (const [id, b] of wanted) {
      const values = {
        block_date: date,
        starts_at: new Date(b.start).toISOString(),
        ends_at: new Date(b.end).toISOString(),
        kind: b.kind,
        task_id: b.taskId,
        habit_id: b.habitId,
        title: b.title,
        origin: 'auto' as const,
        is_locked: false,
        status: 'planned' as const,
        reason: b.reason.slice(0, 500),
        algorithm_version: plan.algorithmVersion,
      };
      const current = await tx.get<ScheduleBlock>('schedule_blocks', id);
      if (!current) await tx.insert('schedule_blocks', { id, ...values });
      else if (current.deleted_at) {
        await tx.restore('schedule_blocks', id);
        await tx.update('schedule_blocks', id, values);
      } else await tx.update('schedule_blocks', id, values);
    }
  });
  return plan;
}

// ───────────────────────────── manual overrides ─────────────────────────────

/** Moves a block to a new start time. It becomes a manual block, so re-plans flow around it. */
export async function moveBlock(store: Store, id: string, newStart: number): Promise<void> {
  const b = await store.get<ScheduleBlock>('schedule_blocks', id);
  if (!b) throw new Error('Block not found');
  const length = Date.parse(b.ends_at) - Date.parse(b.starts_at);
  await store.update('schedule_blocks', id, {
    starts_at: new Date(newStart).toISOString(),
    ends_at: new Date(newStart + length).toISOString(),
    origin: 'manual',
    reason: 'Moved by you',
  });
}

export async function setBlockLocked(store: Store, id: string, locked: boolean): Promise<void> {
  await store.update('schedule_blocks', id, { is_locked: locked });
}

/** Changes a block's length; optionally updates the task's estimate for future planning too. */
export async function resizeBlock(store: Store, id: string, minutes: number, updateEstimate: boolean): Promise<void> {
  const b = await store.get<ScheduleBlock>('schedule_blocks', id);
  if (!b) throw new Error('Block not found');
  if (minutes < 5 || minutes > 600) throw new Error('Choose between 5 minutes and 10 hours');
  await store.write(async (tx) => {
    await tx.update('schedule_blocks', id, {
      ends_at: new Date(Date.parse(b.starts_at) + minutes * 60_000).toISOString(),
      origin: b.origin === 'auto' ? 'manual' : b.origin,
    });
    if (updateEstimate && b.task_id) {
      const task = await tx.get<Task>('tasks', b.task_id);
      if (task) {
        await tx.update('tasks', task.id, { estimated_minutes: minutes });
        await tx.insert('task_events', {
          task_id: task.id,
          event_type: 'estimate_changed',
          from_value: { estimated_minutes: task.estimated_minutes },
          to_value: { estimated_minutes: minutes },
          origin: 'user',
          occurred_at: tx.nowIso(),
        });
      }
    }
  });
}

export async function setBlockStatus(store: Store, id: string, status: ScheduleBlock['status'], actualMinutes?: number | null): Promise<void> {
  await store.update('schedule_blocks', id, {
    status,
    actual_minutes: actualMinutes ?? null,
    completed_at: status === 'done' || status === 'partial' ? store.now().toISOString() : null,
  });
}

/** Adds a manual block (e.g. "protect 18:00–20:00 for friends"). */
export async function addManualBlock(
  store: Store,
  input: { date: string; start: number; end: number; title: string; kind: ScheduleBlock['kind']; taskId?: string | null; locked?: boolean },
): Promise<void> {
  if (input.end <= input.start) throw new Error('End must be after start');
  await store.insert('schedule_blocks', {
    block_date: input.date,
    starts_at: new Date(input.start).toISOString(),
    ends_at: new Date(input.end).toISOString(),
    kind: input.kind,
    task_id: input.taskId ?? null,
    habit_id: null,
    title: input.title.trim() || 'Block',
    origin: 'manual',
    is_locked: input.locked ?? false,
    status: 'planned',
    reason: 'Added by you',
  });
}

/** Marks planned blocks whose time has passed without being completed as missed. Never deletes anything. */
export async function markMissedBlocks(store: Store, date: string, now: number): Promise<number> {
  const blocks = await blocksForDay(store, date);
  const missed = blocks.filter((b) => (b.kind === 'task' || b.kind === 'habit') && b.status === 'planned' && Date.parse(b.ends_at) <= now);
  if (!missed.length) return 0;
  await store.write(async (tx) => {
    for (const b of missed) await tx.update('schedule_blocks', b.id, { status: 'missed' });
  });
  return missed.length;
}

// ───────────────────────────── missed-work options ─────────────────────────────

export interface MissedOptions {
  laterToday: { start: number; end: number } | null;
  tomorrow: { start: number; end: number } | null;
  shortenTo: number;
  neededMinutes: number;
}

/** The sensible alternatives offered for unfinished work (docs/04-scheduler.md → Missed work). */
export async function missedOptions(store: Store, blockIdValue: string, now: number): Promise<MissedOptions> {
  const block = await store.get<ScheduleBlock>('schedule_blocks', blockIdValue);
  if (!block) throw new Error('Block not found');
  const minutes = Math.max(5, Math.round((Date.parse(block.ends_at) - Date.parse(block.starts_at)) / 60_000) - (block.actual_minutes ?? 0));
  const input = await buildPlanInput(store, block.block_date, now);
  const today = planDay(input);
  const laterToday = findFreeSlot(input, today, minutes, now);

  const tomorrowDate = addDays(block.block_date, 1);
  const tomorrowInput = await buildPlanInput(store, tomorrowDate, localToUtc(tomorrowDate, 0, input.timeZone));
  const forced = tomorrowInput.tasks.map((t) => (t.id === block.task_id ? { ...t, doDate: tomorrowDate } : t));
  const tomorrowPlan = planDay({ ...tomorrowInput, tasks: forced });
  const placed = tomorrowPlan.blocks.find((b) => b.taskId === block.task_id) ?? null;
  return {
    laterToday,
    tomorrow: placed ? { start: placed.start, end: placed.end } : findFreeSlot(tomorrowInput, tomorrowPlan, minutes, tomorrowInput.now),
    shortenTo: Math.max(10, Math.round(minutes / 2 / 5) * 5),
    neededMinutes: minutes,
  };
}

/** Moves missed work to a specific slot today (a manual block) and marks the old block as rescheduled. */
export async function rescheduleMissedToSlot(store: Store, missedBlockId: string, slot: { start: number; end: number }): Promise<void> {
  const b = await store.get<ScheduleBlock>('schedule_blocks', missedBlockId);
  if (!b) throw new Error('Block not found');
  await store.write(async (tx) => {
    await tx.update('schedule_blocks', b.id, { status: 'skipped' });
    await tx.insert('schedule_blocks', {
      block_date: b.block_date,
      starts_at: new Date(slot.start).toISOString(),
      ends_at: new Date(slot.end).toISOString(),
      kind: b.kind,
      task_id: b.task_id,
      habit_id: b.habit_id,
      title: b.title,
      origin: 'manual',
      is_locked: false,
      status: 'planned',
      reason: 'Rescheduled after a missed block',
    });
    if (b.task_id) {
      await tx.insert('task_events', {
        task_id: b.task_id,
        event_type: 'rescheduled',
        from_value: { starts_at: b.starts_at },
        to_value: { starts_at: new Date(slot.start).toISOString() },
        origin: 'user',
        occurred_at: tx.nowIso(),
      });
    }
  });
}

/** Moves missed work to another day by pinning the task to that day; tomorrow's plan picks it up. */
export async function rescheduleMissedToDay(store: Store, missedBlockId: string, date: string): Promise<void> {
  const b = await store.get<ScheduleBlock>('schedule_blocks', missedBlockId);
  if (!b) throw new Error('Block not found');
  await store.write(async (tx) => {
    await tx.update('schedule_blocks', b.id, { status: 'skipped' });
    if (b.task_id) {
      const task = await tx.get<Task>('tasks', b.task_id);
      if (task) {
        await tx.update('tasks', task.id, { do_date: date });
        await tx.insert('task_events', {
          task_id: task.id,
          event_type: 'rescheduled',
          from_value: { do_date: task.do_date },
          to_value: { do_date: date },
          origin: 'user',
          occurred_at: tx.nowIso(),
        });
      }
    }
  });
}

/** Takes missed work off today's plan without touching the task itself. */
export async function unplanBlock(store: Store, id: string): Promise<void> {
  await store.update('schedule_blocks', id, { status: 'unplanned' });
}

export function describeSlot(slot: { start: number; end: number }, timeZone: string): string {
  const fmt = (ms: number) => {
    const m = utcToLocalMinutes(ms, timeZone);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  return `${fmt(slot.start)}–${fmt(slot.end)}`;
}

export { formatHours };
