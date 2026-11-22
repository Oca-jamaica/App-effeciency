import { parseTime, formatTime } from '@ascend/domain';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Plus, Search, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLive, useStore } from '@/data/DataProvider';
import type { Category, Goal, Project, Skill } from '@/data/types';
import { ValidationError } from '@/data/validation';
import { useToday, useUserContext } from '@/hooks/useUser';
import {
  Button, ChipGroup, DateTimeField, EmptyState, Group, IconButton, ListRow, LoadingState, Screen, SelectField, Text, TextField, ToggleRow, confirm, space, useToast,
  type SelectOption,
} from '@/ui';
import { collectionDef, listRecords, parseTags, saveRecord, type FieldDef, type RefSource } from './defs';

export function CollectionListScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const def = collectionDef(key);
  const ctx = useUserContext();
  const { today } = useToday(ctx.timeZone);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const rows = useLive((s) => listRecords(s, def, { search, filter: filter ?? undefined, today }), [key, search, filter, today], [def.table]);
  return (
    <>
      <Stack.Screen options={{ title: def.title, headerRight: () => <IconButton icon={Plus} label={`New ${def.singular}`} tone="primary" onPress={() => router.push({ pathname: '/(app)/c/[key]/edit', params: { key } })} /> }} />
      <Screen edges="none">
        <Text variant="callout" tone="secondary">{def.description}</Text>
        <TextField placeholder={`Search ${def.title.toLowerCase()}`} value={search} onChangeText={setSearch} returnKeyType="search" accessibilityLabel="Search" />
        {def.filters?.length ? (
          <ChipGroup options={[{ value: '__all', label: 'All' }, ...def.filters.map((f) => ({ value: f.where, label: f.label }))]} value={filter ?? '__all'} onChange={(v) => setFilter(v === '__all' ? null : v)} />
        ) : null}
        {rows.loading && !rows.data ? (
          <LoadingState />
        ) : rows.data?.length ? (
          <Group>
            {rows.data.map((r) => (
              <ListRow key={String(r.id)} title={def.listTitle(r)} subtitle={def.listSubtitle?.(r, today)} chevron onPress={() => router.push({ pathname: '/(app)/c/[key]/edit', params: { key, id: String(r.id) } })} />
            ))}
          </Group>
        ) : search || filter ? (
          <EmptyState compact icon={Search} title="Nothing matches" body="Try a different search or filter." />
        ) : (
          <EmptyState title={def.empty.title} body={def.empty.body} actionLabel={`Add ${def.singular === 'entry' ? 'an entry' : `a ${def.singular}`}`} onAction={() => router.push({ pathname: '/(app)/c/[key]/edit', params: { key } })} />
        )}
      </Screen>
    </>
  );
}

function useRefOptions(source: RefSource | undefined): SelectOption<string | null>[] {
  const data = useLive(
    async (s) => {
      if (source === 'goals') return (await s.list<Goal>('goals', { where: "status IN ('active','paused')", orderBy: 'rank COLLATE BINARY' })).map((g) => ({ value: g.id, label: g.title }));
      if (source === 'projects') return (await s.list<Project>('projects', { where: "status NOT IN ('archived')", orderBy: 'rank COLLATE BINARY' })).map((p) => ({ value: p.id, label: p.title }));
      if (source === 'skills') return (await s.list<Skill>('skills', { orderBy: 'rank COLLATE BINARY' })).map((k) => ({ value: k.id, label: k.name }));
      if (source === 'categories') return (await s.list<Category>('categories', { where: 'archived_at IS NULL', orderBy: 'rank COLLATE BINARY' })).map((c) => ({ value: c.id, label: c.name }));
      return [];
    },
    [source],
    source ? [source] : [],
  );
  return data.data ?? [];
}

function FieldInput({ f, value, onChange, error }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void; error?: string }) {
  const refOptions = useRefOptions(f.type === 'ref' ? f.ref : undefined);
  switch (f.type) {
    case 'text':
    case 'url':
      return <TextField label={f.label} value={String(value ?? '')} onChangeText={onChange} error={error} hint={f.hint} placeholder={f.placeholder} maxLength={f.type === 'url' ? 2048 : f.max} autoCapitalize={f.type === 'url' ? 'none' : 'sentences'} keyboardType={f.type === 'url' ? 'url' : 'default'} />;
    case 'multiline':
      return <TextField label={f.label} value={String(value ?? '')} onChangeText={onChange} error={error} hint={f.hint} placeholder={f.placeholder} multiline minLines={3} />;
    case 'number':
      return <TextField label={f.label} value={value === null || value === undefined ? '' : String(value)} onChangeText={(t) => onChange(t.trim() === '' ? null : Number(t.replace(',', '.')))} error={error} hint={f.hint} keyboardType="decimal-pad" />;
    case 'date':
      return <DateTimeField label={f.label} mode="date" value={(value as string) ?? null} onChange={onChange} allowClear={!f.required} error={error} />;
    case 'time':
      return <DateTimeField label={f.label} mode="time" value={typeof value === 'string' ? parseTime(value) : null} onChange={(m: number | null) => onChange(m === null ? null : formatTime(m))} allowClear error={error} />;
    case 'rating':
      return (
        <View style={{ gap: space.xs }}>
          <Text variant="captionStrong" tone="secondary">{f.label}</Text>
          <ChipGroup options={Array.from({ length: f.max ?? 5 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))} value={(value as number) ?? null} onChange={(v) => onChange(v === value ? null : v)} />
          {error ? <Text variant="caption" tone="danger">{error}</Text> : f.hint ? <Text variant="caption" tone="tertiary">{f.hint}</Text> : null}
        </View>
      );
    case 'select':
      return (
        <View style={{ gap: space.xs }}>
          <Text variant="captionStrong" tone="secondary">{f.label}</Text>
          {(f.options?.length ?? 0) > 6 ? (
            <SelectField label="" value={(value as string) ?? null} options={f.options!} onChange={onChange} allowClear placeholder="Not set" />
          ) : (
            <ChipGroup options={f.options ?? []} value={(value as string) ?? null} onChange={onChange} />
          )}
          {error ? <Text variant="caption" tone="danger">{error}</Text> : null}
        </View>
      );
    case 'bool':
      return <ToggleRow label={f.label} value={!!value} onChange={onChange} />;
    case 'tags':
      return <TextField label={f.label} value={Array.isArray(value) ? (value as string[]).join(', ') : String(value ?? '')} onChangeText={onChange} hint={f.hint} autoCapitalize="none" error={error} />;
    case 'ref':
      return <SelectField label={f.label} value={(value as string) ?? null} options={refOptions} onChange={onChange} allowClear placeholder="None" />;
  }
}

export function CollectionEditScreen() {
  const { key, id } = useLocalSearchParams<{ key: string; id?: string }>();
  const def = collectionDef(key);
  const store = useStore();
  const toast = useToast();
  const ctx = useUserContext();
  const { today } = useToday(ctx.timeZone);
  const [values, setValues] = useState<Record<string, unknown> | null>(id ? null : { ...(def.defaults?.(today) ?? {}) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!id) return;
    store.get(def.table, id).then((r) => {
      const v: Record<string, unknown> = { ...(r ?? {}) };
      if (def.key === 'people' && v.birthday_month) v.birthday_month = String(v.birthday_month);
      setValues(v);
    });
  }, [id, store, def]);
  if (!values) return <LoadingState />;
  const visible = def.fields.filter((f) => !f.showIf || f.showIf.values.includes(values[f.showIf.key]));
  const save = async () => {
    setSaving(true);
    try {
      const input: Record<string, unknown> = {};
      for (const f of def.fields) {
        let v = values[f.key];
        if (f.type === 'tags' && typeof v === 'string') v = parseTags(v);
        if (f.type === 'number' && typeof v === 'number' && Number.isNaN(v)) v = undefined;
        if (v !== undefined) input[f.key] = v;
      }
      await saveRecord(store, def, id ?? null, input, today);
      toast.show('Saved');
      router.back();
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fields);
      else toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Stack.Screen
        options={{
          title: id ? def.title : `New ${def.singular}`,
          headerRight: id
            ? () => (
                <IconButton
                  icon={Trash2}
                  label="Delete"
                  tone="danger"
                  onPress={async () => {
                    if (!(await confirm({ title: `Delete this ${def.singular}?`, message: 'You can undo straight after.', confirmLabel: 'Delete', destructive: true }))) return;
                    await store.remove(def.table, id);
                    router.back();
                    toast.show('Deleted', { action: { label: 'Undo', onPress: () => void store.restore(def.table, id) } });
                  }}
                />
              )
            : undefined,
        }}
      />
      <Screen edges="none" keyboard footer={<Button label={id ? 'Save changes' : 'Save'} onPress={() => void save()} loading={saving} />}>
        {visible.map((f) => (
          <FieldInput key={f.key} f={f} value={values[f.key]} error={errors[f.key]} onChange={(v) => setValues((cur) => ({ ...cur!, [f.key]: v }))} />
        ))}
        {errors.form ? <Text variant="callout" tone="danger">{errors.form}</Text> : null}
      </Screen>
    </>
  );
}
