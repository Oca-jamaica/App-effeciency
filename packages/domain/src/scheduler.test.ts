import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SCHEDULER_PREFS,
  findFreeSlot,
  planDay,
  type ExistingBlock,
  type FixedEvent,
  type PlanInput,
  type PlanResult,
  type SchedulableHabit,
  type SchedulableTask,
} from './scheduler.ts';
import { MINUTE, addDays, localToUtc, utcToLocalMinutes } from './time.ts';

const TZ = 'Europe/London';
const DATE = '2026-11-17';
const at = (h: number, m = 0, date = DATE, tz = TZ) => localToUtc(date, h * 60 + m, tz);

function task(id: string, over: Partial<SchedulableTask> = {}): SchedulableTask {
  return {
    id,
    title: `Task ${id}`,
    priority: 3,
    status: 'planned',
    dueDate: null,
    doDate: null,
    estimatedMinutes: 60,
    recordedMinutes: 0,
    splittable: false,
    minChunkMinutes: 25,
    preferredWindow: 'any',
    goalRank: null,
    milestoneDeadline: null,
    contextWindow: null,
    createdAt: '2026-11-01T00:00:00Z',
    ...over,
  };
}

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    date: DATE,
    timeZone: TZ,
    now: at(6),
    prefs: { ...DEFAULT_SCHEDULER_PREFS },
    windows: [],
    events: [],
    blocks: [],
    tasks: [],
    habits: [],
    ...over,
  };
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/** The invariants from docs/04-scheduler.md, checked on every plan the tests produce. */
function assertInvariants(inp: PlanInput, plan: PlanResult): void {
  const dayStart = localToUtc(inp.date, inp.prefs.dayStartMinutes, inp.timeZone);
  const dayEnd = localToUtc(inp.date, inp.prefs.dayEndMinutes, inp.timeZone);
  const placed = plan.blocks;
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i]!;
    assert.ok(a.end > a.start, 'positive length');
    assert.ok(a.start >= dayStart && a.end <= dayEnd, `inside day: ${a.title}`);
    assert.ok(a.start >= Math.floor(inp.now / (5 * MINUTE)) * 5 * MINUTE, 'not in the past');
    for (let j = i + 1; j < placed.length; j++) assert.ok(!overlaps(a, placed[j]!), `no overlap: ${a.title} / ${placed[j]!.title}`);
    for (const e of inp.events) if (e.busy) assert.ok(!overlaps(a, e), `avoids event ${e.title}`);
    for (const k of plan.kept) assert.ok(!overlaps(a, k), `avoids kept block ${k.title}`);
  }
  // Kept blocks are returned untouched.
  for (const k of plan.kept) assert.deepEqual(k, inp.blocks.find((b) => b.id === k.id));
  // Focus budget respected.
  const taskMinutes = placed.filter((b) => b.kind === 'task').reduce((s, b) => s + (b.end - b.start) / MINUTE, 0);
  assert.ok(taskMinutes <= plan.metrics.focusBudgetMinutes + 0.001, 'focus budget');
  // Every candidate task is either placed in full or reported.
  for (const t of inp.tasks) {
    if (t.doDate && t.doDate > inp.date) continue;
    const scheduled = placed.filter((b) => b.taskId === t.id).reduce((s, b) => s + (b.end - b.start) / MINUTE, 0);
    const reported = plan.unscheduled.find((u) => u.id === t.id);
    const need = (t.estimatedMinutes ?? inp.prefs.defaultTaskMinutes) - t.recordedMinutes;
    if (need > 0) assert.ok(reported || scheduled >= need, `task ${t.id} placed or reported`);
  }
  // Pacing: any continuous work run that the scheduler added to stays within breakAfter. Runs made only
  // of the user's own events/blocks are theirs to keep; the scheduler must not extend them.
  const work = [
    ...placed.filter((b) => b.kind === 'task').map((b) => ({ start: b.start, end: b.end, placed: true })),
    ...inp.events
      .filter((e) => e.kind === 'work' || e.kind === 'class')
      .map((e) => ({ start: e.start, end: e.end, placed: false })),
    ...plan.kept
      .filter((b) => b.kind === 'task' && b.status !== 'skipped' && b.status !== 'unplanned')
      .map((b) => ({ start: b.start, end: b.end, placed: false })),
  ].sort((a, b) => a.start - b.start);
  const runsFound: { start: number; end: number; placed: boolean }[] = [];
  for (const w of work) {
    const last = runsFound[runsFound.length - 1];
    if (last && w.start - last.end < inp.prefs.breakMinutes * MINUTE) {
      last.end = Math.max(last.end, w.end);
      last.placed ||= w.placed;
    } else runsFound.push({ ...w });
  }
  for (const r of runsFound) {
    if (!r.placed) continue;
    const len = (r.end - r.start) / MINUTE;
    assert.ok(len <= inp.prefs.breakAfterMinutes, `run of ${len}m exceeds pacing`);
  }
}

test('places tasks around a fixed commitment, never on it', () => {
  const events: FixedEvent[] = [
    { id: 'e1', title: 'School', start: at(8, 30), end: at(15, 30), busy: true, kind: 'class' },
  ];
  const inp = input({ events, tasks: [task('a', { estimatedMinutes: 60, priority: 1 })] });
  const plan = planDay(inp);
  assertInvariants(inp, plan);
  const block = plan.blocks.find((b) => b.taskId === 'a')!;
  assert.ok(block.start >= at(15, 40) || block.end <= at(8, 20), 'outside school + buffer');
});

test('higher priority and urgent work goes first; reasons are explained', () => {
  const inp = input({
    tasks: [
      task('low', { priority: 4, estimatedMinutes: 30 }),
      task('urgent', { priority: 2, dueDate: DATE, estimatedMinutes: 30 }),
      task('goal1', { priority: 3, goalRank: 1, goalTitle: 'Economics', estimatedMinutes: 30 }),
    ],
  });
  const plan = planDay(inp);
  assertInvariants(inp, plan);
  const order = plan.blocks.filter((b) => b.kind === 'task').map((b) => b.taskId);
  assert.deepEqual(order, ['urgent', 'goal1', 'low']);
  assert.match(plan.blocks[0]!.reason, /P2 · due today/);
  assert.match(plan.blocks[1]!.reason, /Goal #1 Economics/);
});

test('respects locked and manual blocks exactly', () => {
  const locked: ExistingBlock = {
    id: 'b1', start: at(9), end: at(11), kind: 'task', taskId: 'x', habitId: null, title: 'Locked revision',
    origin: 'auto', isLocked: true, status: 'planned',
  };
  const manual: ExistingBlock = {
    id: 'b2', start: at(13), end: at(14), kind: 'custom', taskId: null, habitId: null, title: 'Lunch with Sam',
    origin: 'manual', isLocked: false, status: 'planned',
  };
  const inp = input({ blocks: [locked, manual], tasks: [task('a', { estimatedMinutes: 120, splittable: true })] });
  const plan = planDay(inp);
  assertInvariants(inp, plan);
  assert.equal(plan.kept.length, 2);
});

test('re-planning replaces only automatic, unlocked, future blocks — and keeps their slots when valid', () => {
  const first = planDay(input({ tasks: [task('a'), task('b')] }));
  const asBlocks: ExistingBlock[] = first.blocks.map((b, i) => ({
    id: `p${i}`, start: b.start, end: b.end, kind: b.kind, taskId: b.taskId, habitId: b.habitId, title: b.title,
    origin: 'auto', isLocked: false, status: 'planned',
  }));
  // Adding a lower-priority task must not reshuffle existing placements.
  const second = planDay(input({ blocks: asBlocks, tasks: [task('a'), task('b'), task('c', { priority: 4 })] }));
  for (const b of first.blocks) {
    const again = second.blocks.find((x) => x.taskId === b.taskId);
    assert.equal(again?.start, b.start, `task ${b.taskId} kept its slot`);
  }
  // Same input → identical plan (determinism).
  assert.deepEqual(planDay(input({ tasks: [task('a'), task('b')] })), first);
});

test('protects free time and stops at the focus limit, reporting what did not fit', () => {
  const prefs = { ...DEFAULT_SCHEDULER_PREFS, maxFocusMinutesPerDay: 120 };
  const tasks = Array.from({ length: 6 }, (_, i) => task(`t${i}`, { estimatedMinutes: 60 }));
  const inp = input({ prefs, tasks });
  const plan = planDay(inp);
  assertInvariants(inp, plan);
  assert.equal(plan.metrics.focusMinutes, 120);
  assert.equal(plan.unscheduled.filter((u) => u.kind === 'task').length, 4);
  assert.ok(plan.unscheduled.every((u) => u.reason === 'day_full'));
  assert.ok(plan.metrics.freeMinutesKept >= prefs.minFreeMinutesPerDay);
});

test('inserts breaks so continuous work never exceeds the limit', () => {
  const prefs = { ...DEFAULT_SCHEDULER_PREFS, dayStartMinutes: 9 * 60, dayEndMinutes: 13 * 60, minFreeMinutesPerDay: 0 };
  const inp = input({ prefs, tasks: [task('a', { estimatedMinutes: 180, splittable: true })] });
  const plan = planDay(inp);
  assertInvariants(inp, plan);
  assert.ok(plan.blocks.some((b) => b.kind === 'break'), 'labelled break');
  assert.equal(plan.blocks.filter((b) => b.kind === 'task').reduce((s, b) => s + (b.end - b.start) / MINUTE, 0), 180);
});

test('habits go to their preferred time, then their window', () => {
  const habits: SchedulableHabit[] = [
    { id: 'h1', name: 'Read', durationMinutes: 20, preferredWindow: 'evening', preferredTimeMinutes: 21 * 60, rank: 'a0' },
    { id: 'h2', name: 'Stretch', durationMinutes: 10, preferredWindow: 'morning', preferredTimeMinutes: null, rank: 'a1' },
    { id: 'h3', name: 'Plan tomorrow', durationMinutes: null, preferredWindow: 'any', preferredTimeMinutes: null, rank: 'a2' },
  ];
  const inp = input({ habits });
  const plan = planDay(inp);
  assertInvariants(inp, plan);
  const read = plan.blocks.find((b) => b.habitId === 'h1')!;
  assert.equal(utcToLocalMinutes(read.start, TZ), 21 * 60);
  const stretch = plan.blocks.find((b) => b.habitId === 'h2')!;
  assert.ok(utcToLocalMinutes(stretch.start, TZ) < 12 * 60);
  assert.deepEqual(plan.untimedHabitIds, ['h3']);
});

test('study tasks prefer study hours', () => {
  const inp = input({
    windows: [{ weekday: 2, startMinutes: 16 * 60, endMinutes: 19 * 60, kind: 'study' }],
    tasks: [task('rev', { contextWindow: 'study', estimatedMinutes: 60 })],
  });
  const plan = planDay(inp);
  const b = plan.blocks.find((x) => x.taskId === 'rev')!;
  assert.equal(utcToLocalMinutes(b.start, TZ), 16 * 60);
  assert.match(b.reason, /study hours/);
});

test('warns early when a deadline is at risk and pulls that work forward', () => {
  const busy: FixedEvent[] = [];
  for (let i = 1; i < 4; i++) {
    const d = addDays(DATE, i);
    busy.push({ id: `w${i}`, title: 'Work', start: at(7, 0, d), end: at(21, 0, d), busy: true, kind: 'work' });
  }
  const inp = input({
    events: busy,
    tasks: [
      task('essay', { estimatedMinutes: 600, splittable: true, dueDate: addDays(DATE, 3), priority: 3 }),
      task('other', { estimatedMinutes: 60, priority: 2 }),
    ],
  });
  const plan = planDay(inp);
  assertInvariants(inp, plan);
  const w = plan.warnings.find((x) => x.code === 'deadline_at_risk');
  assert.ok(w, 'warning present');
  assert.deepEqual(w.taskIds, ['essay']);
  assert.equal(plan.blocks.find((b) => b.kind === 'task')!.taskId, 'essay', 'at-risk work first');
});

test('overload today is reported, never silently dropped', () => {
  const prefs = { ...DEFAULT_SCHEDULER_PREFS, maxFocusMinutesPerDay: 60 };
  const inp = input({ prefs, tasks: [task('a', { dueDate: DATE, estimatedMinutes: 90 }), task('b', { doDate: DATE })] });
  const plan = planDay(inp);
  assert.ok(plan.warnings.some((w) => w.code === 'overload_today'));
  assert.ok(plan.unscheduled.length >= 1);
});

test('tasks pinned to a later day are left alone; day over is reported', () => {
  const plan = planDay(input({ tasks: [task('later', { doDate: addDays(DATE, 2) })] }));
  assert.equal(plan.blocks.length, 0);
  assert.equal(plan.unscheduled.length, 0);
  const late = planDay(input({ now: at(23), tasks: [task('a')] }));
  assert.ok(late.warnings.some((w) => w.code === 'day_over'));
  assert.equal(late.unscheduled[0]?.reason, 'outside_day');
});

test('next free slot for missed work', () => {
  const inp = input({ now: at(10), events: [{ id: 'e', title: 'Class', start: at(10), end: at(12), busy: true, kind: 'class' }] });
  const plan = planDay(inp);
  const slot = findFreeSlot(inp, plan, 45);
  assert.ok(slot);
  assert.ok(slot.start >= at(12, 10));
});

test('DST days in several zones keep all invariants', () => {
  const cases: [string, string][] = [
    ['Europe/London', '2026-03-29'],
    ['Europe/London', '2026-10-25'],
    ['America/New_York', '2026-03-08'],
    ['America/New_York', '2026-11-01'],
    ['Australia/Sydney', '2026-04-05'],
  ];
  for (const [tz, date] of cases) {
    const inp = input({
      date,
      timeZone: tz,
      now: localToUtc(date, 0, tz),
      prefs: { ...DEFAULT_SCHEDULER_PREFS, dayStartMinutes: 0, dayEndMinutes: 24 * 60, minFreeMinutesPerDay: 0 },
      tasks: Array.from({ length: 5 }, (_, i) => task(`t${i}`, { estimatedMinutes: 75, splittable: i % 2 === 0 })),
    });
    const plan = planDay(inp);
    assertInvariants(inp, plan);
  }
});

// Small deterministic PRNG so property tests are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('property: 300 random days satisfy every invariant', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
    const nowH = 6 + Math.floor(r() * 10);
    const events: FixedEvent[] = Array.from({ length: Math.floor(r() * 4) }, (_, i) => {
      const s = 7 * 60 + Math.floor(r() * 12 * 12) * 5;
      return {
        id: `e${i}`, title: `Event ${i}`, start: at(0, s), end: at(0, s + 30 + Math.floor(r() * 18) * 10),
        busy: r() > 0.1, kind: pick(['event', 'class', 'work', 'social']),
      };
    });
    const blocks: ExistingBlock[] = Array.from({ length: Math.floor(r() * 3) }, (_, i) => {
      const s = 8 * 60 + Math.floor(r() * 12 * 12) * 5;
      return {
        id: `b${i}`, start: at(0, s), end: at(0, s + 30 + Math.floor(r() * 6) * 10), kind: 'task' as const,
        taskId: `k${i}`, habitId: null, title: `Block ${i}`, origin: pick(['auto', 'manual'] as const),
        isLocked: r() > 0.5, status: pick(['planned', 'done', 'in_progress'] as const),
      };
    });
    const tasks = Array.from({ length: Math.floor(r() * 12) }, (_, i) =>
      task(`t${i}`, {
        priority: 1 + Math.floor(r() * 4),
        estimatedMinutes: r() > 0.1 ? 15 + Math.floor(r() * 24) * 5 : null,
        splittable: r() > 0.5,
        dueDate: r() > 0.5 ? addDays(DATE, Math.floor(r() * 10) - 2) : null,
        goalRank: r() > 0.5 ? 1 + Math.floor(r() * 5) : null,
        preferredWindow: pick(['any', 'morning', 'afternoon', 'evening', 'study'] as const),
        recordedMinutes: r() > 0.8 ? 20 : 0,
      }),
    );
    const habits: SchedulableHabit[] = Array.from({ length: Math.floor(r() * 4) }, (_, i) => ({
      id: `h${i}`, name: `Habit ${i}`, durationMinutes: r() > 0.2 ? 10 + Math.floor(r() * 5) * 10 : null,
      preferredWindow: pick(['any', 'morning', 'evening'] as const),
      preferredTimeMinutes: r() > 0.6 ? (7 + Math.floor(r() * 14)) * 60 : null, rank: `a${i}`,
    }));
    const inp = input({
      now: at(nowH, Math.floor(r() * 12) * 5),
      events,
      blocks,
      tasks,
      habits,
      windows: [{ weekday: 2, startMinutes: 16 * 60, endMinutes: 19 * 60, kind: 'study' }],
      prefs: {
        ...DEFAULT_SCHEDULER_PREFS,
        maxFocusMinutesPerDay: 120 + Math.floor(r() * 8) * 30,
        minFreeMinutesPerDay: Math.floor(r() * 5) * 30,
      },
    });
    const plan = planDay(inp);
    assertInvariants(inp, plan);
    assert.deepEqual(planDay(inp), plan, `deterministic (seed ${seed})`);
  }
});
