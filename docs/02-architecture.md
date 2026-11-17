# 02 — Architecture

## Stack

| Concern | Choice | Version (Expo SDK 58 compatible) | Why |
|---|---|---|---|
| App runtime | Expo (managed, CNG) + React Native | SDK 58 · RN 0.88.1 · React 19.3 | Native iOS/Android from one TypeScript codebase; EAS builds; SDK 58 has had seven weeks of patches. |
| Language | TypeScript, `strict` | 5.x | Types shared from DB to UI. |
| Navigation | Expo Router (file-based, typed routes) | ~58.0 | Native stacks/tabs, deep links (auth emails), modals. |
| Local database | `expo-sqlite` + Drizzle ORM | ~58.0 · drizzle-orm 0.45 | Offline-first storage, typed queries, live queries, and it runs in Expo Go. |
| Backend | Supabase: Postgres, Auth, Storage, Edge Functions | Postgres 15+ (17 on new projects) | Relational data with Row Level Security; private file storage; server functions for AI and admin tasks. |
| AI | Anthropic Claude via `@anthropic-ai/sdk`, **server-side only** in Edge Functions | Model `claude-opus-5-5` (configurable) | Strong tool use and structured outputs; the key never leaves the server. |
| Animation & gestures | Reanimated 4 + Gesture Handler 3 | 4.7.1 · ~3.3 | Restrained transitions, drag-and-drop on lists and the calendar. |
| Sheets | `@gorhom/bottom-sheet` | 5.2 | Quick capture, pickers, confirmations. |
| Icons | `lucide-react-native` (one icon set, one stroke weight) | 1.74 | Consistent iconography. |
| Type | Inter via `@expo-google-fonts/inter` | 0.4 | As specified. |
| Validation | Zod (schemas shared by app, sync and server) | 4.x | One definition of "valid" everywhere. |
| Dates & recurrence | `date-fns` 4 + `@date-fns/tz`; `rrule` (RFC 5545) | — | Timezone-correct scheduling; standard recurrence. |
| Ordering | `fractional-indexing` | 4.0 | Drag-to-reorder changes one row, which keeps offline sync conflict-free. |
| UI state | Zustand (ephemeral UI only) | 5.x | Domain data lives in SQLite, not in a JS store. |
| Notifications | `expo-notifications` (local) | ~58.1 | Reminders without a push server. |
| Device calendars | `expo-calendar` | ~58.0 | Read-only import of fixed commitments. |
| Media | `expo-image-picker`, `expo-file-system`, `expo-video` | ~58.0 | Pick, upload (with progress) and play timelapses. |
| Secrets on device | `expo-secure-store` (+ encrypted AsyncStorage for large values) | ~58.0 | Auth session storage. |
| Tests | Jest (`jest-expo`), React Native Testing Library, SQL tests on Postgres, Maestro (E2E) | — | See Testing. |

## System overview

```
┌──────────────────────────── ASCEND mobile app (Expo) ─────────────────────────────┐
│  Screens (Expo Router)  ──  Feature modules (goals, tasks, habits, planner, …)     │
│        │                          │                                                │
│        ▼                          ▼                                                │
│  Design system (ui/)      Repositories ── validate (Zod) ── write ── history log  │
│                                   │                                                │
│  Domain core (packages/domain: scheduler, recurrence, habits, stats, progress)    │
│                                   │                                                │
│                         Local SQLite (Drizzle)  ◄── live queries ── UI             │
│                                   │                                                │
│                         Sync engine (outbox → push · pull ← cursor)                │
└───────────────────────────────────┼────────────────────────────────────────────────┘
                                    │ HTTPS, user's JWT (publishable key + RLS)
┌───────────────────────────────────▼──────────────── Supabase ─────────────────────┐
│ Auth │ Postgres: tables + RLS + triggers + sync RPCs │ Storage: private buckets    │
│ Edge Functions: ai · weekly-report · export-data · delete-account · video-share   │
└───────────────────────────────────┼────────────────────────────────────────────────┘
                                    │ server-side API key
                                    ▼
                              Anthropic API
```

**Layering rules** (enforced by folder boundaries and lint rules):

- `packages/domain` is pure TypeScript: no React, no React Native, no I/O. It is
  imported by the app *and* by Edge Functions, so the scheduler, habit-due logic
  and weekly statistics have exactly one implementation.
- Screens never touch SQLite or Supabase directly. They call feature hooks,
  which call repositories.
- Repositories are the only writers. Each write validates, persists, records
  history (e.g. `task_events`), and enqueues sync in one SQLite transaction.

## Data & sync: local-first

**Decision:** the phone holds a SQLite copy of the user's data. The UI reads
from it (instant, works offline), writes go to it first, and a sync engine
reconciles with Postgres in the background.

Why not online-only with a cache: the scheduler, Home, quick capture and habit
check-offs must work on the Tube, in a basement gym, on a plane. They also need to
feel instant. Local-first gives both.

Why custom sync rather than PowerSync/WatermelonDB: those need native modules,
which would rule out Expo Go and force a custom development build from day one.
A personal app (one user, a few devices, rare concurrent edits) has a simple
enough conflict profile to sync reliably with a small, well-tested engine. The
engine sits behind an interface, so PowerSync can replace it later if needed.

### Protocol

Every synced table has `id uuid` (generated on the device), `user_id`,
`created_at`, `updated_at` (set by a server trigger on every write) and
`deleted_at` (tombstone).

- **Push.** Each local write appends an outbox entry: `{table, id, op, patch,
  base_updated_at}`. The engine sends batches to a Postgres function
  `sync_push(changes jsonb)` that runs *as the user* (RLS applies). It applies each
  patch field-by-field and returns the canonical row. Retries use exponential
  backoff, and entries are idempotent, so a lost response is harmless.
- **Pull.** `sync_pull(cursors jsonb)` returns rows with `updated_at` greater
  than the per-table cursor minus a 2-minute overlap window. The overlap covers
  transactions that commit slightly out of timestamp order. Applying a pulled
  row is idempotent and skipped if the row has unpushed local changes; those
  win and are pushed next.
- **Triggers.** Sync runs on app start, on foreground, after local writes
  (debounced), on reconnect, and on a timer while the app is open. Supabase
  Realtime can later trigger an immediate pull when another device writes.

### Conflict rules

| Situation | Rule |
|---|---|
| Two devices edit *different* fields of a row | Both survive (patches are per field). |
| Two devices edit the *same* field | Last write to reach the server wins; the losing value is recorded in a local conflict log, visible in Settings → Sync. |
| Edit vs delete | The delete wins, but deletes are soft. The item stays in **Recently deleted** for 30 days and can be restored. |
| Completion vs other status edits | Completion is sticky: an offline edit cannot silently un-complete a task. Reopening is an explicit action. |
| Duplicate derived records (e.g. both devices log the same habit on the same date) | Natural-key upsert (`unique (habit_id, log_date)`); the server merges into the existing row and tells the device to adopt its id. Only leaf tables use natural keys, so re-pointing ids is trivial. |
| Ordering (goal priorities) | Fractional ranks: a move changes one row, so concurrent reorders rarely conflict, and if they do the result is still a valid order. |

Tombstones are purged after 30 days. A device whose cursor is older than that
does a full re-sync automatically.

**Schema parity.** The SQLite schema (Drizzle) mirrors the Postgres tables. A
test runs all migrations on a real Postgres, reads `information_schema`, and
fails if any synced table's columns differ from the Drizzle definition.

**Local-only tables:** outbox, sync cursors, conflict log, focus-timer state,
scheduler run log. **Server-only data:** AI messages (fetched on demand and
cached), AI usage quotas, video share links.

## Authentication & account lifecycle

- Email + password with email verification; passwordless email code as an
  alternative. Sign in with Apple and Google are added at release (Stage 8):
  they need store configuration and a development build. Apple requires Sign in
  with Apple if Google sign-in is offered.
- **Recovery:** password reset with a 6-digit code emailed by Supabase, entered
  in the app. This is more reliable on mobile than magic-link deep links.
- **Session storage:** the Supabase session is encrypted. An AES key is held in
  the OS keychain/keystore (`expo-secure-store`) and the session blob is stored
  encrypted in AsyncStorage, because the keychain has a size limit.
- **Data export:** `export-data` Edge Function, running as the user, produces a
  ZIP of JSON files (one per table) plus a manifest of uploaded videos with
  time-limited download links.
- **Account deletion:** in-app, after re-authentication. The `delete-account`
  function removes the user's storage objects, then deletes the auth user; every
  table cascades on `user_id`. This meets Apple's in-app deletion requirement.

## Security model

1. **Row Level Security on every table**, with the same policy shape:
   `user_id = (select auth.uid())` for read and write. A SQL test enumerates
   every table in `public` and fails the build if any lacks RLS, lacks a policy,
   or leaks rows across two test users.
2. **Ownership-enforcing foreign keys.** Child rows reference parents with
   composite keys `(parent_id, user_id) → parent(id, user_id)`. So a task
   *cannot* point at another user's goal, even with a guessed id. This also
   closes the "does this id exist?" oracle, because foreign-key checks bypass
   RLS. Verified on Postgres 16 during Stage 1.
3. **Only the publishable key ships in the app.** The `anon` role gets no table
   grants at all; only `authenticated` does. The service-role key exists only in
   Edge Function secrets and is used by just two functions (account deletion and
   the weekly-report scheduler).
4. **Edge Functions run as the calling user.** They create a Supabase client
   with the caller's JWT, so RLS applies to everything they read, including
   everything the AI reads.
5. **Storage.** The `study-videos` bucket is private. Object paths are
   `{user_id}/{video_id}.{ext}`, and storage policies allow access only to the
   owner's folder. MIME types and size are limited at the bucket level. Playback
   uses signed URLs that expire after one hour.
6. **Video sharing is explicit and revocable.** The user creates a share link
   with an expiry. The link carries a random token (only its hash is stored); the
   `video-share` function checks it, then issues a 60-second signed URL. Revoking
   the link takes effect immediately. Nothing is ever shared automatically.
7. **Minimal data.** Only an email is required. No contact import, location
   tracking or third-party analytics. AI features are opt-in, and the user is
   told plainly that content is sent to the AI provider when AI is used.

## AI service

The AI is a layer over the same structured data the app uses, not a separate
chatbot.

**Endpoints** (Supabase Edge Functions, TypeScript/Deno, Anthropic SDK):

| Route | What it does | Call shape |
|---|---|---|
| `ai/chat` | Life Command assistant: plan my day, "I have two hours free", "move revision because I have football", "what should I do now?" | Tool-using conversation (streams to the app) |
| `ai/briefing` | Morning briefing from today's plan, deadlines and habits | Single call, structured output |
| `ai/goal-plan` | Turn an ambition into a goal, milestones, tasks and a timeline | Single call, structured output → proposal |
| `ai/capture` | Parse free text or voice into a typed item | Single call, structured output |
| `weekly-report` | Narrative and recommendations over the deterministic weekly stats | Single call, structured output |
| `ai/audit` | Life Audit: neglected goals, stalled projects, mismatch between stated priorities and time spent | Single call over computed signals |
| `ai/opportunities` | Opportunity suggestions tied to goals and interests | Single call; web search with citations when enabled |

**Context retrieval.** Chat uses read tools: `get_overview`, `get_goals`,
`get_tasks(filter)`, `get_habits`, `get_schedule(range)`, `get_events(range)`,
`get_activity(range)`, `search_notes(query)` and `get_memories`. It also has
`simulate_schedule(changes)`, which runs the same deterministic scheduler from
`packages/domain`, and `propose_changes(actions)`. Every read tool queries
Postgres with the user's JWT (RLS) and respects the user's **AI access settings**,
which control per area whether the AI may read journal, decision journal, notes,
memory and sleep. Sensitive areas are off by default.

**Approval flow.**

1. The model can only *propose*. `propose_changes` takes typed actions such as
   `create_task`, `reschedule_block`, `update_goal_priority`, `create_event` or
   `delete_task`. These are validated with a strict schema (Zod) when generated
   and again when applied.
2. **Risk is classified by code, not by the model.** Creates are low-risk;
   edits to priorities, locked blocks, many calendar items, or any delete
   require explicit approval. External actions (sending messages) are not
   available to the AI at all in v1.
3. Proposals appear as cards that are visually distinct from confirmed data,
   with Accept / Edit / Reject per action. Accepted actions run through the same
   repositories as manual edits, so they work offline, sync, and show in history
   with `origin = 'ai'`.

**Model configuration.**

- Default model `claude-opus-5-5`, set by a server environment variable.
  Cheaper models (Sonnet 5.5, Haiku 5.5) can be swapped in per route, but the
  model is your decision, not mine.
- Adaptive thinking. Effort is set per route: low for chat and capture parsing,
  higher for weekly reviews, audits and goal planning.
- Prompt caching on the stable system prompt and tool definitions; strict tool
  schemas; structured outputs for parsing routes.
- **Server-side refusal fallbacks are enabled** (`fallbacks: "default"`), so a
  safety-classifier refusal is retried on a fallback model instead of failing.
  Easy to remove if you'd rather not.
- Per-user daily token quota (`ai_usage`), request size limits, and a clean
  error when the AI is unavailable. The app never depends on the AI to
  function: every AI feature has a deterministic or manual path.

**Grounding.** Weekly-report numbers come from computed stats, and the UI
renders those numbers directly. The model receives the stats and writes
narrative only, and is instructed not to introduce figures. Opportunities follow
the rule in product decision 12.

**Decision for Stage 6: where the assistant's tool loop runs.** Two good options:

- **Anthropic Managed Agents** — Anthropic's current default for tool-using
  agents. Anthropic hosts the agent loop and a per-session container. It is in
  beta, bills session runtime on top of tokens, and keeps session history until
  deleted (we would delete sessions when a conversation closes). Our read and
  propose tools would be custom tools answered by our Edge Function.
- **Messages API tool loop inside our Edge Function.** We host the loop.
  Conversation history lives only in our database, and there is no container cost.

I lean towards the second for ASCEND: the tools are few and short-running, and
journal and personal-memory content flows through the assistant, so keeping
history only in our own database is the simpler privacy story. It's your call;
nothing before Stage 6 depends on it.

**Voice capture.** On-device speech recognition (iOS Speech framework, Android
SpeechRecognizer, preferring on-device models) produces a transcript. The
deterministic capture parser runs first, then the AI parser if enabled, and the
user confirms a preview. This needs a development build (not Expo Go).

## Scheduler placement

The scheduler is a pure function in `packages/domain`. It runs on the device,
against local data, in milliseconds, offline. The AI never schedules directly:
it changes inputs (adds an event, adjusts an estimate, locks a block) and the
deterministic engine produces the plan. Full specification: `04-scheduler.md`.

## Notifications

All local (no push server in v1), generated from local data: habit reminders,
task reminders, standalone reminders, optional block-start nudges, the morning
briefing, the Sunday Reset prompt and "weekly report ready". iOS allows 64
pending local notifications, so the app keeps a rolling window of the next
several days and tops it up on foreground and in a background task. Quiet hours
and a daily cap are enforced when notifications are scheduled.

## Media pipeline (study timelapses)

1. The user picks a video (`expo-image-picker`, video only).
2. The app validates type, size (default limit 500 MB, configurable on the
   server) and duration.
3. It creates the `study_videos` row (`upload_status = uploading`), requests a
   signed upload URL for `{uid}/{video_id}.mp4`, and uploads with
   `expo-file-system` using a background-capable upload task with progress.
4. It marks the row `ready`, or `failed` with a retry. Uploads resume when the
   app returns.

Playback uses a short-lived signed URL with `expo-video`. Deleting a video
removes both the object and the row.

## Calendar integration

v1 is read-only import from device calendars the user selects in Settings.
Events become fixed, locked commitments for the scheduler and display with
their source calendar's name. Because the same Google event has a different id
on each device, imported events are **device-local** (not synced). The AI is
told about them when the app makes a request. Server-side Google/Microsoft
calendar sync is a later upgrade that would make them cross-device.

## Project structure

```
ascend/
├─ apps/mobile/                 Expo app
│  ├─ app/                      Expo Router routes (thin; compose feature screens)
│  │  ├─ _layout.tsx            providers: theme, database, auth, sync, toasts
│  │  ├─ (auth)/                sign-in, sign-up, verify, reset
│  │  ├─ (app)/(tabs)/          home, goals, planner, insights, profile
│  │  ├─ (app)/…/[id].tsx       detail stacks (goal, task, habit, project, …)
│  │  ├─ capture.tsx            quick-capture sheet
│  │  └─ assistant.tsx          ASCEND AI
│  ├─ src/
│  │  ├─ ui/                    design system: tokens, theme, primitives, patterns
│  │  ├─ features/<module>/     screens, components, hooks per module
│  │  ├─ data/                  SQLite schema (Drizzle), local migrations, repositories
│  │  ├─ sync/                  outbox, push/pull, conflict rules, status
│  │  ├─ services/              supabase, auth, notifications, uploads, device calendar
│  │  └─ lib/                   dates, ids, errors, logging
│  └─ e2e/                      Maestro flows
├─ packages/domain/             pure TS shared by app and Edge Functions
│  └─ src/  scheduler/ recurrence/ habits/ progress/ stats/ capture/ schemas/
├─ supabase/
│  ├─ migrations/               ordered SQL migrations (one or more per stage)
│  ├─ tests/                    SQL tests: RLS, constraints, ownership, sync RPCs
│  └─ functions/                ai, weekly-report, export-data, delete-account, video-share
└─ docs/
```

Adding a module later follows the same steps each time:
1. Add a migration and its RLS tests.
2. Add a Drizzle table.
3. Add a sync registry entry.
4. Add a `features/<module>` folder.

Nothing else changes, which is what keeps the architecture extensible.

## Testing strategy

| Layer | Tooling | Runs in |
|---|---|---|
| Domain logic (scheduler, recurrence, habit due/consistency, stats, capture parser) | Jest, including property-based tests (no overlaps, locked blocks untouched, caps respected, DST days) | CI and this environment |
| Database (RLS isolation for every table, ownership FKs, constraints, sync RPC behaviour) | SQL test suite against real Postgres with Supabase's `auth` layer emulated; in CI, Supabase's local stack | CI and this environment |
| Sync engine (offline queue, retries, conflicts, idempotency, schema parity) | Jest against SQLite and a Postgres-backed test server | CI and this environment |
| Components and screens | React Native Testing Library | CI and this environment |
| Bundling | `expo export` for iOS and Android, `expo-doctor` | CI and this environment |
| End-to-end flows on simulators and emulators | Maestro (auth → goal → task → schedule → focus → report) | CI (macOS runner) and your machine |
| Real devices | Expo Go during Stages 2–5, development build afterwards | Your phone |

**Limitation:** this environment cannot run an iOS Simulator or Android
emulator. I can prove the logic, database, security and bundling here; on-device
behaviour is verified on your phone with the steps I give after each stage, and
in CI with Maestro.

## Configuration

| Variable | Where | Secret? |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | app `.env` | No |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | app `.env` | No (safe to ship; RLS protects data) |
| `ANTHROPIC_API_KEY` | Supabase Edge Function secrets | **Yes — never in the app or the repo** |
| `AI_MODEL`, `AI_DAILY_TOKEN_LIMIT`, `VIDEO_MAX_BYTES` | Supabase function secrets/config | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Provided automatically to Edge Functions | **Yes** |
