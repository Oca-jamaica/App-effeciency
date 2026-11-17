import test from 'node:test';
import assert from 'node:assert/strict';
import { consistency, describeFrequency, isHabitDue, runs, validateHabitRule, type HabitLogEntry, type HabitRule } from './habits.ts';
import { addDays, enumerateDates } from './time.ts';

const base: HabitRule = {
  frequencyKind: 'daily',
  daysOfWeek: null,
  timesPerPeriod: null,
  intervalDays: null,
  startDate: '2026-11-02',
  endDate: null,
  status: 'active',
  pausedUntil: null,
};

const done = (...dates: string[]): HabitLogEntry[] => dates.map((logDate) => ({ logDate, status: 'done' as const }));

test('daily habit is due until logged', () => {
  assert.equal(isHabitDue(base, '2026-11-17', []), true);
  assert.equal(isHabitDue(base, '2026-11-17', done('2026-11-17')), false);
  assert.equal(isHabitDue(base, '2026-11-01', []), false, 'before start');
  assert.equal(isHabitDue({ ...base, status: 'paused' }, '2026-11-17', []), false);
  assert.equal(isHabitDue({ ...base, status: 'paused', pausedUntil: '2026-11-16' }, '2026-11-17', []), true, 'pause ended');
  assert.equal(isHabitDue({ ...base, status: 'archived' }, '2026-11-17', []), false);
});

test('specific weekdays', () => {
  const r: HabitRule = { ...base, frequencyKind: 'weekdays', daysOfWeek: [1, 3, 5] };
  assert.equal(isHabitDue(r, '2026-11-16', []), true); // Monday
  assert.equal(isHabitDue(r, '2026-11-17', []), false); // Tuesday
});

test('3× a week spreads sessions and catches up at the end of the week', () => {
  const r: HabitRule = { ...base, frequencyKind: 'times_per_week', timesPerPeriod: 3 };
  // Week of Mon 16 Nov: nothing done yet → due Monday.
  assert.equal(isHabitDue(r, '2026-11-16', []), true);
  // Done Monday → not due Tuesday (gap of 2), due Wednesday.
  assert.equal(isHabitDue(r, '2026-11-17', done('2026-11-16')), false);
  assert.equal(isHabitDue(r, '2026-11-18', done('2026-11-16')), true);
  // Target met → not due.
  assert.equal(isHabitDue(r, '2026-11-21', done('2026-11-16', '2026-11-18', '2026-11-20')), false);
  // Only one done by Saturday: needs 2 in 2 remaining days → due.
  assert.equal(isHabitDue(r, '2026-11-21', done('2026-11-20')), true);
});

test('times per week with preferred days', () => {
  const r: HabitRule = { ...base, frequencyKind: 'times_per_week', timesPerPeriod: 2, daysOfWeek: [2, 4] };
  assert.equal(isHabitDue(r, '2026-11-16', []), false); // Monday not preferred
  assert.equal(isHabitDue(r, '2026-11-17', []), true); // Tuesday
});

test('every N days anchors to last completion', () => {
  const r: HabitRule = { ...base, frequencyKind: 'every_n_days', intervalDays: 3 };
  assert.equal(isHabitDue(r, '2026-11-17', done('2026-11-15')), false);
  assert.equal(isHabitDue(r, '2026-11-18', done('2026-11-15')), true);
});

test('validation', () => {
  assert.equal(validateHabitRule({ ...base, frequencyKind: 'weekdays', daysOfWeek: [] }), 'Choose at least one day.');
  assert.equal(validateHabitRule({ ...base, frequencyKind: 'times_per_week', timesPerPeriod: 9 }), 'Choose 1–7 times per week.');
  assert.equal(validateHabitRule(base), null);
});

test('one missed day lowers consistency slightly instead of erasing history', () => {
  const r: HabitRule = { ...base, startDate: '2026-08-01' };
  const all = enumerateDates('2026-08-01', '2026-11-16').filter((d) => d !== '2026-11-10');
  const stats = consistency(r, done(...all), '2026-11-17', 30);
  assert.ok(stats.rate !== null && stats.rate > 0.95 && stats.rate < 1, `rate ${stats.rate}`);
  // Today not yet logged: no artificial dip.
  assert.equal(stats.windowDays, 29);
  const run = runs(r, done(...all), '2026-11-17');
  assert.equal(run.current, 6);
  assert.ok(run.best >= 100);
});

test('skips are planned rest and are excluded', () => {
  const logs: HabitLogEntry[] = [
    ...done('2026-11-10', '2026-11-11', '2026-11-12'),
    { logDate: '2026-11-13', status: 'skipped' },
    ...done('2026-11-14', '2026-11-15', '2026-11-16'),
  ];
  const r: HabitRule = { ...base, startDate: '2026-11-10' };
  const stats = consistency(r, logs, '2026-11-17', 30);
  assert.equal(stats.rate, 1);
  assert.equal(runs(r, logs, '2026-11-17').current, 6);
});

test('weekly target runs', () => {
  const r: HabitRule = { ...base, frequencyKind: 'times_per_week', timesPerPeriod: 2, startDate: '2026-10-26' };
  const logs = done('2026-10-27', '2026-10-29', '2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12', '2026-11-16');
  const result = runs(r, logs, '2026-11-17');
  assert.equal(result.unit, 'weeks');
  assert.equal(result.current, 3);
});

test('descriptions', () => {
  assert.equal(describeFrequency({ ...base, frequencyKind: 'weekdays', daysOfWeek: [1, 2, 3, 4, 5] }), 'Weekdays');
  assert.equal(describeFrequency({ ...base, frequencyKind: 'times_per_week', timesPerPeriod: 3 }), '3× a week');
  void addDays;
});
