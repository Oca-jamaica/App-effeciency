# 06 — Technical risks & open decisions

## Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **Scope.** About 40 modules: breadth could beat depth and leave many half-working screens. | High | Stage gates tied to the acceptance criteria; nothing is reported as done without data flow and tests; core loop (Stage 3) before breadth. |
| 2 | **Sync correctness.** Lost updates, cursor gaps, clock skew, SQLite/Postgres schema drift. | High | Server-assigned `updated_at` (device clocks are never trusted); per-field patches; 2-minute pull overlap with idempotent apply; natural keys only on leaf tables; schema-parity test; conflict log; sync behind an interface (PowerSync is the fallback). |
| 3 | **Scheduler quality.** "Realistic" is subjective; re-plans can feel chaotic; DST and timezone bugs. | High | Explainable scoring with a reason on every block; stability rule; property-based invariants; DST tests in several zones; every threshold is a user preference; tuned from your real usage after Stage 3. |
| 4 | **Large video uploads on mobile.** Uploads killed when backgrounded; plan file-size caps; storage cost. | Medium | Background-capable upload task with resume and retry; client-side validation before upload; size cap configured on the server; **Supabase Free caps files at 50 MB**, so Pro (≈ $25/month, large file limits) is needed for real timelapses. |
| 5 | **AI cost, latency and accuracy.** | Medium | AI is optional on every path; deterministic numbers with AI writing narrative only; per-user daily quotas; prompt caching; effort tuned per route; model configurable by you. |
| 6 | **Prompt injection.** A note or saved web text tries to instruct the AI. | Medium | The AI has no write tools, only proposals; risk is classified by code; destructive actions always need a human tap; tool reads are scoped by RLS and the AI access settings. |
| 7 | **Opportunity Engine accuracy.** It cannot know real availability. | Medium | Ideas are labelled as ideas; specific listings only from web search with citations and "check availability". |
| 8 | **Notification limits.** iOS caps pending local notifications at 64; Android 12+ restricts exact alarms; Expo Go limits on Android. | Medium | Rolling window topped up on foreground and in a background task; inexact delivery where acceptable; full behaviour verified in the development build. |
| 9 | **Cross-device calendar imports.** Device calendar event ids differ per device. | Low | Imports are device-local in v1; server-side Google/Microsoft sync is the later fix. |
| 10 | **No simulator in this environment.** | Medium | Logic, database, security and bundling are proven here; Expo Go on your phone for Stages 2–5; Maestro on CI macOS runners; on-device checklists after each stage. |
| 11 | **Drag-and-drop calendar performance.** | Medium | Reanimated and Gesture Handler on the UI thread; evaluate `@howljs/calendar-kit` versus custom in Stage 3 and pick by measured performance. |
| 12 | **Sharing domain code between Metro (app) and Deno (Edge Functions).** | Low | `packages/domain` has no dependencies beyond `date-fns`, `rrule` and `zod`, and uses explicit `.ts` import extensions so both runtimes resolve it; if bundling fights back, a build step copies it into `supabase/functions/_shared`. |
| 13 | **App Store review.** Sign in with Apple, in-app account deletion, privacy labels, AI disclosure. | Low | All planned in the architecture; covered in Stage 8 with a checklist. |
| 14 | **Supabase Free projects pause after a week of inactivity.** | Low | Fine for development; use Pro for real use. |

## Decisions needed from you

| # | Decision | When | My recommendation |
|---|---|---|---|
| D1 | **Where the code lives.** No ASCEND repository exists; the attached ones are Beacon (Swift) and Hex-war (game). | **Before Stage 2** | Create an empty private GitHub repo `Oca-jamaica/ascend`; I'll attach it and push Stage 1 there. |
| D2 | Monetisation (free, one-off, subscription). Determines whether "Subscription management" exists. | Before Stage 8 | Defer; build for free personal use first. |
| D3 | AI model and budget. Default is `claude-opus-5-5` ($4 / $20 per million input/output tokens). | Before Stage 6 | Keep the default and measure real usage; cheaper models can be set per route if you choose. You will need an Anthropic API key stored as a Supabase secret. |
| D4 | Assistant loop hosting: Anthropic Managed Agents vs our own Messages API loop. | Stage 6 | Our own loop, for the privacy reasons in `02-architecture.md`. |
| D5 | Accounts you'll need: Supabase (free to start), Expo/EAS (free), Apple Developer ($99/yr) and Google Play ($25 once) for store builds. | Supabase before Stage 2; stores before Stage 8 | — |
