import { z } from 'zod';
import { projectProgress } from '@ascend/domain';
import type { Store } from '../../data/store.ts';
import { rankAtEnd } from '../../data/ranks.ts';
import type { FocusSession, Milestone, Note, Project, ProjectStage, Task } from '../../data/types.ts';
import { isoDate, optionalText, parseOrThrow, requiredTitle, ValidationError } from '../../data/validation.ts';

export const projectInput = z
  .object({
    kind: z.enum(['project', 'mission']).default('project'),
    title: requiredTitle(),
    objective: optionalText(2000),
    description: optionalText(10000),
    goal_id: z.string().uuid().nullable().optional(),
    category_id: z.string().uuid().nullable().optional(),
    start_date: isoDate.nullable().optional(),
    deadline: isoDate.nullable().optional(),
  })
  .refine((p) => !p.deadline || !p.start_date || p.deadline >= p.start_date, { message: 'The deadline must be after the start', path: ['deadline'] })
  .refine((p) => p.kind !== 'mission' || (p.objective && p.deadline), { message: 'A mission needs an objective and a deadline', path: ['objective'] });
export type ProjectInput = z.input<typeof projectInput>;

export async function listProjects(store: Store, kind?: Project['kind'], includeClosed = false): Promise<Project[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (kind) (where.push('kind = ?'), params.push(kind));
  if (!includeClosed) where.push("status NOT IN ('completed','archived')");
  return store.list<Project>('projects', { where: where.join(' AND ') || undefined, params, orderBy: "status = 'on_hold', rank COLLATE BINARY" });
}

export async function createProject(store: Store, input: ProjectInput): Promise<Project> {
  const v = parseOrThrow(projectInput, input);
  const rank = await rankAtEnd(store, 'projects');
  return store.insert<Project>('projects', {
    kind: v.kind,
    title: v.title,
    objective: v.objective ?? null,
    description: v.description ?? null,
    goal_id: v.goal_id ?? null,
    category_id: v.category_id ?? null,
    start_date: v.start_date ?? null,
    deadline: v.deadline ?? null,
    status: 'active',
    rank,
  });
}

export async function updateProject(store: Store, id: string, input: Partial<ProjectInput>): Promise<Project> {
  const current = await store.get<Project>('projects', id);
  if (!current) throw new Error('Project not found');
  const v = parseOrThrow(projectInput, { ...current, ...input });
  return store.update<Project>('projects', id, {
    title: v.title,
    objective: v.objective ?? null,
    description: v.description ?? null,
    goal_id: v.goal_id ?? null,
    category_id: v.category_id ?? null,
    start_date: v.start_date ?? null,
    deadline: v.deadline ?? null,
  });
}

export async function setProjectStatus(store: Store, id: string, status: Project['status'], completionSummary?: string | null): Promise<void> {
  if (status === 'completed' && completionSummary !== undefined && completionSummary !== null && completionSummary.length > 10000) {
    throw new ValidationError({ completion_summary: 'Keep the summary under 10,000 characters' });
  }
  await store.update('projects', id, {
    status,
    completed_at: status === 'completed' ? store.now().toISOString() : null,
    ...(completionSummary !== undefined ? { completion_summary: completionSummary?.trim() || null } : {}),
  });
}

export async function deleteProject(store: Store, id: string): Promise<void> {
  await store.remove('projects', id);
}

// ───────────────────────────── stages & milestones ─────────────────────────────

export async function addStage(store: Store, projectId: string, title: string, deadline: string | null = null): Promise<ProjectStage> {
  const t = parseOrThrow(requiredTitle(), title);
  const rank = await rankAtEnd(store, 'project_stages', 'project_id = ?', [projectId]);
  return store.insert<ProjectStage>('project_stages', { project_id: projectId, title: t, deadline, status: 'open', rank });
}

export async function setStageDone(store: Store, id: string, done: boolean): Promise<void> {
  await store.update('project_stages', id, { status: done ? 'done' : 'open' });
}

export async function deleteStage(store: Store, id: string): Promise<void> {
  await store.remove('project_stages', id);
}

export async function addProjectMilestone(store: Store, projectId: string, input: { title: string; deadline?: string | null; stageId?: string | null }): Promise<Milestone> {
  const t = parseOrThrow(requiredTitle(), input.title);
  const rank = await rankAtEnd(store, 'milestones', 'project_id = ?', [projectId]);
  return store.insert<Milestone>('milestones', {
    project_id: projectId,
    goal_id: null,
    stage_id: input.stageId ?? null,
    title: t,
    deadline: input.deadline ?? null,
    status: 'open',
    rank,
  });
}

export async function setProjectMilestoneDone(store: Store, id: string, done: boolean): Promise<void> {
  await store.update('milestones', id, { status: done ? 'done' : 'open', completed_at: done ? store.now().toISOString() : null });
}

export interface ProjectDetail {
  project: Project;
  stages: ProjectStage[];
  milestones: Milestone[];
  tasks: Task[];
  notes: Note[];
  focusMinutes: number;
  progress: ReturnType<typeof projectProgress>;
}

export async function loadProjectDetail(store: Store, id: string): Promise<ProjectDetail | null> {
  const project = await store.get<Project>('projects', id);
  if (!project || project.deleted_at) return null;
  const [stages, milestones, tasks, notes, sessions] = await Promise.all([
    store.list<ProjectStage>('project_stages', { where: 'project_id = ?', params: [id], orderBy: 'rank COLLATE BINARY' }),
    store.list<Milestone>('milestones', { where: 'project_id = ?', params: [id], orderBy: 'rank COLLATE BINARY' }),
    store.list<Task>('tasks', { where: 'project_id = ? AND parent_task_id IS NULL', params: [id], orderBy: "status = 'completed', priority, rank" }),
    store.list<Note>('notes', { where: 'project_id = ?', params: [id], orderBy: 'pinned DESC, updated_at DESC' }),
    store.list<FocusSession>('focus_sessions', { where: "status = 'completed' AND (project_id = ? OR task_id IN (SELECT id FROM tasks WHERE project_id = ? AND deleted_at IS NULL))", params: [id, id] }),
  ]);
  return {
    project,
    stages,
    milestones,
    tasks,
    notes,
    focusMinutes: Math.round(sessions.reduce((s, f) => s + f.duration_seconds, 0) / 60),
    progress: projectProgress({ milestones, tasks, stages }),
  };
}

export const PROJECT_STATUS_LABELS: Record<Project['status'], string> = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  archived: 'Archived',
};
