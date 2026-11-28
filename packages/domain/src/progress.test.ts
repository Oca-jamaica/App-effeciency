import test from 'node:test';
import assert from 'node:assert/strict';
import { goalRoadmap } from './progress.ts';

const m = (id: string, deadline: string | null, status = 'open') => ({ id, title: id, deadline, status });

test('roadmap places markers between the start and the deadline', () => {
  const r = goalRoadmap({ startDate: '2026-01-01', deadline: '2026-01-11', today: '2026-01-06', milestones: [m('b', '2026-01-08'), m('a', '2026-01-03', 'done'), m('c', null)] });
  assert.deepEqual(r.markers.map((x) => [x.id, x.position]), [['a', 0.2], ['b', 0.7]]);
  assert.equal(r.todayPosition, 0.5);
  assert.deepEqual(r.undated.map((x) => x.id), ['c']);
  assert.equal(r.next?.id, 'b');
  assert.equal(r.overdueCount, 0);
});

test('roadmap without a deadline runs to the last marker; overdue and skipped are handled', () => {
  const r = goalRoadmap({ startDate: '2026-01-05', deadline: null, today: '2026-01-10', milestones: [m('early', '2026-01-01'), m('late', '2026-01-21'), m('gone', '2026-01-15', 'skipped')] });
  assert.equal(r.start, '2026-01-01', 'a marker before the start date extends the line');
  assert.equal(r.end, '2026-01-21');
  assert.deepEqual(r.markers.map((x) => x.id), ['early', 'late']);
  assert.equal(r.markers[0]!.overdue, true);
  assert.equal(r.overdueCount, 1);
  assert.equal(r.markers[1]!.position, 1);
});

test('roadmap with no dates at all has no line', () => {
  const r = goalRoadmap({ startDate: '2026-01-05', deadline: null, today: '2026-01-10', milestones: [m('x', null)] });
  assert.equal(r.end, null);
  assert.equal(r.todayPosition, null);
  assert.equal(r.markers.length, 0);
  assert.equal(r.undated.length, 1);
});

test('a marker after the deadline stretches the line rather than falling off it', () => {
  const r = goalRoadmap({ startDate: '2026-01-01', deadline: '2026-01-10', today: '2026-01-02', milestones: [m('x', '2026-01-20')] });
  assert.equal(r.end, '2026-01-20');
  assert.equal(r.markers[0]!.position, 1);
});
