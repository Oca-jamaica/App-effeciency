import { addDays, consistency, formatHours, startOfWeek } from '@ascend/domain';
import { router } from 'expo-router';
import { BarChart3 } from 'lucide-react-native';
import { View } from 'react-native';
import { useLive } from '@/data/DataProvider';
import type { Goal, Habit, HabitLog, ScheduleBlock, Task } from '@/data/types';
import { computeProgress } from '@/features/goals/repo';
import { toRule } from '@/features/habits/repo';
import { useToday, useUserContext } from '@/hooks/useUser';
import { Card, EmptyState, Group, ListRow, LoadingState, ProgressBar, Row, Screen, Section, Text, space } from '@/ui';

interface WeekOverview {
  completed: number;
  created: number;
  postponed: number;
  plannedMinutes: number;
  doneMinutes: number;
  missedBlocks: number;
  habits: { habit: Habit; rate: number | null }[];
  goals: { goal: Goal; ratio: number | null; label: string; minutes: number }[];
}

/** Everything here is computed from recorded activity — tasks, blocks, habit logs — never estimated. */
async function loadOverview(s: Parameters<typeof computeProgress>[0], weekStart: string, today: string): Promise<WeekOverview> {
  const weekEnd = addDays(weekStart, 6);
  const from = `${weekStart}T00:00:00`;
  const [completedRows, createdRows, postponedRows, blocks, habits, goals] = await Promise.all([
    s.query<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL AND status = 'completed' AND completed_at >= ?", [from]),
    s.query<{ n: number }>('SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL AND created_at >= ?', [from]),
    s.query<{ n: number }>("SELECT COUNT(DISTINCT task_id) AS n FROM task_events WHERE deleted_at IS NULL AND event_type = 'rescheduled' AND occurred_at >= ?", [from]),
    s.list<ScheduleBlock>('schedule_blocks', { where: "block_date BETWEEN ? AND ? AND kind = 'task'", params: [weekStart, weekEnd] }),
    s.list<Habit>('habits', { where: "status = 'active'", orderBy: 'rank COLLATE BINARY' }),
    s.list<Goal>('goals', { where: "status = 'active'", orderBy: 'rank COLLATE BINARY' }),
  ]);
  const minutes = (b: ScheduleBlock) => b.actual_minutes ?? Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000);
  const counted = blocks.filter((b) => b.status !== 'unplanned' && b.status !== 'skipped');
  const done = counted.filter((b) => b.status === 'done' || b.status === 'partial');
  const logs = habits.length
    ? await s.list<HabitLog>('habit_logs', { where: `habit_id IN (${habits.map(() => '?').join(',')}) AND log_date >= ?`, params: [...habits.map((h) => h.id), addDays(today, -30)] })
    : [];
  const tasks = goals.length
    ? await s.list<Task>('tasks', { where: `goal_id IN (${goals.map(() => '?').join(',')})`, params: goals.map((g) => g.id) })
    : [];
  const minutesByTask = new Map<string, number>();
  for (const b of done) if (b.task_id) minutesByTask.set(b.task_id, (minutesByTask.get(b.task_id) ?? 0) + minutes(b));
  return {
    completed: completedRows[0]?.n ?? 0,
    created: createdRows[0]?.n ?? 0,
    postponed: postponedRows[0]?.n ?? 0,
    plannedMinutes: counted.reduce((n, b) => n + minutes(b), 0),
    doneMinutes: done.reduce((n, b) => n + minutes(b), 0),
    missedBlocks: counted.filter((b) => b.status === 'missed').length,
    habits: habits.map((habit) => ({
      habit,
      rate: consistency(toRule(habit), logs.filter((l) => l.habit_id === habit.id).map((l) => ({ logDate: l.log_date, status: l.status })), today, 30).rate,
    })),
    goals: await Promise.all(
      goals.map(async (goal) => {
        const p = await computeProgress(s, goal);
        const mins = tasks.filter((t) => t.goal_id === goal.id).reduce((n, t) => n + (minutesByTask.get(t.id) ?? 0), 0);
        return { goal, ratio: p.ratio, label: p.label, minutes: mins };
      }),
    ),
  };
}

export function InsightsScreen() {
  const ctx = useUserContext();
  const { today } = useToday(ctx.timeZone);
  const weekStart = startOfWeek(today, ctx.weekStartsOn);
  const data = useLive((s) => loadOverview(s, weekStart, today), [weekStart, today], ['tasks', 'task_events', 'schedule_blocks', 'habits', 'habit_logs', 'goals', 'milestones', 'goal_progress_entries']);
  if (data.loading && !data.data) return <Screen title="Insights"><LoadingState /></Screen>;
  const o = data.data;
  const empty = !o || (!o.completed && !o.created && !o.plannedMinutes && !o.habits.length && !o.goals.length);
  return (
    <Screen title="Insights" subtitle="This week, from what you actually recorded">
      {empty || !o ? (
        <EmptyState icon={BarChart3} title="Nothing recorded yet" body="As you complete tasks, follow your plan and log habits, an honest picture of your week builds up here." />
      ) : (
        <>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <Metric value={String(o.completed)} label="Tasks completed" />
              <Metric value={String(o.postponed)} label="Rescheduled" />
              <Metric value={formatHours(o.doneMinutes)} label={`of ${formatHours(o.plannedMinutes)} planned`} />
            </Row>
            {o.plannedMinutes ? <ProgressBar value={o.doneMinutes / o.plannedMinutes} /> : null}
            {o.missedBlocks ? <Text variant="caption" tone="secondary">{o.missedBlocks} planned block{o.missedBlocks === 1 ? '' : 's'} didn’t happen — that’s information, not failure. Check whether those estimates or times were realistic.</Text> : null}
          </Card>

          {o.goals.length ? (
            <Section title="Goals" hint="Progress, and focused time recorded against each goal this week.">
              <Group>
                {o.goals.map(({ goal, ratio, label, minutes }, i) => (
                  <View key={goal.id} style={{ padding: space.lg, gap: space.sm }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1} onPress={() => router.push({ pathname: '/(app)/goal/[id]', params: { id: goal.id } })}>
                        {i + 1}. {goal.title}
                      </Text>
                      <Text variant="caption" tone="secondary">{minutes ? formatHours(minutes) : 'no time yet'}</Text>
                    </Row>
                    <ProgressBar value={ratio} />
                    <Text variant="caption" tone="secondary">{label}</Text>
                  </View>
                ))}
              </Group>
              {o.goals.length > 1 && o.goals[0]!.minutes === 0 && o.goals.some((g) => g.minutes > 0) ? (
                <Text variant="caption" tone="warning">Your top priority hasn’t had focused time this week, while others have.</Text>
              ) : null}
            </Section>
          ) : null}

          {o.habits.length ? (
            <Section title="Habit consistency" hint="Last 30 days. Consistency matters more than streaks.">
              <Group>
                {o.habits.map(({ habit, rate }) => (
                  <ListRow key={habit.id} title={habit.name} trailing={<Text variant="callout" tone="secondary" tabular>{rate === null ? '—' : `${Math.round(rate * 100)}%`}</Text>} onPress={() => router.push({ pathname: '/(app)/habit/[id]', params: { id: habit.id } })} />
                ))}
              </Group>
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ gap: 2, flex: 1 }}>
      <Text variant="numeric" tabular>{value}</Text>
      <Text variant="caption" tone="secondary">{label}</Text>
    </View>
  );
}
