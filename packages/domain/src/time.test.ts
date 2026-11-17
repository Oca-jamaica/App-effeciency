import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  addMonths,
  diffDays,
  localToUtc,
  parseTime,
  formatTime,
  startOfWeek,
  tzOffsetMinutes,
  utcToLocalDate,
  utcToLocalMinutes,
  weekday,
  isValidLocalDate,
} from './time.ts';

test('calendar arithmetic', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(diffDays('2026-11-17', '2026-11-24'), 7);
  assert.equal(weekday('2026-11-17'), 2); // Tuesday
  assert.equal(startOfWeek('2026-11-17', 1), '2026-11-16');
  assert.equal(startOfWeek('2026-11-15', 1), '2026-11-09'); // Sunday belongs to previous Monday week
  assert.equal(isValidLocalDate('2026-02-30'), false);
  assert.equal(parseTime('07:30'), 450);
  assert.equal(formatTime(450), '07:30');
});

test('local ↔ UTC round-trips in several zones', () => {
  for (const tz of ['Europe/London', 'America/New_York', 'Asia/Kolkata', 'Australia/Sydney', 'UTC']) {
    for (const date of ['2026-01-15', '2026-07-15']) {
      for (const minutes of [0, 7 * 60 + 30, 23 * 60 + 55]) {
        const ms = localToUtc(date, minutes, tz);
        assert.equal(utcToLocalDate(ms, tz), date, `${tz} ${date} ${minutes}`);
        assert.equal(utcToLocalMinutes(ms, tz), minutes, `${tz} ${date} ${minutes}`);
      }
    }
  }
});

test('DST: London spring-forward day is 23 hours, autumn day is 25 hours', () => {
  const tz = 'Europe/London';
  const spring = localToUtc('2026-03-30', 0, tz) - localToUtc('2026-03-29', 0, tz);
  const autumn = localToUtc('2026-10-26', 0, tz) - localToUtc('2026-10-25', 0, tz);
  assert.equal(spring / 3600_000, 23);
  assert.equal(autumn / 3600_000, 25);
  // 01:30 does not exist on 29 March 2026 in London; it resolves forward to 02:30 BST.
  const gap = localToUtc('2026-03-29', 90, tz);
  assert.equal(utcToLocalMinutes(gap, tz), 150);
  assert.equal(tzOffsetMinutes(localToUtc('2026-07-01', 600, tz), tz), 60);
});

test('DST: New York', () => {
  const tz = 'America/New_York';
  const ms = localToUtc('2026-03-08', 9 * 60, tz);
  assert.equal(new Date(ms).toISOString(), '2026-03-08T13:00:00.000Z');
  const ms2 = localToUtc('2026-11-01', 9 * 60, tz);
  assert.equal(new Date(ms2).toISOString(), '2026-11-01T14:00:00.000Z');
});
