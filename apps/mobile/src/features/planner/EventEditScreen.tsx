import { addDays, utcToLocalDate, utcToLocalMinutes } from '@ascend/domain';
import { router, useLocalSearchParams } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useStore } from '@/data/DataProvider';
import type { CalendarEvent, EventKind } from '@/data/types';
import { ValidationError } from '@/data/validation';
import { useCategoryOptions, useGoalOptions } from '@/features/shared/options';
import { useToday, useUserContext } from '@/hooks/useUser';
import { Button, ChipGroup, DateTimeField, Screen, SelectField, Text, TextField, ToggleRow, confirm, space, useToast } from '@/ui';
import { EVENT_KIND_LABELS, createEvent, deleteEvent, updateEvent } from './events';

const REPEATS = [
  { value: '', label: 'Does not repeat' },
  { value: 'FREQ=DAILY', label: 'Every day' },
  { value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: 'Every weekday' },
  { value: 'FREQ=WEEKLY', label: 'Every week' },
  { value: 'FREQ=WEEKLY;INTERVAL=2', label: 'Every 2 weeks' },
  { value: 'FREQ=MONTHLY', label: 'Every month' },
  { value: 'FREQ=YEARLY', label: 'Every year' },
];

export function EventEditScreen() {
  const { id, date: dateParam, kind: kindParam } = useLocalSearchParams<{ id?: string; date?: string; kind?: string }>();
  const store = useStore();
  const toast = useToast();
  const ctx = useUserContext();
  const { today } = useToday(ctx.timeZone);
  const categories = useCategoryOptions();
  const goals = useGoalOptions();
  const [loaded, setLoaded] = useState(!id);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(dateParam ?? today);
  const [start, setStart] = useState(9 * 60);
  const [end, setEnd] = useState(10 * 60);
  const [allDay, setAllDay] = useState(false);
  const [kind, setKind] = useState<EventKind>(kindParam && kindParam in EVENT_KIND_LABELS ? (kindParam as EventKind) : 'event');
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(true);
  const [repeat, setRepeat] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [event, setEvent] = useState<CalendarEvent | null>(null);

  useEffect(() => {
    if (!id) return;
    store.get<CalendarEvent>('calendar_events', id).then((e) => {
      if (!e) return;
      const tz = e.timezone || ctx.timeZone;
      setEvent(e);
      setTitle(e.title);
      setDate(utcToLocalDate(Date.parse(e.starts_at), tz));
      setStart(utcToLocalMinutes(Date.parse(e.starts_at), tz));
      setEnd(utcToLocalMinutes(Date.parse(e.ends_at), tz) || 24 * 60);
      setAllDay(e.all_day);
      setKind(e.kind);
      setLocked(e.is_locked);
      setBusy(e.busy);
      setRepeat(e.recurrence_rule ?? '');
      setLocation(e.location ?? '');
      setDescription(e.description ?? '');
      setCategoryId(e.category_id);
      setGoalId(e.goal_id);
      setLoaded(true);
    });
  }, [id, store, ctx.timeZone]);

  const save = async () => {
    setSaving(true);
    try {
      const input = {
        title, date, start_minutes: start, end_minutes: end, end_date: allDay ? date : end <= start ? addDays(date, 1) : date, all_day: allDay, kind,
        is_locked: locked, busy, recurrence_rule: repeat || null, location, description, category_id: categoryId, goal_id: goalId,
      };
      if (id) await updateEvent(store, id, input, event?.timezone || ctx.timeZone);
      else await createEvent(store, input, ctx.timeZone);
      toast.show(busy ? 'Saved. Your plan adjusts around it.' : 'Saved');
      router.back();
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fields);
      else toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    if (event?.recurrence_rule) {
      const choice = await new Promise<'one' | 'all' | null>((resolve) => {
        import('react-native').then(({ Alert }) =>
          Alert.alert('Delete repeating event', undefined, [
            { text: 'Only this one', onPress: () => resolve('one') },
            { text: 'All occurrences', style: 'destructive', onPress: () => resolve('all') },
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
          ]),
        );
      });
      if (!choice) return;
      await deleteEvent(store, id, choice === 'one' ? date : undefined);
    } else {
      if (!(await confirm({ title: 'Delete this event?', confirmLabel: 'Delete', destructive: true }))) return;
      await deleteEvent(store, id);
    }
    toast.show('Event deleted', { action: { label: 'Undo', onPress: () => void store.restore('calendar_events', id) } });
    router.back();
  };

  if (!loaded) return null;
  return (
    <Screen
      edges="none"
      keyboard
      footer={
        <View style={{ gap: space.sm }}>
          <Button label={id ? 'Save changes' : 'Add to calendar'} onPress={save} loading={saving} />
          {id ? <Button label="Delete event" variant="danger" icon={Trash2} onPress={remove} /> : null}
        </View>
      }
    >
      <TextField label="Title" value={title} onChangeText={setTitle} error={errors.title} autoFocus={!id} />
      <View style={{ gap: space.sm }}>
        <Text variant="captionStrong" tone="secondary">Type</Text>
        <ChipGroup options={(Object.keys(EVENT_KIND_LABELS) as EventKind[]).map((k) => ({ value: k, label: EVENT_KIND_LABELS[k] }))} value={kind} onChange={(k) => { setKind(k); if (k === 'commitment') setLocked(true); }} />
      </View>
      <DateTimeField label="Date" mode="date" value={date} onChange={setDate} />
      <ToggleRow label="All day" value={allDay} onChange={setAllDay} />
      {!allDay ? (
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}><DateTimeField label="Starts" mode="time" value={start} onChange={(v: number) => { setEnd(Math.min(24 * 60, v + Math.max(15, end - start))); setStart(v); }} /></View>
          <View style={{ flex: 1 }}><DateTimeField label="Ends" mode="time" value={end % (24 * 60)} onChange={setEnd} error={errors.end_minutes} /></View>
        </View>
      ) : null}
      <SelectField label="Repeat" value={repeat} options={REPEATS} onChange={setRepeat} />
      <ToggleRow label="Fixed commitment (locked)" description="ASCEND never moves it, and the AI must ask first." value={locked || kind === 'commitment'} onChange={setLocked} />
      <ToggleRow label="Busy" description="Nothing else is scheduled during it." value={busy} onChange={setBusy} />
      <TextField label="Location" value={location} onChangeText={setLocation} />
      <SelectField label="Category" value={categoryId} options={categories} onChange={setCategoryId} allowClear placeholder="No category" />
      <SelectField label="Goal" value={goalId} options={goals} onChange={setGoalId} allowClear placeholder="No goal" />
      <TextField label="Notes" value={description} onChangeText={setDescription} multiline minLines={3} />
    </Screen>
  );
}
