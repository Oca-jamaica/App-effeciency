/**
 * The synced-table registry: one description of every table that lives both on the device (SQLite)
 * and in Postgres. The app generates its local schema and (de)serialisation from this; a parity test
 * checks it against the Postgres migrations so the two can never drift apart.
 *
 * Every table also has the standard columns: id, user_id, created_at, updated_at, deleted_at.
 */
export type ColumnType =
  | 'uuid'
  | 'text'
  | 'int'
  | 'real'
  | 'bool'
  | 'date'
  | 'time'
  | 'timestamptz'
  | 'json'
  | 'text[]'
  | 'int[]'
  | 'time[]'
  | 'date[]';

export interface ColumnDef {
  name: string;
  type: ColumnType;
  nullable: boolean;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  /** Natural key for tables where two devices may create "the same" row (e.g. one log per habit per day). */
  naturalKey?: string[];
}

function table(name: string, spec: string[], naturalKey?: string[]): TableDef {
  const standard: ColumnDef[] = [
    { name: 'id', type: 'uuid', nullable: false },
    { name: 'user_id', type: 'uuid', nullable: false },
    { name: 'created_at', type: 'timestamptz', nullable: false },
    { name: 'updated_at', type: 'timestamptz', nullable: false },
    { name: 'deleted_at', type: 'timestamptz', nullable: true },
  ];
  const columns = spec.map((s) => {
    const [colName, rawType] = s.split(/\s+/) as [string, string];
    const nullable = rawType.endsWith('?');
    return { name: colName, type: rawType.replace('?', '') as ColumnType, nullable };
  });
  return { name, columns: [...standard, ...columns], ...(naturalKey ? { naturalKey } : {}) };
}

/** Ordered so that parents come before children (used for initial sync and push ordering). */
export const SYNCED_TABLES: readonly TableDef[] = [
  table('profiles', [
    'display_name text?',
    'timezone text',
    'locale text?',
    'week_starts_on int',
    'onboarding_completed_at timestamptz?',
  ]),
  table('user_preferences', [
    'theme text',
    'day_start time',
    'day_end time',
    'default_task_minutes int',
    'max_focus_minutes_per_day int',
    'max_block_minutes int',
    'break_after_minutes int',
    'break_minutes int',
    'buffer_minutes int',
    'min_free_minutes_per_day int',
    'schedule_inbox_with_deadline bool',
    'ai_enabled bool',
    'ai_auto_apply_low_risk bool',
    'ai_daily_briefing bool',
    'ai_access_journal bool',
    'ai_access_decisions bool',
    'ai_access_notes bool',
    'ai_access_memory bool',
    'ai_access_sleep bool',
    'quiet_hours_start time?',
    'quiet_hours_end time?',
    'max_notifications_per_day int',
    'notify_block_start bool',
  ]),
  table('availability_windows', ['weekday int', 'start_time time', 'end_time time', 'kind text']),
  table('categories', [
    'name text',
    'color text',
    'icon text',
    'applies_to text[]',
    'is_default bool',
    'rank text',
    'archived_at timestamptz?',
  ]),
  table('goals', [
    'title text',
    'description text?',
    'why text?',
    'category_id uuid?',
    'status text',
    'rank text',
    'deadline date?',
    'started_on date',
    'completed_at timestamptz?',
    'progress_mode text',
    'target_value real?',
    'target_unit text?',
    'current_value real?',
    'baseline_value real?',
  ]),
  table('milestones', [
    'goal_id uuid?',
    'project_id uuid?',
    'stage_id uuid?',
    'title text',
    'description text?',
    'deadline date?',
    'status text',
    'completed_at timestamptz?',
    'rank text',
  ]),
  table('goal_checklist_items', ['goal_id uuid', 'title text', 'is_done bool', 'done_at timestamptz?', 'rank text']),
  table('goal_progress_entries', [
    'goal_id uuid',
    'value real?',
    'note text?',
    'source text',
    'source_id uuid?',
    'recorded_at timestamptz',
  ]),
  table('notes', [
    'title text',
    'body text',
    'note_type text',
    'goal_id uuid?',
    'folder text?',
    'pinned bool',
    'tags text[]',
    'project_id uuid?',
  ]),
  table('knowledge_items', [
    'kind text',
    'title text',
    'url text?',
    'body text?',
    'source_name text?',
    'category_id uuid?',
    'tags text[]',
    'goal_id uuid?',
    'milestone_id uuid?',
    'is_favorite bool',
    'project_id uuid?',
    'skill_id uuid?',
  ]),
  table('habits', [
    'name text',
    'description text?',
    'category_id uuid?',
    'goal_id uuid?',
    'frequency_kind text',
    'days_of_week int[]?',
    'times_per_period int?',
    'interval_days int?',
    'start_date date',
    'end_date date?',
    'duration_minutes int?',
    'preferred_window text',
    'preferred_time time?',
    'target_value real?',
    'target_unit text?',
    'status text',
    'paused_until date?',
    'reminder_times time[]',
    'notes text?',
    'rank text',
  ]),
  table(
    'habit_logs',
    ['habit_id uuid', 'log_date date', 'status text', 'value real?', 'note text?', 'logged_at timestamptz'],
    ['habit_id', 'log_date'],
  ),
  table('tasks', [
    'title text',
    'description text?',
    'notes text?',
    'category_id uuid?',
    'priority int',
    'status text',
    'archived_at timestamptz?',
    'due_date date?',
    'due_time time?',
    'do_date date?',
    'estimated_minutes int?',
    'splittable bool',
    'min_chunk_minutes int',
    'preferred_window text',
    'goal_id uuid?',
    'milestone_id uuid?',
    'parent_task_id uuid?',
    'recurrence_rule text?',
    'recurrence_template_id uuid?',
    'completed_at timestamptz?',
    'rank text',
    'project_id uuid?',
  ]),
  table('task_events', [
    'task_id uuid',
    'event_type text',
    'from_value json?',
    'to_value json?',
    'origin text',
    'occurred_at timestamptz',
  ]),
  table('calendar_events', [
    'title text',
    'description text?',
    'location text?',
    'starts_at timestamptz',
    'ends_at timestamptz',
    'all_day bool',
    'timezone text',
    'kind text',
    'is_locked bool',
    'busy bool',
    'recurrence_rule text?',
    'exdates date[]',
    'recurrence_parent_id uuid?',
    'original_start timestamptz?',
    'category_id uuid?',
    'goal_id uuid?',
  ]),
  table('reminders', [
    'title text',
    'remind_at timestamptz',
    'recurrence_rule text?',
    'task_id uuid?',
    'habit_id uuid?',
    'event_id uuid?',
    'done_at timestamptz?',
  ]),
  table('schedule_blocks', [
    'block_date date',
    'starts_at timestamptz',
    'ends_at timestamptz',
    'kind text',
    'task_id uuid?',
    'habit_id uuid?',
    'title text',
    'origin text',
    'is_locked bool',
    'status text',
    'actual_minutes int?',
    'reason text?',
    'algorithm_version text?',
    'completed_at timestamptz?',
  ]),
  table('projects', [
    'kind text',
    'title text',
    'objective text?',
    'description text?',
    'status text',
    'category_id uuid?',
    'goal_id uuid?',
    'start_date date?',
    'deadline date?',
    'completed_at timestamptz?',
    'completion_summary text?',
    'rank text',
  ]),
  table('project_stages', ['project_id uuid', 'title text', 'description text?', 'deadline date?', 'status text', 'rank text']),
  table('skills', [
    'parent_id uuid?',
    'name text',
    'description text?',
    'category_id uuid?',
    'goal_id uuid?',
    'level int',
    'target_level int?',
    'rank text',
  ]),
  table('skill_progress_entries', ['skill_id uuid', 'level int?', 'note text?', 'source text', 'source_id uuid?', 'recorded_at timestamptz']),
  table('learning_items', [
    'kind text',
    'title text',
    'author_or_provider text?',
    'url text?',
    'status text',
    'progress_current real?',
    'progress_total real?',
    'progress_unit text',
    'started_on date?',
    'completed_on date?',
    'rating int?',
    'notes text?',
    'goal_id uuid?',
    'skill_id uuid?',
  ]),
  table('focus_sessions', [
    'kind text',
    'source text',
    'started_at timestamptz',
    'ended_at timestamptz?',
    'duration_seconds int',
    'pause_seconds int',
    'planned_minutes int?',
    'task_id uuid?',
    'goal_id uuid?',
    'project_id uuid?',
    'learning_item_id uuid?',
    'schedule_block_id uuid?',
    'quality int?',
    'notes text?',
    'status text',
  ]),
  table('study_videos', [
    'focus_session_id uuid?',
    'task_id uuid?',
    'goal_id uuid?',
    'recorded_on date',
    'storage_path text',
    'mime_type text',
    'size_bytes int',
    'duration_seconds int?',
    'session_minutes int?',
    'notes text?',
    'upload_status text',
    'upload_error text?',
  ]),
  table('exercises', ['name text', 'kind text', 'muscle_group text?', 'equipment text?', 'weight_unit text', 'notes text?']),
  table('workout_plans', ['name text', 'description text?', 'goal_id uuid?', 'rank text']),
  table('workout_plan_items', [
    'plan_id uuid',
    'exercise_id uuid',
    'position int',
    'target_sets int',
    'target_reps int?',
    'target_weight real?',
    'rest_seconds int?',
    'notes text?',
  ]),
  table('workout_sessions', [
    'plan_id uuid?',
    'title text',
    'started_at timestamptz',
    'ended_at timestamptz?',
    'schedule_block_id uuid?',
    'perceived_effort int?',
    'notes text?',
  ]),
  table('workout_sets', [
    'session_id uuid',
    'exercise_id uuid',
    'set_index int',
    'reps int?',
    'weight real?',
    'duration_seconds int?',
    'distance_m real?',
    'rpe real?',
    'is_warmup bool',
    'completed_at timestamptz?',
  ]),
  table('sports', ['name text', 'position text?', 'notes text?']),
  table('training_sessions', [
    'sport_id uuid',
    'session_type text',
    'started_at timestamptz',
    'duration_minutes int',
    'intensity int?',
    'performance_rating int?',
    'focus text?',
    'notes text?',
    'schedule_block_id uuid?',
    'goal_id uuid?',
  ]),
  table(
    'training_session_skills',
    ['training_session_id uuid', 'skill_id uuid', 'minutes int?', 'rating int?', 'note text?'],
    ['training_session_id', 'skill_id'],
  ),
  table('people', ['name text', 'birthday_month int?', 'birthday_day int?', 'birth_year int?', 'relationship text?', 'notes text?']),
  table('experiences', [
    'title text',
    'description text?',
    'category text',
    'status text',
    'target_date date?',
    'completed_on date?',
    'location text?',
    'rating int?',
    'notes text?',
  ]),
  table(
    'journal_entries',
    ['entry_date date', 'went_well text?', 'could_improve text?', 'learned text?', 'looking_forward text?', 'free_text text?'],
    ['entry_date'],
  ),
  table('decisions', [
    'title text',
    'decided_on date?',
    'context text?',
    'alternatives text?',
    'reasoning text?',
    'expected_outcome text?',
    'confidence int?',
    'review_on date?',
    'actual_outcome text?',
    'reflection text?',
    'status text',
  ]),
  table('ideas', [
    'title text',
    'description text?',
    'category_id uuid?',
    'research text?',
    'potential int?',
    'next_steps text?',
    'status text',
    'project_id uuid?',
  ]),
  table(
    'sleep_logs',
    ['sleep_date date', 'bed_at time?', 'wake_at time?', 'duration_minutes int?', 'energy int?', 'recovery int?', 'notes text?'],
    ['sleep_date'],
  ),
];

export type SyncedTableName =
  | 'profiles'
  | 'user_preferences'
  | 'availability_windows'
  | 'categories'
  | 'goals'
  | 'milestones'
  | 'goal_checklist_items'
  | 'goal_progress_entries'
  | 'notes'
  | 'knowledge_items'
  | 'habits'
  | 'habit_logs'
  | 'tasks'
  | 'task_events'
  | 'calendar_events'
  | 'reminders'
  | 'schedule_blocks'
  | 'projects'
  | 'project_stages'
  | 'skills'
  | 'skill_progress_entries'
  | 'learning_items'
  | 'focus_sessions'
  | 'study_videos'
  | 'exercises'
  | 'workout_plans'
  | 'workout_plan_items'
  | 'workout_sessions'
  | 'workout_sets'
  | 'sports'
  | 'training_sessions'
  | 'training_session_skills'
  | 'people'
  | 'experiences'
  | 'journal_entries'
  | 'decisions'
  | 'ideas'
  | 'sleep_logs';

export function tableDef(name: string): TableDef {
  const t = SYNCED_TABLES.find((x) => x.name === name);
  if (!t) throw new Error(`Unknown synced table: ${name}`);
  return t;
}
