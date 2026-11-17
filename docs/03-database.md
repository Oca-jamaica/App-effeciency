# 03 — Database design

Relational Postgres (Supabase), one row per real thing, real foreign keys,
Row Level Security on every table. No "giant JSON object". JSON appears only
where the data *is* a document: AI proposal payloads, frozen weekly-report
snapshots and history diffs. Each of those is called out below.

Tables are created incrementally, one or more migrations per stage, each with
its own RLS tests. This document is the target schema.

## Conventions (apply to every user-owned table)

```sql
id          uuid primary key,                         -- generated on the device (offline creation)
user_id     uuid not null default auth.uid()
            references auth.users(id) on delete cascade,
created_at  timestamptz not null default now(),
updated_at  timestamptz not null default now(),       -- set by trigger on every write (sync cursor)
deleted_at  timestamptz,                              -- tombstone; purged after 30 days
unique (id, user_id)                                  -- target for ownership-enforcing FKs
```

- **RLS.** `enable row level security` plus one policy per command:
  `using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))`.
  The `(select …)` form is evaluated once per query, not once per row.
  Grants go to `authenticated` only, never to `anon`.
- **Ownership-enforcing foreign keys.** For example,
  `foreign key (goal_id, user_id) references goals(id, user_id) on delete set null (goal_id)`.
  A row can only reference its owner's rows. `set null (goal_id)` clears just
  the link and keeps `user_id`. *Verified on Postgres 16 in Stage 1: cross-user
  links are rejected, spoofed owners are rejected by RLS, and parent deletion
  unlinks children correctly.*
- **Triggers.** `set_updated_at` (uses `clock_timestamp()`); `forbid_user_id_change`.
- **Indexes.** `(user_id, updated_at)` on every synced table (pull); every
  foreign-key column; partial indexes for hot lists (e.g. open tasks by due date).
- **Ordering.** `rank text collate "C"` holding fractional-index keys.
- **Text limits.** `check` constraints on lengths (titles ≤ 200, bodies ≤ 100k)
  to stop accidental or abusive payloads.
- **Enums.** `text` with `check (x in (…))` rather than Postgres enum types:
  easier to evolve in migrations and to mirror in SQLite.
- **Dates vs instants.** `date` for things that belong to a local calendar day
  (due dates, habit log dates, journal dates). `timestamptz` for instants
  (event start, session start). The user's IANA timezone lives in `profiles`.

Diagram notation: `→` is a foreign key; `(opt)` is nullable.

---

## A. Identity, preferences, categories

**profiles** — one per auth user (`id = auth.users.id`)
`display_name (opt)`, `timezone` (IANA, required), `locale`, `week_starts_on smallint`,
`onboarding_completed_at (opt)`. Created by a trigger on `auth.users` insert.

**user_preferences** — one per user (`user_id` primary key)
- Appearance: `theme` (`system|light|dark`).
- Day: `day_start time`, `day_end time`.
- Scheduling: `default_task_minutes`, `max_focus_minutes_per_day`,
  `max_block_minutes`, `break_after_minutes`, `break_minutes`,
  `buffer_minutes`, `min_free_minutes_per_day`, `schedule_inbox_with_deadline bool`.
- AI: `ai_enabled`, `ai_auto_apply_low_risk`, `ai_daily_briefing`, and the
  per-area read toggles `ai_access_journal`, `ai_access_decisions`,
  `ai_access_notes`, `ai_access_memory`, `ai_access_sleep`.
- Notifications: `quiet_hours_start`, `quiet_hours_end`,
  `max_notifications_per_day`, `notify_block_start`.

**availability_windows** — preferred working/study hours and protected time
`weekday smallint (0–6)`, `start_time`, `end_time`,
`kind` (`work|study|training|protected_free|no_scheduling`). The scheduler uses
these as soft preferences (work/study/training) or hard exclusions
(protected_free, no_scheduling).

**categories** — user-owned, shared across goals, tasks, habits and events
`name`, `color` (design-token name, not hex), `icon` (Lucide name),
`applies_to text[]`, `is_default bool`, `rank`, `archived_at (opt)`;
`unique (user_id, lower(name))`. Defaults are seeded on sign-up: Academics,
Fitness, Football & sport, Personal development, Social, Business, Projects,
Other. All are editable and deletable.

## B. Goals

**goals**
`title`, `description`, `why (opt)` (motivation), `category_id → categories (opt)`,
`status` (`active|paused|completed|archived`), `rank` (the user's priority order),
`deadline date (opt)`, `started_on date`, `completed_at (opt)`,
`progress_mode` (`milestones|tasks|target|manual`),
`target_value numeric (opt)`, `target_unit (opt)`, `current_value numeric (opt)`.
Progress percentage is **computed** from the mode (milestones done, tasks done,
current/target, or the manual value), never stored.

**milestones** — shared by goals and projects/missions
`goal_id → goals (opt)`, `project_id → projects (opt)`, `stage_id → project_stages (opt)`,
`title`, `description`, `deadline date (opt)`, `status` (`open|done|skipped`),
`completed_at (opt)`, `rank`.
`check (num_nonnulls(goal_id, project_id) = 1)`; `stage_id` requires `project_id`.

**goal_checklist_items** — lightweight actions that aren't worth scheduling
`goal_id → goals`, `title`, `is_done`, `done_at (opt)`, `rank`. Any item can be
promoted to a task.

**goal_progress_entries** — append-only progress history
`goal_id → goals`, `value numeric (opt)`, `note (opt)`,
`source` (`manual|milestone|task|habit|system`), `source_id (opt)`, `recorded_at`.

**notes** — goal notes, project notes, workspace documents
`title`, `body` (Markdown), `note_type` (`general|strategy|learning|problem|next_steps|info|research`),
`goal_id (opt)`, `project_id (opt)`, `idea_id (opt)`, `folder (opt)`, `pinned`,
`tags text[]` (GIN index). Full-text search via a generated `tsvector` column.

**knowledge_items** — the Knowledge Vault, including goal resources and video links
`kind` (`video|article|link|book|course|note|info|file`), `title`, `url (opt)`,
`body (opt)`, `source_name (opt)`, `category_id (opt)`, `tags text[]`,
`goal_id (opt)`, `milestone_id (opt)`, `project_id (opt)`, `skill_id (opt)`,
`is_favorite`. A `url` must be `http(s)`. Full-text search over title, body and tags.

## C. Tasks & reminders

**tasks**
`title`, `description`, `notes`, `category_id (opt)`,
`priority smallint` (1 = highest … 4),
`status` (`inbox|planned|in_progress|completed|cancelled`), `archived_at (opt)`,
`due_date date (opt)`, `due_time time (opt)`,
`do_date date (opt)` (user pinned it to a day),
`estimated_minutes (opt)`, `splittable bool`, `min_chunk_minutes`,
`preferred_window` (`any|morning|afternoon|evening|work|study`),
`goal_id (opt)`, `milestone_id (opt)`, `project_id (opt)`,
`parent_task_id → tasks (opt)` (subtasks are real tasks, so they can be scheduled),
`recurrence_rule (opt)` (RFC 5545 RRULE), `recurrence_template_id → tasks (opt)`
(an instance points at its template), `completed_at (opt)`, `rank`.
Recurring tasks are a template plus generated instances (a rolling 14-day
horizon), so each instance has its own status and history.

**task_events** — task history (append-only)
`task_id → tasks`, `event_type` (`created|status_changed|rescheduled|estimate_changed|due_changed|split|linked|completed|reopened`),
`from_value jsonb (opt)`, `to_value jsonb (opt)` (small diffs; JSON is
appropriate for a history record), `origin` (`user|scheduler|ai`), `occurred_at`.
Used for weekly "postponed" counts and the task history view.

**reminders** — standalone ("call the dentist at 3pm") or attached
`title`, `remind_at timestamptz`, `recurrence_rule (opt)`,
`task_id (opt)`, `habit_id (opt)`, `event_id (opt)`, `done_at (opt)`.

## D. Habits

**habits**
`name`, `description`, `category_id (opt)`, `goal_id (opt)`,
`frequency_kind` (`daily|weekdays|times_per_week|times_per_month|every_n_days`),
`days_of_week smallint[] (opt)`, `times_per_period smallint (opt)`,
`interval_days smallint (opt)`, `start_date`, `end_date (opt)`,
`duration_minutes (opt)` (used by the scheduler), `preferred_window`,
`preferred_time time (opt)`, `target_value (opt)`, `target_unit (opt)`,
`status` (`active|paused|archived`), `paused_until date (opt)`,
`reminder_times time[]`, `notes`, `rank`.
`check` constraints keep frequency fields consistent with `frequency_kind`.

**habit_logs**
`habit_id → habits`, `log_date date`, `status` (`done|partial|skipped`),
`value numeric (opt)`, `note (opt)`, `logged_at`; `unique (habit_id, log_date)`.
A natural key, so two devices logging the same day merge. Consistency,
current/best runs and the calendar heatmap are all computed from these rows.

## E. Calendar & schedule

**calendar_events** (ASCEND-native; device-imported events are local-only, see Architecture)
`title`, `description`, `location (opt)`, `starts_at`, `ends_at`, `all_day`,
`timezone`, `kind` (`event|commitment|class|work|training|social|travel|other`),
`is_locked bool` (a fixed commitment: never moved by the scheduler or the AI
without approval), `busy bool`, `recurrence_rule (opt)`, `exdates timestamptz[]`,
`recurrence_parent_id → calendar_events (opt)` + `original_start (opt)`
(edited instances of a series), `category_id (opt)`, `goal_id (opt)`,
`project_id (opt)`, `person_ids uuid[]` (social plans; validated by trigger).
`check (ends_at > starts_at)`.

**schedule_blocks** — the scheduler's output plus manual blocks
`block_date date`, `starts_at`, `ends_at`,
`kind` (`task|habit|break|protected_free|training|focus|custom`),
`task_id (opt)`, `habit_id (opt)`, `title`,
`origin` (`auto|manual|ai`), `is_locked bool`,
`status` (`planned|in_progress|done|partial|missed|skipped|unplanned`),
`actual_minutes (opt)`, `reason (opt)` (why the scheduler put it here),
`algorithm_version`, `completed_at (opt)`.
Re-planning only replaces `origin = 'auto'`, unlocked, not-started blocks. Past
blocks are kept as the record of what was planned, which is the "planned" side
of Time Reality.

## F. Focus, study sessions, timelapses

**focus_sessions** — the single time ledger
`kind` (`focus|study|learning|deep_work`), `source` (`timer|manual`),
`started_at`, `ended_at (opt)`, `duration_seconds` (excluding pauses),
`pause_seconds`, `planned_minutes (opt)`, `task_id (opt)`, `goal_id (opt)`,
`learning_item_id (opt)`, `schedule_block_id (opt)`, `quality smallint (opt, 1–5)`,
`notes`, `status` (`running|completed|abandoned`).

**study_videos**
`focus_session_id (opt)`, `task_id (opt)`, `goal_id (opt)`, `recorded_on date`,
`storage_path` (`{user_id}/{id}.{ext}`; a check constraint enforces the user
prefix), `mime_type`, `size_bytes`, `duration_seconds (opt)`,
`session_minutes (opt)`, `notes`,
`upload_status` (`pending|uploading|ready|failed`), `upload_error (opt)`.

**video_shares** (server-only, not synced)
`video_id → study_videos`, `token_hash`, `label (opt)`, `expires_at`,
`revoked_at (opt)`, `access_count`, `last_accessed_at (opt)`.

## G. Training: workouts & sport

**exercises** — `name`, `kind` (`strength|cardio|mobility|skill|other`),
`muscle_group (opt)`, `equipment (opt)`, `weight_unit` (`kg|lb`), `notes`;
`unique (user_id, lower(name))`. A starter library is offered at onboarding,
but every exercise is the user's own row and fully editable.

**workout_plans** — `name`, `description`, `goal_id (opt)`, `rank`.
**workout_plan_items** — `plan_id → workout_plans`, `exercise_id → exercises`,
`position`, `target_sets`, `target_reps`, `target_weight (opt)`, `rest_seconds (opt)`, `notes`.

**workout_sessions** — `plan_id (opt)`, `started_at`, `ended_at (opt)`,
`schedule_block_id (opt)`, `perceived_effort smallint (opt)`, `notes`.
**workout_sets** — `session_id → workout_sessions`, `exercise_id → exercises`,
`set_index`, `reps (opt)`, `weight (opt)`, `duration_seconds (opt)`,
`distance_m (opt)`, `rpe (opt)`, `is_warmup`, `completed_at`.
Personal records come from a **view** (`exercise_personal_records`: heaviest
weight, best estimated 1RM, most reps at a weight), so they are always correct
after edits.

**sports** — `name`, `notes` (e.g. Football).
**training_sessions** — `sport_id → sports`,
`session_type` (`technical|tactical|match|conditioning|recovery|other`),
`started_at`, `duration_minutes`, `intensity (1–10, opt)`,
`performance_rating (1–10, opt)`, `focus (opt)`, `notes`,
`schedule_block_id (opt)`, `goal_id (opt)`.
**training_session_skills** — `training_session_id`, `skill_id`,
`minutes (opt)`, `rating (opt)`, `note (opt)`.

## H. Projects & missions

**projects** — `kind` (`project|mission`), `title`, `objective`, `description`,
`status` (`planning|active|on_hold|completed|archived`), `category_id (opt)`,
`goal_id (opt)`, `start_date (opt)`, `deadline (opt)`, `completed_at (opt)`,
`completion_summary (opt)`, `rank`.
**project_stages** — `project_id → projects`, `title`, `description`,
`deadline (opt)`, `status`, `rank`.
Milestones: see `milestones` (B). Tasks link through `tasks.project_id` and
`tasks.milestone_id`.

## I. Skills & Life Graph

**skills** — `parent_id → skills (opt)` (the tree), `name`, `description`,
`category_id (opt)`, `level smallint` (0–10), `target_level (opt)`, `rank`.
A cycle-prevention trigger keeps it a tree.
**skill_progress_entries** — `skill_id`, `level`, `note (opt)`,
`source_type (opt)`, `source_id (opt)`, `recorded_at`.

**entity_links** — the Life Graph's *extra* connections
`from_type`, `from_id`, `to_type`, `to_id`,
`relation` (`supports|part_of|practises|develops|related|blocks`), `note (opt)`;
`unique (user_id, from_type, from_id, to_type, to_id, relation)`.

Most graph edges already exist as real foreign keys (task → goal, habit → goal,
milestone → project, …). `entity_links` holds only the many-to-many connections
that have no column of their own, such as skill ↔ goal, habit ↔ skill or
project ↔ skill. Polymorphic ids cannot have foreign keys, so:
- a trigger verifies both endpoints exist and belong to the user;
- a delete trigger on each linkable table removes dangling links.

The Life Graph view is the union of the foreign-key edges and these links.

## J. Knowledge & reflection

**journal_entries** — `entry_date date`, `went_well`, `could_improve`,
`learned`, `looking_forward`, `free_text`; `unique (user_id, entry_date)`.
Full-text search.

**decisions** — `title`, `decided_on (opt)`, `context`, `alternatives`,
`reasoning`, `expected_outcome`, `confidence smallint (opt)`, `review_on date (opt)`,
`actual_outcome (opt)`, `reflection (opt)`, `status` (`open|decided|reviewed`).

**learning_items** — `kind` (`book|course|article|topic|video|podcast`),
`title`, `author_or_provider (opt)`, `url (opt)`,
`status` (`want|in_progress|completed|dropped`), `progress_current (opt)`,
`progress_total (opt)`, `progress_unit` (`pages|chapters|lessons|percent|minutes`),
`started_on (opt)`, `completed_on (opt)`, `rating (opt)`, `notes`,
`goal_id (opt)`, `skill_id (opt)`. Learning sessions are `focus_sessions` with
`kind = 'learning'`.

**ideas** — `title`, `description`, `category_id (opt)`, `research`,
`potential smallint (1–5, opt)`, `next_steps`,
`status` (`seed|exploring|validated|parked|converted`),
`project_id (opt)` (set when promoted to a project).

**experiences** — `title`, `description`,
`category` (`place|event|activity|skill|other`), `status` (`someday|planned|done`),
`target_date (opt)`, `completed_on (opt)`, `location (opt)`, `rating (opt)`,
`notes`, `event_id (opt)`.

**people** — for the social planner: `name`, `birthday_month (opt)`,
`birthday_day (opt)`, `birth_year (opt)`, `relationship (opt)`, `notes`.
Entered by the user only; never imported.

**sleep_logs** — `sleep_date date` (the morning you woke), `bed_at (opt)`,
`wake_at (opt)`, `duration_minutes (opt)`, `energy (1–5, opt)`,
`recovery (1–5, opt)`, `notes`; `unique (user_id, sleep_date)`.

## K. Insights

**achievements** — `title`, `description`,
`kind` (`milestone|project|mission|personal_record|learning|experience|habit|challenge|life_event|manual`),
`achieved_on date`, `source_type (opt)`, `source_id (opt)`, `is_hidden`;
`unique (user_id, kind, source_type, source_id)` (natural key, so automatic
achievements are never duplicated). Feeds the Life Timeline together with
completed experiences.

**weekly_reports** — `week_start date`, `stats jsonb` (*a frozen snapshot*
produced by the shared `computeWeeklyStats`; JSON is right here because a
report is a document that must not change when old data is later edited),
`stats_version`, `narrative (opt)`, `attention_areas jsonb (opt)`,
`recommendations jsonb (opt)`, `next_week_plan jsonb (opt)`, `generated_at`;
`unique (user_id, week_start)`.

**weekly_reviews** (Sunday Reset) — `week_start`, `steps_completed text[]`,
`notes`, `completed_at (opt)`; `unique (user_id, week_start)`.

**life_audits** — `period_start`, `period_end`, `signals jsonb` (computed
inputs, frozen), `findings jsonb`, `narrative`, `created_at`.

**challenges** — `title`, `description`, `start_date`, `end_date`,
`target_count (opt)`, `unit (opt)`, `status` (`active|completed|abandoned`),
`goal_id (opt)`, `habit_id (opt)`.
**challenge_checkins** — `challenge_id`, `checkin_date`, `value (opt)`,
`note (opt)`; `unique (challenge_id, checkin_date)`.

## L. AI

**ai_conversations** — `title`, `context_type (opt)`, `context_id (opt)`,
`last_message_at`, `archived_at (opt)`. Server-written; read by the app.
**ai_messages** — `conversation_id`, `role` (`user|assistant`), `content`,
`tool_trace jsonb (opt)` (audit of which data was read), `model`,
`input_tokens`, `output_tokens`, `created_at`.
**ai_proposals** — `conversation_id (opt)`,
`source` (`chat|briefing|goal_plan|capture|weekly_review|audit|scheduler`),
`summary`, `actions jsonb` (typed command list validated against the shared Zod
schema; a command payload, not domain data), `risk_level` (`low|review|destructive`,
set by server code), `status` (`pending|accepted|partially_accepted|rejected|expired|applied|failed`),
`decided_at (opt)`, `applied_at (opt)`, `error (opt)`.
**ai_memories** (Personal Memory) — `content`,
`category` (`preference|lesson|ambition|reflection|fact`),
`source` (`user|ai_suggested`), `status` (`active|pending_review|archived`),
`last_used_at (opt)`. AI-suggested memories stay `pending_review` until the
user accepts them. All are reviewable and deletable.
**ai_usage** (server-only) — `usage_date`, `requests`, `input_tokens`,
`output_tokens`; written by the service role, readable by the owner.
**opportunities** — `title`, `description`,
`kind` (`course|competition|project|learning|sport|experience|other`),
`goal_id (opt)`, `url (opt)`, `source` (`ai_idea|web_search|user`),
`citation_url (opt)`, `retrieved_at (opt)`,
`status` (`suggested|saved|dismissed|done`).

## Storage

Bucket `study-videos`:
- private;
- `file_size_limit` set from `VIDEO_MAX_BYTES`;
- `allowed_mime_types = {video/mp4, video/quicktime}`.

Policies on `storage.objects` allow select/insert/update/delete only where
`bucket_id = 'study-videos' and (storage.foldername(name))[1] = auth.uid()::text`.

## Server functions (Postgres)

| Function | Purpose | Security |
|---|---|---|
| `sync_push(changes jsonb)` | Apply a batch of patches with the conflict rules | `security invoker` (RLS applies) |
| `sync_pull(cursors jsonb)` | Changed rows per table since the cursors | `security invoker` |
| `handle_new_user()` | Create profile, preferences and default categories | trigger on `auth.users` |
| `purge_tombstones()` | Hard-delete rows soft-deleted more than 30 days ago | scheduled (pg_cron), service role |

## Entity count and staging

About 50 tables. They are introduced by stage:

| Stage | Tables |
|---|---|
| 2 | A (identity, preferences, categories) and the sync functions |
| 3 | B (goals) · C (tasks) · D (habits) · E (calendar, schedule) |
| 4 | F (focus, study, timelapses) · G (training) · H (projects) · J (knowledge & reflection) · `skills` and `skill_progress_entries` (needed by athletic development and the learning tracker) |
| 5 | `entity_links` (Life Graph) · K (insights) |
| 6 | L (AI) |

A column that references a table introduced in a later stage is added by that
later stage's migration, together with its ownership foreign key. For example,
`tasks.project_id` and `milestones.project_id` arrive with `projects` in Stage 4,
and `calendar_events.person_ids` arrives with `people`. Earlier tables never
carry dangling, unenforced references.

Each migration ships with RLS and ownership tests for the tables it adds, and
the "every table has RLS" guard test runs on every build.
