import { formatClock, formatHours, suggestedBreakMinutes, timerElapsedMs, timerRemainingMs, utcToLocalDate, type TimerState } from '@ascend/domain';
import { router } from 'expo-router';
import { Film, Pause, Play, Square } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLive, useStore } from '@/data/DataProvider';
import type { FocusKind, FocusSession, Goal, StudyVideo, Task } from '@/data/types';
import { useToday, useUserContext } from '@/hooks/useUser';
import {
  Badge, Button, Card, ChipGroup, DateTimeField, EmptyState, Group, ListRow, Row, Section, SelectField, Sheet, Stepper, Text, TextField, space,
  useToast, type SelectOption,
} from '@/ui';
import { FOCUS_KIND_LABELS, deleteSession, discardFocus, focusMinutesSince, getTimer, listSessions, logManualSession, pauseFocus, resumeFocus, startFocus, stopFocus } from './repo';
import { formatBytes, listVideos } from './videos';
import { UploadSheet } from './VideoScreens';

const LENGTHS = [
  { value: 25, label: '25 min' },
  { value: 50, label: '50 min' },
  { value: 90, label: '90 min' },
  { value: 0, label: 'Open-ended' },
];

export function useTaskOptions(): SelectOption<string | null>[] {
  const tasks = useLive(
    (s) => s.list<Task>('tasks', { where: "status NOT IN ('completed','cancelled') AND archived_at IS NULL", orderBy: "status = 'in_progress' DESC, priority, due_date IS NULL, due_date", limit: 200 }),
    [],
    ['tasks'],
  );
  return (tasks.data ?? []).map((t) => ({ value: t.id, label: t.title, description: t.status === 'in_progress' ? 'In progress' : t.due_date ? `Due ${t.due_date}` : undefined }));
}

/** Planner → Focus: the timer, today's focus, session history and study timelapses. */
export function FocusPane() {
  const store = useStore();
  const toast = useToast();
  const ctx = useUserContext();
  const { today } = useToday(ctx.timeZone);
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [kind, setKind] = useState<FocusKind>('study');
  const [length, setLength] = useState(25);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [finishing, setFinishing] = useState<FocusSession | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [upload, setUpload] = useState<{ sessionId?: string; taskId?: string | null; goalId?: string | null; minutes?: number | null } | null>(null);
  const taskOptions = useTaskOptions();

  const refresh = useCallback(() => getTimer(store).then(setTimer), [store]);
  useEffect(() => {
    void refresh();
    return store.subscribe(['focus_sessions'], () => void refresh());
  }, [refresh, store]);
  useEffect(() => {
    if (!timer) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [timer]);

  const history = useLive((s) => listSessions(s, { limit: 30 }), [], ['focus_sessions']);
  const totals = useLive((s) => focusMinutesSince(s, new Date(Date.now() - 6 * 86400_000).toISOString()), [], ['focus_sessions']);
  const todayTotal = useLive(
    async (s) => (await listSessions(s, { limit: 200 })).filter((x) => utcToLocalDate(Date.parse(x.started_at), ctx.timeZone) === today && x.status === 'completed').reduce((m, x) => m + x.duration_seconds / 60, 0),
    [today, ctx.timeZone],
    ['focus_sessions'],
  );
  const names = useLive(
    async (s) => {
      const [tasks, goals] = await Promise.all([s.list<Task>('tasks', { includeDeleted: true }), s.list<Goal>('goals', { includeDeleted: true })]);
      return { tasks: new Map(tasks.map((t) => [t.id, t.title])), goals: new Map(goals.map((g) => [g.id, g.title])) };
    },
    [],
    ['tasks', 'goals'],
  );
  const videos = useLive((s) => listVideos(s), [], ['study_videos']);
  const fail = (e: unknown) => toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });

  const elapsed = timer ? timerElapsedMs(timer, now) : 0;
  const remaining = timer ? timerRemainingMs(timer, now) : null;
  const sessionLabel = (s: FocusSession) => (s.task_id ? names.data?.tasks.get(s.task_id) : s.goal_id ? names.data?.goals.get(s.goal_id) : null) ?? FOCUS_KIND_LABELS[s.kind];

  return (
    <View style={{ gap: space.xxl }}>
      <Card>
        {timer ? (
          <View style={{ alignItems: 'center', gap: space.md }}>
            <Text variant="label" tone="tertiary">{timer.pausedAt ? 'Paused' : remaining !== null && remaining < 0 ? 'Over your planned time' : 'Focusing'}</Text>
            <Text style={styles.clock} tabular accessibilityLabel={`Elapsed ${formatClock(elapsed)}`}>
              {formatClock(remaining !== null && remaining > 0 ? remaining : elapsed)}
            </Text>
            <Text variant="caption" tone="secondary">
              {remaining !== null ? (remaining > 0 ? `${formatClock(elapsed)} so far of ${timer.plannedMinutes} min` : `${formatClock(-remaining)} over · a ${suggestedBreakMinutes(timer.plannedMinutes ?? 25)}-minute break is earned`) : 'Open-ended session'}
            </Text>
            <Row>
              {timer.pausedAt ? (
                <Button label="Resume" icon={Play} onPress={() => resumeFocus(store).then(setTimer).catch(fail)} />
              ) : (
                <Button label="Pause" icon={Pause} variant="secondary" onPress={() => pauseFocus(store).then(setTimer).catch(fail)} />
              )}
              <Button
                label="Stop"
                icon={Square}
                variant="secondary"
                onPress={async () => {
                  const s = await getTimer(store);
                  if (!s) return;
                  const session = await store.get<FocusSession>('focus_sessions', s.sessionId);
                  setFinishing(session);
                }}
              />
            </Row>
            <Button label="Discard this session" variant="ghost" size="sm" onPress={() => discardFocus(store).then(() => { setTimer(null); toast.show('Session discarded'); }).catch(fail)} />
          </View>
        ) : (
          <View style={{ gap: space.md }}>
            <Text variant="subheading">Start a session</Text>
            <ChipGroup options={(Object.keys(FOCUS_KIND_LABELS) as FocusKind[]).map((k) => ({ value: k, label: FOCUS_KIND_LABELS[k] }))} value={kind} onChange={setKind} />
            <ChipGroup options={LENGTHS} value={length} onChange={setLength} />
            <SelectField label="Working on" value={taskId} options={taskOptions} onChange={setTaskId} allowClear clearLabel="Nothing specific" placeholder="Nothing specific" />
            <Button label="Start" icon={Play} onPress={() => startFocus(store, kind, length || null, { taskId }).then(setTimer).catch(fail)} />
          </View>
        )}
      </Card>

      <Row style={{ justifyContent: 'space-between' }}>
        <View>
          <Text variant="numeric" tabular>{formatHours(todayTotal.data ?? 0)}</Text>
          <Text variant="caption" tone="secondary">Today</Text>
        </View>
        <View>
          <Text variant="numeric" tabular>{formatHours(totals.data?.total ?? 0)}</Text>
          <Text variant="caption" tone="secondary">Last 7 days</Text>
        </View>
        <View>
          <Text variant="numeric" tabular>{formatHours(totals.data?.study ?? 0)}</Text>
          <Text variant="caption" tone="secondary">Study, 7 days</Text>
        </View>
      </Row>

      <Section title="Study timelapses" action="Upload" onAction={() => setUpload({})} hint="Optional accountability: upload a timelapse of a study session. Videos are private to you.">
        {videos.data?.length ? (
          <Group>
            {videos.data.slice(0, 8).map((v: StudyVideo) => (
              <ListRow
                key={v.id}
                icon={Film}
                title={new Date(`${v.recorded_on}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                subtitle={[v.session_minutes ? `${v.session_minutes} min session` : null, formatBytes(v.size_bytes), v.notes].filter(Boolean).join(' · ')}
                trailing={v.upload_status === 'ready' ? null : <Badge label={v.upload_status === 'failed' ? 'Upload failed' : 'Uploading'} tone={v.upload_status === 'failed' ? 'danger' : 'accent'} />}
                chevron
                onPress={() => router.push({ pathname: '/(app)/video/[id]', params: { id: v.id } })}
              />
            ))}
          </Group>
        ) : (
          <Text variant="callout" tone="secondary">No timelapses yet.</Text>
        )}
      </Section>

      <Section title="History" action="Log a session" onAction={() => setLogOpen(true)}>
        {history.data?.length ? (
          <Group>
            {history.data.map((s) => (
              <ListRow
                key={s.id}
                title={sessionLabel(s)}
                subtitle={`${FOCUS_KIND_LABELS[s.kind]} · ${formatHours(s.duration_seconds / 60)} · ${new Date(s.started_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}${s.source === 'manual' ? ' · logged' : ''}${s.status === 'abandoned' ? ' · stopped early' : ''}`}
                trailing={s.quality ? <Text variant="caption" tone="secondary">{'●'.repeat(s.quality)}</Text> : null}
                onLongPress={() => deleteSession(store, s.id).then(() => toast.show('Session deleted', { action: { label: 'Undo', onPress: () => void store.restore('focus_sessions', s.id) } })).catch(fail)}
              />
            ))}
          </Group>
        ) : (
          <EmptyState compact title="No sessions yet" body="Focus and study time you record shows here, and counts towards your tasks and goals." />
        )}
        {history.data?.length ? <Text variant="caption" tone="tertiary">Hold a session to delete it.</Text> : null}
      </Section>

      {finishing ? (
        <FinishSheet
          session={finishing}
          onClose={() => setFinishing(null)}
          onDone={async (quality, notes, attach) => {
            const saved = await stopFocus(store, { quality, notes });
            setTimer(null);
            setFinishing(null);
            if (saved) toast.show(`Recorded ${formatHours(saved.duration_seconds / 60)} of ${FOCUS_KIND_LABELS[saved.kind].toLowerCase()}`);
            else toast.show('Sessions under a minute aren’t recorded');
            if (saved && attach) setUpload({ sessionId: saved.id, taskId: saved.task_id, goalId: saved.goal_id, minutes: Math.round(saved.duration_seconds / 60) });
          }}
        />
      ) : null}
      {logOpen ? <LogSessionSheet onClose={() => setLogOpen(false)} today={today} timeZone={ctx.timeZone} /> : null}
      {upload ? <UploadSheet onClose={() => setUpload(null)} today={today} focusSessionId={upload.sessionId} taskId={upload.taskId ?? null} goalId={upload.goalId ?? null} sessionMinutes={upload.minutes ?? null} /> : null}
    </View>
  );
}

function FinishSheet({ session, onClose, onDone }: { session: FocusSession; onClose: () => void; onDone: (quality: number | null, notes: string, attach: boolean) => Promise<void> }) {
  const [quality, setQuality] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const finish = async (attach: boolean) => {
    setBusy(true);
    try {
      await onDone(quality, notes, attach);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      visible
      onClose={onClose}
      title="Finish session"
      footer={
        <View style={{ gap: space.sm }}>
          <Button label="Save session" onPress={() => void finish(false)} loading={busy} />
          {session.kind === 'study' ? <Button label="Save and add a timelapse" variant="secondary" onPress={() => void finish(true)} disabled={busy} /> : null}
        </View>
      }
    >
      <Text variant="captionStrong" tone="secondary">How focused were you?</Text>
      <ChipGroup options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: ['Distracted', 'Patchy', 'OK', 'Good', 'Deep'][n - 1]! }))} value={quality} onChange={(v) => setQuality(v === quality ? null : v)} />
      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} multiline minLines={3} placeholder="What you covered, what to do next" />
    </Sheet>
  );
}

function LogSessionSheet({ onClose, today, timeZone }: { onClose: () => void; today: string; timeZone: string }) {
  const store = useStore();
  const toast = useToast();
  const taskOptions = useTaskOptions();
  const [kind, setKind] = useState<FocusKind>('study');
  const [date, setDate] = useState(today);
  const [start, setStart] = useState(16 * 60);
  const [minutes, setMinutes] = useState(60);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  return (
    <Sheet
      visible
      onClose={onClose}
      title="Log a session"
      footer={
        <Button
          label="Save"
          onPress={() =>
            logManualSession(store, { kind, date, startMinutes: start, minutes, taskId, notes }, timeZone)
              .then(() => {
                toast.show('Session logged');
                onClose();
              })
              .catch((e) => toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' }))
          }
        />
      }
    >
      <ChipGroup options={(Object.keys(FOCUS_KIND_LABELS) as FocusKind[]).map((k) => ({ value: k, label: FOCUS_KIND_LABELS[k] }))} value={kind} onChange={setKind} />
      <DateTimeField label="Date" mode="date" value={date} onChange={setDate} />
      <DateTimeField label="Started at" mode="time" value={start} onChange={setStart} />
      <Stepper value={minutes} onChange={setMinutes} min={5} max={600} step={5} format={(v) => formatHours(v)} />
      <SelectField label="Working on" value={taskId} options={taskOptions} onChange={setTaskId} allowClear clearLabel="Nothing specific" placeholder="Nothing specific" />
      <TextField label="Notes" value={notes} onChangeText={setNotes} multiline minLines={2} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  clock: { fontFamily: 'Inter_500Medium', fontSize: 56, lineHeight: 64, letterSpacing: -1.5 },
});

