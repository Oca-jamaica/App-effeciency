import { formatHours } from '@ascend/domain';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FolderKanban, MoreHorizontal } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLive, useStore } from '@/data/DataProvider';
import type { Project } from '@/data/types';
import { ValidationError } from '@/data/validation';
import { showMenu } from '@/features/goals/GoalDetailScreen';
import { saveNote } from '@/features/goals/repo';
import { useGoalOptions } from '@/features/shared/options';
import { STATUS_LABELS } from '@/features/tasks/repo';
import { useToday, useUserContext } from '@/hooks/useUser';
import {
  Badge, Button, Card, Checkbox, ChipGroup, DateTimeField, EmptyState, Group, IconButton, ListRow, LoadingState, ProgressBar, Row, Screen, Section,
  SegmentedControl, SelectField, Sheet, Text, TextField, confirm, formatDateLabel, space, useToast,
} from '@/ui';
import {
  PROJECT_STATUS_LABELS, addProjectMilestone, addStage, createProject, deleteProject, deleteStage, listProjects, loadProjectDetail, setProjectMilestoneDone,
  setProjectStatus, setStageDone, updateProject,
} from './repo';
import { projectProgress } from '@ascend/domain';

/** Goals → Projects: projects and missions with progress. */
export function ProjectList() {
  const [kind, setKind] = useState<'all' | 'project' | 'mission'>('all');
  const data = useLive(
    async (s) => {
      const projects = await listProjects(s, kind === 'all' ? undefined : kind, true);
      const ms = await s.query<{ project_id: string; status: string }>("SELECT project_id, status FROM milestones WHERE deleted_at IS NULL AND project_id IS NOT NULL");
      const ts = await s.query<{ project_id: string; status: string }>("SELECT project_id, status FROM tasks WHERE deleted_at IS NULL AND project_id IS NOT NULL AND parent_task_id IS NULL");
      const st = await s.query<{ project_id: string; status: string }>("SELECT project_id, status FROM project_stages WHERE deleted_at IS NULL");
      return projects.map((p) => ({
        p,
        progress: projectProgress({ milestones: ms.filter((m) => m.project_id === p.id), tasks: ts.filter((t) => t.project_id === p.id), stages: st.filter((x) => x.project_id === p.id) }),
      }));
    },
    [kind],
    ['projects', 'milestones', 'tasks', 'project_stages'],
  );
  if (data.loading && !data.data) return <LoadingState />;
  const open = (data.data ?? []).filter(({ p }) => p.status !== 'completed' && p.status !== 'archived');
  const closed = (data.data ?? []).filter(({ p }) => p.status === 'completed' || p.status === 'archived');
  return (
    <View style={{ gap: space.xxl }}>
      <SegmentedControl segments={[{ value: 'all', label: 'All' }, { value: 'project', label: 'Projects' }, { value: 'mission', label: 'Missions' }]} value={kind} onChange={setKind} />
      {!open.length && !closed.length ? (
        <EmptyState
          icon={FolderKanban}
          title="Bigger pieces of work"
          body="A project is a body of work with milestones and tasks. A mission is a time-boxed push towards one objective, in stages."
          actionLabel="New project"
          onAction={() => router.push('/(app)/project/edit')}
        />
      ) : null}
      {open.length ? (
        <Group>
          {open.map(({ p, progress }) => (
            <View key={p.id}>
              <ListRow
                title={p.title}
                subtitle={[p.kind === 'mission' ? 'Mission' : 'Project', PROJECT_STATUS_LABELS[p.status], progress.label, p.deadline ? `by ${formatDateLabel(p.deadline)}` : null].filter(Boolean).join(' · ')}
                chevron
                onPress={() => router.push({ pathname: '/(app)/project/[id]', params: { id: p.id } })}
              />
              <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, marginTop: -space.xs }}>
                <ProgressBar value={progress.ratio} />
              </View>
            </View>
          ))}
        </Group>
      ) : null}
      {closed.length ? (
        <Section title="Completed & archived">
          <Group>
            {closed.map(({ p }) => (
              <ListRow key={p.id} title={p.title} subtitle={PROJECT_STATUS_LABELS[p.status]} muted={p.status === 'completed'} chevron onPress={() => router.push({ pathname: '/(app)/project/[id]', params: { id: p.id } })} />
            ))}
          </Group>
        </Section>
      ) : null}
    </View>
  );
}

export function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const toast = useToast();
  const data = useLive((s) => loadProjectDetail(s, id), [id], ['projects', 'project_stages', 'milestones', 'tasks', 'notes', 'focus_sessions']);
  const [sheet, setSheet] = useState<null | 'stage' | 'milestone' | 'note' | 'complete'>(null);
  if (data.loading && !data.data) return <LoadingState />;
  const d = data.data;
  if (!d) return <EmptyState title="This project no longer exists" actionLabel="Back" onAction={() => router.back()} />;
  const { project: p } = d;
  const fail = (e: unknown) => toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
  const menu = () =>
    showMenu(p.title, [
      { label: 'Edit', onPress: () => router.push({ pathname: '/(app)/project/edit', params: { id } }) },
      ...(p.status === 'active' ? [{ label: 'Put on hold', onPress: () => setProjectStatus(store, id, 'on_hold').catch(fail) }] : [{ label: 'Make active', onPress: () => setProjectStatus(store, id, 'active').catch(fail) }]),
      ...(p.status !== 'completed' ? [{ label: p.kind === 'mission' ? 'Complete mission' : 'Complete project', onPress: () => setSheet('complete') }] : []),
      { label: 'Archive', onPress: () => setProjectStatus(store, id, 'archived').then(() => toast.show('Archived')).catch(fail) },
      {
        label: 'Delete',
        destructive: true,
        onPress: async () => {
          if (!(await confirm({ title: `Delete this ${p.kind}?`, message: 'Its stages, milestones and notes go with it. Linked tasks are kept. You can undo straight after.', confirmLabel: 'Delete', destructive: true }))) return;
          await deleteProject(store, id);
          router.back();
          toast.show('Deleted', { action: { label: 'Undo', onPress: () => void store.restore('projects', id) } });
        },
      },
    ]);

  const milestonesByStage = (stageId: string | null) => d.milestones.filter((m) => (m.stage_id ?? null) === stageId);
  const milestoneRows = (list: typeof d.milestones) =>
    list.map((m) => (
      <ListRow
        key={m.id}
        leading={<Checkbox checked={m.status === 'done'} label={`${m.title} done`} onToggle={() => setProjectMilestoneDone(store, m.id, m.status !== 'done').catch(fail)} />}
        title={m.title}
        subtitle={m.deadline ? `By ${formatDateLabel(m.deadline)}` : null}
        muted={m.status === 'done'}
        onLongPress={() => showMenu(m.title, [{ label: 'Delete milestone', destructive: true, onPress: () => store.remove('milestones', m.id).catch(fail) }])}
      />
    ));

  return (
    <>
      <Stack.Screen options={{ title: '', headerRight: () => <IconButton icon={MoreHorizontal} label="Options" onPress={menu} /> }} />
      <Screen edges="none">
        <View style={{ gap: space.sm }}>
          <Row>
            <Badge label={p.kind === 'mission' ? 'Mission' : 'Project'} tone="accent" />
            <Badge label={PROJECT_STATUS_LABELS[p.status]} tone={p.status === 'completed' ? 'success' : 'neutral'} />
            {p.deadline ? <Text variant="caption" tone="secondary">By {formatDateLabel(p.deadline)}</Text> : null}
          </Row>
          <Text variant="title">{p.title}</Text>
          {p.objective ? <Text variant="body"><Text variant="bodyStrong">Objective: </Text>{p.objective}</Text> : null}
          {p.description ? <Text variant="body" tone="secondary">{p.description}</Text> : null}
        </View>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="subheading">Progress</Text>
            <Text variant="caption" tone="secondary">{d.progress.ratio !== null ? `${Math.round(d.progress.ratio * 100)}%` : ''}</Text>
          </Row>
          <ProgressBar value={d.progress.ratio} height={6} />
          <Text variant="caption" tone="secondary">
            {d.progress.label}
            {d.progress.stagesTotal && !d.progress.label.endsWith('stages') ? ` · ${d.progress.stagesDone} of ${d.progress.stagesTotal} stages` : ''}
            {d.focusMinutes ? ` · ${formatHours(d.focusMinutes)} focused` : ''}
          </Text>
        </Card>
        {p.status === 'completed' && p.completion_summary ? (
          <Section title="Completion summary">
            <Card><Text variant="body">{p.completion_summary}</Text></Card>
          </Section>
        ) : null}

        {p.kind === 'mission' || d.stages.length ? (
          <Section title="Stages" action="Add stage" onAction={() => setSheet('stage')}>
            {d.stages.map((st, i) => (
              <View key={st.id} style={{ gap: space.xs }}>
                <Row>
                  <Checkbox shape="square" checked={st.status === 'done'} label={`Stage ${st.title} done`} onToggle={() => setStageDone(store, st.id, st.status !== 'done').catch(fail)} />
                  <Text variant="bodyStrong" style={{ flex: 1 }} onLongPress={() => showMenu(st.title, [{ label: 'Delete stage', destructive: true, onPress: () => deleteStage(store, st.id).catch(fail) }])}>
                    {i + 1}. {st.title}
                  </Text>
                  {st.deadline ? <Text variant="caption" tone="secondary">{formatDateLabel(st.deadline)}</Text> : null}
                </Row>
                {milestonesByStage(st.id).length ? <Group>{milestoneRows(milestonesByStage(st.id))}</Group> : null}
              </View>
            ))}
            {!d.stages.length ? <Text variant="callout" tone="secondary">Break the mission into stages, each with its own milestones.</Text> : null}
          </Section>
        ) : null}

        <Section title="Milestones" action="Add" onAction={() => setSheet('milestone')}>
          {milestonesByStage(null).length ? <Group>{milestoneRows(milestonesByStage(null))}</Group> : <Text variant="callout" tone="secondary">Checkpoints that show real progress.</Text>}
        </Section>

        <Section title="Tasks" action="Add task" onAction={() => router.push({ pathname: '/(app)/task/edit', params: { project_id: id, goal_id: p.goal_id ?? undefined } })}>
          {d.tasks.length ? (
            <Group>
              {d.tasks.map((t) => (
                <ListRow key={t.id} title={t.title} subtitle={STATUS_LABELS[t.status]} muted={t.status === 'completed'} chevron onPress={() => router.push({ pathname: '/(app)/task/[id]', params: { id: t.id } })} />
              ))}
            </Group>
          ) : (
            <Text variant="callout" tone="secondary">Tasks added here are scheduled into your days like any other.</Text>
          )}
        </Section>

        <Section title="Notes" action="Add note" onAction={() => setSheet('note')}>
          {d.notes.length ? (
            <Group>{d.notes.map((n) => <ListRow key={n.id} title={n.title || n.body.split('\n')[0] || 'Untitled'} subtitle={n.title ? n.body.slice(0, 120) : null} />)}</Group>
          ) : (
            <Text variant="callout" tone="secondary">Research, decisions and anything else about this {p.kind}.</Text>
          )}
        </Section>
      </Screen>
      {sheet === 'stage' ? <TitleSheet title="New stage" withDate onClose={() => setSheet(null)} onSave={(t, date) => addStage(store, id, t, date)} /> : null}
      {sheet === 'milestone' ? (
        <TitleSheet
          title="New milestone"
          withDate
          stages={d.stages.map((s) => ({ value: s.id, label: s.title }))}
          onClose={() => setSheet(null)}
          onSave={(t, date, stageId) => addProjectMilestone(store, id, { title: t, deadline: date, stageId })}
        />
      ) : null}
      {sheet === 'note' ? <NoteSheet projectId={id} onClose={() => setSheet(null)} /> : null}
      {sheet === 'complete' ? <CompleteSheet project={p} onClose={() => setSheet(null)} /> : null}
    </>
  );
}

function TitleSheet({ title, withDate, stages, onClose, onSave }: { title: string; withDate?: boolean; stages?: { value: string; label: string }[]; onClose: () => void; onSave: (t: string, date: string | null, stageId: string | null) => Promise<unknown> }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [date, setDate] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      visible
      onClose={onClose}
      title={title}
      footer={
        <Button
          label="Add"
          onPress={() =>
            onSave(text, date, stageId)
              .then(() => {
                toast.show('Added');
                onClose();
              })
              .catch((e) => setError(e instanceof ValidationError ? e.message : String(e)))
          }
        />
      }
    >
      <TextField label="Title" value={text} onChangeText={setText} error={error} autoFocus />
      {withDate ? <DateTimeField label="Deadline (optional)" mode="date" value={date} onChange={setDate} allowClear /> : null}
      {stages?.length ? (
        <View style={{ gap: space.xs }}>
          <Text variant="captionStrong" tone="secondary">Stage (optional)</Text>
          <ChipGroup options={stages} value={stageId} onChange={(v) => setStageId(v === stageId ? null : v)} />
        </View>
      ) : null}
    </Sheet>
  );
}

function NoteSheet({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  return (
    <Sheet
      visible
      onClose={onClose}
      title="New note"
      footer={
        <Button
          label="Save"
          onPress={async () => {
            try {
              const n = await saveNote(store, { title, body, note_type: 'research' });
              await store.update('notes', n.id, { project_id: projectId });
              toast.show('Note saved');
              onClose();
            } catch (e) {
              toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
            }
          }}
        />
      }
    >
      <TextField label="Title" value={title} onChangeText={setTitle} />
      <TextField label="Note" value={body} onChangeText={setBody} multiline minLines={6} />
    </Sheet>
  );
}

function CompleteSheet({ project, onClose }: { project: Project; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [summary, setSummary] = useState('');
  return (
    <Sheet
      visible
      onClose={onClose}
      title={`Complete ${project.kind}`}
      footer={
        <Button
          label="Mark complete"
          onPress={() =>
            setProjectStatus(store, project.id, 'completed', summary)
              .then(() => {
                toast.show(`${project.kind === 'mission' ? 'Mission' : 'Project'} complete. Well done.`);
                onClose();
              })
              .catch((e) => toast.show(String(e), { kind: 'error' }))
          }
        />
      }
    >
      <Text variant="body" tone="secondary">What did you achieve, and what would you do differently next time?</Text>
      <TextField label="Completion summary" value={summary} onChangeText={setSummary} multiline minLines={5} />
    </Sheet>
  );
}

export function ProjectEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const store = useStore();
  const toast = useToast();
  const ctx = useUserContext();
  const { today } = useToday(ctx.timeZone);
  const goals = useGoalOptions();
  const [loaded, setLoaded] = useState(!id);
  const [kind, setKind] = useState<'project' | 'mission'>('project');
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [description, setDescription] = useState('');
  const [goalId, setGoalId] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!id) return;
    store.get<Project>('projects', id).then((p) => {
      if (!p) return;
      setKind(p.kind);
      setTitle(p.title);
      setObjective(p.objective ?? '');
      setDescription(p.description ?? '');
      setGoalId(p.goal_id);
      setStart(p.start_date);
      setDeadline(p.deadline);
      setLoaded(true);
    });
  }, [id, store]);
  const save = async () => {
    try {
      const input = { kind, title, objective, description, goal_id: goalId, start_date: start, deadline };
      if (id) {
        await updateProject(store, id, input);
        router.back();
      } else {
        const p = await createProject(store, input);
        router.replace({ pathname: '/(app)/project/[id]', params: { id: p.id } });
      }
      toast.show('Saved');
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fields);
      else toast.show(String(e), { kind: 'error' });
    }
  };
  if (!loaded) return null;
  return (
    <Screen edges="none" keyboard footer={<Button label={id ? 'Save changes' : kind === 'mission' ? 'Create mission' : 'Create project'} onPress={() => void save()} />}>
      {!id ? <SegmentedControl segments={[{ value: 'project', label: 'Project' }, { value: 'mission', label: 'Mission' }]} value={kind} onChange={setKind} /> : null}
      <Text variant="caption" tone="secondary">
        {kind === 'mission' ? 'A mission is a focused push towards one objective by a deadline, broken into stages.' : 'A project is a body of work with milestones and tasks.'}
      </Text>
      <TextField label="Title" value={title} onChangeText={setTitle} error={errors.title} autoFocus={!id} />
      <TextField label={kind === 'mission' ? 'Objective' : 'Objective (optional)'} value={objective} onChangeText={setObjective} error={errors.objective} multiline minLines={2} />
      <TextField label="Description" value={description} onChangeText={setDescription} multiline minLines={3} />
      <SelectField label="Supports goal" value={goalId} options={goals} onChange={setGoalId} allowClear placeholder="No goal" />
      <DateTimeField label="Start (optional)" mode="date" value={start} onChange={setStart} allowClear />
      <DateTimeField label={kind === 'mission' ? 'Deadline' : 'Deadline (optional)'} mode="date" value={deadline} onChange={setDeadline} allowClear error={errors.deadline} minimumDate={today} />
    </Screen>
  );
}
