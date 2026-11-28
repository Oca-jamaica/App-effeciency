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
  /** The user's name for this time, e.g. "School" or "Morning routine". */
  label: string | null;
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
  project_id: string | null;
  stage_id: string | null;
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
  project_id: string | null;
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
  project_id: string | null;
  skill_id: string | null;
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
  project_id: string | null;
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

// ───────────────────────────── Stage 4 ─────────────────────────────

export interface Project extends BaseRow {
  kind: 'project' | 'mission';
  title: string;
  objective: string | null;
  description: string | null;
  status: 'planning' | 'active' | 'on_hold' | 'completed' | 'archived';
  category_id: string | null;
  goal_id: string | null;
  start_date: string | null;
  deadline: string | null;
  completed_at: string | null;
  completion_summary: string | null;
  rank: string;
}

export interface ProjectStage extends BaseRow {
  project_id: string;
  title: string;
  description: string | null;
  deadline: string | null;
  status: 'open' | 'done';
  rank: string;
}

export interface Skill extends BaseRow {
  parent_id: string | null;
  name: string;
  description: string | null;
  category_id: string | null;
  goal_id: string | null;
  level: number;
  target_level: number | null;
  rank: string;
}

export interface SkillProgress extends BaseRow {
  skill_id: string;
  level: number | null;
  note: string | null;
  source: 'manual' | 'training' | 'learning' | 'project';
  source_id: string | null;
  recorded_at: string;
}

export interface LearningItem extends BaseRow {
  kind: 'book' | 'course' | 'article' | 'topic' | 'video' | 'podcast';
  title: string;
  author_or_provider: string | null;
  url: string | null;
  status: 'want' | 'in_progress' | 'completed' | 'dropped';
  progress_current: number | null;
  progress_total: number | null;
  progress_unit: 'pages' | 'chapters' | 'lessons' | 'percent' | 'minutes';
  started_on: string | null;
  completed_on: string | null;
  rating: number | null;
  notes: string | null;
  goal_id: string | null;
  skill_id: string | null;
}

export type FocusKind = 'focus' | 'study' | 'learning' | 'deep_work';
export interface FocusSession extends BaseRow {
  kind: FocusKind;
  source: 'timer' | 'manual';
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  pause_seconds: number;
  planned_minutes: number | null;
  task_id: string | null;
  goal_id: string | null;
  project_id: string | null;
  learning_item_id: string | null;
  schedule_block_id: string | null;
  quality: number | null;
  notes: string | null;
  status: 'running' | 'completed' | 'abandoned';
}

export interface StudyVideo extends BaseRow {
  focus_session_id: string | null;
  task_id: string | null;
  goal_id: string | null;
  recorded_on: string;
  storage_path: string;
  mime_type: 'video/mp4' | 'video/quicktime';
  size_bytes: number;
  duration_seconds: number | null;
  session_minutes: number | null;
  notes: string | null;
  upload_status: 'pending' | 'uploading' | 'ready' | 'failed';
  upload_error: string | null;
}

export interface Exercise extends BaseRow {
  name: string;
  kind: 'strength' | 'cardio' | 'mobility' | 'skill' | 'other';
  muscle_group: string | null;
  equipment: string | null;
  weight_unit: 'kg' | 'lb';
  notes: string | null;
}

export interface WorkoutPlan extends BaseRow {
  name: string;
  description: string | null;
  goal_id: string | null;
  rank: string;
}

export interface WorkoutPlanItem extends BaseRow {
  plan_id: string;
  exercise_id: string;
  position: number;
  target_sets: number;
  target_reps: number | null;
  target_weight: number | null;
  rest_seconds: number | null;
  notes: string | null;
}

export interface WorkoutSession extends BaseRow {
  plan_id: string | null;
  title: string;
  started_at: string;
  ended_at: string | null;
  schedule_block_id: string | null;
  perceived_effort: number | null;
  notes: string | null;
}

export interface WorkoutSet extends BaseRow {
  session_id: string;
  exercise_id: string;
  set_index: number;
  reps: number | null;
  weight: number | null;
  duration_seconds: number | null;
  distance_m: number | null;
  rpe: number | null;
  is_warmup: boolean;
  completed_at: string | null;
}

export interface Sport extends BaseRow {
  name: string;
  position: string | null;
  notes: string | null;
}

export interface TrainingSession extends BaseRow {
  sport_id: string;
  session_type: 'technical' | 'tactical' | 'match' | 'conditioning' | 'recovery' | 'other';
  started_at: string;
  duration_minutes: number;
  intensity: number | null;
  performance_rating: number | null;
  focus: string | null;
  notes: string | null;
  schedule_block_id: string | null;
  goal_id: string | null;
}

export interface TrainingSessionSkill extends BaseRow {
  training_session_id: string;
  skill_id: string;
  minutes: number | null;
  rating: number | null;
  note: string | null;
}

export interface Person extends BaseRow {
  name: string;
  birthday_month: number | null;
  birthday_day: number | null;
  birth_year: number | null;
  relationship: string | null;
  notes: string | null;
}

export interface Experience extends BaseRow {
  title: string;
  description: string | null;
  category: 'place' | 'event' | 'activity' | 'skill' | 'other';
  status: 'someday' | 'planned' | 'done';
  target_date: string | null;
  completed_on: string | null;
  location: string | null;
  rating: number | null;
  notes: string | null;
}

export interface JournalEntry extends BaseRow {
  entry_date: string;
  went_well: string | null;
  could_improve: string | null;
  learned: string | null;
  looking_forward: string | null;
  free_text: string | null;
}

export interface Decision extends BaseRow {
  title: string;
  decided_on: string | null;
  context: string | null;
  alternatives: string | null;
  reasoning: string | null;
  expected_outcome: string | null;
  confidence: number | null;
  review_on: string | null;
  actual_outcome: string | null;
  reflection: string | null;
  status: 'open' | 'decided' | 'reviewed';
}

export interface Idea extends BaseRow {
  title: string;
  description: string | null;
  category_id: string | null;
  research: string | null;
  potential: number | null;
  next_steps: string | null;
  status: 'seed' | 'exploring' | 'validated' | 'parked' | 'converted';
  project_id: string | null;
}

export interface SleepLog extends BaseRow {
  sleep_date: string;
  bed_at: string | null;
  wake_at: string | null;
  duration_minutes: number | null;
  energy: number | null;
  recovery: number | null;
  notes: string | null;
}
