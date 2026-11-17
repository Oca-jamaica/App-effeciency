import { describeFrequency, monthStatus, startOfMonth, addMonths, weekday, formatTime, parseTime } from '@ascend/domain';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLive, useStore } from '@/data/DataProvider';
import type { FrequencyKind, Habit, PreferredWindow } from '@/data/types';
import { ValidationError } from '@/data/validation';
import { showMenu } from '@/features/goals/GoalDetailScreen';
import { WEEKDAY_OPTIONS, WINDOW_OPTIONS, useCategoryOptions, useGoalOptions } from '@/features/shared/options';
import { useToday, useUserContext } from '@/hooks/useUser';
import {
  Button, Card, ChipGroup, DateTimeField, EmptyState, IconButton, LoadingState, Row, Screen, Section, SelectField, Stepper, Text, TextField,
  confirm, formatDateLabel, radius, space, useTheme, useToast,
} from '@/ui';
import { archiveHabit, createHabit, deleteHabit, habitStats, pauseHabit, resumeHabit, setHabitLog, toRule, updateHabit } from './repo';

export function HabitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const toast = useToast();
  const { colors } = useTheme();
  const ctx = useUserContext();
  const { today } = useToday(ctx.timeZone);
  const [month, setMonth] = useState(startOfMonth(today));
  const data = useLive(
    async (s) => {
      const habit = await s.get<Habit>('habits', id);
      if (!habit || habit.deleted_at) return null;
      return { habit, stats: await habitStats(s, habit, today, ctx.weekStartsOn) };
    },
    [id, today],
    ['habits', 'habit_logs'],
  );
  if (data.loading && !data.data) return <LoadingState />;
  if (!data.data) return <EmptyState title="This habit no longer exists" actionLabel="Back" onAction={() => router.back()} />;
  const { habit, stats } = data.data;
  const fail = (e: unknown) => toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
  const grid = monthStatus(toRule(habit), stats.logs.map((l) => ({ logDate: l.log_date, status: l.status })), month);
  const lead = (weekday(month) + 6) % 7; // Monday-first grid
  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

  const cycle = (date: string) => {
    if (date > today) return;
    const current = stats.logs.find((l) => l.log_date === date)?.status ?? null;
    const next = current === null ? 'done' : current === 'done' ? 'partial' : current === 'partial' ? 'skipped' : null;
    setHabitLog(store, habit.id, date, next).catch(fail);
  };

  const menu = () =>
    showMenu(habit.name, [
      { label: 'Edit habit', onPress: () => router.push({ pathname: '/(app)/habit/edit', params: { id } }) },
      habit.status === 'active'
        ? { label: 'Pause', onPress: () => pauseHabit(store, id, null).then(() => toast.show('Paused. Your history is kept.')).catch(fail) }
        : { label: 'Resume', onPress: () => resumeHabit(store, id).then(() => toast.show('Resumed')).catch(fail) },
      { label: 'Archive', onPress: () => archiveHabit(store, id).then(() => { toast.show('Habit archived'); router.back(); }).catch(fail) },
      {
        label: 'Delete habit',
        destructive: true,
        onPress: async () => {
          if (!(await confirm({ title: 'Delete this habit?', message: 'Its history will be hidden too. You can undo straight after.', confirmLabel: 'Delete', destructive: true }))) return;
          await deleteHabit(store, id);
          router.back();
          toast.show('Habit deleted', { action: { label: 'Undo', onPress: () => void store.restore('habits', id) } });
        },
      },
    ]);

  return (
    <>
      <Stack.Screen options={{ headerRight: () => <IconButton icon={MoreHorizontal} label="Habit options" onPress={menu} /> }} />
      <Screen edges="none">
        <View style={{ gap: space.xs }}>
          <Text variant="title">{habit.name}</Text>
          <Text variant="callout" tone="secondary">
            {describeFrequency(toRule(habit))}
            {habit.duration_minutes ? ` · ${habit.duration_minutes} min` : ''}
            {habit.preferred_time ? ` · around ${habit.preferred_time}` : ''}
            {habit.status === 'paused' ? ' · paused' : ''}
          </Text>
          {habit.description ? <Text variant="body" tone="secondary">{habit.description}</Text> : null}
        </View>

        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <StatBlock label="Last 30 days" value={pct(stats.c30.rate)} />
            <StatBlock label="Last 90 days" value={pct(stats.c90.rate)} />
            <StatBlock label="Times done" value={String(stats.total)} />
          </Row>
          <Text variant="caption" tone="secondary">
            Current run {stats.runs.current} {stats.runs.unit} · best {stats.runs.best}. A missed day lowers consistency a little — it never erases your progress.
          </Text>
        </Card>

        <Section title="History" hint="Tap a day to cycle: done → partly → rest day → clear.">
          <Row style={{ justifyContent: 'space-between' }}>
            <IconButton icon={ChevronLeft} label="Previous month" onPress={() => setMonth(addMonths(month, -1))} />
            <Text variant="subheading">{new Date(`${month}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
            <IconButton icon={ChevronRight} label="Next month" onPress={() => setMonth(addMonths(month, 1))} disabled={month >= startOfMonth(today)} />
          </Row>
          <View style={styles.grid}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <Text key={i} variant="caption" tone="tertiary" align="center" style={styles.cell}>{d}</Text>
            ))}
            {Array.from({ length: lead }, (_, i) => <View key={`l${i}`} style={styles.cell} />)}
            {grid.map((g) => {
              const bg = g.status === 'done' ? colors.accent : g.status === 'partial' ? colors.accentSoft : 'transparent';
              const future = g.date > today;
              return (
                <Pressable
                  key={g.date}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatDateLabel(g.date)}: ${g.status ?? (g.scheduled ? 'not done' : 'not scheduled')}`}
                  disabled={future}
                  onPress={() => cycle(g.date)}
                  style={styles.cell}
                >
                  <View
                    style={[
                      styles.day,
                      { backgroundColor: bg, borderColor: g.date === today ? colors.text : g.scheduled && !future ? colors.border : 'transparent' },
                      g.status === 'skipped' && { borderColor: colors.textTertiary, borderStyle: 'dashed' },
                    ]}
                  >
                    <Text variant="caption" tone={g.status === 'done' ? 'onAccent' : future ? 'tertiary' : 'primary'} tabular>{Number(g.date.slice(8))}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Section>

        {habit.notes ? (
          <Section title="Notes">
            <Text variant="body" tone="secondary">{habit.notes}</Text>
          </Section>
        ) : null}
      </Screen>
    </>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="numeric" tabular>{value}</Text>
      <Text variant="caption" tone="secondary">{label}</Text>
    </View>
  );
}

const FREQUENCIES: { value: FrequencyKind; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Specific days' },
  { value: 'times_per_week', label: 'Times a week' },
  { value: 'times_per_month', label: 'Times a month' },
  { value: 'every_n_days', label: 'Every few days' },
];

export function HabitEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const store = useStore();
  const toast = useToast();
  const ctx = useUserContext();
  const { today } = useToday(ctx.timeZone);
  const categories = useCategoryOptions();
  const goals = useGoalOptions();
  const [loaded, setLoaded] = useState(!id);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [freq, setFreq] = useState<FrequencyKind>('daily');
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [times, setTimes] = useState(3);
  const [interval, setInterval] = useState(2);
  const [duration, setDuration] = useState<number | null>(30);
  const [window, setWindow] = useState<PreferredWindow>('any');
  const [time, setTime] = useState<number | null>(null);
  const [reminder, setReminder] = useState<number | null>(null);
  const [startDate, setStartDate] = useState(today);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    store.get<Habit>('habits', id).then((h) => {
      if (!h) return;
      setName(h.name);
      setDescription(h.description ?? '');
      setFreq(h.frequency_kind);
      if (h.days_of_week?.length) setDays(h.days_of_week);
      if (h.times_per_period) setTimes(h.times_per_period);
      if (h.interval_days) setInterval(h.interval_days);
      setDuration(h.duration_minutes);
      setWindow(h.preferred_window);
      setTime(h.preferred_time ? parseTime(h.preferred_time) : null);
      setReminder(h.reminder_times[0] ? parseTime(h.reminder_times[0]) : null);
      setStartDate(h.start_date);
      setCategoryId(h.category_id);
      setGoalId(h.goal_id);
      setTarget(h.target_value !== null ? String(h.target_value) : '');
      setUnit(h.target_unit ?? '');
      setNotes(h.notes ?? '');
      setLoaded(true);
    });
  }, [id, store]);

  const save = async () => {
    setSaving(true);
    try {
      const input = {
        name,
        description,
        frequency_kind: freq,
        days_of_week: freq === 'weekdays' || freq === 'times_per_week' ? days : null,
        times_per_period: freq === 'times_per_week' || freq === 'times_per_month' ? times : null,
        interval_days: freq === 'every_n_days' ? interval : null,
        duration_minutes: duration,
        preferred_window: window,
        preferred_time: time !== null ? formatTime(time) : null,
        reminder_times: reminder !== null ? [formatTime(reminder)] : [],
        start_date: startDate,
        category_id: categoryId,
        goal_id: goalId,
        target_value: target.trim() ? Number(target) : null,
        target_unit: unit,
        notes,
      };
      if (id) await updateHabit(store, id, input);
      else await createHabit(store, input);
      toast.show(id ? 'Habit saved' : 'Habit created. It will appear in your plan on the days it’s due.');
      router.back();
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fields);
      else toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;
  const toggleDay = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  return (
    <Screen edges="none" keyboard footer={<Button label={id ? 'Save changes' : 'Create habit'} onPress={save} loading={saving} />}>
      <TextField label="Habit" value={name} onChangeText={setName} error={errors.name} placeholder="e.g. Read, revision, weak-foot drills" autoFocus={!id} />
      <TextField label="Description" value={description} onChangeText={setDescription} multiline minLines={2} />
      <View style={{ gap: space.sm }}>
        <Text variant="captionStrong" tone="secondary">How often</Text>
        <ChipGroup options={FREQUENCIES} value={freq} onChange={setFreq} />
        {errors.frequency_kind ? <Text variant="caption" tone="danger">{errors.frequency_kind}</Text> : null}
      </View>
      {freq === 'times_per_week' || freq === 'times_per_month' ? (
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="body">Times per {freq === 'times_per_week' ? 'week' : 'month'}</Text>
          <Stepper value={times} onChange={setTimes} min={1} max={freq === 'times_per_week' ? 7 : 31} />
        </Row>
      ) : null}
      {freq === 'every_n_days' ? (
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="body">Every</Text>
          <Stepper value={interval} onChange={setInterval} min={2} max={60} format={(v) => `${v} days`} />
        </Row>
      ) : null}
      {freq === 'weekdays' || freq === 'times_per_week' ? (
        <View style={{ gap: space.sm }}>
          <Text variant="captionStrong" tone="secondary">{freq === 'weekdays' ? 'On these days' : 'Preferred days (optional)'}</Text>
          <ChipGroup options={WEEKDAY_OPTIONS} value={days} onChange={toggleDay} />
        </View>
      ) : null}
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text variant="body">Time to block out</Text>
          <Text variant="caption" tone="secondary">Used to fit it into your day. Off = no time block.</Text>
        </View>
        <Stepper value={duration ?? 0} onChange={(v) => setDuration(v === 0 ? null : v)} min={0} max={240} step={5} format={(v) => (v === 0 ? 'Off' : `${v} min`)} />
      </Row>
      <View style={{ gap: space.sm }}>
        <Text variant="captionStrong" tone="secondary">Best time of day</Text>
        <ChipGroup options={WINDOW_OPTIONS.slice(0, 4)} value={window} onChange={setWindow} />
      </View>
      <DateTimeField label="Preferred time (optional)" mode="time" value={time} onChange={setTime} allowClear />
      <DateTimeField label="Reminder (optional)" mode="time" value={reminder} onChange={setReminder} allowClear />
      <DateTimeField label="Start date" mode="date" value={startDate} onChange={setStartDate} />
      <SelectField label="Category" value={categoryId} options={categories} onChange={setCategoryId} allowClear placeholder="No category" />
      <SelectField label="Supports goal" value={goalId} options={goals} onChange={setGoalId} allowClear placeholder="No goal" />
      <Row>
        <View style={{ flex: 1 }}><TextField label="Target per session (optional)" value={target} onChangeText={setTarget} keyboardType="decimal-pad" /></View>
        <View style={{ flex: 1 }}><TextField label="Unit" value={unit} onChangeText={setUnit} placeholder="pages, km…" /></View>
      </Row>
      <TextField label="Notes" value={notes} onChangeText={setNotes} multiline minLines={3} />
      <View style={{ height: space.md, borderRadius: radius.sm }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 },
  day: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
