import { z } from 'zod';
import { addDays, nextOccurrence, parseRRule } from '@ascend/domain';
import type { Store, StoreTx } from '../../data/store.ts';
import { rankAtEnd } from '../../data/ranks.ts';
import type { Milestone, Task, TaskEvent, TaskStatus } from '../../data/types.ts';
import { hhmm, isoDate, optionalText, parseOrThrow, requiredTitle } from '../../data/validation.ts';

export const taskInput = z
  .object({
    title: requiredTitle(300),
    description: optionalText(10000),
    notes: optionalText(20000),
    category_id: z.string().uuid().nullable().optional(),
    priority: z.number().int().min(1).max(4).default(3),
    status: z.enum(['inbox', 'planned', 'in_progress']).optional(),
    due_date: isoDate.nullable().optional(),
    due_time: hhmm.nullable().optional(),
    do_date: isoDate.nullable().optional(),
    estimated_minutes: z.number().int().min(5, 'At least 5 minutes').max(1440).nullable().optional(),
    splittable: z.boolean().default(false),
    min_chunk_minutes: z.number().int().min(5).max(240).default(25),
    preferred_window: z.enum(['any', 'morning', 'afternoon', 'evening', 'work', 'study']).default('any'),
    goal_id: z.string().uuid().nullable().optional(),
    milestone_id: z.string().uuid().nullable().optional(),
    parent_task_id: z.string().uuid().nullable().optional(),
    recurrence_rule: z.string().max(200).nullable().optional(),
  })
  .refine((t) => !t.due_time || t.due_date, { message: 'Set a date for the deadline', path: ['due_date'] })
  .refine(
    (t) => {
      if (!t.recurrence_rule) return true;
      try {
        parseRRule(t.recurrence_rule);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid repeat rule', path: ['recurrence_rule'] },
  );
export type TaskInput = z.input<typeof taskInput>;

async function logEvent(tx: StoreTx, taskId: string, type: string, from: unknown, to: unknown, origin: TaskEvent['origin'] = 'user'): Promise<void> {
  await tx.insert('task_events', {
    task_id: taskId,
    event_type: type,
    from_value: from === undefined ? null : from,
    to_value: to === undefined ? null : to,
    origin,
    occurred_at: tx.nowIso(),
  });
}

/** A milestone implies its goal; keep the two consistent. */
async function resolveGoal(store: Store, goalId: string | null | undefined, milestoneId: string | null | undefined): Promise<string | null> {
  if (milestoneId) {
    const m = await store.get<Milestone>('milestones', milestoneId);
    if (m?.goal_id) return m.goal_id;
  }
  return goalId ?? null;
}

export async function createTask(store: Store, input: TaskInput, origin: TaskEvent['origin'] = 'user'): Promise<Task> {
  const v = parseOrThrow(taskInput, input);
  const goalId = await resolveGoal(store, v.goal_id, v.milestone_id);
  // Captured items land in the inbox unless the user gave enough to plan them.
  const status: TaskStatus = v.status ?? (v.estimated_minutes || v.do_date || v.due_date || goalId ? 'planned' : 'inbox');
  const rank = await rankAtEnd(store, 'tasks');
  return store.write(async (tx) => {
    const task = await tx.insert<Task>('tasks', {
      title: v.title,
      description: v.description ?? null,
      notes: v.notes ?? null,
      category_id: v.category_id ?? null,
      priority: v.priority,
      status,
      due_date: v.due_date ?? null,
      due_time: v.due_time ?? null,
      do_date: v.do_date ?? null,
      estimated_minutes: v.estimated_minutes ?? null,
      splittable: v.splittable,
      min_chunk_minutes: v.min_chunk_minutes,
      preferred_window: v.preferred_window,
      goal_id: goalId,
      milestone_id: v.milestone_id ?? null,
      parent_task_id: v.parent_task_id ?? null,
      recurrence_rule: v.recurrence_rule ?? null,
      rank,
    });
    await logEvent(tx, task.id, 'created', null, { status }, origin);
    return task;
  });
}

const TRACKED: Record<string, string> = {
  status: 'status_changed',
  due_date: 'due_changed',
  do_date: 'rescheduled',
  estimated_minutes: 'estimate_changed',
  goal_id: 'linked',
  milestone_id: 'linked',
};

export async function updateTask(store: Store, id: string, input: Partial<TaskInput>, origin: TaskEvent['origin'] = 'user'): Promise<Task> {
  const current = await store.get<Task>('tasks', id);
  if (!current) throw new Error('Task not found');
  const merged = parseOrThrow(taskInput, {
    ...current,
    status: current.status === 'completed' || current.status === 'cancelled' ? undefined : current.status,
    ...input,
  });
  const goalId = input.milestone_id !== undefined || input.goal_id !== undefined ? await resolveGoal(store, merged.goal_id, merged.milestone_id) : current.goal_id;
  const changes: Partial<Task> = {
    title: merged.title,
    description: merged.description ?? null,
    notes: merged.notes ?? null,
    category_id: merged.category_id ?? null,
    priority: merged.priority,
    due_date: merged.due_date ?? null,
    due_time: merged.due_time ?? null,
    do_date: merged.do_date ?? null,
    estimated_minutes: merged.estimated_minutes ?? null,
    splittable: merged.splittable,
    min_chunk_minutes: merged.min_chunk_minutes,
    preferred_window: merged.preferred_window,
    goal_id: goalId,
    milestone_id: merged.milestone_id ?? null,
    recurrence_rule: merged.recurrence_rule ?? null,
  };
  if (input.status && current.status !== 'completed' && current.status !== 'cancelled') changes.status = input.status;
  // An inbox item that has been given a plan leaves the inbox automatically.
  if (current.status === 'inbox' && !input.status && (changes.estimated_minutes || changes.do_date || changes.due_date)) changes.status = 'planned';
  return store.write(async (tx) => {
    for (const [field, type] of Object.entries(TRACKED)) {
      const before = current[field as keyof Task];
      const after = changes[field as keyof Task];
      if (after !== undefined && before !== after) await logEvent(tx, id, type, { [field]: before }, { [field]: after }, origin);
    }
    return tx.update<Task>('tasks', id, changes);
  });
}

export async function setTaskStatus(store: Store, id: string, status: 'inbox' | 'planned' | 'in_progress'): Promise<void> {
  const current = await store.get<Task>('tasks', id);
  if (!current || current.status === status) return;
  await store.write(async (tx) => {
    await tx.update('tasks', id, { status });
    await logEvent(tx, id, 'status_changed', { status: current.status }, { status });
  });
}

/**
 * Completes a task. For a repeating task, the next occurrence is created straight away so it is never
 * forgotten. Returns the next occurrence, if any.
 */
export async function completeTask(store: Store, id: string, today: string): Promise<Task | null> {
  const task = await store.get<Task>('tasks', id);
  if (!task || task.status === 'completed') return null;
  return store.write(async (tx) => {
    await tx.update('tasks', id, { status: 'completed', completed_at: tx.nowIso() });
    await logEvent(tx, id, 'completed', { status: task.status }, { status: 'completed' });
    // Today's blocks for it that already started count as done; later ones are no longer needed.
    const blocks = await tx.sql.all<{ id: string; starts_at: string }>(
      "SELECT id, starts_at FROM schedule_blocks WHERE task_id = ? AND block_date = ? AND status IN ('planned','in_progress') AND deleted_at IS NULL",
      [id, today],
    );
    for (const b of blocks) {
      if (b.starts_at <= tx.nowIso()) await tx.update('schedule_blocks', b.id, { status: 'done', completed_at: tx.nowIso() });
      else await tx.update('schedule_blocks', b.id, { status: 'unplanned' });
    }
    if (!task.recurrence_rule) return null;
    const rule = parseRRule(task.recurrence_rule);
    const anchor = task.due_date ?? task.do_date ?? today;
    const next = nextOccurrence(rule, anchor, anchor < today ? addDays(today, -1) : anchor);
    if (!next) return null;
    const shift = (d: string | null) => (d ? next : null);
    const nextTask = await tx.insert<Task>('tasks', {
      ...pick(task, ['title', 'description', 'category_id', 'priority', 'due_time', 'estimated_minutes', 'splittable', 'min_chunk_minutes', 'preferred_window', 'goal_id', 'milestone_id', 'recurrence_rule', 'rank']),
      status: 'planned',
      due_date: shift(task.due_date),
      do_date: task.due_date ? null : next,
      recurrence_template_id: task.recurrence_template_id ?? task.id,
      parent_task_id: null,
      notes: null,
    });
    await logEvent(tx, nextTask.id, 'created', null, { status: 'planned', repeat_of: task.id });
    return nextTask;
  });
}

/** Deliberately un-completes a task (tells the server this is intentional, not a stale edit). */
export async function reopenTask(store: Store, id: string): Promise<void> {
  const task = await store.get<Task>('tasks', id);
  if (!task || (task.status !== 'completed' && task.status !== 'cancelled')) return;
  await store.write(async (tx) => {
    await tx.update('tasks', id, { status: 'planned', completed_at: null }, { meta: { reopen: true } });
    await logEvent(tx, id, 'reopened', { status: task.status }, { status: 'planned' });
  });
}

export async function cancelTask(store: Store, id: string): Promise<void> {
  const task = await store.get<Task>('tasks', id);
  if (!task || task.status === 'cancelled') return;
  await store.write(async (tx) => {
    await tx.update('tasks', id, { status: 'cancelled', completed_at: null });
    await logEvent(tx, id, 'status_changed', { status: task.status }, { status: 'cancelled' });
  });
}

export async function archiveTask(store: Store, id: string, archived: boolean): Promise<void> {
  await store.update('tasks', id, { archived_at: archived ? store.now().toISOString() : null });
}

export async function deleteTask(store: Store, id: string): Promise<void> {
  await store.write(async (tx) => {
    await tx.remove('tasks', id);
    const subtasks = await tx.sql.all<{ id: string }>('SELECT id FROM tasks WHERE parent_task_id = ? AND deleted_at IS NULL', [id]);
    for (const s of subtasks) await tx.remove('tasks', s.id);
  });
}

export async function restoreTask(store: Store, id: string): Promise<void> {
  await store.restore('tasks', id);
}

/** Splits a task into smaller subtasks; the parent's estimate becomes the sum of the parts. */
export async function splitTask(store: Store, id: string, parts: { title: string; estimated_minutes: number | null }[]): Promise<Task[]> {
  const parent = await store.get<Task>('tasks', id);
  if (!parent) throw new Error('Task not found');
  if (parts.length < 2) throw new Error('Add at least two parts');
  const created: Task[] = [];
  for (const p of parts) {
    created.push(
      await createTask(store, {
        title: p.title,
        estimated_minutes: p.estimated_minutes,
        parent_task_id: id,
        goal_id: parent.goal_id,
        milestone_id: parent.milestone_id,
        priority: parent.priority,
        due_date: parent.due_date,
        category_id: parent.category_id,
        preferred_window: parent.preferred_window,
        status: 'planned',
      }),
    );
  }
  await store.write(async (tx) => {
    await logEvent(tx, id, 'split', null, { parts: created.map((c) => c.id) });
  });
  return created;
}

export async function listSubtasks(store: Store, parentId: string): Promise<Task[]> {
  return store.list<Task>('tasks', { where: 'parent_task_id = ?', params: [parentId], orderBy: "status = 'completed', rank" });
}

export async function taskHistory(store: Store, id: string): Promise<TaskEvent[]> {
  return store.list<TaskEvent>('task_events', { where: 'task_id = ?', params: [id], orderBy: 'occurred_at DESC' });
}

export type TaskListKind = 'inbox' | 'today' | 'upcoming' | 'all' | 'completed';

/** The smart lists in Planner → Tasks. Subtasks appear under their parent, not on their own. */
export async function listTasks(store: Store, kind: TaskListKind, today: string): Promise<Task[]> {
  const open = "status NOT IN ('completed','cancelled') AND archived_at IS NULL AND parent_task_id IS NULL";
  switch (kind) {
    case 'inbox':
      return store.list<Task>('tasks', { where: `${open} AND status = 'inbox'`, orderBy: 'created_at DESC' });
    case 'today':
      return store.list<Task>('tasks', {
        where: `${open} AND ((due_date IS NOT NULL AND due_date <= ?) OR do_date = ? OR status = 'in_progress')`,
        params: [today, today],
        orderBy: 'priority, due_date IS NULL, due_date, rank',
      });
    case 'upcoming':
      return store.list<Task>('tasks', {
        where: `${open} AND status != 'inbox' AND ((due_date > ?) OR (do_date > ?))`,
        params: [today, today],
        orderBy: 'COALESCE(do_date, due_date), priority, rank',
      });
    case 'all':
      return store.list<Task>('tasks', { where: open, orderBy: "status = 'inbox' DESC, priority, due_date IS NULL, due_date, rank" });
    case 'completed':
      return store.list<Task>('tasks', { where: "status IN ('completed','cancelled') AND parent_task_id IS NULL", orderBy: 'COALESCE(completed_at, updated_at) DESC', limit: 200 });
  }
}

function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}

export const PRIORITY_LABELS: Record<number, string> = { 1: 'P1 · Urgent', 2: 'P2 · High', 3: 'P3 · Normal', 4: 'P4 · Low' };
export const STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: 'Inbox',
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
