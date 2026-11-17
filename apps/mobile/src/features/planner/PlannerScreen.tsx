import { addDays, addMonths, daysInMonth, diffDays, parseTime, startOfMonth, startOfWeek, weekday } from '@ascend/domain';
import { router } from 'expo-router';
import { CalendarPlus, CheckSquare, ChevronLeft, ChevronRight, Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLive, useStore } from '@/data/DataProvider';
import type { ScheduleBlock, Task } from '@/data/types';
import { completeTask, listTasks, reopenTask, type TaskListKind } from '@/features/tasks/repo';
import { useToday, useUserContext } from '@/hooks/useUser';
import {
  Badge, Checkbox, ChipGroup, Dot, EmptyState, Group, IconButton, ListRow, LoadingState, Row, Screen, Section, SegmentedControl, Text,
  formatDateLabel, gutter, radius, space, useTheme, useToast,
} from '@/ui';
import { BlockSheet } from './BlockSheet';
import { DayGrid } from './DayGrid';
import { occurrencesInRange } from './events';
import { moveBlock } from './schedule';
import { clock } from './Timeline';
import { useDayPlan } from './useDayPlan';

type Tab = 'calendar' | 'tasks';
type View3 = 'day' | 'week' | 'month';

export function PlannerScreen() {
  const [tab, setTab] = useState<Tab>('calendar');
  return (
    <Screen
      title="Planner"
      actions={
        <IconButton
          icon={tab === 'calendar' ? CalendarPlus : Plus}
          label={tab === 'calendar' ? 'New event' : 'New task'}
          tone="primary"
          filled
          onPress={() => router.push(tab === 'calendar' ? '/(app)/event/edit' : '/(app)/task/edit')}
        />
      }
      toolbar={
        <View style={{ paddingHorizontal: gutter, paddingBottom: space.md }}>
          <SegmentedControl segments={[{ value: 'calendar', label: 'Calendar' }, { value: 'tasks', label: 'Tasks' }]} value={tab} onChange={setTab} />
        </View>
      }
    >
      {tab === 'calendar' ? <CalendarPane /> : <TasksPane />}
    </Screen>
  );
}

function CalendarPane() {
  const ctx = useUserContext();
  const { today, now } = useToday(ctx.timeZone);
  const [mode, setMode] = useState<View3>('day');
  const [date, setDate] = useState(today);
  const step = (dir: number) => setDate((d) => (mode === 'day' ? addDays(d, dir) : mode === 'week' ? addDays(d, 7 * dir) : addMonths(d, dir)));
  const title =
    mode === 'month'
      ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : mode === 'week'
        ? `Week of ${formatDateLabel(startOfWeek(date, ctx.weekStartsOn))}`
        : date === today
          ? `Today · ${formatDateLabel(date)}`
          : formatDateLabel(date);
  return (
    <View style={{ gap: space.md }}>
      <SegmentedControl segments={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} value={mode} onChange={setMode} />
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton icon={ChevronLeft} label="Previous" onPress={() => step(-1)} />
        <Pressable accessibilityRole="button" accessibilityLabel={`${title}. Tap to go to today.`} onPress={() => setDate(today)}>
          <Text variant="subheading">{title}</Text>
        </Pressable>
        <IconButton icon={ChevronRight} label="Next" onPress={() => step(1)} />
      </Row>
      {mode === 'day' ? <DayPane date={date} today={today} now={now} /> : null}
      {mode === 'week' ? <WeekPane date={date} today={today} onPick={(d) => { setDate(d); setMode('day'); }} /> : null}
      {mode === 'month' ? <MonthPane date={date} today={today} onPick={(d) => { setDate(d); setMode('day'); }} /> : null}
    </View>
  );
}

function DayPane({ date, today, now }: { date: string; today: string; now: number }) {
  const store = useStore();
  const toast = useToast();
  const ctx = useUserContext();
  const isToday = date === today;
  const { plan, blocks, events, isPreview } = useDayPlan(date, ctx.timeZone, isToday);
  const [selected, setSelected] = useState<ScheduleBlock | null>(null);
  const startHour = ctx.prefs ? Math.floor(parseTime(ctx.prefs.day_start) / 60) : 7;
  const endHour = ctx.prefs ? Math.ceil(parseTime(ctx.prefs.day_end) / 60) : 23;

  // Future days show an unsaved preview of how the scheduler would plan them.
  const shown: ScheduleBlock[] = useMemo(() => {
    if (!isPreview || !plan) return blocks;
    const preview = plan.blocks.map((b) => ({
      id: `preview:${b.key}`, user_id: '', created_at: '', updated_at: '', deleted_at: null, block_date: date,
      starts_at: new Date(b.start).toISOString(), ends_at: new Date(b.end).toISOString(), kind: b.kind, task_id: b.taskId, habit_id: b.habitId,
      title: b.title, origin: 'auto' as const, is_locked: false, status: 'planned' as const, actual_minutes: null, reason: b.reason, algorithm_version: null, completed_at: null,
    }));
    return [...blocks.filter((b) => b.origin !== 'auto'), ...preview];
  }, [isPreview, plan, blocks, date]);

  const allDay = events.filter((o) => o.event.all_day);
  return (
    <View style={{ gap: space.sm }}>
      {allDay.map((o) => (
        <Badge key={o.key} label={`All day · ${o.event.title}`} />
      ))}
      {isPreview && date > today ? (
        <Text variant="caption" tone="tertiary">Preview of how this day would be planned. It’s confirmed automatically on the day.</Text>
      ) : null}
      <DayGrid
        date={date}
        timeZone={ctx.timeZone}
        startHour={startHour}
        endHour={endHour}
        blocks={shown}
        events={events}
        now={now}
        onBlockPress={(b) => (b.id.startsWith('preview:') ? b.task_id && router.push({ pathname: '/(app)/task/[id]', params: { id: b.task_id } }) : setSelected(b))}
        onMoveBlock={(b, start) => {
          if (b.id.startsWith('preview:')) return toast.show('Previewed blocks can be moved on the day itself.', { kind: 'info' });
          moveBlock(store, b.id, start)
            .then(() => toast.show(`Moved to ${clock(start, ctx.timeZone)}. Lock it to keep it there.`))
            .catch((e) => toast.show(String(e), { kind: 'error' }));
        }}
      />
      <BlockSheet block={selected} onClose={() => setSelected(null)} timeZone={ctx.timeZone} today={today} />
    </View>
  );
}

function WeekPane({ date, today, onPick }: { date: string; today: string; onPick: (d: string) => void }) {
  const ctx = useUserContext();
  const start = startOfWeek(date, ctx.weekStartsOn);
  const end = addDays(start, 6);
  const data = useLive(
    async (s) => {
      const [events, tasks, blocks] = await Promise.all([
        occurrencesInRange(s, start, end, ctx.timeZone),
        s.list<Task>('tasks', { where: "status NOT IN ('completed','cancelled') AND (due_date BETWEEN ? AND ? OR do_date BETWEEN ? AND ?)", params: [start, end, start, end] }),
        s.list<ScheduleBlock>('schedule_blocks', { where: "block_date BETWEEN ? AND ? AND status NOT IN ('unplanned','skipped')", params: [start, end] }),
      ]);
      return { events, tasks, blocks };
    },
    [start, end, ctx.timeZone],
    ['calendar_events', 'tasks', 'schedule_blocks'],
  );
  if (!data.data) return <LoadingState />;
  return (
    <View style={{ gap: space.sm }}>
      {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((d) => {
        const evs = data.data!.events.filter((o) => o.date === d);
        const due = data.data!.tasks.filter((t) => t.due_date === d);
        const planned = data.data!.blocks.filter((b) => b.block_date === d && b.kind === 'task').length;
        return (
          <Pressable key={d} accessibilityRole="button" onPress={() => onPick(d)} style={({ pressed }) => [styles.weekDay, pressed && { opacity: 0.7 }]}>
            <View style={{ width: 52 }}>
              <Text variant="captionStrong" tone={d === today ? 'accent' : 'secondary'}>
                {new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}
              </Text>
              <Text variant="numeric" tone={d === today ? 'accent' : 'primary'}>{Number(d.slice(8))}</Text>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              {evs.slice(0, 3).map((o) => (
                <Text key={o.key} variant="callout" numberOfLines={1}>
                  <Text variant="caption" tone="secondary" tabular>{o.event.all_day ? 'All day ' : `${clock(o.start, ctx.timeZone)} `}</Text>
                  {o.event.title}
                </Text>
              ))}
              {evs.length > 3 ? <Text variant="caption" tone="tertiary">+{evs.length - 3} more</Text> : null}
              {due.map((t) => (
                <Text key={t.id} variant="caption" tone="warning" numberOfLines={1}>Due: {t.title}</Text>
              ))}
              {!evs.length && !due.length ? <Text variant="caption" tone="tertiary">{planned ? `${planned} planned block${planned === 1 ? '' : 's'}` : 'Free'}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function MonthPane({ date, today, onPick }: { date: string; today: string; onPick: (d: string) => void }) {
  const { colors } = useTheme();
  const ctx = useUserContext();
  const first = startOfMonth(date);
  const last = addDays(first, daysInMonth(date) - 1);
  const data = useLive(
    async (s) => {
      const [events, tasks] = await Promise.all([
        occurrencesInRange(s, first, last, ctx.timeZone),
        s.list<Task>('tasks', { where: "status NOT IN ('completed','cancelled') AND due_date BETWEEN ? AND ?", params: [first, last] }),
      ]);
      return { events, tasks };
    },
    [first, last, ctx.timeZone],
    ['calendar_events', 'tasks'],
  );
  const lead = (weekday(first) - ctx.weekStartsOn + 7) % 7;
  const names = Array.from({ length: 7 }, (_, i) => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][(ctx.weekStartsOn + i) % 7]);
  return (
    <View style={styles.monthGrid}>
      {names.map((n, i) => (
        <Text key={i} variant="caption" tone="tertiary" align="center" style={styles.monthCell}>{n}</Text>
      ))}
      {Array.from({ length: lead }, (_, i) => <View key={`l${i}`} style={styles.monthCell} />)}
      {Array.from({ length: daysInMonth(date) }, (_, i) => addDays(first, i)).map((d) => {
        const hasEvent = data.data?.events.some((o) => o.date === d);
        const hasDue = data.data?.tasks.some((t) => t.due_date === d);
        return (
          <Pressable key={d} accessibilityRole="button" accessibilityLabel={`${formatDateLabel(d)}${hasEvent ? ', has events' : ''}${hasDue ? ', has deadlines' : ''}`} onPress={() => onPick(d)} style={styles.monthCell}>
            <View style={[styles.monthDay, d === today && { backgroundColor: colors.accent }]}>
              <Text variant="callout" tone={d === today ? 'onAccent' : diffDays(today, d) < 0 ? 'tertiary' : 'primary'} tabular>{Number(d.slice(8))}</Text>
            </View>
            <Row gap={3} style={{ height: 6 }}>
              {hasEvent ? <Dot color={colors.textSecondary} size={5} /> : null}
              {hasDue ? <Dot color={colors.warning} size={5} /> : null}
            </Row>
          </Pressable>
        );
      })}
    </View>
  );
}

const LISTS: { value: TaskListKind; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'all', label: 'All open' },
  { value: 'completed', label: 'Done' },
];

function TasksPane() {
  const store = useStore();
  const toast = useToast();
  const ctx = useUserContext();
  const { today } = useToday(ctx.timeZone);
  const [list, setList] = useState<TaskListKind>('today');
  const tasks = useLive((s) => listTasks(s, list, today), [list, today], ['tasks']);
  const counts = useLive(
    (s) => s.query<{ inbox: number }>("SELECT COUNT(*) AS inbox FROM tasks WHERE deleted_at IS NULL AND status = 'inbox' AND archived_at IS NULL AND parent_task_id IS NULL"),
    [],
    ['tasks'],
  );
  const toggle = async (t: Task) => {
    try {
      if (t.status === 'completed') await reopenTask(store, t.id);
      else {
        const next = await completeTask(store, t.id, today);
        toast.show(next ? `Done. Next one scheduled for ${formatDateLabel(next.due_date ?? next.do_date ?? today)}` : 'Done', { action: { label: 'Undo', onPress: () => void reopenTask(store, t.id) } });
      }
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
    }
  };
  const inboxCount = counts.data?.[0]?.inbox ?? 0;
  return (
    <View style={{ gap: space.lg }}>
      <ChipGroup scroll options={LISTS.map((l) => ({ ...l, label: l.value === 'inbox' && inboxCount ? `Inbox ${inboxCount}` : l.label }))} value={list} onChange={setList} />
      {tasks.loading && !tasks.data ? (
        <LoadingState />
      ) : tasks.data?.length ? (
        <Group>
          {tasks.data.map((t) => (
            <ListRow
              key={t.id}
              leading={<Checkbox checked={t.status === 'completed'} label={`Complete ${t.title}`} onToggle={() => void toggle(t)} />}
              title={t.title}
              subtitle={[
                t.priority <= 2 ? `P${t.priority}` : null,
                t.due_date ? `due ${t.due_date === today ? 'today' : formatDateLabel(t.due_date)}` : null,
                t.estimated_minutes ? `${t.estimated_minutes} min` : null,
                t.status === 'inbox' ? 'not planned yet' : t.status === 'in_progress' ? 'in progress' : t.status === 'cancelled' ? 'cancelled' : null,
              ].filter(Boolean).join(' · ') || null}
              muted={t.status === 'completed' || t.status === 'cancelled'}
              chevron
              onPress={() => router.push({ pathname: '/(app)/task/[id]', params: { id: t.id } })}
            />
          ))}
        </Group>
      ) : (
        <EmptyState
          icon={CheckSquare}
          title={list === 'inbox' ? 'Inbox zero' : list === 'today' ? 'Nothing due today' : 'No tasks here'}
          body={list === 'inbox' ? 'Captured tasks wait here until you give them a time, estimate or goal.' : 'Add a task and ASCEND will find time for it.'}
          actionLabel="New task"
          onAction={() => router.push('/(app)/task/edit')}
          compact
        />
      )}
      {list === 'inbox' && tasks.data?.length ? (
        <Section>
          <Text variant="caption" tone="tertiary">Tip: open a task and add an estimate or date — it leaves the inbox and gets scheduled.</Text>
        </Section>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  weekDay: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,0.18)' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  monthCell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 4, gap: 2 },
  monthDay: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});

