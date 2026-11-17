import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useStore } from '@/data/DataProvider';
import type { Goal, ProgressMode } from '@/data/types';
import { ValidationError } from '@/data/validation';
import { useCategoryOptions } from '@/features/shared/options';
import { useToday, useUserContext } from '@/hooks/useUser';
import { Button, ChipGroup, DateTimeField, Screen, SelectField, Text, TextField, space, useToast } from '@/ui';
import { createGoal, updateGoal } from './repo';

const MODES: { value: ProgressMode; label: string; hint: string }[] = [
  { value: 'milestones', label: 'Milestones', hint: 'Progress = milestones completed.' },
  { value: 'tasks', label: 'Tasks', hint: 'Progress = linked tasks completed.' },
  { value: 'target', label: 'Target', hint: 'Track a number towards a target (e.g. 10 km, grade 7).' },
  { value: 'manual', label: 'Manual', hint: 'Update a percentage yourself.' },
];

export function GoalEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const store = useStore();
  const toast = useToast();
  const ctx = useUserContext();
  const { today } = useToday(ctx.timeZone);
  const categories = useCategoryOptions();
  const [loaded, setLoaded] = useState(!id);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [why, setWhy] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [mode, setMode] = useState<ProgressMode>('milestones');
  const [target, setTarget] = useState('');
  const [current, setCurrent] = useState('');
  const [unit, setUnit] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    store.get<Goal>('goals', id).then((g) => {
      if (!g) return;
      setTitle(g.title);
      setDescription(g.description ?? '');
      setWhy(g.why ?? '');
      setCategoryId(g.category_id);
      setDeadline(g.deadline);
      setMode(g.progress_mode);
      setTarget(g.target_value !== null ? String(g.target_value) : '');
      setCurrent(g.current_value !== null ? String(g.current_value) : '');
      setUnit(g.target_unit ?? '');
      setLoaded(true);
    });
  }, [id, store]);

  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
  const save = async () => {
    setSaving(true);
    try {
      const input = { title, description, why, category_id: categoryId, deadline, progress_mode: mode, target_value: num(target), current_value: num(current), target_unit: unit };
      if (id) await updateGoal(store, id, input);
      else {
        const g = await createGoal(store, input, today);
        router.replace({ pathname: '/(app)/goal/[id]', params: { id: g.id } });
        toast.show('Goal created. Add milestones to map the way.');
        return;
      }
      toast.show('Goal saved');
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
    <Screen edges="none" keyboard footer={<Button label={id ? 'Save changes' : 'Create goal'} onPress={save} loading={saving} />}>
      <TextField label="Goal" value={title} onChangeText={setTitle} error={errors.title} placeholder="e.g. Improve my Economics grade" autoFocus={!id} />
      <TextField label="Description" value={description} onChangeText={setDescription} multiline minLines={3} error={errors.description} />
      <TextField label="Why it matters to you" value={why} onChangeText={setWhy} multiline minLines={2} hint="A reason you’ll still believe on a hard day." />
      <SelectField label="Category" value={categoryId} options={categories} onChange={setCategoryId} allowClear placeholder="No category" />
      <DateTimeField label="Deadline" mode="date" value={deadline} onChange={setDeadline} allowClear minimumDate={today} />
      <View style={{ gap: space.sm }}>
        <Text variant="captionStrong" tone="secondary">How progress is measured</Text>
        <ChipGroup options={MODES} value={mode} onChange={setMode} />
        <Text variant="caption" tone="tertiary">{MODES.find((m) => m.value === mode)?.hint}</Text>
      </View>
      {mode === 'target' ? (
        <View style={{ gap: space.md }}>
          <TextField label="Target" value={target} onChangeText={setTarget} keyboardType="decimal-pad" error={errors.target_value} />
          <TextField label="Where you are now" value={current} onChangeText={setCurrent} keyboardType="decimal-pad" />
          <TextField label="Unit" value={unit} onChangeText={setUnit} placeholder="km, %, grade, books…" />
        </View>
      ) : null}
    </Screen>
  );
}
