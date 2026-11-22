import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimatedOneRepMax, formatClock, learningProgress, nextBirthday, pauseTimer, personalRecords, projectProgress, recordsBrokenBy, resumeTimer,
  sleepMinutes, sleepSummary, stopTimer, suggestedBreakMinutes, timerElapsedMs, timerRemainingMs, upcomingBirthdays, type SetRecord, type TimerState,
} from './development.ts';

test('focus timer: pauses are excluded and survive a restart', () => {
  const t0 = 1_000_000;
  let t: TimerState = { sessionId: 's', startedAt: t0, pausedAt: null, pausedMs: 0, plannedMinutes: 25 };
  assert.equal(timerElapsedMs(t, t0 + 10 * 60_000), 10 * 60_000);
  t = pauseTimer(t, t0 + 10 * 60_000);
  assert.equal(timerElapsedMs(t, t0 + 15 * 60_000), 10 * 60_000, 'frozen while paused');
  t = pauseTimer(t, t0 + 12 * 60_000);
  assert.equal(t.pausedAt, t0 + 10 * 60_000, 'pausing twice keeps the first pause');
  // The app restarts: state is plain data, so it resumes exactly.
  t = JSON.parse(JSON.stringify(t)) as TimerState;
  t = resumeTimer(t, t0 + 15 * 60_000);
  assert.equal(timerElapsedMs(t, t0 + 20 * 60_000), 15 * 60_000);
  assert.equal(timerRemainingMs(t, t0 + 20 * 60_000), 10 * 60_000);
  const stopped = stopTimer(pauseTimer(t, t0 + 30 * 60_000), t0 + 32 * 60_000);
  assert.deepEqual(stopped, { durationSeconds: 25 * 60, pauseSeconds: 7 * 60, endedAt: t0 + 32 * 60_000 });
  assert.equal(formatClock(25 * 60_000 + 5000), '25:05');
  assert.equal(formatClock(3_725_000), '1:02:05');
  assert.equal(suggestedBreakMinutes(25), 5);
  assert.equal(suggestedBreakMinutes(90), 18);
});

test('personal records from working sets only', () => {
  const s = (sessionId: string, reps: number, weight: number, isWarmup = false): SetRecord => ({ exerciseId: 'sq', sessionId, reps, weight, isWarmup, completedAt: '2026-11-20T10:00:00Z' });
  const sets = [s('a', 10, 60, true), s('a', 5, 100), s('a', 5, 100), s('b', 3, 110), s('b', 8, 80)];
  const pr = personalRecords(sets);
  assert.equal(pr.heaviest?.weight, 110);
  assert.equal(pr.bestOneRepMax?.value, estimatedOneRepMax(110, 3));
  assert.equal(pr.mostReps?.reps, 8, 'warm-up reps ignored');
  assert.equal(pr.bestSessionVolume?.sessionId, 'a', '1000 kg vs 970 kg');
  assert.deepEqual(recordsBrokenBy(sets, s('c', 2, 115)), ['heaviest', 'one_rep_max']);
  assert.deepEqual(recordsBrokenBy(sets, s('c', 5, 60, true)), []);
  assert.equal(estimatedOneRepMax(100, 20), null, 'too many reps to estimate');
});

test('birthdays: next occurrence, leap years and ages', () => {
  assert.equal(nextBirthday(3, 14, '2026-11-22'), '2027-03-14');
  assert.equal(nextBirthday(11, 22, '2026-11-22'), '2026-11-22');
  assert.equal(nextBirthday(2, 29, '2026-11-22'), '2027-02-28');
  assert.equal(nextBirthday(2, 29, '2027-11-22'), '2028-02-29');
  const list = upcomingBirthdays(
    [
      { birthdayMonth: 12, birthdayDay: 1, birthYear: 2008, name: 'A' },
      { birthdayMonth: 11, birthdayDay: 25, birthYear: null, name: 'B' },
      { birthdayMonth: 6, birthdayDay: 1, birthYear: null, name: 'C' },
      { birthdayMonth: null, birthdayDay: null, birthYear: null, name: 'D' },
    ],
    '2026-11-22',
    30,
  );
  assert.deepEqual(list.map((x) => [x.person.name, x.inDays, x.turning]), [['B', 3, null], ['A', 9, 18]]);
});

test('project progress prefers milestones, then tasks', () => {
  assert.equal(projectProgress({ milestones: [{ status: 'done' }, { status: 'open' }], tasks: [{ status: 'completed' }], stages: [{ status: 'done' }, { status: 'open' }] }).ratio, 0.5);
  const t = projectProgress({ milestones: [], tasks: [{ status: 'completed' }, { status: 'planned' }, { status: 'cancelled' }], stages: [] });
  assert.equal(t.ratio, 0.5);
  assert.equal(t.label, '1 of 2 tasks');
  assert.equal(projectProgress({ milestones: [], tasks: [], stages: [] }).ratio, null);
});

test('learning progress and sleep', () => {
  assert.deepEqual(learningProgress(120, 400, 'pages'), { ratio: 0.3, label: '120 of 400 pages' });
  assert.deepEqual(learningProgress(45, null, 'percent'), { ratio: 0.45, label: '45%' });
  assert.equal(sleepMinutes('23:30', '07:15'), 465);
  assert.equal(sleepMinutes('01:00', '08:00'), 420);
  const sum = sleepSummary(
    [
      { sleepDate: '2026-11-22', minutes: 480, energy: 4 },
      { sleepDate: '2026-11-21', minutes: 360, energy: 2 },
      { sleepDate: '2026-11-20', minutes: 450, energy: 5 },
      { sleepDate: '2026-10-01', minutes: 200, energy: 1 },
    ],
    '2026-11-22',
  );
  assert.equal(sum.nights, 3);
  assert.equal(sum.averageMinutes, 430);
  assert.equal(sum.energyDifferenceWithSevenHours, 2.5);
});
