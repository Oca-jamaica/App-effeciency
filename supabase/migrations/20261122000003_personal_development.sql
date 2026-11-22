-- ASCEND Stage 4: personal development.
-- Projects & missions, skills, focus/study sessions, study timelapse videos (private storage), workouts,
-- sport & training, social planner, experiences, knowledge & reflection, sleep.
-- Same conventions as earlier migrations: RLS via register_owned_table, ownership-enforcing FKs.

-- Natural-key unique indexes include user_id, so a uniqueness error can never reveal that another
-- user's row exists (uniqueness is checked before foreign keys). Fixes the Stage 3 habit_logs index.
drop index if exists public.habit_logs_natural_key;
create unique index habit_logs_natural_key on public.habit_logs (user_id, habit_id, log_date) where deleted_at is null;

-- ─────────────────────────── projects & missions ───────────────────────────

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  kind text not null default 'project' check (kind in ('project', 'mission')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  objective text check (char_length(objective) <= 2000),
  description text check (char_length(description) <= 10000),
  status text not null default 'active' check (status in ('planning', 'active', 'on_hold', 'completed', 'archived')),
  category_id uuid,
  goal_id uuid,
  start_date date,
  deadline date,
  completed_at timestamptz,
  completion_summary text check (char_length(completion_summary) <= 10000),
  rank text collate "C" not null,
  unique (id, user_id),
  check (deadline is null or start_date is null or deadline >= start_date),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id)
);
create index projects_user_status_idx on public.projects (user_id, kind, status) where deleted_at is null;
create index projects_goal_idx on public.projects (goal_id);
create index projects_category_idx on public.projects (category_id);
select ascend_private.register_owned_table('public.projects', 26);

create table public.project_stages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  project_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 5000),
  deadline date,
  status text not null default 'open' check (status in ('open', 'done')),
  rank text collate "C" not null,
  unique (id, user_id),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade
);
create index project_stages_project_idx on public.project_stages (project_id, rank);
select ascend_private.register_owned_table('public.project_stages', 27);

-- Milestones now belong to exactly one goal or one project (optionally a project stage).
alter table public.milestones add column project_id uuid;
alter table public.milestones add column stage_id uuid;
alter table public.milestones drop constraint milestones_parent_check;
alter table public.milestones add constraint milestones_parent_check check (num_nonnulls(goal_id, project_id) = 1);
alter table public.milestones add constraint milestones_stage_needs_project check (stage_id is null or project_id is not null);
alter table public.milestones add foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade;
alter table public.milestones add foreign key (stage_id, user_id) references public.project_stages (id, user_id) on delete set null (stage_id);
create index milestones_project_idx on public.milestones (project_id, rank);
create index milestones_stage_idx on public.milestones (stage_id);

alter table public.tasks add column project_id uuid;
alter table public.tasks add foreign key (project_id, user_id) references public.projects (id, user_id) on delete set null (project_id);
create index tasks_project_idx on public.tasks (project_id);

alter table public.notes add column project_id uuid;
alter table public.notes add foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade;
create index notes_project_idx on public.notes (project_id);

-- ─────────────────────────── skills ───────────────────────────

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  parent_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (char_length(description) <= 2000),
  category_id uuid,
  goal_id uuid,
  level smallint not null default 0 check (level between 0 and 10),
  target_level smallint check (target_level between 0 and 10),
  rank text collate "C" not null,
  unique (id, user_id),
  check (parent_id is null or parent_id <> id),
  foreign key (parent_id, user_id) references public.skills (id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id)
);
create index skills_parent_idx on public.skills (parent_id);
create index skills_category_idx on public.skills (category_id);
create index skills_goal_idx on public.skills (goal_id);
select ascend_private.register_owned_table('public.skills', 28);

-- Keep skills a tree: reject an update that would make a skill its own ancestor.
create or replace function ascend_private.skills_no_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cursor_id uuid := new.parent_id;
  depth int := 0;
begin
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'A skill cannot be inside itself' using errcode = '23514';
    end if;
    depth := depth + 1;
    if depth > 32 then
      raise exception 'Skill tree is too deep' using errcode = '23514';
    end if;
    select s.parent_id into cursor_id from public.skills s where s.id = cursor_id;
  end loop;
  return new;
end;
$$;
create trigger skills_no_cycle before insert or update of parent_id on public.skills
for each row execute function ascend_private.skills_no_cycle();

create table public.skill_progress_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  skill_id uuid not null,
  level smallint check (level between 0 and 10),
  note text check (char_length(note) <= 2000),
  source text not null default 'manual' check (source in ('manual', 'training', 'learning', 'project')),
  source_id uuid,
  recorded_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (skill_id, user_id) references public.skills (id, user_id) on delete cascade
);
create index skill_progress_skill_idx on public.skill_progress_entries (skill_id, recorded_at);
select ascend_private.register_owned_table('public.skill_progress_entries', 29);

alter table public.knowledge_items add column project_id uuid;
alter table public.knowledge_items add column skill_id uuid;
alter table public.knowledge_items add foreign key (project_id, user_id) references public.projects (id, user_id) on delete set null (project_id);
alter table public.knowledge_items add foreign key (skill_id, user_id) references public.skills (id, user_id) on delete set null (skill_id);
create index knowledge_project_idx on public.knowledge_items (project_id);
create index knowledge_skill_idx on public.knowledge_items (skill_id);

-- ─────────────────────────── learning ───────────────────────────

create table public.learning_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  kind text not null default 'book' check (kind in ('book', 'course', 'article', 'topic', 'video', 'podcast')),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  author_or_provider text check (char_length(author_or_provider) <= 200),
  url text check (url ~* '^https?://[^\s]+$' and char_length(url) <= 2048),
  status text not null default 'want' check (status in ('want', 'in_progress', 'completed', 'dropped')),
  progress_current numeric check (progress_current >= 0),
  progress_total numeric check (progress_total > 0),
  progress_unit text not null default 'percent' check (progress_unit in ('pages', 'chapters', 'lessons', 'percent', 'minutes')),
  started_on date,
  completed_on date,
  rating smallint check (rating between 1 and 5),
  notes text check (char_length(notes) <= 20000),
  goal_id uuid,
  skill_id uuid,
  unique (id, user_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id),
  foreign key (skill_id, user_id) references public.skills (id, user_id) on delete set null (skill_id)
);
create index learning_items_status_idx on public.learning_items (user_id, status) where deleted_at is null;
create index learning_items_goal_idx on public.learning_items (goal_id);
create index learning_items_skill_idx on public.learning_items (skill_id);
select ascend_private.register_owned_table('public.learning_items', 32);

-- ─────────────────────────── focus & study sessions ───────────────────────────

create table public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  kind text not null default 'focus' check (kind in ('focus', 'study', 'learning', 'deep_work')),
  source text not null default 'timer' check (source in ('timer', 'manual')),
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds between 0 and 86400),
  pause_seconds integer not null default 0 check (pause_seconds between 0 and 86400),
  planned_minutes smallint check (planned_minutes between 1 and 600),
  task_id uuid,
  goal_id uuid,
  project_id uuid,
  learning_item_id uuid,
  schedule_block_id uuid,
  quality smallint check (quality between 1 and 5),
  notes text check (char_length(notes) <= 5000),
  status text not null default 'completed' check (status in ('running', 'completed', 'abandoned')),
  unique (id, user_id),
  check (ended_at is null or ended_at >= started_at),
  check (status <> 'completed' or ended_at is not null),
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete set null (task_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete set null (project_id),
  foreign key (learning_item_id, user_id) references public.learning_items (id, user_id) on delete set null (learning_item_id),
  foreign key (schedule_block_id, user_id) references public.schedule_blocks (id, user_id) on delete set null (schedule_block_id)
);
create index focus_sessions_time_idx on public.focus_sessions (user_id, started_at) where deleted_at is null;
create index focus_sessions_task_idx on public.focus_sessions (task_id);
create index focus_sessions_goal_idx on public.focus_sessions (goal_id);
create index focus_sessions_project_idx on public.focus_sessions (project_id);
create index focus_sessions_learning_idx on public.focus_sessions (learning_item_id);
create index focus_sessions_block_idx on public.focus_sessions (schedule_block_id);
select ascend_private.register_owned_table('public.focus_sessions', 61);

create table public.study_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  focus_session_id uuid,
  task_id uuid,
  goal_id uuid,
  recorded_on date not null,
  storage_path text not null check (char_length(storage_path) <= 300),
  mime_type text not null check (mime_type in ('video/mp4', 'video/quicktime')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 2147483648),
  duration_seconds integer check (duration_seconds between 0 and 86400),
  session_minutes smallint check (session_minutes between 1 and 1440),
  notes text check (char_length(notes) <= 5000),
  upload_status text not null default 'pending' check (upload_status in ('pending', 'uploading', 'ready', 'failed')),
  upload_error text check (char_length(upload_error) <= 500),
  unique (id, user_id),
  -- The object must live in the owner's own folder of the private bucket.
  check (storage_path = user_id::text || '/' || id::text || case mime_type when 'video/mp4' then '.mp4' else '.mov' end),
  foreign key (focus_session_id, user_id) references public.focus_sessions (id, user_id) on delete set null (focus_session_id),
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete set null (task_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id)
);
create index study_videos_date_idx on public.study_videos (user_id, recorded_on) where deleted_at is null;
create index study_videos_session_idx on public.study_videos (focus_session_id);
create index study_videos_task_idx on public.study_videos (task_id);
create index study_videos_goal_idx on public.study_videos (goal_id);
select ascend_private.register_owned_table('public.study_videos', 62);

-- Private bucket: owner-only access by folder. Supabase also applies the project's global upload limit
-- (50 MB on the Free plan), so large timelapses need a plan that raises it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('study-videos', 'study-videos', false, 524288000, array['video/mp4', 'video/quicktime'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "study videos: owner can read" on storage.objects for select to authenticated
  using (bucket_id = 'study-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "study videos: owner can upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'study-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "study videos: owner can replace" on storage.objects for update to authenticated
  using (bucket_id = 'study-videos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'study-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "study videos: owner can delete" on storage.objects for delete to authenticated
  using (bucket_id = 'study-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ─────────────────────────── workouts ───────────────────────────

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null default 'strength' check (kind in ('strength', 'cardio', 'mobility', 'skill', 'other')),
  muscle_group text check (char_length(muscle_group) <= 60),
  equipment text check (char_length(equipment) <= 60),
  weight_unit text not null default 'kg' check (weight_unit in ('kg', 'lb')),
  notes text check (char_length(notes) <= 2000),
  unique (id, user_id)
);
create unique index exercises_user_name_uniq on public.exercises (user_id, lower(name)) where deleted_at is null;
select ascend_private.register_owned_table('public.exercises', 70);

create table public.workout_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (char_length(description) <= 2000),
  goal_id uuid,
  rank text collate "C" not null,
  unique (id, user_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id)
);
create index workout_plans_goal_idx on public.workout_plans (goal_id);
select ascend_private.register_owned_table('public.workout_plans', 71);

create table public.workout_plan_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  plan_id uuid not null,
  exercise_id uuid not null,
  position smallint not null default 0,
  target_sets smallint not null default 3 check (target_sets between 1 and 20),
  target_reps smallint check (target_reps between 1 and 200),
  target_weight numeric check (target_weight >= 0),
  rest_seconds smallint check (rest_seconds between 0 and 1800),
  notes text check (char_length(notes) <= 500),
  unique (id, user_id),
  foreign key (plan_id, user_id) references public.workout_plans (id, user_id) on delete cascade,
  foreign key (exercise_id, user_id) references public.exercises (id, user_id) on delete cascade
);
create index workout_plan_items_plan_idx on public.workout_plan_items (plan_id, position);
create index workout_plan_items_exercise_idx on public.workout_plan_items (exercise_id);
select ascend_private.register_owned_table('public.workout_plan_items', 72);

create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  plan_id uuid,
  title text not null default 'Workout' check (char_length(title) between 1 and 120),
  started_at timestamptz not null,
  ended_at timestamptz,
  schedule_block_id uuid,
  perceived_effort smallint check (perceived_effort between 1 and 10),
  notes text check (char_length(notes) <= 5000),
  unique (id, user_id),
  check (ended_at is null or ended_at >= started_at),
  foreign key (plan_id, user_id) references public.workout_plans (id, user_id) on delete set null (plan_id),
  foreign key (schedule_block_id, user_id) references public.schedule_blocks (id, user_id) on delete set null (schedule_block_id)
);
create index workout_sessions_time_idx on public.workout_sessions (user_id, started_at) where deleted_at is null;
create index workout_sessions_plan_idx on public.workout_sessions (plan_id);
create index workout_sessions_block_idx on public.workout_sessions (schedule_block_id);
select ascend_private.register_owned_table('public.workout_sessions', 73);

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  session_id uuid not null,
  exercise_id uuid not null,
  set_index smallint not null check (set_index between 1 and 100),
  reps smallint check (reps between 0 and 1000),
  weight numeric check (weight >= 0 and weight <= 2000),
  duration_seconds integer check (duration_seconds between 0 and 86400),
  distance_m numeric check (distance_m >= 0),
  rpe numeric check (rpe between 1 and 10),
  is_warmup boolean not null default false,
  completed_at timestamptz,
  unique (id, user_id),
  foreign key (session_id, user_id) references public.workout_sessions (id, user_id) on delete cascade,
  foreign key (exercise_id, user_id) references public.exercises (id, user_id) on delete cascade
);
create index workout_sets_session_idx on public.workout_sets (session_id, set_index);
create index workout_sets_exercise_idx on public.workout_sets (exercise_id, completed_at);
select ascend_private.register_owned_table('public.workout_sets', 74);

-- ─────────────────────────── sport & training ───────────────────────────

create table public.sports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  position text check (char_length(position) <= 80),
  notes text check (char_length(notes) <= 2000),
  unique (id, user_id)
);
create unique index sports_user_name_uniq on public.sports (user_id, lower(name)) where deleted_at is null;
select ascend_private.register_owned_table('public.sports', 75);

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sport_id uuid not null,
  session_type text not null default 'technical' check (session_type in ('technical', 'tactical', 'match', 'conditioning', 'recovery', 'other')),
  started_at timestamptz not null,
  duration_minutes smallint not null check (duration_minutes between 1 and 600),
  intensity smallint check (intensity between 1 and 10),
  performance_rating smallint check (performance_rating between 1 and 10),
  focus text check (char_length(focus) <= 300),
  notes text check (char_length(notes) <= 5000),
  schedule_block_id uuid,
  goal_id uuid,
  unique (id, user_id),
  foreign key (sport_id, user_id) references public.sports (id, user_id) on delete cascade,
  foreign key (schedule_block_id, user_id) references public.schedule_blocks (id, user_id) on delete set null (schedule_block_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id)
);
create index training_sessions_time_idx on public.training_sessions (user_id, started_at) where deleted_at is null;
create index training_sessions_sport_idx on public.training_sessions (sport_id);
create index training_sessions_block_idx on public.training_sessions (schedule_block_id);
create index training_sessions_goal_idx on public.training_sessions (goal_id);
select ascend_private.register_owned_table('public.training_sessions', 76);

create table public.training_session_skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  training_session_id uuid not null,
  skill_id uuid not null,
  minutes smallint check (minutes between 1 and 600),
  rating smallint check (rating between 1 and 10),
  note text check (char_length(note) <= 1000),
  unique (id, user_id),
  foreign key (training_session_id, user_id) references public.training_sessions (id, user_id) on delete cascade,
  foreign key (skill_id, user_id) references public.skills (id, user_id) on delete cascade
);
create unique index training_session_skills_natural on public.training_session_skills (user_id, training_session_id, skill_id) where deleted_at is null;
create index training_session_skills_skill_idx on public.training_session_skills (skill_id);
select ascend_private.register_owned_table('public.training_session_skills', 77, array['training_session_id', 'skill_id']);

-- ─────────────────────────── social & experiences ───────────────────────────

create table public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  birthday_month smallint check (birthday_month between 1 and 12),
  birthday_day smallint check (birthday_day between 1 and 31),
  birth_year smallint check (birth_year between 1900 and 2100),
  relationship text check (char_length(relationship) <= 80),
  notes text check (char_length(notes) <= 5000),
  unique (id, user_id),
  check ((birthday_month is null) = (birthday_day is null)),
  check (birth_year is null or birthday_month is not null)
);
select ascend_private.register_owned_table('public.people', 80);

create table public.experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 5000),
  category text not null default 'activity' check (category in ('place', 'event', 'activity', 'skill', 'other')),
  status text not null default 'someday' check (status in ('someday', 'planned', 'done')),
  target_date date,
  completed_on date,
  location text check (char_length(location) <= 200),
  rating smallint check (rating between 1 and 5),
  notes text check (char_length(notes) <= 5000),
  unique (id, user_id),
  check ((status = 'done') = (completed_on is not null))
);
create index experiences_status_idx on public.experiences (user_id, status) where deleted_at is null;
select ascend_private.register_owned_table('public.experiences', 81);

-- ─────────────────────────── reflection ───────────────────────────

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  entry_date date not null,
  went_well text check (char_length(went_well) <= 10000),
  could_improve text check (char_length(could_improve) <= 10000),
  learned text check (char_length(learned) <= 10000),
  looking_forward text check (char_length(looking_forward) <= 10000),
  free_text text check (char_length(free_text) <= 50000),
  unique (id, user_id)
);
-- One live entry per day (natural key: two devices writing the same day merge).
create unique index journal_entries_day on public.journal_entries (user_id, entry_date) where deleted_at is null;
select ascend_private.register_owned_table('public.journal_entries', 82, array['entry_date']);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  decided_on date,
  context text check (char_length(context) <= 10000),
  alternatives text check (char_length(alternatives) <= 10000),
  reasoning text check (char_length(reasoning) <= 10000),
  expected_outcome text check (char_length(expected_outcome) <= 5000),
  confidence smallint check (confidence between 1 and 5),
  review_on date,
  actual_outcome text check (char_length(actual_outcome) <= 5000),
  reflection text check (char_length(reflection) <= 10000),
  status text not null default 'decided' check (status in ('open', 'decided', 'reviewed')),
  unique (id, user_id)
);
create index decisions_review_idx on public.decisions (user_id, review_on) where deleted_at is null;
select ascend_private.register_owned_table('public.decisions', 83);

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 10000),
  category_id uuid,
  research text check (char_length(research) <= 20000),
  potential smallint check (potential between 1 and 5),
  next_steps text check (char_length(next_steps) <= 5000),
  status text not null default 'seed' check (status in ('seed', 'exploring', 'validated', 'parked', 'converted')),
  project_id uuid,
  unique (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete set null (project_id)
);
create index ideas_category_idx on public.ideas (category_id);
create index ideas_project_idx on public.ideas (project_id);
select ascend_private.register_owned_table('public.ideas', 84);

create table public.sleep_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sleep_date date not null,
  bed_at time,
  wake_at time,
  duration_minutes smallint check (duration_minutes between 0 and 1440),
  energy smallint check (energy between 1 and 5),
  recovery smallint check (recovery between 1 and 5),
  notes text check (char_length(notes) <= 2000),
  unique (id, user_id)
);
create unique index sleep_logs_day on public.sleep_logs (user_id, sleep_date) where deleted_at is null;
select ascend_private.register_owned_table('public.sleep_logs', 85, array['sleep_date']);
