# 01 — Product definition

## What ASCEND is

ASCEND is a personal operating system. It is the place a person decides what
matters, turns that into concrete work, gets a realistic plan for each day, does
the work, and sees honestly how it went — then adjusts.

It is not a to-do list with extra tabs. The value comes from the connections:
a goal knows its milestones, tasks and habits; the scheduler knows the goals'
priority order; the focus timer knows which task it is serving; the weekly report
knows what was actually recorded; the AI can see all of it (with permission) and
propose changes the user approves.

**Tagline:** Become more. Every day.

## The core loop

Every module exists to serve one loop. If a feature does not strengthen a step of
this loop, it does not belong in the main interface.

```
 Capture ──► Clarify ──► Plan ──► Do ──► Record ──► Reflect ──► Adjust
 (quick     (inbox,     (auto-    (focus   (logs,     (insights,  (re-prioritise,
  capture,   goals,      scheduler, timer,   sessions,  weekly      reschedule,
  voice)     priorities) calendar)  habits)  uploads)   report)     AI proposals)
     ▲                                                                   │
     └───────────────────────────────────────────────────────────────────┘
```

## The connective model

Goals are the spine. Most other things hang off them, and the links are real
database relationships, not tags.

```
Goal (priority-ranked)
 ├─ Milestones ──► Tasks ──► Schedule blocks ──► Focus / study sessions ──► Time Reality
 │                  └─ Subtasks                     └─ Study timelapse videos
 ├─ Habits ──► Schedule blocks ──► Habit logs ──► Consistency
 ├─ Notes · Resources (videos, articles) · Action checklist · Progress history
 ├─ Projects / Missions ──► Stages ──► Milestones ──► Tasks
 └─ Skills (trees) ◄──► Training sessions · Learning items · Habits   (Life Graph)
```

Football example from the brief, as data:
`Goal "Become a two-footed player"` → `Skill "Weak foot" (child of "Technical")` →
`Habit "Weak-foot drills, 3×/week, 30 min"` → `Schedule block Tue 17:00` →
`Training session (skill: weak foot, rating 6/10)` → `Skill progress entry`.

## Information architecture

Five primary tabs, as specified. Each holds its own subsections; nothing is
promoted to Home unless it is needed daily.

| Tab | Subsections | Notes |
|---|---|---|
| **Home** | (single screen) Greeting & date · Today strip (tasks/habits/focus) · Now & Next · Today's schedule · Priorities · Habits due · Deadlines · Upcoming events · Daily briefing | The daily command centre. Sections are ordered by usefulness; the briefing is collapsed by default. |
| **Goals** | Goals · Habits · Projects (incl. Missions) · Skills | Goal detail has Overview, Notes, Resources, History, Connections. Life Graph is reached from any goal's Connections and from the Goals overflow menu. |
| **Planner** | Calendar · Tasks · Focus · Training · Social · Experiences · Time Reality | Scrollable segment bar. Study sessions and timelapses live inside Focus. Workouts, sport development and the training planner live inside Training. |
| **Insights** | Overview · Weekly · Audit · Balance · Achievements · Timeline · Challenges | Sunday Reset is launched from Weekly (and suggested on Home on Sundays). |
| **Profile** | Knowledge Vault · Workspace · Reading & Learning · Ideas · Daily Journal · Decision Journal · Personal Memory · Opportunities · Sleep & Recovery · Settings | A grouped list, not a segment bar — ten destinations do not fit in tabs. |

**Global elements** (present on every tab root, top-right of the header):

- **Quick capture (+)** — one sheet, one text field, type chips (Task, Goal,
  Habit, Event, Idea, Note, Reminder). Natural-language shortcuts are parsed
  deterministically (`tomorrow 3pm`, `30m`, `!p1`, `#economics`). Saves offline,
  instantly. A microphone button adds voice capture (Stage 6).
- **ASCEND AI** — a small header icon that opens the assistant with the current
  screen as context ("Ask about this goal"). No floating glowing orb.
- **Sync status** — a quiet indicator that appears only when something needs
  attention (offline, syncing a backlog, or a sync error).

## Product decisions (made, with reasons)

These are the judgement calls I've made so the brief turns into a buildable product.
None of them removes anything the brief asks for. If you disagree with one, it's
cheap to change now and expensive later.

1. **Missions are a kind of Project.** Both have an objective, deadline,
   milestones, tasks, progress and a completion summary; a Mission adds stages.
   One data model (`projects.kind = 'project' | 'mission'`) and one set of
   screens, with a Missions filter. Avoids two near-identical systems drifting apart.
2. **Habits live in the Goals tab.** Habits are how most goals are actually
   achieved; putting them next to goals keeps the connection visible. They still
   appear on Home and in the Planner schedule every day they are due.
3. **One time ledger.** A study session is a focus session of kind `study`
   (timer-recorded or logged manually). Timelapse videos attach to it. This is
   what lets Time Reality and weekly reports count study time without double-counting.
4. **One resource library.** A video link saved inside a goal is a Knowledge
   Vault item linked to that goal. It shows under the goal's Resources and is
   searchable in the Vault. No duplicate link lists.
5. **Sport training plans are habits/recurring events linked to skills.**
   "Weak-foot practice 3×/week" is a habit linked to a skill and a goal. Gym
   workout plans are separate (they need exercises, sets, reps and weights).
6. **Life Timeline is derived**, not separately maintained: achievements,
   completed milestones, finished projects, completed experiences, plus manual
   "life event" entries.
7. **Life Graph on a phone is a Connections panel, not a hairball.** Every
   entity shows what it is connected to (and why), and goals get a tree view.
   A full node-link visualisation can come later if it proves useful.
8. **The inbox is not auto-scheduled.** Inbox items have not been triaged
   (no estimate, no priority). The scheduler uses `planned` and `in progress`
   tasks, plus inbox tasks that have a deadline. This keeps capture friction-free
   without polluting the plan.
9. **Calendar integration v1 reads the phone's calendars** (which already sync
   Google, iCloud and Outlook) via the OS calendar API, read-only, as fixed
   commitments. No Google OAuth, no server-side tokens. Two-way sync is a later
   enhancement.
10. **Streaks are secondary.** Habits headline a consistency percentage over 30
    and 90 days. Missing a day lowers it slightly; it never resets months of history.
11. **The AI never writes directly.** It reads (with per-area permissions) and
    produces *proposals*. Low-risk proposals (e.g. "add this task to your inbox")
    are one tap. Destructive or significant changes always need explicit approval.
    Users can opt in to auto-applying low-risk proposals.
12. **The Opportunity Engine does not invent listings.** By default it suggests
    *kinds* of opportunity plus concrete search queries. Specific opportunities
    appear only when retrieved by a server-side web search, shown with their
    source and a "check availability" label.
13. **Derived numbers are computed, not stored.** Goal progress, habit
    consistency and personal records are computed from the underlying records,
    so they can never disagree with them. The only stored aggregates are frozen
    snapshots (weekly reports) and append-only history logs.
14. **Subscription management is deferred**, not stubbed. No monetisation model
    has been decided, and the brief forbids buttons that do nothing. The Settings
    row will appear when there is a real subscription to manage.
15. **Notifications are budgeted.** Every type is individually controllable,
    there are quiet hours and a daily cap, and only habit/task reminders the
    user set are on by default.

## Non-goals

No separate wellness tracker, vision board, public feeds, public leaderboards,
competitive gamification, or notification spam. Achievements and progress are
private and understated.
