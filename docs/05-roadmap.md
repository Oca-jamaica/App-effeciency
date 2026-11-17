# 05 — Development roadmap

Eight stages, as specified in the brief. Each stage ends with:

1. a report: what was built, files changed, what works, known issues;
2. tests run, with results;
3. step-by-step instructions to try it yourself.

A feature is "done" only when it is backed by the database, survives an app
restart and a sync, has loading, empty and error states, and has tests.
Placeholders are never reported as features.

## Stage 1 — Product & architecture ✅ (this stage)

- [x] Inspect existing repositories (none is ASCEND; this is a new project)
- [x] Product definition, information architecture, product decisions — `01-product.md`
- [x] Architecture, sync design, security model, AI design — `02-architecture.md`
- [x] Database schema (target, staged) — `03-database.md`
- [x] Scheduling engine specification — `04-scheduler.md`
- [x] Roadmap and risks — this file and `06-risks.md`
- [x] Validated on real Postgres 16: RLS isolation, owner spoofing rejected,
      cross-user foreign-key links rejected, `ON DELETE SET NULL (col)` behaviour.

## Stage 2 — Foundation

Split in two so each half can be verified on its own.

**2a. App shell & design system**
- npm-workspaces monorepo: `apps/mobile` (Expo SDK 58, TypeScript strict) and `packages/domain`
- ESLint (with layering rules), Prettier, `tsconfig` paths, Jest (`jest-expo`)
- Design tokens: colour (dark: background `#101318`, surface `#1C2430`, accent
  `#739BEA`, text `#E9EDF3`, muted slate; light: off-white, dark text,
  restrained blue, subtle borders), spacing scale (4-pt), radii (8/12/16),
  type scale (Inter), elevation by border rather than shadow, motion durations
- Theme provider (system, light or dark; persisted), status bar, safe areas
- Primitives: Text, Button, IconButton, TextField, TextArea, Select sheet,
  Date/Time picker, SegmentedControl, Chip, Checkbox, Switch, Card, ListRow,
  SectionHeader, ProgressBar, EmptyState, ErrorState, Skeleton, Toast,
  ConfirmDialog, BottomSheet, Badge, Divider
- A **design catalogue screen** (dev menu) rendering every component in both
  themes. I'll screenshot it for your review.
- Expo Router: auth stack plus the five tabs (Home, Goals, Planner, Insights,
  Profile), each with its real header (capture and AI entry points wired to
  sheets that say plainly what arrives in later stages, without fake buttons),
  and the Planner segment bar
- Supabase client with encrypted session storage; sign up, email verification,
  sign in, sign out, password reset by 6-digit code, session restore; form
  validation and error messages

**2b. Data layer**
- Supabase project config, first migrations: `profiles`, `user_preferences`,
  `availability_windows`, `categories`, triggers (`set_updated_at`,
  `forbid_user_id_change`, `handle_new_user` with default categories)
- `sync_push` / `sync_pull` functions with the conflict rules
- SQL test harness: the "every table has RLS" guard, cross-user isolation
  tests, ownership foreign-key tests, sync RPC tests
- Local SQLite with Drizzle, migrations, the repository pattern, live queries
- Sync engine: outbox, push/pull, backoff, idempotency, conflict log, sync
  status indicator, offline banner
- Schema-parity test (Postgres ↔ Drizzle)
- Settings: theme, profile, timezone, day bounds and preferred hours (the first
  real, synced preferences)
- CI (GitHub Actions): typecheck, lint, unit tests, SQL tests, `expo export`
  for iOS and Android

**You test:** create a Supabase project and push the migrations (exact
commands provided). Then:
1. Run the app in Expo Go and create an account.
2. Change the theme and preferences.
3. Turn on airplane mode, change a setting, and reconnect.
4. Sign in on a second device and see it there.

## Stage 3 — Core: goals, tasks, habits, planner, scheduler, Home

- **Goals.** Create, edit, archive, delete (soft, restorable); categories;
  priority list with drag-to-reorder; milestones; action checklist; notes;
  resource links (clickable, organised); progress modes and progress history.
- **Tasks.** Full CRUD; states (inbox → planned → in progress → completed /
  cancelled / archived); subtasks; goal and milestone links; recurrence; task
  history; smart lists (Inbox, Today, Upcoming, By goal, Completed).
- **Habits.** Custom habits; all frequency kinds; preferred days and times;
  pause and archive; check-off creates `habit_logs`; consistency stats; history
  calendar; notes.
- **Calendar.** Day, week and month views; events; recurring events; locked
  commitments; deadlines overlay; free-time display; drag-and-drop rescheduling
  in day and week views.
- **Scheduler engine.** Full spec in `04-scheduler.md`, with the property-based
  test suite.
- **Home.** Greeting and date; Today strip; Now & Next; today's schedule (move,
  lock, resize, complete, start focus); priorities; habits due; deadlines;
  upcoming events; missed-work flow.
- **Quick capture.** All seven item types; deterministic natural-language
  parser; offline.
- **Local notifications v1.** Habit and task reminders, standalone reminders,
  quiet hours, daily cap.

Acceptance criteria covered: **1–11**.

## Stage 4 — Personal development

- Focus timer: start, pause, resume, stop; linked task or goal; optional
  breaks; survives app kill; history.
- Study sessions (timer or manual) linked to tasks and goals.
- Study timelapse upload (validation, progress, retry, playback, delete,
  history) and revocable share links.
- Projects and Missions: stages, milestones, tasks, notes, completion summary.
- Workout tracker: custom exercises, plans, sessions, sets, personal records.
- Athletic development: sports, training sessions, skill ratings.
- Training planner (feeds the scheduler).
- Social planner: people, birthdays, plans, reminders.
- Experiences list.
- Knowledge Vault (search, categories, tags), Workspace notes, Daily Journal,
  Decision Journal, Reading & Learning, Idea Incubator, Sleep & Recovery.

Acceptance criteria covered: **12, 13, 14, 16**.

## Stage 5 — Insights & advanced systems

- Insights Overview.
- **Weekly reports.** Shared deterministic `computeWeeklyStats`: tasks
  completed, missed and postponed; habit consistency; study time; goal and
  project progress; time allocation; achievements; attention areas; and a
  deterministic next-week plan. Generated automatically, with history and
  comparison.
- Sunday Reset flow.
- Achievements (automatic plus manual) and the Life Timeline.
- Life Balance Map.
- Time Reality (planned vs actual).
- Monthly challenges.
- Skill Trees.
- Life Graph Connections.
- Purge job for tombstones.

Acceptance criterion covered: **15**.

## Stage 6 — ASCEND AI

- Edge Functions (Anthropic SDK, server-side key), per-user quotas, AI access
  settings per data area.
- Context tools under RLS; proposal schema; deterministic risk classification;
  approval UI (Accept / Edit / Reject per action).
- Life Command assistant (streaming).
- Daily briefing.
- Goal strategist (ambition → plan proposal).
- "What should I do now?" (deterministic pick plus AI explanation).
- Weekly AI review narrative.
- Life Audit.
- Predictive-planning explanations.
- Personal Memory (review, delete, AI-suggested memories pending approval).
- Opportunity Engine (no invented listings; web search with citations).
- Voice capture (introduces the development build).

Acceptance criteria covered: **17, 18**.

## Stage 7 — Testing & refinement

- Maestro end-to-end suite on iOS and Android.
- Multi-device sync and conflict scenarios.
- Offline matrix.
- RLS penetration tests with two real users through the REST API.
- Performance with a large dataset: 5k tasks, 2 years of habit logs, cold
  start, list virtualisation.
- Accessibility: VoiceOver and TalkBack labels, dynamic type, contrast, touch
  targets.
- Design consistency pass.
- Fix everything found, rather than only reporting it.

Acceptance criteria covered: **19–22**.

## Stage 8 — Release preparation

- EAS build profiles (development, preview, production).
- App icon and splash (light and dark).
- Sign in with Apple and Google.
- Environment configuration for staging and production Supabase.
- Privacy policy and in-app privacy screen.
- App Store privacy labels and Play data-safety form.
- Crash reporting (opt-in, PII-scrubbed — to be decided).
- Store metadata.
- Deployment runbook and testing instructions.
- Release only after a full device pass.

## Acceptance criteria → stage

| # | Criterion | Stage |
|---|---|---|
| 1 | Create and edit own goals | 3 |
| 2 | Organise goals by priority | 3 |
| 3 | Goal notes, milestones, video links | 3 |
| 4 | Custom habits | 3 |
| 5 | Custom habit schedules and frequencies | 3 |
| 6 | Habit completion saved and tracked | 3 |
| 7 | Tasks linked to goals | 3 |
| 8 | Scheduler uses real tasks, habits and commitments | 3 |
| 9 | Scheduler respects locked events | 3 |
| 10 | Manual schedule override | 3 |
| 11 | Sensible rescheduling of unfinished tasks | 3 |
| 12 | Timelapse upload and retrieval | 4 |
| 13 | Study sessions linked to tasks and goals | 4 |
| 14 | Focus timer records sessions | 4 |
| 15 | Weekly reports from real activity | 5 |
| 16 | Projects and milestones | 4 |
| 17 | AI retrieves approved context | 6 |
| 18 | AI approval for significant changes | 6 |
| 19 | Data syncs correctly | 2 (engine) · 7 (verified at scale) |
| 20 | No cross-user access | 2 onwards (every migration) · 7 (penetration tests) |
| 21 | Works on iOS and Android | every stage (Expo Go) · 7–8 (builds) |
| 22 | Consistent design | 2 (system) · 7 (pass) |
