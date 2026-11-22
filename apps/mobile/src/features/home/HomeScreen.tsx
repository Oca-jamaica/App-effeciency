import { addDays, diffDays, formatHours, localToUtc, parseTime } from '@ascend/domain';
import { router } from 'expo-router';
import { AlertTriangle, CloudOff, Plus, RefreshCw, Sunrise } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useData, useLive } from '@/data/DataProvider';
import type { Goal, Milestone, ScheduleBlock, Task } from '@/data/types';
import { setHabitLog, habitsForDay } from '@/features/habits/repo';
import { completeTask } from '@/features/tasks/repo';
import { BlockSheet } from '@/features/planner/BlockSheet';
import { buildTimeline, clock, TimelineRow } from '@/features/planner/Timeline';
import { useDayPlan } from '@/features/planner/useDayPlan';
import { setBlockStatus } from '@/features/planner/schedule';
import { startFocus } from '@/features/focus/repo';
import { useToday, useUserContext } from '@/hooks/useUser';
import { Badge, Button, Card, Checkbox, EmptyState, Group, IconButton, ListRow, Row, Screen, Section, Text, Icon, space, useToast } from '@/ui';

function greeting(hour: number, name: string | null): string {
  const part = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name.split(' ')[0]}` : part;
}

export function HomeScreen() {
  const { store, status, syncNow } = useData();
  const toast = useToast();
  const ctx = useUserContext();
  const { today, now } = useToday(ctx.timeZone);
  const { plan, blocks, events, replan, planning } = useDayPlan(today, ctx.timeZone, true);
  const [selected, setSelected] = useState<ScheduleBlock | null>(null);

  const habits = useLive((s) => habitsForDay(s, today, ctx.weekStartsOn), [today, ctx.weekStartsOn], ['habits', 'habit_logs']);
  const upcoming = useLive(
    async (s) => {
      const horizon = addDays(today, 7);
      const tasks = await s.list<Task>('tasks', {
        where: "status NOT IN ('completed','cancelled') AND archived_at IS NULL AND due_date IS NOT NULL AND due_date <= ?",
        params: [horizon],
        orderBy: 'due_date, priority',
        limit: 8,
      });
      const milestones = await s.list<Milestone>('milestones', { where: "status = 'open' AND deadline IS NOT NULL AND deadline <= ?", params: [horizon], orderBy: 'deadline', limit: 5 });
      const goals = await s.list<Goal>('goals', { where: "status = 'active' AND deadline IS NOT NULL AND deadline <= ?", params: [addDays(today, 30)], orderBy: 'deadline', limit: 3 });
      return { tasks, milestones, goals };
    },
    [today],
    ['tasks', 'milestones', 'goals'],
  );
  const doneToday = useLive(
    (s) => s.query<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL AND status = 'completed' AND substr(completed_at, 1, 10) >= ?", [addDays(today, -1)]),
    [today],
    ['tasks'],
  );

  const prefs = ctx.prefs;
  const dayStart = localToUtc(today, prefs ? parseTime(prefs.day_start) : 7 * 60, ctx.timeZone);
  const dayEnd = localToUtc(today, prefs ? parseTime(prefs.day_end) : 22 * 60 + 30, ctx.timeZone);
  const timeline = useMemo(() => buildTimeline(blocks, events, Math.max(dayStart, now - 60 * 60_000), dayEnd), [blocks, events, dayStart, dayEnd, now]);

  const workBlocks = blocks.filter((b) => (b.kind === 'task' || b.kind === 'habit') && b.status !== 'unplanned' && b.status !== 'skipped');
  const doneBlocks = workBlocks.filter((b) => b.status === 'done').length;
  const focusPlanned = blocks.filter((b) => b.kind === 'task' && b.status !== 'unplanned' && b.status !== 'skipped').reduce((s, b) => s + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000, 0);
  const missed = blocks.filter((b) => b.status === 'missed');
  const current = workBlocks.find((b) => Date.parse(b.starts_at) <= now && Date.parse(b.ends_at) > now && b.status !== 'done');
  const next = workBlocks.find((b) => Date.parse(b.starts_at) > now && b.status === 'planned');
  const dueHabits = (habits.data ?? []).filter((h) => h.due || h.log);
  const priorities = workBlocks.filter((b) => b.kind === 'task' && b.status !== 'done').slice(0, 3);

  const toggleBlockDone = async (b: ScheduleBlock) => {
    try {
      if (b.status === 'done') {
        await setBlockStatus(store, b.id, 'planned');
        if (b.habit_id) await setHabitLog(store, b.habit_id, today, null);
        return;
      }
      if (b.task_id) await completeTask(store, b.task_id, today);
      if (b.habit_id) await setHabitLog(store, b.habit_id, today, 'done');
      await setBlockStatus(store, b.id, 'done');
      toast.show(`Done: ${b.title}`);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
    }
  };

  const dateLabel = new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: ctx.timeZone });
  const hour = Math.floor(((now - localToUtc(today, 0, ctx.timeZone)) / 3_600_000) % 24);

  return (
    <Screen
      title={greeting(hour, ctx.profile?.display_name ?? null)}
      subtitle={dateLabel}
      onRefresh={() => {
        void syncNow();
        void replan();
      }}
      refreshing={planning && status.phase === 'syncing'}
      actions={<IconButton icon={Plus} label="Quick capture" tone="primary" filled onPress={() => router.push('/(app)/capture')} />}
    >
      {status.phase === 'offline' || status.phase === 'error' ? (
        <Row style={styles.notice}>
          <Icon icon={CloudOff} size={16} tone="tertiary" />
          <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
            {status.phase === 'offline' ? 'Offline. Everything you do is saved and will sync when you’re back online.' : `Sync paused: ${status.lastError ?? 'unknown error'}`}
            {status.pending ? ` ${status.pending} change${status.pending === 1 ? '' : 's'} waiting.` : ''}
          </Text>
        </Row>
      ) : null}

      {/* Today strip */}
      <View style={styles.strip}>
        <Stat label="Planned done" value={`${doneBlocks}/${workBlocks.length}`} />
        <Stat label="Habits" value={`${dueHabits.filter((h) => h.log?.status === 'done').length}/${dueHabits.length}`} />
        <Stat label="Focus planned" value={formatHours(focusPlanned)} />
        <Stat label="Tasks done" value={String(doneToday.data?.[0]?.n ?? 0)} hint="since yesterday" />
      </View>

      {/* Now & next */}
      <Card>
        <Text variant="label" tone="tertiary">
          {current ? 'Now' : 'Next'}
        </Text>
        {current || next ? (
          <View style={{ gap: space.sm }}>
            <Text variant="heading">{(current ?? next)!.title}</Text>
            <Text variant="callout" tone="secondary">
              {clock(Date.parse((current ?? next)!.starts_at), ctx.timeZone)}–{clock(Date.parse((current ?? next)!.ends_at), ctx.timeZone)}
              {(current ?? next)!.reason ? ` · ${(current ?? next)!.reason}` : ''}
            </Text>
            <Row>
              <Button label="Mark done" size="sm" onPress={() => toggleBlockDone((current ?? next)!)} />
              {(current ?? next)!.kind === 'task' ? (
                <Button
                  label="Start focus"
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    const b = (current ?? next)!;
                    const planned = Math.max(5, Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000));
                    startFocus(store, 'focus', planned, { taskId: b.task_id, scheduleBlockId: b.id })
                      .then(() => router.push({ pathname: '/(tabs)/planner', params: { tab: 'focus' } }))
                      .catch((e) => toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' }));
                  }}
                />
              ) : null}
              <Button label="Options" size="sm" variant="secondary" onPress={() => setSelected((current ?? next)!)} />
            </Row>
          </View>
        ) : (
          <Text variant="callout" tone="secondary">
            {workBlocks.length ? 'Nothing else planned today. The rest of the day is yours.' : 'Nothing planned yet. Add tasks or habits and ASCEND will plan your day around your commitments.'}
          </Text>
        )}
      </Card>

      {plan?.warnings.length || missed.length ? (
        <View style={{ gap: space.sm }}>
          {plan?.warnings.map((w) => (
            <Card key={w.code} style={{ flexDirection: 'row', gap: space.md }}>
              <Icon icon={AlertTriangle} size={18} tone="warning" />
              <Text variant="callout" style={{ flex: 1 }}>
                {w.message}
              </Text>
            </Card>
          ))}
          {missed.map((b) => (
            <Card key={b.id} onPress={() => setSelected(b)} accessibilityLabel={`Not done: ${b.title}. Choose what to do.`}>
              <Text variant="callout">
                Not done: <Text variant="bodyStrong">{b.title}</Text> · {Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000)} min
              </Text>
              <Text variant="caption" tone="accent">
                Tap to reschedule, shorten, split, or drop it from today
              </Text>
            </Card>
          ))}
        </View>
      ) : null}

      <Section title="Today" action={planning ? 'Planning…' : 'Replan'} onAction={() => void replan()}>
        {timeline.length ? (
          <View style={{ gap: space.sm }}>
            {timeline.map((item) => (
              <TimelineRow key={item.key} item={item} timeZone={ctx.timeZone} now={now} onBlockPress={setSelected} onToggleDone={toggleBlockDone} />
            ))}
          </View>
        ) : (
          <EmptyState icon={Sunrise} title="A clear day" body="No commitments or planned work. Capture a task and it will be scheduled automatically." actionLabel="Capture something" onAction={() => router.push('/(app)/capture')} compact />
        )}
        {plan?.unscheduled.length ? (
          <View style={{ gap: space.xs }}>
            <Text variant="captionStrong" tone="secondary">
              Not scheduled today
            </Text>
            <Group>
              {plan.unscheduled.map((u) => (
                <ListRow
                  key={u.id}
                  title={u.title}
                  subtitle={u.message}
                  chevron
                  onPress={() => router.push(u.kind === 'task' ? { pathname: '/(app)/task/[id]', params: { id: u.id } } : { pathname: '/(app)/habit/[id]', params: { id: u.id } })}
                />
              ))}
            </Group>
          </View>
        ) : null}
      </Section>

      {priorities.length ? (
        <Section title="Priorities">
          <Group>
            {priorities.map((b, i) => (
              <ListRow
                key={b.id}
                leading={<Text variant="captionStrong" tone="tertiary" style={{ width: 16 }}>{i + 1}</Text>}
                title={b.title}
                subtitle={b.reason}
                onPress={() => b.task_id && router.push({ pathname: '/(app)/task/[id]', params: { id: b.task_id } })}
                chevron
              />
            ))}
          </Group>
        </Section>
      ) : null}

      {dueHabits.length ? (
        <Section title="Habits" action="All habits" onAction={() => router.push({ pathname: '/(tabs)/goals', params: { tab: 'habits' } })}>
          <Group>
            {dueHabits.map(({ habit, log }) => (
              <ListRow
                key={habit.id}
                leading={
                  <Checkbox
                    checked={log?.status === 'done'}
                    partial={log?.status === 'partial'}
                    label={`${habit.name} done today`}
                    onToggle={() => setHabitLog(store, habit.id, today, log?.status === 'done' ? null : 'done').catch((e) => toast.show(String(e), { kind: 'error' }))}
                  />
                }
                title={habit.name}
                subtitle={habit.duration_minutes ? `${habit.duration_minutes} min${habit.preferred_time ? ` · ${habit.preferred_time}` : ''}` : null}
                muted={log?.status === 'done'}
                onPress={() => router.push({ pathname: '/(app)/habit/[id]', params: { id: habit.id } })}
              />
            ))}
          </Group>
        </Section>
      ) : null}

      {upcoming.data && (upcoming.data.tasks.length || upcoming.data.milestones.length || upcoming.data.goals.length) ? (
        <Section title="Deadlines">
          <Group>
            {upcoming.data.tasks.map((t) => (
              <ListRow
                key={t.id}
                title={t.title}
                trailing={<DueBadge date={t.due_date!} today={today} />}
                onPress={() => router.push({ pathname: '/(app)/task/[id]', params: { id: t.id } })}
              />
            ))}
            {upcoming.data.milestones.map((m) => (
              <ListRow key={m.id} title={m.title} subtitle="Milestone" trailing={<DueBadge date={m.deadline!} today={today} />} onPress={() => m.goal_id && router.push({ pathname: '/(app)/goal/[id]', params: { id: m.goal_id } })} />
            ))}
            {upcoming.data.goals.map((g) => (
              <ListRow key={g.id} title={g.title} subtitle="Goal" trailing={<DueBadge date={g.deadline!} today={today} />} onPress={() => router.push({ pathname: '/(app)/goal/[id]', params: { id: g.id } })} />
            ))}
          </Group>
        </Section>
      ) : null}

      <UpcomingEvents today={today} timeZone={ctx.timeZone} />

      {status.pending > 0 && status.phase === 'idle' ? (
        <Row style={{ justifyContent: 'center' }}>
          <Icon icon={RefreshCw} size={12} tone="tertiary" />
          <Text variant="caption" tone="tertiary">
            Syncing {status.pending} change{status.pending === 1 ? '' : 's'}
          </Text>
        </Row>
      ) : null}

      <BlockSheet block={selected} onClose={() => setSelected(null)} timeZone={ctx.timeZone} today={today} />
    </Screen>
  );
}

function UpcomingEvents({ today, timeZone }: { today: string; timeZone: string }) {
  const tomorrow = addDays(today, 1);
  const events = useLive(
    async (s) => {
      const { occurrencesInRange } = await import('@/features/planner/events');
      return occurrencesInRange(s, tomorrow, addDays(today, 3), timeZone);
    },
    [today, timeZone],
    ['calendar_events'],
  );
  if (!events.data?.length) return null;
  return (
    <Section title="Coming up">
      <Group>
        {events.data.slice(0, 5).map((o) => (
          <ListRow
            key={o.key}
            title={o.event.title}
            subtitle={`${o.date === tomorrow ? 'Tomorrow' : new Date(o.start).toLocaleDateString(undefined, { weekday: 'long', timeZone })} · ${o.event.all_day ? 'All day' : `${clock(o.start, timeZone)}–${clock(o.end, timeZone)}`}`}
            onPress={() => router.push({ pathname: '/(app)/event/edit', params: { id: o.event.id } })}
          />
        ))}
      </Group>
    </Section>
  );
}

function DueBadge({ date, today }: { date: string; today: string }) {
  const d = diffDays(today, date);
  if (d < 0) return <Badge label="Overdue" tone="danger" />;
  if (d === 0) return <Badge label="Today" tone="warning" />;
  if (d === 1) return <Badge label="Tomorrow" tone="accent" />;
  return <Badge label={new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} />;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}${hint ? `, ${hint}` : ''}`}>
      <Text variant="numeric" tabular>
        {value}
      </Text>
      <Text variant="caption" tone="secondary" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  stat: { flex: 1, gap: 2 },
  notice: { paddingVertical: space.xs },
});
