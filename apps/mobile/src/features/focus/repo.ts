/**
 * Focus and study sessions. A running timer is persisted on the device (and its session row is created
 * immediately), so closing the app never loses a session.
 */
import { localToUtc, pauseTimer, resumeTimer, stopTimer, timerElapsedMs, type TimerState } from '@ascend/domain';
import type { Store } from '../../data/store.ts';
import type { FocusKind, FocusSession, ScheduleBlock, Task } from '../../data/types.ts';

const TIMER_KEY = 'focus_timer';

export interface FocusLinks {
  taskId?: string | null;
  goalId?: string | null;
  projectId?: string | null;
  learningItemId?: string | null;
  scheduleBlockId?: string | null;
}

export async function getTimer(store: Store): Promise<TimerState | null> {
  const raw = await store.getSetting(TIMER_KEY);
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as TimerState;
    const s = await store.get<FocusSession>('focus_sessions', t.sessionId);
    // The session may have been finished or deleted on another device.
    if (!s || s.deleted_at || s.status !== 'running') {
      await store.db.run('DELETE FROM _kv WHERE key = ?', [TIMER_KEY]);
      return null;
    }
    return t;
  } catch {
    return null;
  }
}

async function saveTimer(store: Store, t: TimerState | null): Promise<void> {
  if (t) await store.setSetting(TIMER_KEY, JSON.stringify(t));
  else await store.db.run('DELETE FROM _kv WHERE key = ?', [TIMER_KEY]);
}

export async function startFocus(store: Store, kind: FocusKind, plannedMinutes: number | null, links: FocusLinks = {}): Promise<TimerState> {
  if (await getTimer(store)) throw new Error('A session is already running. Stop it before starting another.');
  if (plannedMinutes !== null && (plannedMinutes < 1 || plannedMinutes > 600)) throw new Error('Choose between 1 minute and 10 hours');
  let goalId = links.goalId ?? null;
  if (links.taskId && !goalId) goalId = (await store.get<Task>('tasks', links.taskId))?.goal_id ?? null;
  const now = store.now();
  const session = await store.write(async (tx) => {
    const s = await tx.insert<FocusSession>('focus_sessions', {
      kind,
      source: 'timer',
      started_at: now.toISOString(),
      duration_seconds: 0,
      pause_seconds: 0,
      planned_minutes: plannedMinutes,
      task_id: links.taskId ?? null,
      goal_id: goalId,
      project_id: links.projectId ?? null,
      learning_item_id: links.learningItemId ?? null,
      schedule_block_id: links.scheduleBlockId ?? null,
      status: 'running',
    });
    if (links.taskId) {
      const t = await tx.get<Task>('tasks', links.taskId);
      if (t && (t.status === 'inbox' || t.status === 'planned')) await tx.update('tasks', t.id, { status: 'in_progress' });
    }
    if (links.scheduleBlockId) {
      const b = await tx.get<ScheduleBlock>('schedule_blocks', links.scheduleBlockId);
      if (b && b.status === 'planned') await tx.update('schedule_blocks', b.id, { status: 'in_progress' });
    }
    return s;
  });
  const timer: TimerState = { sessionId: session.id, startedAt: now.getTime(), pausedAt: null, pausedMs: 0, plannedMinutes };
  await saveTimer(store, timer);
  return timer;
}

export async function pauseFocus(store: Store): Promise<TimerState | null> {
  const t = await getTimer(store);
  if (!t) return null;
  const next = pauseTimer(t, store.now().getTime());
  await saveTimer(store, next);
  return next;
}

export async function resumeFocus(store: Store): Promise<TimerState | null> {
  const t = await getTimer(store);
  if (!t) return null;
  const next = resumeTimer(t, store.now().getTime());
  await saveTimer(store, next);
  return next;
}

/** Stops the running session and records it. Links to a planned block count that block as done. */
export async function stopFocus(store: Store, outcome: { quality?: number | null; notes?: string | null } = {}): Promise<FocusSession | null> {
  const t = await getTimer(store);
  if (!t) return null;
  const done = stopTimer(t, store.now().getTime());
  const session = await store.write(async (tx) => {
    const s = await tx.update<FocusSession>('focus_sessions', t.sessionId, {
      ended_at: new Date(done.endedAt).toISOString(),
      duration_seconds: Math.min(86400, done.durationSeconds),
      pause_seconds: Math.min(86400, done.pauseSeconds),
      quality: outcome.quality ?? null,
      notes: outcome.notes?.trim() || null,
      status: 'completed',
    });
    if (s.schedule_block_id) {
      const b = await tx.get<ScheduleBlock>('schedule_blocks', s.schedule_block_id);
      if (b && (b.status === 'planned' || b.status === 'in_progress' || b.status === 'missed')) {
        await tx.update('schedule_blocks', b.id, { status: 'done', actual_minutes: Math.round(done.durationSeconds / 60), completed_at: tx.nowIso() });
      }
    }
    return s;
  });
  await saveTimer(store, null);
  return session;
}

/** Discards the running session (sessions under a minute are removed; longer ones are kept as abandoned). */
export async function discardFocus(store: Store): Promise<void> {
  const t = await getTimer(store);
  if (!t) return;
  const elapsed = timerElapsedMs(t, store.now().getTime());
  if (elapsed < 60_000) await store.remove('focus_sessions', t.sessionId);
  else {
    const done = stopTimer(t, store.now().getTime());
    await store.update('focus_sessions', t.sessionId, { ended_at: new Date(done.endedAt).toISOString(), duration_seconds: done.durationSeconds, pause_seconds: done.pauseSeconds, status: 'abandoned' });
  }
  await saveTimer(store, null);
}

/** Records a session after the fact (e.g. study at the library without the timer). */
export async function logManualSession(
  store: Store,
  input: { kind: FocusKind; date: string; startMinutes: number; minutes: number; notes?: string | null; quality?: number | null } & FocusLinks,
  timeZone: string,
): Promise<FocusSession> {
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440) throw new Error('Enter a duration between 1 minute and 24 hours');
  const start = localToUtc(input.date, input.startMinutes, timeZone);
  if (start > store.now().getTime()) throw new Error('A logged session can’t be in the future');
  let goalId = input.goalId ?? null;
  if (input.taskId && !goalId) goalId = (await store.get<Task>('tasks', input.taskId))?.goal_id ?? null;
  return store.insert<FocusSession>('focus_sessions', {
    kind: input.kind,
    source: 'manual',
    started_at: new Date(start).toISOString(),
    ended_at: new Date(start + input.minutes * 60_000).toISOString(),
    duration_seconds: input.minutes * 60,
    pause_seconds: 0,
    task_id: input.taskId ?? null,
    goal_id: goalId,
    project_id: input.projectId ?? null,
    learning_item_id: input.learningItemId ?? null,
    quality: input.quality ?? null,
    notes: input.notes?.trim() || null,
    status: 'completed',
  });
}

export async function listSessions(store: Store, opts: { kind?: FocusKind; taskId?: string; goalId?: string; limit?: number } = {}): Promise<FocusSession[]> {
  const where: string[] = ["status != 'running'"];
  const params: (string | number)[] = [];
  if (opts.kind) (where.push('kind = ?'), params.push(opts.kind));
  if (opts.taskId) (where.push('task_id = ?'), params.push(opts.taskId));
  if (opts.goalId) (where.push('goal_id = ?'), params.push(opts.goalId));
  return store.list<FocusSession>('focus_sessions', { where: where.join(' AND '), params, orderBy: 'started_at DESC', limit: opts.limit ?? 100 });
}

/** Completed focus minutes since an instant, by kind. */
export async function focusMinutesSince(store: Store, sinceIso: string): Promise<Record<FocusKind, number> & { total: number }> {
  const rows = await store.query<{ kind: FocusKind; s: number }>(
    "SELECT kind, SUM(duration_seconds) AS s FROM focus_sessions WHERE deleted_at IS NULL AND status = 'completed' AND started_at >= ? GROUP BY kind",
    [sinceIso],
  );
  const out = { focus: 0, study: 0, learning: 0, deep_work: 0, total: 0 };
  for (const r of rows) {
    out[r.kind] = Math.round(r.s / 60);
    out.total += Math.round(r.s / 60);
  }
  return out;
}

export async function deleteSession(store: Store, id: string): Promise<void> {
  await store.remove('focus_sessions', id);
}

export const FOCUS_KIND_LABELS: Record<FocusKind, string> = { focus: 'Focus', study: 'Study', learning: 'Learning', deep_work: 'Deep work' };
