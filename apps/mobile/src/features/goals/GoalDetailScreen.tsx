import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { BookOpen, FileText, Link2, MoreHorizontal, PlayCircle, Star, Trash2, Video } from 'lucide-react-native';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Platform, View } from 'react-native';
import { useLive, useStore } from '@/data/DataProvider';
import type { Milestone, Note, NoteType } from '@/data/types';
import { ValidationError } from '@/data/validation';
import { STATUS_LABELS } from '@/features/tasks/repo';
import {
  Badge, Button, Card, Checkbox, ChipGroup, DateTimeField, EmptyState, Group, IconButton, ListRow, LoadingState, ProgressBar, Row, Screen,
  Section, Sheet, Text, TextField, confirm, formatDateLabel, space, useToast,
} from '@/ui';
import {
  NOTE_TYPE_LABELS, addChecklistItem, addMilestone, addResource, deleteChecklistItem, deleteGoal, deleteMilestone, deleteNote, deleteResource,
  loadGoalDetail, recordProgress, restoreGoal, saveNote, setGoalStatus, setMilestoneDone, toggleChecklistItem, toggleResourceFavorite, updateMilestone,
} from './repo';

/** iOS action sheet / Android alert menu, so long-press menus feel native on each platform. */
export function showMenu(title: string, options: { label: string; destructive?: boolean; onPress: () => void }[]): void {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...options.map((o) => o.label), 'Cancel'], cancelButtonIndex: options.length, destructiveButtonIndex: options.findIndex((o) => o.destructive) },
      (i) => options[i]?.onPress(),
    );
  } else {
    Alert.alert(title, undefined, [...options.map((o) => ({ text: o.label, style: o.destructive ? ('destructive' as const) : ('default' as const), onPress: o.onPress })), { text: 'Cancel', style: 'cancel' as const }]);
  }
}

export function GoalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const toast = useToast();
  const detail = useLive((s) => loadGoalDetail(s, id), [id], ['goals', 'milestones', 'goal_checklist_items', 'tasks', 'notes', 'knowledge_items', 'goal_progress_entries']);
  const [sheet, setSheet] = useState<null | { kind: 'milestone'; milestone?: Milestone } | { kind: 'note'; note?: Note } | { kind: 'resource' } | { kind: 'progress' }>(null);
  const [newItem, setNewItem] = useState('');

  if (detail.loading && !detail.data) return <LoadingState />;
  const d = detail.data;
  if (!d) return <EmptyState title="This goal no longer exists" body="It may have been deleted on another device." actionLabel="Back to goals" onAction={() => router.back()} />;
  const { goal } = d;
  const fail = (e: unknown) => toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });

  const menu = () =>
    showMenu(goal.title, [
      { label: 'Edit goal', onPress: () => router.push({ pathname: '/(app)/goal/edit', params: { id } }) },
      goal.status === 'paused'
        ? { label: 'Resume', onPress: () => setGoalStatus(store, id, 'active').then(() => toast.show('Goal resumed')).catch(fail) }
        : { label: 'Pause', onPress: () => setGoalStatus(store, id, 'paused').then(() => toast.show('Goal paused')).catch(fail) },
      goal.status === 'completed'
        ? { label: 'Mark as active again', onPress: () => setGoalStatus(store, id, 'active').catch(fail) }
        : { label: 'Mark as achieved', onPress: () => setGoalStatus(store, id, 'completed').then(() => toast.show('Goal achieved. Well done.')).catch(fail) },
      { label: 'Archive', onPress: () => setGoalStatus(store, id, 'archived').then(() => toast.show('Goal archived')).catch(fail) },
      {
        label: 'Delete goal',
        destructive: true,
        onPress: async () => {
          const ok = await confirm({ title: 'Delete this goal?', message: 'Its milestones, notes and links go with it. Linked tasks are kept. You can undo straight after.', confirmLabel: 'Delete', destructive: true });
          if (!ok) return;
          await deleteGoal(store, id);
          router.back();
          toast.show('Goal deleted', { action: { label: 'Undo', onPress: () => void restoreGoal(store, id) } });
        },
      },
    ]);

  const notesByType = new Map<NoteType, Note[]>();
  for (const n of d.notes) notesByType.set(n.note_type, [...(notesByType.get(n.note_type) ?? []), n]);

  return (
    <>
      <Stack.Screen options={{ title: '', headerRight: () => <IconButton icon={MoreHorizontal} label="Goal options" onPress={menu} /> }} />
      <Screen edges="none">
        <View style={{ gap: space.sm }}>
          <Text variant="title">{goal.title}</Text>
          <Row>
            {goal.status !== 'active' ? <Badge label={goal.status === 'completed' ? 'Achieved' : goal.status === 'paused' ? 'Paused' : 'Archived'} tone={goal.status === 'completed' ? 'success' : 'neutral'} /> : null}
            {goal.deadline ? <Text variant="caption" tone="secondary">By {formatDateLabel(goal.deadline)}</Text> : null}
          </Row>
          {goal.description ? <Text variant="body" tone="secondary">{goal.description}</Text> : null}
          {goal.why ? (
            <Text variant="callout" tone="secondary">
              <Text variant="captionStrong" tone="secondary">Why it matters: </Text>
              {goal.why}
            </Text>
          ) : null}
        </View>

        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="subheading">Progress</Text>
            <Text variant="captionStrong" tone="secondary">{d.progress.ratio !== null ? `${Math.round(d.progress.ratio * 100)}%` : ''}</Text>
          </Row>
          <ProgressBar value={d.progress.ratio} height={6} />
          <Text variant="caption" tone="secondary">{d.progress.label}</Text>
          {goal.progress_mode === 'manual' || goal.progress_mode === 'target' ? (
            <Button label="Update progress" size="sm" variant="secondary" onPress={() => setSheet({ kind: 'progress' })} />
          ) : null}
        </Card>

        <Section title="Milestones" action="Add" onAction={() => setSheet({ kind: 'milestone' })}>
          {d.milestones.length ? (
            <Group>
              {d.milestones.map((m) => (
                <ListRow
                  key={m.id}
                  leading={<Checkbox checked={m.status === 'done'} label={`${m.title} done`} onToggle={() => setMilestoneDone(store, m.id, m.status !== 'done').then(() => m.status !== 'done' && toast.show('Milestone complete. Progress updated.')).catch(fail)} />}
                  title={m.title}
                  subtitle={[m.deadline ? `By ${formatDateLabel(m.deadline)}` : null, `${d.tasks.filter((t) => t.milestone_id === m.id).length} tasks`].filter(Boolean).join(' · ')}
                  muted={m.status === 'done'}
                  onPress={() => setSheet({ kind: 'milestone', milestone: m })}
                  onLongPress={() =>
                    showMenu(m.title, [
                      { label: 'Edit', onPress: () => setSheet({ kind: 'milestone', milestone: m }) },
                      { label: 'Add a task to this milestone', onPress: () => router.push({ pathname: '/(app)/task/edit', params: { goal_id: id, milestone_id: m.id } }) },
                      { label: 'Delete milestone', destructive: true, onPress: () => deleteMilestone(store, m.id).then(() => toast.show('Milestone deleted')).catch(fail) },
                    ])
                  }
                />
              ))}
            </Group>
          ) : (
            <Text variant="callout" tone="secondary">Break the goal into a few meaningful checkpoints.</Text>
          )}
        </Section>

        <Section title="Linked tasks" action="Add task" onAction={() => router.push({ pathname: '/(app)/task/edit', params: { goal_id: id } })}>
          {d.tasks.length ? (
            <Group>
              {d.tasks.map((t) => (
                <ListRow key={t.id} title={t.title} subtitle={`${STATUS_LABELS[t.status]}${t.due_date ? ` · due ${formatDateLabel(t.due_date)}` : ''}`} muted={t.status === 'completed' || t.status === 'cancelled'} chevron onPress={() => router.push({ pathname: '/(app)/task/[id]', params: { id: t.id } })} />
              ))}
            </Group>
          ) : (
            <Text variant="callout" tone="secondary">Tasks linked here are prioritised by this goal’s position in your list.</Text>
          )}
        </Section>

        <Section title="Action checklist">
          <Group>
            {d.checklist.map((c) => (
              <ListRow
                key={c.id}
                leading={<Checkbox shape="square" checked={c.is_done} label={c.title} onToggle={() => toggleChecklistItem(store, c.id).catch(fail)} />}
                title={c.title}
                muted={c.is_done}
                onLongPress={() =>
                  showMenu(c.title, [
                    { label: 'Turn into a scheduled task', onPress: () => router.push({ pathname: '/(app)/task/edit', params: { goal_id: id, title: c.title } }) },
                    { label: 'Delete', destructive: true, onPress: () => deleteChecklistItem(store, c.id).catch(fail) },
                  ])
                }
              />
            ))}
          </Group>
          <TextField
            placeholder="Add an action…"
            value={newItem}
            onChangeText={setNewItem}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (!newItem.trim()) return;
              addChecklistItem(store, id, newItem).then(() => setNewItem('')).catch(fail);
            }}
          />
        </Section>

        <Section title="Notes" action="Add note" onAction={() => setSheet({ kind: 'note' })}>
          {d.notes.length ? (
            <View style={{ gap: space.md }}>
              {[...notesByType.entries()].map(([type, notes]) => (
                <View key={type} style={{ gap: space.xs }}>
                  <Text variant="label" tone="tertiary">{NOTE_TYPE_LABELS[type]}</Text>
                  <Group>
                    {notes.map((n) => (
                      <ListRow key={n.id} icon={FileText} title={n.title || n.body.split('\n')[0] || 'Untitled'} subtitle={n.title ? n.body.slice(0, 120) : null} onPress={() => setSheet({ kind: 'note', note: n })} />
                    ))}
                  </Group>
                </View>
              ))}
            </View>
          ) : (
            <Text variant="callout" tone="secondary">Your strategy, what you’ve learned, problems to overcome and next steps.</Text>
          )}
        </Section>

        <Section title="Videos & resources" action="Add link" onAction={() => setSheet({ kind: 'resource' })}>
          {d.resources.length ? (
            <Group>
              {d.resources.map((r) => (
                <ListRow
                  key={r.id}
                  icon={r.kind === 'video' ? PlayCircle : r.kind === 'course' ? BookOpen : Link2}
                  title={r.title}
                  subtitle={r.url ? r.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60) : null}
                  trailing={r.is_favorite ? <Star size={14} color="#D9AD66" fill="#D9AD66" /> : null}
                  onPress={() => r.url && WebBrowser.openBrowserAsync(r.url).catch(fail)}
                  onLongPress={() =>
                    showMenu(r.title, [
                      { label: r.is_favorite ? 'Remove from favourites' : 'Add to favourites', onPress: () => toggleResourceFavorite(store, r.id).catch(fail) },
                      { label: 'Delete link', destructive: true, onPress: () => deleteResource(store, r.id).then(() => toast.show('Link removed')).catch(fail) },
                    ])
                  }
                />
              ))}
            </Group>
          ) : (
            <Text variant="callout" tone="secondary">Save explanations, tutorials and articles here. Videos are grouped automatically.</Text>
          )}
        </Section>

        {d.history.length ? (
          <Section title="History">
            <Group>
              {d.history.slice(0, 12).map((h) => (
                <ListRow key={h.id} title={h.note ?? (h.value !== null ? `Progress: ${h.value}${goal.progress_mode === 'manual' ? '%' : goal.target_unit ? ` ${goal.target_unit}` : ''}` : 'Update')} subtitle={new Date(h.recorded_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} />
              ))}
            </Group>
          </Section>
        ) : null}
      </Screen>

      {sheet?.kind === 'milestone' ? <MilestoneSheet goalId={id} milestone={sheet.milestone} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === 'note' ? <NoteSheet goalId={id} note={sheet.note} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === 'resource' ? <ResourceSheet goalId={id} milestones={d.milestones} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === 'progress' ? <ProgressSheet goalId={id} mode={goal.progress_mode} unit={goal.target_unit} current={goal.current_value} onClose={() => setSheet(null)} /> : null}
    </>
  );
}

function MilestoneSheet({ goalId, milestone, onClose }: { goalId: string; milestone?: Milestone; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [title, setTitle] = useState(milestone?.title ?? '');
  const [description, setDescription] = useState(milestone?.description ?? '');
  const [deadline, setDeadline] = useState<string | null>(milestone?.deadline ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async () => {
    try {
      if (milestone) await updateMilestone(store, milestone.id, { title, description, deadline });
      else await addMilestone(store, goalId, { title, description, deadline });
      toast.show(milestone ? 'Milestone saved' : 'Milestone added');
      onClose();
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fields);
      else toast.show(String(e), { kind: 'error' });
    }
  };
  return (
    <Sheet visible onClose={onClose} title={milestone ? 'Edit milestone' : 'New milestone'} footer={<Button label="Save" onPress={save} />}>
      <TextField label="Title" value={title} onChangeText={setTitle} error={errors.title} autoFocus={!milestone} />
      <TextField label="Description" value={description} onChangeText={setDescription} multiline minLines={3} />
      <DateTimeField label="Deadline" mode="date" value={deadline} onChange={setDeadline} allowClear />
    </Sheet>
  );
}

function NoteSheet({ goalId, note, onClose }: { goalId: string; note?: Note; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [type, setType] = useState<NoteType>(note?.note_type ?? 'strategy');
  const save = async () => {
    try {
      await saveNote(store, { id: note?.id, goal_id: goalId, title, body, note_type: type });
      toast.show('Note saved');
      onClose();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
    }
  };
  return (
    <Sheet
      visible
      onClose={onClose}
      title={note ? 'Edit note' : 'New note'}
      footer={
        <View style={{ gap: space.sm }}>
          <Button label="Save" onPress={save} />
          {note ? (
            <Button
              label="Delete note"
              variant="danger"
              icon={Trash2}
              onPress={async () => {
                if (await confirm({ title: 'Delete this note?', confirmLabel: 'Delete', destructive: true })) {
                  await deleteNote(store, note.id);
                  toast.show('Note deleted', { action: { label: 'Undo', onPress: () => void store.restore('notes', note.id) } });
                  onClose();
                }
              }}
            />
          ) : null}
        </View>
      }
    >
      <ChipGroup
        options={(['strategy', 'info', 'learning', 'problem', 'next_steps', 'general'] as NoteType[]).map((t) => ({ value: t, label: NOTE_TYPE_LABELS[t] }))}
        value={type}
        onChange={setType}
      />
      <TextField label="Title" value={title} onChangeText={setTitle} />
      <TextField label="Note" value={body} onChangeText={setBody} multiline minLines={6} />
    </Sheet>
  );
}

function ResourceSheet({ goalId, milestones, onClose }: { goalId: string; milestones: Milestone[]; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async () => {
    try {
      await addResource(store, goalId, { title: title || link, url: link, milestone_id: milestoneId });
      toast.show('Link saved');
      onClose();
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fields);
      else toast.show(String(e), { kind: 'error' });
    }
  };
  return (
    <Sheet visible onClose={onClose} title="Save a link" footer={<Button label="Save link" onPress={save} />}>
      <TextField label="Link" value={link} onChangeText={setLink} error={errors.url} autoCapitalize="none" keyboardType="url" placeholder="https://" autoFocus />
      <TextField label="Title" value={title} onChangeText={setTitle} error={errors.title} placeholder="e.g. Price elasticity explained" />
      {milestones.length ? (
        <View style={{ gap: space.xs }}>
          <Text variant="captionStrong" tone="secondary">For a milestone (optional)</Text>
          <ChipGroup options={milestones.map((m) => ({ value: m.id, label: m.title }))} value={milestoneId} onChange={(v) => setMilestoneId(v === milestoneId ? null : v)} />
        </View>
      ) : null}
      <Row>
        <Video size={14} color="#888" />
        <Text variant="caption" tone="tertiary">YouTube and Vimeo links are filed as videos automatically.</Text>
      </Row>
    </Sheet>
  );
}

function ProgressSheet({ goalId, mode, unit, current, onClose }: { goalId: string; mode: string; unit: string | null; current: number | null; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [value, setValue] = useState(current !== null ? String(current) : '');
  const [note, setNote] = useState('');
  const save = async () => {
    try {
      await recordProgress(store, goalId, Number(value.replace(',', '.')), note);
      toast.show('Progress recorded');
      onClose();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
    }
  };
  return (
    <Sheet visible onClose={onClose} title="Update progress" footer={<Button label="Save" onPress={save} />}>
      <TextField label={mode === 'manual' ? 'Progress (%)' : `Current value${unit ? ` (${unit})` : ''}`} value={value} onChangeText={setValue} keyboardType="decimal-pad" autoFocus />
      <TextField label="Note (optional)" value={note} onChangeText={setNote} />
    </Sheet>
  );
}

