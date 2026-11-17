import { useLive } from '@/data/DataProvider';
import type { Goal, Milestone } from '@/data/types';
import { listCategories } from '@/features/settings/repo';
import { useTheme, type SelectOption } from '@/ui';

export function useCategoryOptions(): SelectOption<string | null>[] {
  const { categoryColor } = useTheme();
  const cats = useLive((s) => listCategories(s), [], ['categories']);
  return (cats.data ?? []).map((c) => ({ value: c.id, label: c.name, color: categoryColor(c.color) }));
}

export function useGoalOptions(): SelectOption<string | null>[] {
  const goals = useLive((s) => s.list<Goal>('goals', { where: "status IN ('active','paused')", orderBy: 'rank COLLATE BINARY' }), [], ['goals']);
  return (goals.data ?? []).map((g, i) => ({ value: g.id, label: g.title, description: `Priority ${i + 1}` }));
}

export function useMilestoneOptions(goalId: string | null): SelectOption<string | null>[] {
  const ms = useLive(
    (s) => (goalId ? s.list<Milestone>('milestones', { where: "goal_id = ? AND status = 'open'", params: [goalId], orderBy: 'rank COLLATE BINARY' }) : Promise.resolve([])),
    [goalId],
    ['milestones'],
  );
  return (ms.data ?? []).map((m) => ({ value: m.id, label: m.title }));
}

export const WINDOW_OPTIONS = [
  { value: 'any' as const, label: 'Any time' },
  { value: 'morning' as const, label: 'Morning' },
  { value: 'afternoon' as const, label: 'Afternoon' },
  { value: 'evening' as const, label: 'Evening' },
  { value: 'study' as const, label: 'Study hours' },
  { value: 'work' as const, label: 'Work hours' },
];

export const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: d, label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]! }));
