import { formatTime, parseTime } from '@ascend/domain';
import { router } from 'expo-router';
import { Bell, BookOpen, BookMarked, CalendarClock, Download, Lightbulb, LogOut, MapPin, Moon, NotebookPen, RefreshCw, Scale, Shapes, SlidersHorizontal, StickyNote, Trash2, UserRound, Users } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useData, useLive, useStore } from '@/data/DataProvider';
import type { AvailabilityKind, Category, Preferences } from '@/data/types';
import { ValidationError } from '@/data/validation';
import { WEEKDAY_OPTIONS } from '@/features/shared/options';
import { useAuth } from '@/services/auth';
import { useUserContext } from '@/hooks/useUser';
import {
  Badge, Button, ChipGroup, DateTimeField, Dot, Group, IconButton, ListRow, Row, Screen, Section, SegmentedControl, Sheet, Stepper, Text, TextField,
  ToggleRow, categoryColors, confirm, space, useTheme, useToast, type ThemePreference,
} from '@/ui';
import { deleteAccount, exportAllData } from './account';
import {
  AVAILABILITY_LABELS, BLOCKED_PRESETS, BLOCKING_KINDS, createCategory, deleteCategory, groupAvailability, listAvailability, listCategories,
  removeAvailability, replaceAvailability, updateCategory, updatePreferences, updateProfile, type AvailabilityGroup,
} from './repo';

const DEV_LINKS = [
  { key: 'journal', title: 'Daily Journal', icon: NotebookPen },
  { key: 'decisions', title: 'Decision Journal', icon: Scale },
  { key: 'learning', title: 'Reading & Learning', icon: BookOpen },
  { key: 'vault', title: 'Knowledge Vault', icon: BookMarked },
  { key: 'ideas', title: 'Idea Incubator', icon: Lightbulb },
  { key: 'notes', title: 'Workspace', icon: StickyNote },
  { key: 'people', title: 'People & birthdays', icon: Users },
  { key: 'experiences', title: 'Experiences', icon: MapPin },
  { key: 'sleep', title: 'Sleep & Recovery', icon: Moon },
];

export function ProfileScreen() {
  const { session, signOut } = useAuth();
  const { store, status, syncNow } = useData();
  const toast = useToast();
  const theme = useTheme();
  const ctx = useUserContext();
  const [sheet, setSheet] = useState<null | 'name' | 'delete'>(null);
  const email = session?.user.email ?? '';

  const setTheme = (p: ThemePreference) => {
    theme.setPreference(p);
    if (ctx.prefs) updatePreferences(store, { theme: p }).catch(() => undefined);
  };
  useEffect(() => {
    // Apply the synced theme on a new device.
    if (ctx.prefs && ctx.prefs.theme !== theme.preference) theme.setPreference(ctx.prefs.theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.prefs?.theme]);

  const syncLabel =
    status.phase === 'syncing' ? 'Syncing…' : status.phase === 'offline' ? 'Offline — changes are saved on this device' : status.phase === 'error' ? `Paused: ${status.lastError ?? ''}` : status.lastSyncedAt ? `Up to date · ${new Date(status.lastSyncedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : 'Not synced yet';

  return (
    <Screen title="Profile">
      <Group>
        <ListRow icon={UserRound} title={ctx.profile?.display_name || 'Add your name'} subtitle={email} chevron onPress={() => setSheet('name')} />
      </Group>

      <Section title="Appearance">
        <SegmentedControl<ThemePreference>
          segments={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
          value={theme.preference}
          onChange={setTheme}
        />
      </Section>

      <Section title="Personal development">
        <Group>
          {DEV_LINKS.map((l) => (
            <ListRow key={l.key} icon={l.icon} title={l.title} chevron onPress={() => router.push({ pathname: '/(app)/c/[key]', params: { key: l.key } })} />
          ))}
        </Group>
      </Section>

      <Section title="Planning">
        <Group>
          <ListRow icon={SlidersHorizontal} title="Scheduling" subtitle="Day hours, focus limit, breaks, free time" chevron onPress={() => router.push('/(app)/settings/scheduling')} />
          <ListRow icon={CalendarClock} title="Blocked time & hours" subtitle="School, morning routine, study and training hours" chevron onPress={() => router.push('/(app)/settings/hours')} />
          <ListRow icon={Shapes} title="Categories" chevron onPress={() => router.push('/(app)/settings/categories')} />
          <ListRow icon={Bell} title="Reminders" subtitle="Habit and task reminders, quiet hours" chevron onPress={() => router.push('/(app)/settings/notifications')} />
        </Group>
      </Section>

      <Section title="Data & privacy">
        <Group>
          <ListRow
            icon={RefreshCw}
            title="Sync"
            subtitle={`${syncLabel}${status.pending ? ` · ${status.pending} waiting` : ''}`}
            trailing={status.conflicts ? <Badge label={`${status.conflicts} notice${status.conflicts === 1 ? '' : 's'}`} tone="warning" /> : null}
            onPress={() => router.push('/(app)/settings/sync')}
            chevron
          />
          <ListRow
            icon={Download}
            title="Export my data"
            subtitle="A complete copy as a JSON file"
            onPress={() => exportAllData(store).catch((e) => toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' }))}
          />
          <ListRow icon={Trash2} title="Delete account" destructive onPress={() => setSheet('delete')} />
        </Group>
        <Text variant="caption" tone="tertiary">
          ASCEND only requires your email. Your data is private to your account and protected by row-level security on the server.
        </Text>
      </Section>

      <Button
        label="Sign out"
        variant="secondary"
        icon={LogOut}
        onPress={async () => {
          if (status.pending && !(await confirm({ title: 'Sign out?', message: `${status.pending} change${status.pending === 1 ? ' hasn’t' : 's haven’t'} synced yet. They stay on this device and sync next time you sign in here.`, confirmLabel: 'Sign out' }))) return;
          await syncNow().catch(() => undefined);
          await signOut();
        }}
      />

      {sheet === 'name' ? <NameSheet current={ctx.profile?.display_name ?? ''} onClose={() => setSheet(null)} /> : null}
      {sheet === 'delete' ? <DeleteSheet email={email} onClose={() => setSheet(null)} /> : null}
    </Screen>
  );
}

function NameSheet({ current, onClose }: { current: string; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [name, setName] = useState(current);
  return (
    <Sheet
      visible
      onClose={onClose}
      title="Your name"
      footer={<Button label="Save" onPress={() => updateProfile(store, { display_name: name }).then(() => { toast.show('Saved'); onClose(); }).catch((e) => toast.show(String(e), { kind: 'error' }))} />}
    >
      <TextField label="Name" value={name} onChangeText={setName} autoFocus maxLength={80} hint="Used for greetings. Optional." />
    </Sheet>
  );
}

function DeleteSheet({ email, onClose }: { email: string; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      visible
      onClose={onClose}
      title="Delete your account"
      footer={
        <Button
          label="Delete everything permanently"
          variant="danger"
          loading={busy}
          onPress={async () => {
            if (!(await confirm({ title: 'This cannot be undone', message: 'All your goals, tasks, habits, notes and history will be permanently deleted from the server.', confirmLabel: 'Delete account', destructive: true }))) return;
            setBusy(true);
            try {
              await deleteAccount(email, password);
            } catch (e) {
              toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
              setBusy(false);
            }
          }}
        />
      }
    >
      <Text variant="body" tone="secondary">Consider exporting your data first. Enter your password to confirm it’s you.</Text>
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
    </Sheet>
  );
}

// ───────────────────────────── Scheduling ─────────────────────────────

export function SchedulingSettingsScreen() {
  const store = useStore();
  const toast = useToast();
  const ctx = useUserContext();
  const p = ctx.prefs;
  if (!p) return <Screen edges="none"><Text variant="body" tone="secondary">Your settings haven’t reached this device yet. Connect to the internet and they’ll appear.</Text></Screen>;
  const save = (patch: Partial<Preferences>) =>
    updatePreferences(store, patch).catch((e) => toast.show(e instanceof ValidationError ? e.message : String(e), { kind: 'error' }));
  const row = (label: string, description: string, value: number, key: keyof Preferences, min: number, max: number, step: number, fmt: (v: number) => string) => (
    <View style={{ gap: space.sm }}>
      <View>
        <Text variant="body">{label}</Text>
        <Text variant="caption" tone="secondary">{description}</Text>
      </View>
      <Stepper value={value} onChange={(v) => save({ [key]: v } as Partial<Preferences>)} min={min} max={max} step={step} format={fmt} />
    </View>
  );
  const min = (v: number) => (v >= 60 ? `${Math.floor(v / 60)}h${v % 60 ? ` ${v % 60}m` : ''}` : `${v} min`);
  return (
    <Screen edges="none">
      <Section title="Your day" hint="ASCEND only plans inside these hours.">
        <Row>
          <View style={{ flex: 1 }}><DateTimeField label="Day starts" mode="time" value={parseTime(p.day_start)} onChange={(v: number) => save({ day_start: formatTime(v) })} /></View>
          <View style={{ flex: 1 }}><DateTimeField label="Day ends" mode="time" value={parseTime(p.day_end)} onChange={(v: number) => save({ day_end: formatTime(v) })} /></View>
        </Row>
      </Section>
      <Section title="Workload">
        {row('Focus limit per day', 'The most task time ASCEND will plan in a day.', p.max_focus_minutes_per_day, 'max_focus_minutes_per_day', 30, 960, 30, min)}
        {row('Protected free time', 'Kept unplanned every day, for rest and people.', p.min_free_minutes_per_day, 'min_free_minutes_per_day', 0, 720, 30, min)}
        {row('Default estimate', 'Used when a task has no estimate.', p.default_task_minutes, 'default_task_minutes', 5, 240, 5, min)}
      </Section>
      <Section title="Pacing">
        {row('Longest single block', 'Bigger tasks are split into blocks of this size.', p.max_block_minutes, 'max_block_minutes', 15, 240, 15, min)}
        {row('Break after', 'Continuous work before a break is planned.', p.break_after_minutes, 'break_after_minutes', 25, 240, 5, min)}
        {row('Break length', '', p.break_minutes, 'break_minutes', 5, 60, 5, min)}
        {row('Buffer around events', 'Travel and settling time either side of commitments.', p.buffer_minutes, 'buffer_minutes', 0, 60, 5, min)}
      </Section>
      <ToggleRow label="Plan inbox tasks that have a deadline" description="Otherwise only planned tasks are scheduled." value={p.schedule_inbox_with_deadline} onChange={(v) => save({ schedule_inbox_with_deadline: v })} />
    </Screen>
  );
}

// ───────────────────────────── Blocked time & preferred hours ─────────────────────────────

export function HoursSettingsScreen() {
  const windows = useLive((s) => listAvailability(s), [], ['availability_windows']);
  const [editing, setEditing] = useState<AvailabilityGroup | 'new' | null>(null);
  const groups = groupAvailability(windows.data ?? []);
  const dayNames = (days: number[]) => {
    const set = new Set(days);
    if (set.size === 7) return 'Every day';
    if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'Weekdays';
    if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
    return WEEKDAY_OPTIONS.filter((d) => set.has(d.value)).map((d) => d.label).join(', ');
  };
  const blocked = groups.filter((g) => BLOCKING_KINDS.includes(g.kind));
  const preferred = groups.filter((g) => !BLOCKING_KINDS.includes(g.kind));
  const row = (g: AvailabilityGroup) => (
    <ListRow
      key={g.key}
      title={g.label ?? AVAILABILITY_LABELS[g.kind].label}
      subtitle={`${dayNames(g.days)} · ${g.start}–${g.end}${g.label ? ` · ${AVAILABILITY_LABELS[g.kind].label}` : ''}`}
      chevron
      onPress={() => setEditing(g)}
    />
  );
  return (
    <Screen edges="none" footer={<Button label="Add time" onPress={() => setEditing('new')} />}>
      <Text variant="callout" tone="secondary">Block out time that’s already taken, like school or your morning routine, so ASCEND never plans over it. Preferred hours tell it when you like to study, work and train.</Text>
      <Section title="Blocked time">
        {blocked.length ? <Group>{blocked.map(row)}</Group> : <Text variant="body" tone="tertiary">Nothing blocked out yet.</Text>}
      </Section>
      <Section title="Preferred hours">
        {preferred.length ? <Group>{preferred.map(row)}</Group> : <Text variant="body" tone="tertiary">No preferred hours yet.</Text>}
      </Section>
      {editing ? <TimeWindowSheet group={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /> : null}
    </Screen>
  );
}

function TimeWindowSheet({ group, onClose }: { group?: AvailabilityGroup; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [kind, setKind] = useState<AvailabilityKind>(group?.kind ?? 'no_scheduling');
  const [label, setLabel] = useState(group?.label ?? '');
  const [days, setDays] = useState<number[]>(group?.days ?? [1, 2, 3, 4, 5]);
  const [start, setStart] = useState(group ? parseTime(group.start) : 8 * 60 + 30);
  const [end, setEnd] = useState(group ? parseTime(group.end) : 15 * 60 + 30);
  const fail = (e: unknown) => toast.show(e instanceof ValidationError ? Object.values(e.fields)[0] ?? e.message : e instanceof Error ? e.message : String(e), { kind: 'error' });
  const save = () =>
    replaceAvailability(store, group?.ids ?? [], { kind, label, weekdays: days, start_time: formatTime(start), end_time: formatTime(end) })
      .then(() => { toast.show(BLOCKING_KINDS.includes(kind) ? 'Saved. Nothing will be planned in this time.' : 'Saved. Your plan will use these hours.'); onClose(); })
      .catch(fail);
  const remove = async () => {
    if (!group) return;
    const ok = await confirm({ title: `Remove ${group.label ?? AVAILABILITY_LABELS[group.kind].label}?`, message: 'ASCEND will be able to plan in this time again.', confirmLabel: 'Remove', destructive: true });
    if (ok) removeAvailability(store, group.ids).then(() => { toast.show('Removed'); onClose(); }).catch(fail);
  };
  const usePreset = (p: (typeof BLOCKED_PRESETS)[number]) => {
    setKind('no_scheduling');
    setLabel(p.label);
    setDays(p.weekdays);
    setStart(parseTime(p.start_time));
    setEnd(parseTime(p.end_time));
  };
  return (
    <Sheet
      visible
      onClose={onClose}
      title={group ? 'Edit time' : 'Add time'}
      footer={
        <View style={{ gap: space.sm }}>
          <Button label="Save" onPress={save} />
          {group ? <Button label="Remove" variant="danger" onPress={() => void remove()} /> : null}
        </View>
      }
    >
      {!group ? (
        <View style={{ gap: space.sm }}>
          <Text variant="captionStrong" tone="secondary">Quick start</Text>
          <ChipGroup options={BLOCKED_PRESETS.map((p) => ({ value: p.label, label: p.label }))} value={BLOCKED_PRESETS.find((p) => p.label === label)?.label ?? null} onChange={(v) => { const p = BLOCKED_PRESETS.find((x) => x.label === v); if (p) usePreset(p); }} />
        </View>
      ) : null}
      <ChipGroup options={(Object.keys(AVAILABILITY_LABELS) as AvailabilityKind[]).map((k) => ({ value: k, label: AVAILABILITY_LABELS[k].label }))} value={kind} onChange={setKind} />
      <Text variant="caption" tone="secondary">{AVAILABILITY_LABELS[kind].description}</Text>
      <TextField label="Name (optional)" value={label} onChangeText={setLabel} placeholder={BLOCKING_KINDS.includes(kind) ? 'School, Morning routine, Commute…' : 'e.g. Library time'} maxLength={60} />
      <ChipGroup options={WEEKDAY_OPTIONS} value={days} onChange={(d) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))} />
      <Row>
        <View style={{ flex: 1 }}><DateTimeField label="From" mode="time" value={start} onChange={setStart} /></View>
        <View style={{ flex: 1 }}><DateTimeField label="To" mode="time" value={end} onChange={setEnd} /></View>
      </Row>
    </Sheet>
  );
}

// ───────────────────────────── Categories ─────────────────────────────

export function CategoriesSettingsScreen() {
  const store = useStore();
  const toast = useToast();
  const { categoryColor } = useTheme();
  const cats = useLive((s) => listCategories(s), [], ['categories']);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  return (
    <Screen edges="none" footer={<Button label="New category" onPress={() => setEditing('new')} />}>
      <Group>
        {(cats.data ?? []).map((c) => (
          <ListRow
            key={c.id}
            leading={<Dot color={categoryColor(c.color)} size={10} />}
            title={c.name}
            chevron
            onPress={() => setEditing(c)}
            onLongPress={async () => {
              if (await confirm({ title: `Delete “${c.name}”?`, message: 'Items in it keep working; they just lose the category.', confirmLabel: 'Delete', destructive: true })) {
                await deleteCategory(store, c.id);
                toast.show('Category deleted', { action: { label: 'Undo', onPress: () => void store.restore('categories', c.id) } });
              }
            }}
          />
        ))}
      </Group>
      <Text variant="caption" tone="tertiary">Hold a category to delete it.</Text>
      {editing ? <CategorySheet category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Screen>
  );
}

function CategorySheet({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const { categoryColor } = useTheme();
  const [name, setName] = useState(category?.name ?? '');
  const [color, setColor] = useState(category?.color ?? 'blue');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      if (category) await updateCategory(store, category.id, { name, color: color as never });
      else await createCategory(store, { name, color: color as never });
      toast.show('Saved');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Sheet visible onClose={onClose} title={category ? 'Edit category' : 'New category'} footer={<Button label="Save" onPress={save} />}>
      <TextField label="Name" value={name} onChangeText={setName} error={error} autoFocus={!category} />
      <ChipGroup options={Object.keys(categoryColors).map((c) => ({ value: c, label: c[0]!.toUpperCase() + c.slice(1), color: categoryColor(c) }))} value={color} onChange={setColor} />
    </Sheet>
  );
}

// ───────────────────────────── Sync ─────────────────────────────

export function SyncSettingsScreen() {
  const { store, status, syncNow } = useData();
  const conflicts = useLive(
    (s) => s.query<{ id: number; tbl: string; kind: string; detail: string; created_at: string }>('SELECT id, tbl, kind, detail, created_at FROM _sync_conflicts WHERE dismissed_at IS NULL ORDER BY id DESC LIMIT 50'),
    [status.conflicts],
    [],
  );
  return (
    <Screen edges="none" footer={<Button label={status.phase === 'syncing' ? 'Syncing…' : 'Sync now'} loading={status.phase === 'syncing'} onPress={() => void syncNow()} />}>
      <Group>
        <ListRow title="Status" trailing={<Text variant="callout" tone="secondary">{status.phase === 'idle' ? 'Up to date' : status.phase}</Text>} />
        <ListRow title="Waiting to sync" trailing={<Text variant="callout" tone="secondary">{status.pending}</Text>} />
        <ListRow title="Last synced" trailing={<Text variant="callout" tone="secondary">{status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : 'Never'}</Text>} />
      </Group>
      <Text variant="caption" tone="tertiary">Everything is saved on this device first, so ASCEND works offline. Changes sync automatically when you’re connected.</Text>
      {conflicts.data?.length ? (
        <Section title="Notices" action="Clear" onAction={() => store.db.run("UPDATE _sync_conflicts SET dismissed_at = datetime('now') WHERE dismissed_at IS NULL").then(() => syncNow())}>
          <Group>
            {conflicts.data.map((c) => (
              <ListRow key={c.id} title={c.kind === 'merged' ? `Merged edits in ${c.tbl.replace(/_/g, ' ')}` : `Couldn’t save a change to ${c.tbl.replace(/_/g, ' ')}`} subtitle={`${c.detail} · ${new Date(c.created_at).toLocaleString()}`} />
            ))}
          </Group>
        </Section>
      ) : null}
    </Screen>
  );
}
