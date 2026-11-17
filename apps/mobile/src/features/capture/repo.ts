import { parseCapture, type CaptureDraft, type CaptureType } from '@ascend/domain';
import type { Store } from '../../data/store.ts';
import type { Category, Goal } from '../../data/types.ts';
import { createGoal } from '../goals/repo.ts';
import { saveNote } from '../goals/repo.ts';
import { createHabit } from '../habits/repo.ts';
import { createEvent } from '../planner/events.ts';
import { createTask } from '../tasks/repo.ts';
import { localToUtc } from '@ascend/domain';

export const CAPTURE_TYPES: { value: CaptureType; label: string }[] = [
  { value: 'task', label: 'Task' },
  { value: 'event', label: 'Event' },
  { value: 'reminder', label: 'Reminder' },
  { value: 'idea', label: 'Idea' },
  { value: 'note', label: 'Note' },
  { value: 'habit', label: 'Habit' },
  { value: 'goal', label: 'Goal' },
];

export interface CaptureContext {
  today: string;
  timeZone: string;
}

/** Matches #tags against categories and goals so "#economics" links to the right place. */
async function resolveTags(store: Store, tags: string[]): Promise<{ categoryId: string | null; goalId: string | null }> {
  if (!tags.length) return { categoryId: null, goalId: null };
  const [categories, goals] = await Promise.all([
    store.list<Category>('categories', { where: 'archived_at IS NULL' }),
    store.list<Goal>('goals', { where: "status IN ('active','paused')" }),
  ]);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  let categoryId: string | null = null;
  let goalId: string | null = null;
  for (const tag of tags) {
    const t = norm(tag);
    categoryId ??= categories.find((c) => norm(c.name).startsWith(t))?.id ?? null;
    goalId ??= goals.find((g) => norm(g.title).includes(t))?.id ?? null;
  }
  return { categoryId, goalId };
}

export function previewCapture(text: string, today: string): CaptureDraft {
  return parseCapture(text, today);
}

/** Saves a quick capture as the right kind of item. Everything works offline. */
export async function saveCapture(store: Store, text: string, chosenType: CaptureType | null, ctx: CaptureContext): Promise<{ type: CaptureType; id: string; title: string }> {
  const draft = parseCapture(text, ctx.today);
  const type = chosenType ?? draft.type ?? 'task';
  const title = draft.title || text.trim();
  if (!title) throw new Error('Type something to capture');
  const { categoryId, goalId } = await resolveTags(store, draft.tags);
  switch (type) {
    case 'task': {
      const t = await createTask(store, {
        title,
        priority: draft.priority ?? 3,
        due_date: draft.date,
        due_time: draft.date && draft.timeMinutes !== null ? minutesToHhmm(draft.timeMinutes) : null,
        estimated_minutes: draft.durationMinutes,
        category_id: categoryId,
        goal_id: goalId,
      });
      return { type, id: t.id, title: t.title };
    }
    case 'event': {
      const date = draft.date ?? ctx.today;
      const start = draft.timeMinutes ?? 9 * 60;
      const e = await createEvent(store, { title, date, start_minutes: start, end_minutes: Math.min(24 * 60, start + (draft.durationMinutes ?? 60)), category_id: categoryId, goal_id: goalId }, ctx.timeZone);
      return { type, id: e.id, title: e.title };
    }
    case 'reminder': {
      const date = draft.date ?? ctx.today;
      const minutes = draft.timeMinutes ?? 9 * 60;
      const remindAt = new Date(localToUtc(date, minutes, ctx.timeZone)).toISOString();
      const r = await store.insert('reminders', { title, remind_at: remindAt });
      return { type, id: r.id, title };
    }
    case 'idea':
    case 'note': {
      const n = await saveNote(store, { title, body: '', note_type: type === 'idea' ? 'research' : 'general', goal_id: goalId });
      if (type === 'idea') await store.update('notes', n.id, { folder: 'Ideas', tags: draft.tags });
      else if (draft.tags.length) await store.update('notes', n.id, { tags: draft.tags });
      return { type, id: n.id, title };
    }
    case 'habit': {
      const h = await createHabit(store, { name: title, frequency_kind: 'daily', start_date: ctx.today, duration_minutes: draft.durationMinutes, category_id: categoryId, goal_id: goalId });
      return { type, id: h.id, title: h.name };
    }
    case 'goal': {
      const g = await createGoal(store, { title, deadline: draft.date, category_id: categoryId }, ctx.today);
      return { type, id: g.id, title: g.title };
    }
  }
}

function minutesToHhmm(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
