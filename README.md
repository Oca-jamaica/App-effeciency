# ASCEND

**Become more. Every day.**

ASCEND is a personal operating system for iOS and Android: goals, tasks, habits, an automatic daily
scheduler, focus and study tracking, training, reflection and insights, connected by an AI layer that
proposes changes for the user to approve.

## Status

| Stage | Scope | State |
|---|---|---|
| 1 | Product, architecture, database design, scheduler spec | ✅ Done — see `docs/` |
| 2 | Foundation: monorepo, design system, navigation, auth, migrations, offline data & sync | ✅ Done |
| 3 | Core: Home, Goals, Habits, Tasks, Calendar, automatic scheduler, quick capture | ✅ Done — acceptance criteria 1–11 covered by tests |
| 4 | Personal development: focus timer, study timelapses, projects, training, social, journals, vault, reminders | ✅ Done — acceptance criteria 12, 13, 14, 16 covered by tests |
| 5 | Insights: weekly reports, Life Audit, achievements, balance, Life Graph, skill trees | Next |
| 6 | ASCEND AI (server-side) | Planned |
| 7–8 | Hardening, store builds, release | Planned |

Not yet tested on a physical device (no simulator is available where it was built) — see
**Testing on your phone** below.

## Repository layout

```
apps/mobile/          Expo SDK 58 app (React Native 0.88, TypeScript, Expo Router)
  src/app/            Routes: (auth) sign-in flow, (app)/(tabs) Home · Goals · Planner · Insights · Profile
  src/ui/             Design system: tokens, theme, primitives
  src/data/           On-device SQLite store, outbox, sync engine
  src/features/       Goals, habits, tasks, planner/scheduling, capture, focus & timelapses, projects,
                      training, social, collections (journals, vault…), notifications, insights, settings
packages/domain/      Pure TypeScript shared by app and server: scheduler, habits, recurrence, capture parser,
                      focus timer, personal records, birthdays, project/learning/sleep progress
apps/web-preview/     Single-file browser preview built from the same domain package
supabase/migrations/  Postgres schema with Row Level Security and the sync API
supabase/functions/   Edge Functions (delete-account)
supabase/tests/       Database, security and two-device sync tests
docs/                 Product, architecture, database, scheduler, roadmap, risks
```

## Running the app

You need Node 22, a free [Supabase](https://supabase.com) project, and the **Expo Go** app on your phone.

1. **Install dependencies** (repository root):
   ```bash
   npm install
   ```
2. **Create the database.** Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then:
   ```bash
   supabase login
   ```
   ```bash
   supabase link --project-ref YOUR-PROJECT-REF
   ```
   ```bash
   supabase db push
   ```
   This applies every migration, including the private `study-videos` storage bucket.
   ```bash
   supabase functions deploy delete-account
   ```
3. **Use verification codes in emails.** In the Supabase dashboard → Authentication → Emails, set the
   *Confirm signup* and *Reset password* templates to the contents of `supabase/templates/confirmation.html`
   and `supabase/templates/recovery.html` (they show the 6-digit code the app asks for).
4. **Configure the app:** copy `apps/mobile/.env.example` to `apps/mobile/.env` and fill in your
   project URL and publishable key (Project Settings → API).
5. **Start it:**
   ```bash
   cd apps/mobile && npx expo start
   ```
   Scan the QR code with your phone's camera (iOS) or the Expo Go app (Android).

## Testing on your phone (Stages 2–3)

1. Create an account; enter the code from the email.
2. **Goals:** create three goals, then hold and drag to reorder them. Open one: add milestones, a note
   (e.g. *Strategy*), a YouTube link (opens in the in-app browser), and tick a milestone — progress updates.
3. **Habits:** Goals → Habits → create “Gym, Mon/Wed/Fri, 60 min, evening” and “Read, daily, 20 min at 21:30”.
   Tick today's habit; open it to see the history calendar and consistency.
4. **Planner → Calendar:** add a fixed commitment (e.g. school 08:30–15:30, every weekday, locked).
5. **Tasks:** add tasks linked to a goal with estimates and deadlines. Use **+** on Home for quick capture,
   e.g. `Revise unit 3 tomorrow 4pm 45m !p1 #economics`.
6. **Home:** your day is planned automatically around commitments, with breaks and protected free time.
   Tap a block to move it, lock it, change its length or mark it done. In Planner → Day, hold a block
   and drag it to a new time.
7. **Missed work:** when a planned block's time passes without being done, Home shows a calm card offering
   later today, tomorrow, shorten, split, or unplan.
8. **Offline & sync:** turn on airplane mode, make changes, turn it off — they sync. Sign in on a second
   device to see the same data. Profile → Sync shows status and any merge notices.
9. **Data:** Profile → Export my data shares a full JSON copy. Delete account is permanent.

## Testing on your phone (Stage 4)

1. **Focus:** Planner → Focus. Pick a type and length, link a task, Start. Close the app and reopen it — the
   timer is still running. Pause, resume, then Finish and rate your focus. The time counts towards the task,
   so the planner schedules only what's left. From Home, **Start focus** on the current block does the same
   and marks the block done when you finish.
2. **Timelapses:** after a session, choose to attach a timelapse, or use Planner → Focus → Upload. Pick an
   MP4/MOV video; watch the progress, cancel or retry. Videos are stored privately in your account (only you
   can play them, through links that expire after an hour) and are never shared.
   On Supabase's Free plan a single upload is limited to 50 MB; the Pro plan allows larger files (the app
   accepts up to 500 MB).
3. **Projects & missions:** Goals → Projects → **+**. A mission needs an objective and a deadline. Add stages,
   milestones and tasks; tasks are scheduled like any other. Completing asks for a short summary.
4. **Training:** Planner → Training → Workouts. Add the starter exercises or your own, start a workout and log
   sets — a new personal record is announced. Sport & skills: create skills, rate them 0–10, log sessions.
   For training to appear in your plan, create it as a habit or a recurring *training* event.
5. **Social:** Planner → Social shows plans with people, upcoming birthdays and experiences.
6. **Journals and more:** Profile → Daily Journal, Decision Journal, Reading & Learning, Knowledge Vault,
   Idea Incubator, Workspace, People & birthdays, Experiences, Sleep & Recovery. All searchable.
7. **Reminders:** Profile → Reminders. Turn them on (the phone asks for permission), set quiet hours and a
   daily limit. Habit reminder times, reminders from quick capture (e.g. `remind me to call Sam fri 6pm`) and
   the focus timer then notify you, even with the app closed.

A browser preview of all of this (without the server parts) is in `apps/web-preview`.

## Running the tests

```bash
npm run typecheck
```
```bash
npm test
```
Database, security and two-device sync tests need a Postgres 15+ (`DATABASE_URL`); on Debian/Ubuntu
`npm run db:start` starts a throwaway one on port 54329:
```bash
npm run db:start
```
```bash
DATABASE_URL=postgres://postgres@localhost:54329/postgres npm run db:test
```

CI (`.github/workflows/ci.yml`) runs all of the above plus iOS and Android bundling on every push.

## Security model (summary)

- Row Level Security on every table; the `anon` role has no access; tests fail the build otherwise.
- Ownership-enforcing composite foreign keys: a row can never reference another user's data.
- Only the publishable key ships in the app; service-role and AI keys live only in Edge Function secrets.
- The auth session is stored encrypted (AES key in the OS keychain, ciphertext in app storage).
- Only an email address is required.

Details: `docs/02-architecture.md`, `docs/03-database.md`.
