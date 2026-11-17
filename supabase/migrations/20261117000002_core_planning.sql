-- ASCEND core planning: goals, milestones, notes, resources, habits, tasks, calendar, schedule.
-- Every reference to a parent is an ownership-enforcing composite foreign key (parent_id, user_id),
-- so a row can only ever point at its owner's rows (verified in supabase/tests).

-- ─────────────────────────── goals ───────────────────────────

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 5000),
  why text check (char_length(why) <= 2000),
  category_id uuid,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  rank text collate "C" not null,
  deadline date,
  started_on date not null default current_date,
  completed_at timestamptz,
  progress_mode text not null default 'milestones' check (progress_mode in ('milestones', 'tasks', 'target', 'manual')),
  target_value numeric,
  target_unit text check (char_length(target_unit) <= 40),
  current_value numeric,
  baseline_value numeric,
  unique (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id)
);
create index goals_user_status_rank_idx on public.goals (user_id, status, rank) where deleted_at is null;
create index goals_category_idx on public.goals (category_id);
select ascend_private.register_owned_table('public.goals', 20);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  goal_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 5000),
  deadline date,
  status text not null default 'open' check (status in ('open', 'done', 'skipped')),
  completed_at timestamptz,
  rank text collate "C" not null,
  unique (id, user_id),
  -- Replaced in Stage 4 to allow project milestones: exactly one parent.
  constraint milestones_parent_check check (goal_id is not null),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade
);
create index milestones_goal_idx on public.milestones (goal_id, rank);
select ascend_private.register_owned_table('public.milestones', 21);

create table public.goal_checklist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  goal_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  is_done boolean not null default false,
  done_at timestamptz,
  rank text collate "C" not null,
  unique (id, user_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade
);
create index goal_checklist_goal_idx on public.goal_checklist_items (goal_id, rank);
select ascend_private.register_owned_table('public.goal_checklist_items', 22);

create table public.goal_progress_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  goal_id uuid not null,
  value numeric,
  note text check (char_length(note) <= 2000),
  source text not null default 'manual' check (source in ('manual', 'milestone', 'task', 'habit', 'system')),
  source_id uuid,
  recorded_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade
);
create index goal_progress_goal_idx on public.goal_progress_entries (goal_id, recorded_at);
select ascend_private.register_owned_table('public.goal_progress_entries', 23);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  title text not null default '' check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 100000),
  note_type text not null default 'general'
    check (note_type in ('general', 'strategy', 'learning', 'problem', 'next_steps', 'info', 'research')),
  goal_id uuid,
  folder text check (char_length(folder) <= 80),
  pinned boolean not null default false,
  tags text[] not null default '{}',
  unique (id, user_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade
);
create index notes_goal_idx on public.notes (goal_id);
create index notes_tags_idx on public.notes using gin (tags);
select ascend_private.register_owned_table('public.notes', 24);

create table public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  kind text not null default 'link' check (kind in ('video', 'article', 'link', 'book', 'course', 'note', 'info', 'file')),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  url text check (url ~* '^https?://[^\s]+$' and char_length(url) <= 2048),
  body text check (char_length(body) <= 100000),
  source_name text check (char_length(source_name) <= 120),
  category_id uuid,
  tags text[] not null default '{}',
  goal_id uuid,
  milestone_id uuid,
  is_favorite boolean not null default false,
  unique (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id),
  foreign key (milestone_id, user_id) references public.milestones (id, user_id) on delete set null (milestone_id)
);
create index knowledge_goal_idx on public.knowledge_items (goal_id);
create index knowledge_milestone_idx on public.knowledge_items (milestone_id);
create index knowledge_category_idx on public.knowledge_items (category_id);
create index knowledge_tags_idx on public.knowledge_items using gin (tags);
select ascend_private.register_owned_table('public.knowledge_items', 25);

-- ─────────────────────────── habits ───────────────────────────

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (char_length(description) <= 2000),
  category_id uuid,
  goal_id uuid,
  frequency_kind text not null default 'daily'
    check (frequency_kind in ('daily', 'weekdays', 'times_per_week', 'times_per_month', 'every_n_days')),
  days_of_week smallint[] check (days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  times_per_period smallint check (times_per_period between 1 and 31),
  interval_days smallint check (interval_days between 2 and 365),
  start_date date not null default current_date,
  end_date date,
  duration_minutes smallint check (duration_minutes between 1 and 600),
  preferred_window text not null default 'any'
    check (preferred_window in ('any', 'morning', 'afternoon', 'evening', 'work', 'study')),
  preferred_time time,
  target_value numeric,
  target_unit text check (char_length(target_unit) <= 40),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  paused_until date,
  reminder_times time[] not null default '{}',
  notes text check (char_length(notes) <= 10000),
  rank text collate "C" not null,
  unique (id, user_id),
  check (end_date is null or end_date >= start_date),
  check (frequency_kind <> 'weekdays' or cardinality(days_of_week) > 0),
  check (frequency_kind not in ('times_per_week', 'times_per_month') or times_per_period is not null),
  check (frequency_kind <> 'times_per_week' or times_per_period <= 7),
  check (frequency_kind <> 'every_n_days' or interval_days is not null),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id)
);
create index habits_user_status_idx on public.habits (user_id, status) where deleted_at is null;
create index habits_goal_idx on public.habits (goal_id);
create index habits_category_idx on public.habits (category_id);
select ascend_private.register_owned_table('public.habits', 30);

create table public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  habit_id uuid not null,
  log_date date not null,
  status text not null default 'done' check (status in ('done', 'partial', 'skipped')),
  value numeric,
  note text check (char_length(note) <= 1000),
  logged_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (habit_id, user_id) references public.habits (id, user_id) on delete cascade
);
-- One live log per habit per day (natural key; tombstones excluded so un-check + re-check works).
create unique index habit_logs_natural_key on public.habit_logs (habit_id, log_date) where deleted_at is null;
select ascend_private.register_owned_table('public.habit_logs', 31, array['habit_id', 'log_date']);

-- ─────────────────────────── tasks ───────────────────────────

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  description text check (char_length(description) <= 10000),
  notes text check (char_length(notes) <= 20000),
  category_id uuid,
  priority smallint not null default 3 check (priority between 1 and 4),
  status text not null default 'inbox'
    check (status in ('inbox', 'planned', 'in_progress', 'completed', 'cancelled')),
  archived_at timestamptz,
  due_date date,
  due_time time,
  do_date date,
  estimated_minutes smallint check (estimated_minutes between 5 and 1440),
  splittable boolean not null default false,
  min_chunk_minutes smallint not null default 25 check (min_chunk_minutes between 5 and 240),
  preferred_window text not null default 'any'
    check (preferred_window in ('any', 'morning', 'afternoon', 'evening', 'work', 'study')),
  goal_id uuid,
  milestone_id uuid,
  parent_task_id uuid,
  recurrence_rule text check (char_length(recurrence_rule) <= 200),
  recurrence_template_id uuid,
  completed_at timestamptz,
  rank text collate "C" not null,
  unique (id, user_id),
  check (parent_task_id is null or parent_task_id <> id),
  check (due_time is null or due_date is not null),
  check ((status = 'completed') = (completed_at is not null)),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id),
  foreign key (milestone_id, user_id) references public.milestones (id, user_id) on delete set null (milestone_id),
  foreign key (parent_task_id, user_id) references public.tasks (id, user_id) on delete cascade,
  foreign key (recurrence_template_id, user_id) references public.tasks (id, user_id) on delete set null (recurrence_template_id)
);
create index tasks_open_idx on public.tasks (user_id, status, due_date) where deleted_at is null and status not in ('completed', 'cancelled');
create index tasks_goal_idx on public.tasks (goal_id);
create index tasks_milestone_idx on public.tasks (milestone_id);
create index tasks_parent_idx on public.tasks (parent_task_id);
create index tasks_template_idx on public.tasks (recurrence_template_id);
create index tasks_category_idx on public.tasks (category_id);
select ascend_private.register_owned_table('public.tasks', 40);

create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  task_id uuid not null,
  event_type text not null check (event_type in (
    'created', 'status_changed', 'rescheduled', 'estimate_changed', 'due_changed', 'split', 'linked',
    'completed', 'reopened', 'edited')),
  from_value jsonb,
  to_value jsonb,
  origin text not null default 'user' check (origin in ('user', 'scheduler', 'ai')),
  occurred_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade
);
create index task_events_task_idx on public.task_events (task_id, occurred_at);
create index task_events_user_time_idx on public.task_events (user_id, occurred_at);
select ascend_private.register_owned_table('public.task_events', 41);

-- ─────────────────────────── calendar & schedule ───────────────────────────

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 5000),
  location text check (char_length(location) <= 300),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  timezone text not null default 'UTC' check (char_length(timezone) <= 64),
  kind text not null default 'event'
    check (kind in ('event', 'commitment', 'class', 'work', 'training', 'social', 'travel', 'other')),
  is_locked boolean not null default false,
  busy boolean not null default true,
  recurrence_rule text check (char_length(recurrence_rule) <= 200),
  exdates date[] not null default '{}',
  recurrence_parent_id uuid,
  original_start timestamptz,
  category_id uuid,
  goal_id uuid,
  unique (id, user_id),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '31 days'),
  foreign key (recurrence_parent_id, user_id) references public.calendar_events (id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id)
);
create index calendar_events_range_idx on public.calendar_events (user_id, starts_at, ends_at) where deleted_at is null;
create index calendar_events_recurring_idx on public.calendar_events (user_id) where recurrence_rule is not null and deleted_at is null;
create index calendar_events_parent_idx on public.calendar_events (recurrence_parent_id);
create index calendar_events_category_idx on public.calendar_events (category_id);
create index calendar_events_goal_idx on public.calendar_events (goal_id);
select ascend_private.register_owned_table('public.calendar_events', 50);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  remind_at timestamptz not null,
  recurrence_rule text check (char_length(recurrence_rule) <= 200),
  task_id uuid,
  habit_id uuid,
  event_id uuid,
  done_at timestamptz,
  unique (id, user_id),
  check (num_nonnulls(task_id, habit_id, event_id) <= 1),
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade,
  foreign key (habit_id, user_id) references public.habits (id, user_id) on delete cascade,
  foreign key (event_id, user_id) references public.calendar_events (id, user_id) on delete cascade
);
create index reminders_due_idx on public.reminders (user_id, remind_at) where deleted_at is null and done_at is null;
create index reminders_task_idx on public.reminders (task_id);
create index reminders_habit_idx on public.reminders (habit_id);
create index reminders_event_idx on public.reminders (event_id);
select ascend_private.register_owned_table('public.reminders', 51);

create table public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  block_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null check (kind in ('task', 'habit', 'break', 'protected_free', 'training', 'focus', 'custom')),
  task_id uuid,
  habit_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  origin text not null default 'auto' check (origin in ('auto', 'manual', 'ai')),
  is_locked boolean not null default false,
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'done', 'partial', 'missed', 'skipped', 'unplanned')),
  actual_minutes smallint check (actual_minutes between 0 and 1440),
  reason text check (char_length(reason) <= 500),
  algorithm_version text check (char_length(algorithm_version) <= 40),
  completed_at timestamptz,
  unique (id, user_id),
  check (ends_at > starts_at),
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete set null (task_id),
  foreign key (habit_id, user_id) references public.habits (id, user_id) on delete set null (habit_id)
);
create index schedule_blocks_day_idx on public.schedule_blocks (user_id, block_date) where deleted_at is null;
create index schedule_blocks_task_idx on public.schedule_blocks (task_id);
create index schedule_blocks_habit_idx on public.schedule_blocks (habit_id);
select ascend_private.register_owned_table('public.schedule_blocks', 60);
