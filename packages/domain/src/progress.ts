/**
 * Goal progress is always computed from the underlying records, never stored, so it can never
 * disagree with them (product decision 13).
 */
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
