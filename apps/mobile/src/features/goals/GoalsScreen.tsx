import { describeFrequency } from '@ascend/domain';
import { router, useLocalSearchParams } from 'expo-router';
import { GripVertical, Plus, Repeat, Target } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLive, useStore } from '@/data/DataProvider';
import type { Category, Goal } from '@/data/types';
import { habitsForDay, setHabitLog, toRule } from '@/features/habits/repo';
import { listCategories } from '@/features/settings/repo';
import { useToday, useUserContext } from '@/hooks/useUser';
import {
  Badge, Checkbox, Dot, EmptyState, Group, Icon, IconButton, ListRow, LoadingState, ProgressBar, ReorderableList, Screen, Section,
  SegmentedControl, Text, gutter, radius, space, useTheme, useToast,
} from '@/ui';
import { computeProgress, listGoals, moveGoal } from './repo';
import { ProjectList } from '@/features/projects/ProjectScreens';

type Tab = 'goals' | 'habits' | 'projects';
const ROW_HEIGHT = 92;

export function GoalsScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'habits' ? 'habits' : params.tab === 'projects' ? 'projects' : 'goals');
  return (
    <Screen
      title="Goals"
      actions={
        <IconButton
          icon={Plus}
          label={tab === 'goals' ? 'New goal' : tab === 'habits' ? 'New habit' : 'New project'}
          tone="primary"
          filled
          onPress={() => router.push(tab === 'goals' ? '/(app)/goal/edit' : tab === 'habits' ? '/(app)/habit/edit' : '/(app)/project/edit')}
        />
      }
      toolbar={
        <View style={{ paddingHorizontal: gutter, paddingBottom: space.md }}>
          <SegmentedControl
            segments={[
              { value: 'goals', label: 'Goals' },
              { value: 'habits', label: 'Habits' },
              { value: 'projects', label: 'Projects' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </View>
      }
    >
      {tab === 'goals' ? <GoalList /> : tab === 'habits' ? <HabitList /> : <ProjectList />}
    </Screen>
  );
}

function GoalList() {
  const store = useStore();
  const toast = useToast();
  const data = useLive(
    async (s) => {
      const [goals, done, categories] = await Promise.all([listGoals(s, ['active', 'paused']), listGoals(s, ['completed', 'archived']), listCategories(s, true)]);
      const progress = await Promise.all(goals.map((g) => computeProgress(s, g)));
      return { goals, progress, done, categories: new Map(categories.map((c) => [c.id, c])) };
    },
    [],
    ['goals', 'milestones', 'tasks', 'goal_progress_entries', 'categories'],
  );
  if (data.loading && !data.data) return <LoadingState />;
  const { goals = [], progress = [], done = [], categories = new Map<string, Category>() } = data.data ?? {};

  const onMove = async (id: string, toIndex: number) => {
    const others = goals.filter((g) => g.id !== id);
    const before = others[toIndex - 1]?.rank ?? null;
    const after = others[toIndex]?.rank ?? null;
    const current = goals.findIndex((g) => g.id === id);
    if (current === toIndex) return;
    try {
      await moveGoal(store, id, before, after);
      toast.show(`Moved to priority ${toIndex + 1}`);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
    }
  };

  if (!goals.length && !done.length) {
    return (
      <EmptyState
        icon={Target}
        title="What do you want to achieve?"
        body="Create your own goals, then put them in order. Your priority list shapes how ASCEND plans each day."
        actionLabel="Create a goal"
        onAction={() => router.push('/(app)/goal/edit')}
      />
    );
  }

  return (
    <>
      <Section title="Priorities" hint="Hold and drag to reorder. ASCEND never changes this order without asking you.">
        <ReorderableList
          data={goals}
          keyOf={(g) => g.id}
          itemHeight={ROW_HEIGHT}
          onMove={onMove}
          renderItem={(g, i) => <GoalRow goal={g} index={i} progress={progress[i]?.ratio ?? null} label={progress[i]?.label ?? ''} category={g.category_id ? categories.get(g.category_id) : undefined} />}
        />
      </Section>
      {done.length ? (
        <Section title="Completed & archived">
          <Group>
            {done.map((g) => (
              <ListRow key={g.id} title={g.title} subtitle={g.status === 'completed' ? 'Completed' : 'Archived'} muted={g.status === 'completed'} chevron onPress={() => router.push({ pathname: '/(app)/goal/[id]', params: { id: g.id } })} />
            ))}
          </Group>
        </Section>
      ) : null}
    </>
  );
}

function GoalRow({ goal, index, progress, label, category }: { goal: Goal; index: number; progress: number | null; label: string; category?: Category }) {
  const { colors, categoryColor } = useTheme();
  return (
    <View style={{ paddingBottom: space.sm, height: ROW_HEIGHT }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Priority ${index + 1}: ${goal.title}. ${label}`}
        accessibilityHint="Opens the goal. Hold and drag to reorder."
        onPress={() => router.push({ pathname: '/(app)/goal/[id]', params: { id: goal.id } })}
        style={({ pressed }) => [styles.goalRow, { backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: colors.border }]}
      >
        <Text variant="captionStrong" tone="tertiary" tabular style={{ width: 18 }}>
          {index + 1}
        </Text>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            {category ? <Dot color={categoryColor(category.color)} /> : null}
            <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {goal.title}
            </Text>
            {goal.status === 'paused' ? <Badge label="Paused" /> : null}
          </View>
          <ProgressBar value={progress} />
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {label}
            {goal.deadline ? ` · by ${new Date(`${goal.deadline}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
          </Text>
        </View>
        <Icon icon={GripVertical} size={18} tone="tertiary" />
      </Pressable>
    </View>
  );
}

function HabitList() {
  const store = useStore();
  const toast = useToast();
  const ctx = useUserContext();
  const { today } = useToday(ctx.timeZone);
  const habits = useLive((s) => habitsForDay(s, today, ctx.weekStartsOn), [today, ctx.weekStartsOn], ['habits', 'habit_logs']);
  if (habits.loading && !habits.data) return <LoadingState />;
  const list = habits.data ?? [];
  if (!list.length) {
    return (
      <EmptyState
        icon={Repeat}
        title="Build habits that last"
        body="Reading, revision, gym, football practice — create your own, with the days and frequency that suit you. They’re planned into your day automatically."
        actionLabel="Create a habit"
        onAction={() => router.push('/(app)/habit/edit')}
      />
    );
  }
  const active = list.filter((h) => h.habit.status === 'active');
  const paused = list.filter((h) => h.habit.status === 'paused');
  const row = ({ habit, due, log, consistency30 }: (typeof list)[number]) => (
    <ListRow
      key={habit.id}
      leading={
        due || log ? (
          <Checkbox
            checked={log?.status === 'done'}
            partial={log?.status === 'partial'}
            label={`${habit.name} done today`}
            onToggle={() => setHabitLog(store, habit.id, today, log?.status === 'done' ? null : 'done').catch((e) => toast.show(String(e), { kind: 'error' }))}
          />
        ) : (
          <View style={{ width: 22 }} />
        )
      }
      title={habit.name}
      subtitle={`${describeFrequency(toRule(habit))}${consistency30 !== null ? ` · ${Math.round(consistency30 * 100)}% last 30 days` : ''}${!due && !log && habit.status === 'active' ? ' · not today' : ''}`}
      chevron
      onPress={() => router.push({ pathname: '/(app)/habit/[id]', params: { id: habit.id } })}
    />
  );
  return (
    <>
      <Section title="Active">
        <Group>{active.map(row)}</Group>
      </Section>
      {paused.length ? (
        <Section title="Paused">
          <Group>{paused.map(row)}</Group>
        </Section>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  goalRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
