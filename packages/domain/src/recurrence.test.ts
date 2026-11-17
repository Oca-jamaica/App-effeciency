import test from 'node:test';
import assert from 'node:assert/strict';
import { describeRule, formatRRule, nextOccurrence, occurrencesBetween, parseRRule } from './recurrence.ts';

test('parse and format round-trip', () => {
  const r = parseRRule('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=10');
  assert.deepEqual(r, { freq: 'WEEKLY', interval: 2, byDay: [1, 4], count: 10 });
  assert.equal(formatRRule(r), 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=10');
  assert.equal(parseRRule('FREQ=DAILY;UNTIL=20261231T000000Z').until, '2026-12-31');
  assert.throws(() => parseRRule('FREQ=HOURLY'));
  assert.throws(() => parseRRule('FREQ=WEEKLY;BYDAY=XX'));
});

test('daily with interval', () => {
  const r = parseRRule('FREQ=DAILY;INTERVAL=3');
  assert.deepEqual(occurrencesBetween(r, '2026-11-01', '2026-11-01', '2026-11-10'), [
    '2026-11-01',
    '2026-11-04',
    '2026-11-07',
    '2026-11-10',
  ]);
});

test('weekly on several days, window in the middle', () => {
  const r = parseRRule('FREQ=WEEKLY;BYDAY=MO,WE,FR');
  assert.deepEqual(occurrencesBetween(r, '2026-11-02', '2026-11-10', '2026-11-16'), [
    '2026-11-11',
    '2026-11-13',
    '2026-11-16',
  ]);
});

test('count and exdates', () => {
  const r = parseRRule('FREQ=DAILY;COUNT=3');
  assert.deepEqual(occurrencesBetween(r, '2026-11-01', '2026-11-01', '2026-12-01', ['2026-11-02']), [
    '2026-11-01',
    '2026-11-03',
  ]);
});

test('monthly skips months without the day', () => {
  const r = parseRRule('FREQ=MONTHLY');
  assert.deepEqual(occurrencesBetween(r, '2026-01-31', '2026-01-01', '2026-05-31'), [
    '2026-01-31',
    '2026-03-31',
    '2026-05-31',
  ]);
});

test('next occurrence and description', () => {
  const r = parseRRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  assert.equal(nextOccurrence(r, '2026-11-02', '2026-11-13'), '2026-11-16');
  assert.equal(describeRule(r), 'Every weekday');
  assert.equal(describeRule(parseRRule('FREQ=DAILY')), 'Daily');
});
