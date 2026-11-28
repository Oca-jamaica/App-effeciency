/**
 * Goal progress is always computed from the underlying records, never stored, so it can never
 * disagree with them (product decision 13).
 */
import { diffDays, type LocalDate } from './time.ts';

export type ProgressMode = 'milestones' | 'tasks' | 'target' | 'manual';

export interface ProgressInputs {
  mode: ProgressMode;
  milestones: readonly { status: 'open' | 'done' | 'skipped' }[];
  tasks: readonly { status: string }[];
  targetValue: number | null;
  currentValue: number | null;
  /** For `manual` mode: the latest progress entry's value, 0–100. */
  manualPercent: number | null;
  /** Value at which the target was measured from (defaults to 0). */
  baselineValue?: number | null;
}

export interface Progress {
  /** 0–1, or null when there is nothing to measure yet. */
  ratio: number | null;
  label: string;
}

export function goalProgress(p: ProgressInputs): Progress {
  switch (p.mode) {
    case 'milestones': {
      const counted = p.milestones.filter((m) => m.status !== 'skipped');
      if (!counted.length) return { ratio: null, label: 'No milestones yet' };
      const done = counted.filter((m) => m.status === 'done').length;
      return { ratio: done / counted.length, label: `${done} of ${counted.length} milestones` };
    }
    case 'tasks': {
      const counted = p.tasks.filter((t) => t.status !== 'cancelled');
      if (!counted.length) return { ratio: null, label: 'No linked tasks yet' };
      const done = counted.filter((t) => t.status === 'completed').length;
      return { ratio: done / counted.length, label: `${done} of ${counted.length} tasks` };
    }
    case 'target': {
      if (p.targetValue === null || p.currentValue === null) return { ratio: null, label: 'Set a target' };
      const base = p.baselineValue ?? 0;
      const span = p.targetValue - base;
      if (span === 0) return { ratio: p.currentValue >= p.targetValue ? 1 : 0, label: `${fmt(p.currentValue)} / ${fmt(p.targetValue)}` };
      const ratio = Math.max(0, Math.min(1, (p.currentValue - base) / span));
      return { ratio, label: `${fmt(p.currentValue)} / ${fmt(p.targetValue)}` };
    }
    case 'manual': {
      if (p.manualPercent === null) return { ratio: null, label: 'Not updated yet' };
      const ratio = Math.max(0, Math.min(1, p.manualPercent / 100));
      return { ratio, label: `${Math.round(ratio * 100)}%` };
    }
  }
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ───────────────────────────── roadmap ─────────────────────────────

export interface RoadmapMarker {
  id: string;
  title: string;
  date: LocalDate | null;
  done: boolean;
  /** 0–1 along the line from the roadmap's start to its end; null for markers without a date. */
  position: number | null;
  overdue: boolean;
}

export interface Roadmap {
  start: LocalDate;
  end: LocalDate | null;
  /** Where today falls on the line (0–1), or null when the line has no end. */
  todayPosition: number | null;
  /** Dated markers in date order. */
  markers: RoadmapMarker[];
  undated: RoadmapMarker[];
  /** The first unfinished dated marker. */
  next: RoadmapMarker | null;
  overdueCount: number;
}

/**
 * Lays a goal's milestones out as markers on a line from when the goal started to its deadline
 * (or to the last marker when there is no deadline). Skipped milestones are left off.
 */
export function goalRoadmap(input: {
  startDate: LocalDate;
  deadline: LocalDate | null;
  today: LocalDate;
  milestones: readonly { id: string; title: string; deadline: LocalDate | null; status: string }[];
}): Roadmap {
  const live = input.milestones.filter((m) => m.status !== 'skipped');
  const dated = live.filter((m) => m.deadline).sort((a, b) => (a.deadline! < b.deadline! ? -1 : a.deadline! > b.deadline! ? 1 : 0));
  const first = dated[0]?.deadline ?? null;
  const last = dated[dated.length - 1]?.deadline ?? null;
  const start = first && first < input.startDate ? first : input.startDate;
  const end = input.deadline && (!last || input.deadline >= last) ? input.deadline : last;
  const span = end ? Math.max(1, diffDays(start, end)) : null;
  const at = (d: LocalDate) => (span === null ? null : Math.min(1, Math.max(0, diffDays(start, d) / span)));
  const marker = (m: (typeof live)[number]): RoadmapMarker => {
    const done = m.status === 'done';
    return { id: m.id, title: m.title, date: m.deadline, done, position: m.deadline ? at(m.deadline) : null, overdue: !done && !!m.deadline && m.deadline < input.today };
  };
  const markers = dated.map(marker);
  return {
    start,
    end,
    todayPosition: end ? at(input.today) : null,
    markers,
    undated: live.filter((m) => !m.deadline).map(marker),
    next: markers.find((m) => !m.done) ?? null,
    overdueCount: markers.filter((m) => m.overdue).length,
  };
}
