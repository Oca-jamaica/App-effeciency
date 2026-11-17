/** Row shapes as stored locally (mirrors packages/domain/src/schema.ts). */
export interface BaseRow {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Profile extends BaseRow {
  display_name: string | null;
  timezone: string;
  locale: string | null;
  week_starts_on: number;
  onboarding_completed_at: string | null;
}

export interface Preferences extends BaseRow {
  theme: 'system' | 'light' | 'dark';
  day_start: string;
  day_end: string;
  default_task_minutes: number;
  max_focus_minutes_per_day: number;
  max_block_minutes: number;
  break_after_minutes: number;
  break_minutes: number;
  buffer_minutes: number;
  min_free_minutes_per_day: number;
  schedule_inbox_with_deadline: boolean;
  ai_enabled: boolean;
  ai_auto_apply_low_risk: boolean;
  ai_daily_briefing: boolean;
  ai_access_journal: boolean;
  ai_access_decisions: boolean;
  ai_access_notes: boolean;
  ai_access_memory: boolean;
  ai_access_sleep: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  max_notifications_per_day: number;
  notify_block_start: boolean;
}

export type AvailabilityKind = 'work' | 'study' | 'training' | 'protected_free' | 'no_scheduling';
export interface AvailabilityWindowRow extends BaseRow {
  weekday: number;
  start_time: string;
  end_time: string;
  kind: AvailabilityKind;
}

export interface Category extends BaseRow {
  name: string;
  color: string;
  icon: string;
  applies_to: string[];
  is_default: boolean;
  rank: string;
  archived_at: string | null;
}

export type GoalStatus = 'active' | 'paused' | 'completed' | 'archived';
export type ProgressMode = 'milestones' | 'tasks' | 'target' | 'manual';
export interface Goal extends BaseRow {
  title: string;
  description: string | null;
  why: string | null;
  category_id: string | null;
  status: GoalStatus;
  rank: string;
  deadline: string | null;
  started_on: string;
  completed_at: string | null;
  progress_mode: ProgressMode;
  target_value: number | null;
  target_unit: string | null;
  current_value: number | null;
  baseline_value: number | null;
}

export interface Milestone extends BaseRow {
  goal_id: string | null;
  title: string;
  description: string | null;
  deadline: string | null;
  status: 'open' | 'done' | 'skipped';
  completed_at: string | null;
  rank: string;
}

export interface ChecklistItem extends BaseRow {
  goal_id: string;
  title: string;
  is_done: boolean;
  done_at: string | null;
  rank: string;
}

export interface ProgressEntry extends BaseRow {
  goal_id: string;
  value: number | null;
  note: string | null;
  source: 'manual' | 'milestone' | 'task' | 'habit' | 'system';
  source_id: string | null;
  recorded_at: string;
}

export type NoteType = 'general' | 'strategy' | 'learning' | 'problem' | 'next_steps' | 'info' | 'research';
export interface Note extends BaseRow {
  title: string;
  body: string;
  note_type: NoteType;
  goal_id: string | null;
  folder: string | null;
  pinned: boolean;
  tags: string[];
}

export type KnowledgeKind = 'video' | 'article' | 'link' | 'book' | 'course' | 'note' | 'info' | 'file';
export interface KnowledgeItem extends BaseRow {
  kind: KnowledgeKind;
  title: string;
  url: string | null;
  body: string | null;
  source_name: string | null;
  category_id: string | null;
  tags: string[];
  goal_id: string | null;
  milestone_id: string | null;
  is_favorite: boolean;
}

export type FrequencyKind = 'daily' | 'weekdays' | 'times_per_week' | 'times_per_month' | 'every_n_days';
export type PreferredWindow = 'any' | 'morning' | 'afternoon' | 'evening' | 'work' | 'study';
export interface Habit extends BaseRow {
  name: string;
  description: string | null;
  category_id: string | null;
  goal_id: string | null;
  frequency_kind: FrequencyKind;
  days_of_week: number[] | null;
  times_per_period: number | null;
  interval_days: number | null;
  start_date: string;
  end_date: string | null;
  duration_minutes: number | null;
  preferred_window: PreferredWindow;
  preferred_time: string | null;
  target_value: number | null;
  target_unit: string | null;
  status: 'active' | 'paused' | 'archived';
  paused_until: string | null;
  reminder_times: string[];
  notes: string | null;
  rank: string;
}

export interface HabitLog extends BaseRow {
  habit_id: string;
  log_date: string;
  status: 'done' | 'partial' | 'skipped';
  value: number | null;
  note: string | null;
  logged_at: string;
}

export type TaskStatus = 'inbox' | 'planned' | 'in_progress' | 'completed' | 'cancelled';
export interface Task extends BaseRow {
  title: string;
  description: string | null;
  notes: string | null;
  category_id: string | null;
  priority: number;
  status: TaskStatus;
  archived_at: string | null;
  due_date: string | null;
  due_time: string | null;
  do_date: string | null;
  estimated_minutes: number | null;
  splittable: boolean;
  min_chunk_minutes: number;
  preferred_window: PreferredWindow;
  goal_id: string | null;
  milestone_id: string | null;
  parent_task_id: string | null;
  recurrence_rule: string | null;
  recurrence_template_id: string | null;
  completed_at: string | null;
  rank: string;
}

export interface TaskEvent extends BaseRow {
  task_id: string;
  event_type: string;
  from_value: unknown;
  to_value: unknown;
  origin: 'user' | 'scheduler' | 'ai';
  occurred_at: string;
}

export type EventKind = 'event' | 'commitment' | 'class' | 'work' | 'training' | 'social' | 'travel' | 'other';
export interface CalendarEvent extends BaseRow {
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  kind: EventKind;
  is_locked: boolean;
  busy: boolean;
  recurrence_rule: string | null;
  exdates: string[];
  recurrence_parent_id: string | null;
  original_start: string | null;
  category_id: string | null;
  goal_id: string | null;
}

export interface Reminder extends BaseRow {
  title: string;
  remind_at: string;
  recurrence_rule: string | null;
  task_id: string | null;
  habit_id: string | null;
  event_id: string | null;
  done_at: string | null;
}

export type BlockStatus = 'planned' | 'in_progress' | 'done' | 'partial' | 'missed' | 'skipped' | 'unplanned';
export interface ScheduleBlock extends BaseRow {
  block_date: string;
  starts_at: string;
  ends_at: string;
  kind: 'task' | 'habit' | 'break' | 'protected_free' | 'training' | 'focus' | 'custom';
  task_id: string | null;
  habit_id: string | null;
  title: string;
  origin: 'auto' | 'manual' | 'ai';
  is_locked: boolean;
  status: BlockStatus;
  actual_minutes: number | null;
  reason: string | null;
  algorithm_version: string | null;
  completed_at: string | null;
}
