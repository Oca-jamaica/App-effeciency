# 04 — Automatic daily scheduler

The scheduler turns tasks, habits and commitments into a realistic plan for the
day. It is **deterministic**: the same inputs always produce the same plan, every
placement has a human-readable reason, and it never deletes anything or moves a
fixed commitment. AI helps *interpret* requests ("I have football at 5") by
changing the inputs, and the engine then produces the plan.

It lives in `packages/domain/scheduler` as a pure function:

```ts
planDay(input: PlanInput): PlanResult
planHorizon(input: PlanInput, days: number): HorizonResult   // look-ahead for warnings
```

It runs on the device against local data (instant, offline). Edge Functions can
also import it so the AI can call `simulate_schedule`.

## Inputs

| Input | Source |
|---|---|
| Date, user timezone, "now" | device clock + `profiles.timezone` |
| Day bounds | `user_preferences.day_start / day_end` |
| Preferred hours | `availability_windows` (work, study, training = soft; protected_free, no_scheduling = hard) |
| Fixed commitments | `calendar_events` (expanded recurrences) where `busy`, plus device-imported events |
| Existing blocks | `schedule_blocks` for the date: locked, manual, in-progress and done blocks are kept as obstacles |
| Previous plan | unlocked auto blocks from the last run, used to keep the plan stable |
| Habits | active habits that are due today (see Habit due rules), not yet logged |
| Tasks | `planned` / `in_progress` tasks (plus `inbox` with a deadline, if enabled), not blocked by `do_date` in the future |
| Goals | active goals' priority order (`rank`) |
| Capacity & pacing | `max_focus_minutes_per_day`, `max_block_minutes`, `break_after_minutes`, `break_minutes`, `buffer_minutes`, `min_free_minutes_per_day` |

## Output

```ts
interface PlanResult {
  blocks: PlannedBlock[];          // task / habit / break blocks with start, end, reason
  unscheduled: Unscheduled[];      // never dropped silently: each has a reason + suggestions
  warnings: Warning[];             // overload today, deadline at risk this week, …
  metrics: { focusMinutes, habitMinutes, breakMinutes, freeMinutesKept, capacityUsedPct };
  algorithmVersion: string;
}
```

## Algorithm

### 1. Build the free timeline

1. Start with `[day_start, day_end]` in local time (DST-safe via `@date-fns/tz`).
   For today, clip the start to "now", rounded up to 5 minutes.
2. Subtract obstacles:
   - busy events, padded by `buffer_minutes` on each side;
   - locked, manual, in-progress and done blocks;
   - `protected_free` and `no_scheduling` windows.
3. The result is an ordered list of free intervals. Intervals shorter than the
   minimum useful slot (15 min) are discarded.
4. **Capacity.** `focusBudget = min(max_focus_minutes_per_day, totalFree − min_free_minutes_per_day)`.
   This is how free time is *protected*: the scheduler stops before the day is full.

### 2. Place habits

Habits are short, user-committed and often time-sensitive, so they go first:

1. Sort: habits with a `preferred_time` first, then by narrowest preferred
   window, then by `rank`.
2. Try the exact `preferred_time`. If that is taken, try the nearest free slot
   inside the preferred window (morning 06–12, afternoon 12–17, evening 17–22,
   or user-defined).
3. If neither works, try the rest of the day.
4. If it still can't be placed, it goes to `unscheduled` with a reason
   ("No 30-minute gap in the evening").
5. Habit minutes count against the day but not against the focus budget, so
   habits never crowd out the free-time guarantee in a hidden way. The report
   shows them separately.

### 3. Score tasks

Each candidate task gets a score from components that are easy to explain:

| Component | Rule | Range |
|---|---|---|
| Priority | P1 = 40, P2 = 25, P3 = 12, P4 = 0 | 0–40 |
| Urgency | Effective due date = earliest of task due date and its milestone's deadline. Overdue = 50; due today = 45; otherwise `max(0, 40 − 6 × days_until_due)` | 0–50 |
| Deadline risk | +15 if the look-ahead (step 6) shows this task's deadline is at risk | 0–15 |
| Goal priority | Goal rank 1 = 20, rank 2 = 16, rank 3 = 12, rank 4 = 8, rank 5 = 4, below that 0 | 0–20 |
| Commitment | `do_date` = today: +30 (the user chose today); `in_progress`: +8 | 0–38 |

Ties break by earlier effective due date, then older `created_at`, then `id`.
The order is total, so the result is deterministic.

### 4. Place tasks (greedy, highest score first)

For each task, `need = estimated_minutes − minutes already recorded` (focus
sessions linked to it). The default estimate applies if there is none, and the
block is labelled "estimate assumed".

1. **Candidate slots.** First try free intervals inside the task's preferred
   window. Then try the matching availability window: academic-category tasks
   use study hours, work tasks use work hours, training uses training hours.
   Finally try any free interval.
2. **Stability.** If the previous plan placed this task in a slot that is still
   free and still valid, keep it there. A re-plan should not reshuffle the whole
   day because one task was added.
3. **Fit.**
   - Non-splittable: the earliest slot that fits all of `need`, capped at
     `max_block_minutes`. A task bigger than the cap is treated as splittable.
   - Splittable: fill chunks of at least `min_chunk_minutes` across slots, in
     order, until `need` is met or slots run out. The remainder is reported.
4. **Pacing.** A placement may not create a run of continuous work (task
   blocks, plus events of kind `work`/`class`) longer than `break_after_minutes`.
   When it would, a break of `break_minutes` is inserted first. If the break
   doesn't fit, the slot is rejected for this task.
5. **Budget.** Stop placing once `focusBudget` is used. Remaining tasks go to
   `unscheduled` with "Today is full (6h planned; your limit is 6h)".

Each placed block records a `reason`, e.g. "P1 · due tomorrow · Goal #1
Economics · in your study hours".

### 5. Detect overload today

Must-do work is anything overdue, due today, or with `do_date` = today. If its
total exceeds capacity, a warning lists:

- the shortfall;
- suggested resolutions, each precomputed by re-running the engine: move X to
  tomorrow, reduce Y's scope, drop Z to P3, or protect less free time today
  (the last only when the user explicitly asks).

### 6. Look ahead (predictive planning)

`planHorizon` runs a capacity simulation over the next 7–14 days and checks
deadline feasibility with earliest-deadline-first. For each deadline D: if
cumulative remaining work due on or before D exceeds cumulative free capacity
until D, that deadline is **at risk**. Two things follow:
- the at-risk tasks get the score bonus today, which pulls work forward;
- the user sees an early warning ("Economics essay (6h) is due Friday; about 3h
  of free time is left before then").

This is the deterministic basis for the AI's "predictive planning"; the AI only
explains it and suggests trade-offs.

## Habit due rules

| `frequency_kind` | Due on date *d* when |
|---|---|
| `daily` | `d ≥ start_date` (and not paused, not past `end_date`) |
| `weekdays` | weekday(*d*) ∈ `days_of_week` |
| `times_per_week` (N) | fewer than N logs so far this week, and either *d* is a preferred day, or the remaining days in the week ≤ remaining needed, or ≥ ⌊7/N⌋−1 days have passed since the last log. This spreads sessions out. |
| `times_per_month` (N) | the same rule over the month |
| `every_n_days` (n) | ≥ n days since the last `done` log (anchored to the actual completion, which is forgiving), or since `start_date` |

**Consistency.** `done (partial = 0.5) ÷ due occurrences` over 30 and 90 days.
Skips marked as planned rest are excluded from both sides. Streaks are shown as
"current run" and "best run", secondary to consistency. A missed day lowers the
number slightly and never wipes history.

## Re-planning

The engine re-runs when:
- a task is created, edited, completed or deleted;
- an event changes;
- a block is moved or locked;
- a block is marked missed;
- the day starts;
- the user taps **Replan**.

Re-planning only replaces future, unlocked, `origin = 'auto'` blocks.
Locked, manual, in-progress, done and past blocks are untouched. Fixed
commitments are never moved.

## User control

| Action | Effect |
|---|---|
| Drag a block | It becomes `origin = manual` at the new time; the rest of the day re-flows around it. |
| Lock a block | It is never moved by re-plans or by AI proposals without approval. |
| Resize a block | Asks "Update this task's estimate too?" and updates `estimated_minutes` if confirmed. |
| Unplan a block | The block is removed from today. The task is untouched and listed under "Not scheduled today". |
| Preferred hours / habit days | Edited in Settings and on the habit; feed straight into the inputs. |

## Missed and unfinished work

When a block's end passes without completion, it becomes `missed` the next time
the app evaluates the day. Home shows a calm card ("Not done: Economics essay
— 45 min"), never a red failure state, with options computed by the engine:

1. **Next free slot today** (shows the time, e.g. 16:30).
2. **Tomorrow** at its best slot.
3. **Shorten** — reduce the estimate (e.g. to 25 min) and keep the remainder as a follow-up.
4. **Break it down** — split into subtasks (manually, or with an AI suggestion to approve).
5. **Unplan** — take it off the plan; the task remains.
6. **Not relevant any more** — cancel the task (with confirmation). Never automatic.

Partially done work (`partial`, with `actual_minutes`) reduces `need` for the
next placement. All of this is written to `task_events` (`rescheduled`,
`estimate_changed`, …), which feeds the weekly "postponed" count.

## Invariants (property-tested)

1. No two placed blocks overlap, and no block overlaps an obstacle.
2. Locked blocks, manual blocks and fixed events are byte-for-byte unchanged in the output.
3. All blocks lie within the day bounds and outside hard-excluded windows.
4. Planned focus minutes ≤ focus budget; free time ≥ `min_free_minutes_per_day`
   unless the user overrode it.
5. No continuous work run exceeds `break_after_minutes` without a break.
6. Every candidate task and due habit appears in exactly one of `blocks` or `unscheduled`.
7. Same input → identical output (no randomness, total ordering).
8. Correct on DST transition days (23- and 25-hour days) in several timezones.
9. Re-planning with an unchanged input reproduces the previous plan (stability).

## Performance

A few hundred tasks and a day of 5-minute granularity: placement is
O(tasks × intervals), well under 20 ms on a phone. The horizon simulation is
run only on change, never per frame.
