import { describeRule, formatTime, parseRRule, parseTime } from '@ascend/domain';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { MoreHorizontal, Plus } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLive, useStore } from '@/data/DataProvider';
import type { Goal, Milestone, PreferredWindow, Task } from '@/data/types';
import { ValidationError } from '@/data/validation';
import { showMenu } from '@/features/goals/GoalDetailScreen';
import { WINDOW_OPTIONS, useCategoryOptions, useGoalOptions, useMilestoneOptions } from '@/features/shared/options';
import { useToday, useUserContext } from '@/hooks/useUser';
import {
  Badge, Button, Card, Checkbox, ChipGroup, DateTimeField, EmptyState, Group, IconButton, ListRow, LoadingState, Row, Screen, Section, SelectField,
  Sheet, Stepper, Text, TextField, ToggleRow, confirm, formatDateLabel, space, useToast,
} from '@/ui';
import {
  PRIORITY_LABELS, STATUS_LABELS, archiveTask, cancelTask, completeTask, createTask, deleteTask, listSubtasks, reopenTask, restoreTask, setTaskStatus,
  splitTask, taskHistory, updateTask,
} from './repo';

const EVENT_LABELS: Record<string, string> = {
  created: 'Created',
  status_changed: 'Status changed',
  rescheduled: 'Rescheduled',
  estimate_changed: 'Estimate changed',
  due_changed: 'Deadline changed',
  split: 'Split into parts',
  linked: 'Linked',
  completed: 'Completed',
  reopened: 'Reopened',
  edited: 'Edited',
};

export function TaskDetailScreen() {
  const { id, split } = useLocalSearchParams<{ id: string; split?: string }>();
  const store = useStore();
  const toast = useToast();
  const ctx = useUserContext();
  const { today } = useToday(ctx.timeZone);
  const [newSub, setNewSub] = useState('');
  const [splitOpen, setSplitOpen] = useState(split === '1');
  const data = useLive(
    async (s) => {
      const task = await s.get<Task>('tasks', id);
      if (!task || task.deleted_at) return null;
      const [subtasks, history, goal, milestone] = await Promise.all([
        listSubtasks(s, id),
        taskHistory(s, id),
        task.goal_id ? s.get<Goal>('goals', task.goal_id) : null,
        task.milestone_id ? s.get<Milestone>('milestones', task.milestone_id) : null,
      ]);
      return { task, subtasks, history, goal: goal?.deleted_at ? null : goal, milestone: milestone?.deleted_at ? null : milestone };
    },
    [id],
    ['tasks', 'task_events', 'goals', 'milestones'],
  );
  if (data.loading && !data.data) return <LoadingState />;
  if (!data.data) return <EmptyState title="This task no longer exists" actionLabel="Back" onAction={() => router.back()} />;
  const { task, subtasks, history, goal, milestone } = data.data;
  const fail = (e: unknown) => toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
  const closed = task.status === 'completed' || task.status === 'cancelled';

  const menu = () =>
    showMenu(task.title, [
      { label: 'Edit', onPress: () => router.push({ pathname: '/(app)/task/edit', params: { id } }) },
      ...(!closed ? [{ label: task.status === 'in_progress' ? 'Mark as planned' : 'Mark in progress', onPress: () => setTaskStatus(store, id, task.status === 'in_progress' ? 'planned' : 'in_progress').catch(fail) }] : []),
      { label: 'Break into smaller tasks', onPress: () => setSplitOpen(true) },
      ...(!closed ? [{ label: 'Cancel task', onPress: () => cancelTask(store, id).then(() => toast.show('Task cancelled')).catch(fail) }] : []),
      { label: task.archived_at ? 'Unarchive' : 'Archive', onPress: () => archiveTask(store, id, !task.archived_at).catch(fail) },
      {
        label: 'Delete task',
        destructive: true,
        onPress: async () => {
          if (!(await confirm({ title: 'Delete this task?', message: subtasks.length ? 'Its subtasks are deleted too. You can undo straight after.' : 'You can undo straight after.', confirmLabel: 'Delete', destructive: true }))) return;
          await deleteTask(store, id);
          router.back();
          toast.show('Task deleted', { action: { label: 'Undo', onPress: () => void restoreTask(store, id) } });
        },
      },
    ]);

  return (
    <>
      <Stack.Screen options={{ headerRight: () => <IconButton icon={MoreHorizontal} label="Task options" onPress={menu} /> }} />
      <Screen edges="none">
        <View style={{ gap: space.sm }}>
          <Row style={{ alignItems: 'flex-start' }}>
            <View style={{ paddingTop: 4 }}>
              <Checkbox
                checked={task.status === 'completed'}
                label={task.status === 'completed' ? 'Reopen task' : 'Complete task'}
                onToggle={() => (task.status === 'completed' ? reopenTask(store, id) : completeTask(store, id, today).then(() => toast.show('Done'))).catch(fail)}
              />
            </View>
            <Text variant="title" style={{ flex: 1 }}>{task.title}</Text>
          </Row>
          <Row style={{ flexWrap: 'wrap' }}>
            <Badge label={STATUS_LABELS[task.status]} tone={task.status === 'completed' ? 'success' : task.status === 'in_progress' ? 'accent' : 'neutral'} />
            <Badge label={PRIORITY_LABELS[task.priority] ?? `P${task.priority}`} tone={task.priority <= 2 ? 'warning' : 'neutral'} />
            {task.archived_at ? <Badge label="Archived" /> : null}
          </Row>
          {task.description ? <Text variant="body" tone="secondary">{task.description}</Text> : null}
        </View>

        <Group>
          <ListRow title="Deadline" trailing={<Text variant="callout" tone="secondary">{task.due_date ? `${formatDateLabel(task.due_date)}${task.due_time ? ` ${task.due_time}` : ''}` : 'None'}</Text>} />
          <ListRow title="Planned for" trailing={<Text variant="callout" tone="secondary">{task.do_date ? formatDateLabel(task.do_date) : 'Any day'}</Text>} />
          <ListRow title="Estimate" trailing={<Text variant="callout" tone="secondary">{task.estimated_minutes ? `${task.estimated_minutes} min${task.splittable ? ' · can split' : ''}` : 'Not set'}</Text>} />
          {task.recurrence_rule ? <ListRow title="Repeats" trailing={<Text variant="callout" tone="secondary">{safeDescribe(task.recurrence_rule)}</Text>} /> : null}
          <ListRow title="Goal" trailing={<Text variant="callout" tone={goal ? 'accent' : 'secondary'}>{goal?.title ?? 'None'}</Text>} onPress={goal ? () => router.push({ pathname: '/(app)/goal/[id]', params: { id: goal.id } }) : undefined} />
          {milestone ? <ListRow title="Milestone" trailing={<Text variant="callout" tone="secondary">{milestone.title}</Text>} /> : null}
        </Group>

        {task.notes ? (
          <Section title="Notes">
            <Card><Text variant="body">{task.notes}</Text></Card>
          </Section>
        ) : null}

        <Section title="Subtasks">
          {subtasks.length ? (
            <Group>
              {subtasks.map((s) => (
                <ListRow
                  key={s.id}
                  leading={<Checkbox checked={s.status === 'completed'} label={s.title} onToggle={() => (s.status === 'completed' ? reopenTask(store, s.id) : completeTask(store, s.id, today)).catch(fail)} />}
                  title={s.title}
                  subtitle={s.estimated_minutes ? `${s.estimated_minutes} min` : null}
                  muted={s.status === 'completed'}
                  chevron
                  onPress={() => router.push({ pathname: '/(app)/task/[id]', params: { id: s.id } })}
                />
              ))}
            </Group>
          ) : null}
          <TextField
            placeholder="Add a subtask…"
            value={newSub}
            onChangeText={setNewSub}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (!newSub.trim()) return;
              createTask(store, { title: newSub, parent_task_id: id, goal_id: task.goal_id, milestone_id: task.milestone_id, status: 'planned', priority: task.priority })
                .then(() => setNewSub(''))
                .catch(fail);
            }}
          />
          {subtasks.length ? <Text variant="caption" tone="tertiary">When a task has subtasks, the subtasks are scheduled instead of the whole task.</Text> : null}
        </Section>

        <Section title="History">
          <Group>
            {history.slice(0, 15).map((h) => (
              <ListRow key={h.id} title={EVENT_LABELS[h.event_type] ?? h.event_type} subtitle={`${new Date(h.occurred_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${h.origin !== 'user' ? ` · by ${h.origin === 'ai' ? 'ASCEND AI (approved)' : 'the scheduler'}` : ''}${describeChange(h.to_value)}`} />
            ))}
          </Group>
        </Section>
      </Screen>
      {splitOpen ? <SplitSheet task={task} onClose={() => setSplitOpen(false)} /> : null}
    </>
  );
}

function safeDescribe(rule: string): string {
  try {
    return describeRule(parseRRule(rule));
  } catch {
    return rule;
  }
}

function describeChange(v: unknown): string {
  if (!v || typeof v !== 'object') return '';
  const entries = Object.entries(v as Record<string, unknown>).filter(([k]) => k !== 'repeat_of' && k !== 'parts');
  if (!entries.length) return '';
  return ' · ' + entries.map(([k, val]) => `${k.replace(/_/g, ' ')}: ${val ?? 'none'}`).join(', ');
}

function SplitSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const base = task.estimated_minutes ? Math.max(10, Math.round(task.estimated_minutes / 2 / 5) * 5) : 25;
  const [parts, setParts] = useState([{ title: '', minutes: base }, { title: '', minutes: base }]);
  const save = async () => {
    try {
      const clean = parts.filter((p) => p.title.trim());
      await splitTask(store, task.id, clean.map((p) => ({ title: p.title, estimated_minutes: p.minutes })));
      toast.show(`Split into ${clean.length} smaller tasks`);
      onClose();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
    }
  };
  return (
    <Sheet visible onClose={onClose} title="Break it down" footer={<Button label="Create parts" onPress={save} />}>
      <Text variant="callout" tone="secondary">Smaller steps are easier to start. Each part is scheduled on its own.</Text>
      {parts.map((p, i) => (
        <View key={i} style={{ gap: space.sm }}>
          <TextField label={`Part ${i + 1}`} value={p.title} onChangeText={(t) => setParts((cur) => cur.map((x, j) => (j === i ? { ...x, title: t } : x)))} />
          <Stepper value={p.minutes} onChange={(m) => setParts((cur) => cur.map((x, j) => (j === i ? { ...x, minutes: m } : x)))} min={5} max={240} step={5} format={(v) => `${v} min`} />
        </View>
      ))}
      <Button label="Add another part" variant="ghost" icon={Plus} onPress={() => setParts((cur) => [...cur, { title: '', minutes: base }])} />
    </Sheet>
  );
}

const REPEATS = [
  { value: '', label: 'Never' },
  { value: 'FREQ=DAILY', label: 'Daily' },
  { value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: 'Weekdays' },
  { value: 'FREQ=WEEKLY', label: 'Weekly' },
  { value: 'FREQ=WEEKLY;INTERVAL=2', label: 'Every 2 weeks' },
  { value: 'FREQ=MONTHLY', label: 'Monthly' },
];

export function TaskEditScreen() {
  const params = useLocalSearchParams<{ id?: string; goal_id?: string; milestone_id?: string; title?: string; project_id?: string }>();
  const id = params.id;
  const store = useStore();
  const toast = useToast();
  const ctx = useUserContext();
  const { today } = useToday(ctx.timeZone);
  const categories = useCategoryOptions();
  const goals = useGoalOptions();
  const [loaded, setLoaded] = useState(!id);
  const [title, setTitle] = useState(params.title ?? '');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState(3);
  const [due, setDue] = useState<string | null>(null);
  const [dueTime, setDueTime] = useState<number | null>(null);
  const [doDate, setDoDate] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<number>(30);
  const [hasEstimate, setHasEstimate] = useState(!id);
  const [splittable, setSplittable] = useState(false);
  const [window, setWindow] = useState<PreferredWindow>('any');
  const [goalId, setGoalId] = useState<string | null>(params.goal_id ?? null);
  const [milestoneId, setMilestoneId] = useState<string | null>(params.milestone_id ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [repeat, setRepeat] = useState('');
  const [projectId, setProjectId] = useState<string | null>(params.project_id ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const milestones = useMilestoneOptions(goalId);

  useEffect(() => {
    if (!id) return;
    store.get<Task>('tasks', id).then((t) => {
      if (!t) return;
      setTitle(t.title);
      setDescription(t.description ?? '');
      setNotes(t.notes ?? '');
      setPriority(t.priority);
      setDue(t.due_date);
      setDueTime(t.due_time ? parseTime(t.due_time) : null);
      setDoDate(t.do_date);
      setEstimate(t.estimated_minutes ?? 30);
      setHasEstimate(t.estimated_minutes !== null);
      setSplittable(t.splittable);
      setWindow(t.preferred_window);
      setGoalId(t.goal_id);
      setMilestoneId(t.milestone_id);
      setCategoryId(t.category_id);
      setRepeat(t.recurrence_rule ?? '');
      setProjectId(t.project_id);
      setLoaded(true);
    });
  }, [id, store]);

  const save = async () => {
    setSaving(true);
    try {
      const input = {
        title,
        description,
        notes,
        priority,
        due_date: due,
        due_time: due && dueTime !== null ? formatTime(dueTime) : null,
        do_date: doDate,
        estimated_minutes: hasEstimate ? estimate : null,
        splittable,
        preferred_window: window,
        goal_id: goalId,
        milestone_id: milestoneId,
        category_id: categoryId,
        recurrence_rule: repeat || null,
        project_id: projectId,
      };
      if (id) await updateTask(store, id, input);
      else await createTask(store, input);
      toast.show(id ? 'Task saved' : hasEstimate || due || doDate || goalId ? 'Task added and scheduled' : 'Added to your inbox');
      router.back();
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fields);
      else toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;
  return (
    <Screen edges="none" keyboard footer={<Button label={id ? 'Save changes' : 'Add task'} onPress={save} loading={saving} />}>
      <TextField label="Task" value={title} onChangeText={setTitle} error={errors.title} autoFocus={!id} placeholder="What needs doing?" />
      <View style={{ gap: space.sm }}>
        <Text variant="captionStrong" tone="secondary">Priority</Text>
        <ChipGroup options={[1, 2, 3, 4].map((p) => ({ value: p, label: PRIORITY_LABELS[p]! }))} value={priority} onChange={setPriority} />
      </View>
      <View style={{ gap: space.sm }}>
        <ToggleRow label="Time estimate" description="Needed to fit it into your day." value={hasEstimate} onChange={setHasEstimate} />
        {hasEstimate ? <Stepper value={estimate} onChange={setEstimate} min={5} max={600} step={5} format={(v) => (v >= 60 ? `${Math.floor(v / 60)}h ${v % 60 ? `${v % 60}m` : ''}`.trim() : `${v} min`)} /> : null}
        {hasEstimate ? <ToggleRow label="Can be split across the day" value={splittable} onChange={setSplittable} /> : null}
      </View>
      <DateTimeField label="Deadline" mode="date" value={due} onChange={setDue} allowClear error={errors.due_date} />
      {due ? <DateTimeField label="Deadline time (optional)" mode="time" value={dueTime} onChange={setDueTime} allowClear /> : null}
      <DateTimeField label="Do it on (optional)" mode="date" value={doDate} onChange={setDoDate} allowClear minimumDate={today} />
      <SelectField label="Goal" value={goalId} options={goals} onChange={(v) => { setGoalId(v); setMilestoneId(null); }} allowClear placeholder="No goal" />
      {goalId && milestones.length ? <SelectField label="Milestone" value={milestoneId} options={milestones} onChange={setMilestoneId} allowClear placeholder="No milestone" /> : null}
      <SelectField label="Category" value={categoryId} options={categories} onChange={setCategoryId} allowClear placeholder="No category" />
      <View style={{ gap: space.sm }}>
        <Text variant="captionStrong" tone="secondary">Best time</Text>
        <ChipGroup options={WINDOW_OPTIONS} value={window} onChange={setWindow} />
      </View>
      <SelectField label="Repeat" value={repeat} options={REPEATS} onChange={setRepeat} error={errors.recurrence_rule} />
      <TextField label="Description" value={description} onChangeText={setDescription} multiline minLines={3} />
      <TextField label="Notes" value={notes} onChangeText={setNotes} multiline minLines={3} />
    </Screen>
  );
}
