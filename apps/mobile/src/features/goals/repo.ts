import { z } from 'zod';
import { goalProgress, type Progress } from '@ascend/domain';
import type { Store } from '../../data/store.ts';
import { rankAtEnd, rankBetween } from '../../data/ranks.ts';
import type { ChecklistItem, Goal, GoalStatus, KnowledgeItem, Milestone, Note, NoteType, ProgressEntry, Task } from '../../data/types.ts';
import { isoDate, optionalText, parseOrThrow, requiredTitle, url, ValidationError } from '../../data/validation.ts';

// ───────────────────────────── goals ─────────────────────────────

export const goalInput = z
  .object({
    title: requiredTitle(),
    description: optionalText(5000),
    why: optionalText(2000),
    category_id: z.string().uuid().nullable().optional(),
    deadline: isoDate.nullable().optional(),
    progress_mode: z.enum(['milestones', 'tasks', 'target', 'manual']).default('milestones'),
    target_value: z.number().finite().nullable().optional(),
    target_unit: optionalText(40),
    current_value: z.number().finite().nullable().optional(),
    baseline_value: z.number().finite().nullable().optional(),
  })
  .refine((g) => g.progress_mode !== 'target' || (g.target_value !== null && g.target_value !== undefined), {
    message: 'Set a target value',
    path: ['target_value'],
  });
export type GoalInput = z.input<typeof goalInput>;

export async function listGoals(store: Store, statuses: GoalStatus[] = ['active', 'paused']): Promise<Goal[]> {
  return store.list<Goal>('goals', {
    where: `status IN (${statuses.map(() => '?').join(',')})`,
    params: statuses,
    orderBy: 'rank COLLATE BINARY',
  });
}

/** Active goals in the user's priority order, with their 1-based position. */
export async function activeGoalRanks(store: Store): Promise<Map<string, { rank: number; title: string }>> {
  const goals = await listGoals(store, ['active']);
  return new Map(goals.map((g, i) => [g.id, { rank: i + 1, title: g.title }]));
}

export interface MilestoneDraft {
  title: string;
  deadline?: string | null;
}

/**
 * Checks the markers entered while creating a goal. Blank rows are ignored; a dated row needs a
 * title, and no marker may fall after the goal's own deadline.
 */
export function validateMilestoneDrafts(drafts: readonly MilestoneDraft[], goalDeadline: string | null | undefined): { title: string; deadline: string | null }[] {
  const out: { title: string; deadline: string | null }[] = [];
  for (const [i, d] of drafts.entries()) {
    const title = d.title.trim();
    if (!title && !d.deadline) continue;
    const r = milestoneInput.safeParse({ title, deadline: d.deadline ?? null });
    if (!r.success) throw new ValidationError({ milestones: `Milestone ${i + 1}: ${r.error.issues[0]?.message ?? 'check this milestone'}` });
    if (goalDeadline && r.data.deadline && r.data.deadline > goalDeadline) {
      throw new ValidationError({ milestones: `Milestone ${i + 1} is after the goal’s deadline` });
    }
    out.push({ title: r.data.title, deadline: r.data.deadline ?? null });
  }
  if (out.length > 30) throw new ValidationError({ milestones: 'Add up to 30 milestones here; you can add more later' });
  return out;
}

/** Creates a goal, and any milestones entered with it, in one step: all are saved or none are. */
export async function createGoal(store: Store, input: GoalInput, today: string, milestones: readonly MilestoneDraft[] = []): Promise<Goal> {
  const v = parseOrThrow(goalInput, input);
  const markers = validateMilestoneDrafts(milestones, v.deadline);
  const rank = await rankAtEnd(store, 'goals', "status IN ('active','paused')");
  return store.write(async (tx) => {
    const goal = await tx.insert<Goal>('goals', {
      title: v.title,
      description: v.description ?? null,
      why: v.why ?? null,
      category_id: v.category_id ?? null,
      deadline: v.deadline ?? null,
      progress_mode: v.progress_mode,
      target_value: v.target_value ?? null,
      target_unit: v.target_unit ?? null,
      current_value: v.current_value ?? null,
      baseline_value: v.baseline_value ?? v.current_value ?? null,
      status: 'active',
      rank,
      started_on: today,
    });
    if (v.progress_mode === 'target' && v.current_value !== null && v.current_value !== undefined) {
      await tx.insert('goal_progress_entries', { goal_id: goal.id, value: v.current_value, source: 'manual', recorded_at: tx.nowIso() });
    }
    let previous: string | null = null;
    for (const m of markers) {
      previous = rankBetween(previous, null);
      await tx.insert('milestones', { goal_id: goal.id, title: m.title, deadline: m.deadline, status: 'open', rank: previous });
    }
    return goal;
  });
}

export async function updateGoal(store: Store, id: string, input: Partial<GoalInput>): Promise<Goal> {
  const current = await store.get<Goal>('goals', id);
  if (!current) throw new Error('Goal not found');
  const merged = parseOrThrow(goalInput, { ...current, ...input });
  return store.write(async (tx) => {
    const updated = await tx.update<Goal>('goals', id, {
      title: merged.title,
      description: merged.description ?? null,
      why: merged.why ?? null,
      category_id: merged.category_id ?? null,
      deadline: merged.deadline ?? null,
      progress_mode: merged.progress_mode,
      target_value: merged.target_value ?? null,
      target_unit: merged.target_unit ?? null,
      current_value: merged.current_value ?? null,
      baseline_value: merged.baseline_value ?? null,
    });
    if (input.current_value !== undefined && input.current_value !== current.current_value && input.current_value !== null) {
      await tx.insert('goal_progress_entries', { goal_id: id, value: input.current_value, source: 'manual', recorded_at: tx.nowIso() });
    }
    return updated;
  });
}

export async function setGoalStatus(store: Store, id: string, status: GoalStatus): Promise<void> {
  const current = await store.get<Goal>('goals', id);
  if (!current) throw new Error('Goal not found');
  const changes: Partial<Goal> = { status, completed_at: status === 'completed' ? (current.completed_at ?? store.now().toISOString()) : null };
  if ((status === 'active' || status === 'paused') && current.status !== 'active' && current.status !== 'paused') {
    // Back into the priority list: goes to the bottom so it never silently outranks the user's order.
    changes.rank = await rankAtEnd(store, 'goals', "status IN ('active','paused')");
  }
  await store.update('goals', id, changes);
}

/** Move a goal between two neighbours in the priority list (drag-and-drop). Only this row changes. */
export async function moveGoal(store: Store, id: string, beforeRank: string | null, afterRank: string | null): Promise<void> {
  await store.update('goals', id, { rank: rankBetween(beforeRank, afterRank) });
}

export async function deleteGoal(store: Store, id: string): Promise<void> {
  await store.remove('goals', id);
}

export async function restoreGoal(store: Store, id: string): Promise<void> {
  await store.restore('goals', id);
}

// ───────────────────────────── progress ─────────────────────────────

export interface GoalDetail {
  goal: Goal;
  milestones: Milestone[];
  checklist: ChecklistItem[];
  tasks: Task[];
  notes: Note[];
  resources: KnowledgeItem[];
  history: ProgressEntry[];
  progress: Progress;
}

export async function computeProgress(store: Store, goal: Goal): Promise<Progress> {
  const [milestones, tasks, latest] = await Promise.all([
    store.list<Milestone>('milestones', { where: 'goal_id = ?', params: [goal.id] }),
    store.list<Task>('tasks', { where: 'goal_id = ? AND parent_task_id IS NULL', params: [goal.id] }),
    store.list<ProgressEntry>('goal_progress_entries', { where: "goal_id = ? AND source = 'manual'", params: [goal.id], orderBy: 'recorded_at DESC', limit: 1 }),
  ]);
  return goalProgress({
    mode: goal.progress_mode,
    milestones,
    tasks,
    targetValue: goal.target_value,
    currentValue: goal.current_value,
    baselineValue: goal.baseline_value,
    manualPercent: latest[0]?.value ?? null,
  });
}

export async function loadGoalDetail(store: Store, id: string): Promise<GoalDetail | null> {
  const goal = await store.get<Goal>('goals', id);
  if (!goal || goal.deleted_at) return null;
  const [milestones, checklist, tasks, notes, resources, history, progress] = await Promise.all([
    store.list<Milestone>('milestones', { where: 'goal_id = ?', params: [id], orderBy: 'rank COLLATE BINARY' }),
    store.list<ChecklistItem>('goal_checklist_items', { where: 'goal_id = ?', params: [id], orderBy: 'rank COLLATE BINARY' }),
    store.list<Task>('tasks', { where: "goal_id = ? AND parent_task_id IS NULL AND archived_at IS NULL", params: [id], orderBy: "CASE status WHEN 'completed' THEN 1 WHEN 'cancelled' THEN 2 ELSE 0 END, due_date IS NULL, due_date, rank" }),
    store.list<Note>('notes', { where: 'goal_id = ?', params: [id], orderBy: 'pinned DESC, updated_at DESC' }),
    store.list<KnowledgeItem>('knowledge_items', { where: 'goal_id = ?', params: [id], orderBy: 'is_favorite DESC, created_at DESC' }),
    store.list<ProgressEntry>('goal_progress_entries', { where: 'goal_id = ?', params: [id], orderBy: 'recorded_at DESC', limit: 50 }),
    computeProgress(store, goal),
  ]);
  return { goal, milestones, checklist, tasks, notes, resources, history, progress };
}

/** Records a progress update: a percentage for manual goals, or the current value for target goals. */
export async function recordProgress(store: Store, goalId: string, value: number, note: string | null): Promise<void> {
  const goal = await store.get<Goal>('goals', goalId);
  if (!goal) throw new Error('Goal not found');
  if (!Number.isFinite(value)) throw new Error('Enter a number');
  if (goal.progress_mode === 'manual' && (value < 0 || value > 100)) throw new Error('Enter a percentage between 0 and 100');
  await store.write(async (tx) => {
    await tx.insert('goal_progress_entries', { goal_id: goalId, value, note: note?.trim() || null, source: 'manual', recorded_at: tx.nowIso() });
    if (goal.progress_mode === 'target') await tx.update('goals', goalId, { current_value: value });
  });
}

// ───────────────────────────── milestones ─────────────────────────────

export const milestoneInput = z.object({
  title: requiredTitle(),
  description: optionalText(5000),
  deadline: isoDate.nullable().optional(),
});

export async function addMilestone(store: Store, goalId: string, input: z.input<typeof milestoneInput>): Promise<Milestone> {
  const v = parseOrThrow(milestoneInput, input);
  const rank = await rankAtEnd(store, 'milestones', 'goal_id = ?', [goalId]);
  return store.insert<Milestone>('milestones', { goal_id: goalId, title: v.title, description: v.description ?? null, deadline: v.deadline ?? null, status: 'open', rank });
}

export async function updateMilestone(store: Store, id: string, input: Partial<z.input<typeof milestoneInput>>): Promise<void> {
  const current = await store.get<Milestone>('milestones', id);
  if (!current) throw new Error('Milestone not found');
  const v = parseOrThrow(milestoneInput, { title: current.title, description: current.description, deadline: current.deadline, ...input });
  await store.update('milestones', id, { title: v.title, description: v.description ?? null, deadline: v.deadline ?? null });
}

/** Completing a milestone updates goal progress and leaves a dated entry in the goal's history. */
export async function setMilestoneDone(store: Store, id: string, done: boolean): Promise<void> {
  const m = await store.get<Milestone>('milestones', id);
  if (!m) throw new Error('Milestone not found');
  await store.write(async (tx) => {
    await tx.update('milestones', id, { status: done ? 'done' : 'open', completed_at: done ? tx.nowIso() : null });
    if (done && m.goal_id) {
      await tx.insert('goal_progress_entries', {
        goal_id: m.goal_id,
        value: null,
        note: `Milestone completed: ${m.title}`,
        source: 'milestone',
        source_id: id,
        recorded_at: tx.nowIso(),
      });
    }
  });
}

export async function deleteMilestone(store: Store, id: string): Promise<void> {
  await store.remove('milestones', id);
}

// ───────────────────────────── checklist ─────────────────────────────

export async function addChecklistItem(store: Store, goalId: string, title: string): Promise<void> {
  const t = parseOrThrow(requiredTitle(300), title);
  const rank = await rankAtEnd(store, 'goal_checklist_items', 'goal_id = ?', [goalId]);
  await store.insert('goal_checklist_items', { goal_id: goalId, title: t, is_done: false, rank });
}

export async function toggleChecklistItem(store: Store, id: string): Promise<void> {
  const item = await store.get<ChecklistItem>('goal_checklist_items', id);
  if (!item) return;
  await store.update('goal_checklist_items', id, { is_done: !item.is_done, done_at: item.is_done ? null : store.now().toISOString() });
}

export async function deleteChecklistItem(store: Store, id: string): Promise<void> {
  await store.remove('goal_checklist_items', id);
}

// ───────────────────────────── notes ─────────────────────────────

export const noteInput = z.object({
  title: z.string().trim().max(200).default(''),
  body: z.string().max(100000).default(''),
  note_type: z.enum(['general', 'strategy', 'learning', 'problem', 'next_steps', 'info', 'research']).default('general'),
  pinned: z.boolean().default(false),
});

export const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  strategy: 'Strategy',
  info: 'Important information',
  learning: 'What I’ve learned',
  problem: 'Problems to overcome',
  next_steps: 'Next steps',
  research: 'Research',
  general: 'Note',
};

export async function saveNote(store: Store, input: z.input<typeof noteInput> & { id?: string; goal_id?: string | null }): Promise<Note> {
  const v = parseOrThrow(noteInput, input);
  if (!v.title && !v.body.trim()) throw new Error('Write something first');
  if (input.id) return store.update<Note>('notes', input.id, v);
  return store.insert<Note>('notes', { ...v, goal_id: input.goal_id ?? null, tags: [] });
}

export async function deleteNote(store: Store, id: string): Promise<void> {
  await store.remove('notes', id);
}

// ───────────────────────────── resources ─────────────────────────────

export const resourceInput = z.object({
  title: requiredTitle(300),
  url,
  kind: z.enum(['video', 'article', 'link', 'book', 'course', 'note', 'info', 'file']).default('link'),
  body: optionalText(5000),
  milestone_id: z.string().uuid().nullable().optional(),
});

/** Guesses the kind of a link from its host, so videos group together without extra taps. */
export function guessResourceKind(link: string): 'video' | 'article' | 'course' | 'link' {
  const host = link.toLowerCase();
  if (/(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com)/.test(host)) return 'video';
  if (/(coursera|udemy|edx|khanacademy|skillshare|futurelearn)/.test(host)) return 'course';
  if (/(medium\.com|substack|bbc\.|wikipedia)/.test(host)) return 'article';
  return 'link';
}

export async function addResource(store: Store, goalId: string, input: z.input<typeof resourceInput>): Promise<KnowledgeItem> {
  const v = parseOrThrow(resourceInput, input);
  return store.insert<KnowledgeItem>('knowledge_items', {
    kind: input.kind ?? guessResourceKind(v.url),
    title: v.title,
    url: v.url,
    body: v.body ?? null,
    goal_id: goalId,
    milestone_id: v.milestone_id ?? null,
    tags: [],
    is_favorite: false,
  });
}

export async function deleteResource(store: Store, id: string): Promise<void> {
  await store.remove('knowledge_items', id);
}

export async function toggleResourceFavorite(store: Store, id: string): Promise<void> {
  const r = await store.get<KnowledgeItem>('knowledge_items', id);
  if (r) await store.update('knowledge_items', id, { is_favorite: !r.is_favorite });
}
