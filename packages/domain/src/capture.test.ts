import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCapture } from './capture.ts';

const today = '2026-11-17'; // Tuesday

test('full task capture', () => {
  const d = parseCapture('revise unit 3 tomorrow 4pm 45m !p1 #economics', today);
  assert.equal(d.title, 'Revise unit 3');
  assert.equal(d.date, '2026-11-18');
  assert.equal(d.timeMinutes, 16 * 60);
  assert.equal(d.durationMinutes, 45);
  assert.equal(d.priority, 1);
  assert.deepEqual(d.tags, ['economics']);
});

test('type prefixes', () => {
  assert.equal(parseCapture('idea: app for football drills', today).type, 'idea');
  assert.equal(parseCapture('idea: app for football drills', today).title, 'App for football drills');
  const r = parseCapture('remind me to call coach at 6pm', today);
  assert.equal(r.type, 'reminder');
  assert.equal(r.title, 'Call coach');
  assert.equal(r.date, today);
  assert.equal(r.timeMinutes, 18 * 60);
});

test('weekdays and explicit dates', () => {
  assert.equal(parseCapture('gym friday', today).date, '2026-11-20');
  assert.equal(parseCapture('gym tuesday', today).date, '2026-11-24');
  assert.equal(parseCapture('essay due next friday', today).date, '2026-11-27');
  assert.equal(parseCapture('mock exam 3 dec', today).date, '2026-12-03');
  assert.equal(parseCapture('mock exam dec 3rd', today).date, '2026-12-03');
  assert.equal(parseCapture('trip 10/01', today).date, '2027-01-10');
  assert.equal(parseCapture('call in 3 days', today).date, '2026-11-20');
});

test('durations and times', () => {
  assert.equal(parseCapture('deep work 1h30 tomorrow', today).durationMinutes, 90);
  assert.equal(parseCapture('read for 2 hours', today).durationMinutes, 120);
  assert.equal(parseCapture('stretch 15 min', today).durationMinutes, 15);
  assert.equal(parseCapture('training 17:30', today).timeMinutes, 17 * 60 + 30);
  assert.equal(parseCapture('meet at 3', today).timeMinutes, 15 * 60);
});

test('leaves unrecognised text alone', () => {
  const d = parseCapture('Read chapter 12 of Sapiens', today);
  assert.equal(d.title, 'Read chapter 12 of Sapiens');
  assert.equal(d.date, null);
  assert.equal(d.durationMinutes, null);
});
