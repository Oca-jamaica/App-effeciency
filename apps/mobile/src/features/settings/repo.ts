import { z } from 'zod';
import { localToUtc, parseTime, weekday } from '@ascend/domain';
import type { Store } from '../../data/store.ts';
import { rankAtEnd } from '../../data/ranks.ts';
import type { AvailabilityKind, AvailabilityWindowRow, Category, Preferences, Profile } from '../../data/types.ts';
import { hhmm, optionalText, parseOrThrow, requiredTitle, ValidationError } from '../../data/validation.ts';

export async function getPreferences(store: Store): Promise<Preferences | null> {
  const [p] = await store.list<Preferences>('user_preferences', { limit: 1 });
  return p ?? null;
}

export async function getProfile(store: Store): Promise<Profile | null> {
  const [p] = await store.list<Profile>('profiles', { limit: 1 });
  return p ?? null;
}

export const schedulingPrefsInput = z
  .object({
    day_start: hhmm,
    day_end: hhmm,
    default_task_minutes: z.number().int().min(5).max(480),
    max_focus_minutes_per_day: z.number().int().min(30).max(960),
    max_block_minutes: z.number().int().min(15).max(240),
    break_after_minutes: z.number().int().min(25).max(240),
    break_minutes: z.number().int().min(5).max(60),
    buffer_minutes: z.number().int().min(0).max(60),
    min_free_minutes_per_day: z.number().int().min(0).max(720),
    schedule_inbox_with_deadline: z.boolean(),
    quiet_hours_start: hhmm.nullable(),
    quiet_hours_end: hhmm.nullable(),
    max_notifications_per_day: z.number().int().min(0).max(50),
    notify_block_start: z.boolean(),
  })
  .refine((p) => (p.quiet_hours_start === null) === (p.quiet_hours_end === null), { message: 'Set both ends of quiet hours', path: ['quiet_hours_end'] })
  .refine((p) => p.quiet_hours_start === null || p.quiet_hours_start !== p.quiet_hours_end, { message: 'Quiet hours must start and end at different times', path: ['quiet_hours_end'] })
  .refine((p) => p.day_end > p.day_start, { message: 'Your day must end after it starts', path: ['day_end'] });

export async function updatePreferences(store: Store, patch: Partial<Preferences>): Promise<void> {
  const current = await getPreferences(store);
  if (!current) throw new Error('Your preferences have not synced to this device yet. Connect to the internet and try again.');
  const merged = { ...current, ...patch };
  const r = schedulingPrefsInput.safeParse(merged);
  if (!r.success) throw new ValidationError({ form: r.error.issues[0]?.message ?? 'Invalid settings' });
  await store.update('user_preferences', current.id, patch);
}

export async function updateProfile(store: Store, patch: Partial<Pick<Profile, 'display_name' | 'timezone' | 'week_starts_on'>>): Promise<void> {
  const current = await getProfile(store);
  if (!current) throw new Error('Your profile has not synced to this device yet.');
  if (patch.display_name !== undefined && patch.display_name !== null && patch.display_name.length > 80) {
    throw new ValidationError({ display_name: 'Keep your name under 80 characters' });
  }
  await store.update('profiles', current.id, { ...patch, display_name: patch.display_name?.trim() || (patch.display_name === undefined ? current.display_name : null) });
}

// ───────────────────────────── availability ─────────────────────────────

export const availabilityInput = z
  .object({
    weekdays: z.array(z.number().int().min(0).max(6)).min(1, 'Choose at least one day'),
    start_time: hhmm,
    end_time: hhmm,
    kind: z.enum(['work', 'study', 'training', 'protected_free', 'no_scheduling']),
    label: optionalText(60),
  })
  .refine((w) => w.end_time > w.start_time, { message: 'End must be after start', path: ['end_time'] });
export type AvailabilityInput = z.input<typeof availabilityInput>;

export async function listAvailability(store: Store): Promise<AvailabilityWindowRow[]> {
  return store.list<AvailabilityWindowRow>('availability_windows', { orderBy: 'kind, weekday, start_time' });
}

/** Adds the same window on several weekdays at once (e.g. study hours Mon–Fri 16:00–19:00). */
export async function addAvailability(store: Store, input: AvailabilityInput): Promise<void> {
  await replaceAvailability(store, [], input);
}

/** Replaces a group of windows (one per weekday) with an edited version, in one step. */
export async function replaceAvailability(store: Store, ids: readonly string[], input: AvailabilityInput): Promise<void> {
  const v = parseOrThrow(availabilityInput, input);
  await store.write(async (tx) => {
    for (const id of ids) await tx.remove('availability_windows', id);
    for (const weekday of new Set(v.weekdays)) {
      await tx.insert('availability_windows', { weekday, start_time: v.start_time, end_time: v.end_time, kind: v.kind, label: v.label ?? null });
    }
  });
}

export interface AvailabilityGroup {
  key: string;
  kind: AvailabilityKind;
  label: string | null;
  start: string;
  end: string;
  ids: string[];
  days: number[];
}

/** Windows stored one row per weekday, grouped back into what the user entered ("School, Mon–Fri"). */
export function groupAvailability(rows: readonly AvailabilityWindowRow[]): AvailabilityGroup[] {
  const groups = new Map<string, AvailabilityGroup>();
  for (const w of rows) {
    const key = `${w.kind}|${w.label ?? ''}|${w.start_time}|${w.end_time}`;
    const g = groups.get(key) ?? { key, kind: w.kind, label: w.label, start: w.start_time, end: w.end_time, ids: [], days: [] };
    g.ids.push(w.id);
    g.days.push(w.weekday);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => Number(!BLOCKING_KINDS.includes(a.kind)) - Number(!BLOCKING_KINDS.includes(b.kind)) || a.start.localeCompare(b.start));
}

/** Kinds the scheduler never plans inside. */
export const BLOCKING_KINDS: readonly AvailabilityKind[] = ['no_scheduling', 'protected_free'];

/** Blocked-out time on one date, as instants, for showing on the day plan. */
export async function blockedTimeOn(store: Store, date: string, timeZone: string): Promise<{ key: string; title: string; kind: AvailabilityKind; start: number; end: number }[]> {
  const rows = await store.list<AvailabilityWindowRow>('availability_windows', {
    where: `weekday = ? AND kind IN (${BLOCKING_KINDS.map(() => '?').join(',')})`,
    params: [weekday(date), ...BLOCKING_KINDS],
    orderBy: 'start_time',
  });
  return rows.map((w) => ({
    key: w.id,
    title: w.label ?? AVAILABILITY_LABELS[w.kind].label,
    kind: w.kind,
    start: localToUtc(date, parseTime(w.start_time), timeZone),
    end: localToUtc(date, parseTime(w.end_time), timeZone),
  }));
}

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 0];
const SCHOOL_DAYS = [1, 2, 3, 4, 5];
/** Common things people block out, as one-tap starting points they can adjust. */
export const BLOCKED_PRESETS: { label: string; weekdays: number[]; start_time: string; end_time: string }[] = [
  { label: 'Morning routine', weekdays: EVERY_DAY, start_time: '06:30', end_time: '08:00' },
  { label: 'School', weekdays: SCHOOL_DAYS, start_time: '08:30', end_time: '15:30' },
  { label: 'Commute', weekdays: SCHOOL_DAYS, start_time: '15:30', end_time: '16:15' },
  { label: 'Dinner', weekdays: EVERY_DAY, start_time: '18:30', end_time: '19:15' },
  { label: 'Wind down', weekdays: EVERY_DAY, start_time: '21:30', end_time: '22:30' },
];

export async function removeAvailability(store: Store, ids: string[]): Promise<void> {
  await store.write(async (tx) => {
    for (const id of ids) await tx.remove('availability_windows', id);
  });
}

export const AVAILABILITY_LABELS: Record<AvailabilityKind, { label: string; description: string }> = {
  no_scheduling: { label: 'Blocked time', description: 'School, your morning routine, a commute: nothing is planned here.' },
  protected_free: { label: 'Protected free time', description: 'Time kept free for rest and people. Nothing is planned here.' },
  study: { label: 'Study hours', description: 'Academic tasks are planned here first.' },
  work: { label: 'Work hours', description: 'Work and project tasks are planned here first.' },
  training: { label: 'Training time', description: 'Fitness and sport go here first.' },
};

// ───────────────────────────── categories ─────────────────────────────

export const categoryInput = z.object({
  name: requiredTitle(60),
  color: z.enum(['blue', 'green', 'teal', 'violet', 'amber', 'indigo', 'rose', 'slate']).default('slate'),
  icon: z.string().max(48).default('circle'),
});

export async function listCategories(store: Store, includeArchived = false): Promise<Category[]> {
  return store.list<Category>('categories', { where: includeArchived ? undefined : 'archived_at IS NULL', orderBy: 'rank COLLATE BINARY' });
}

export async function createCategory(store: Store, input: z.input<typeof categoryInput>): Promise<Category> {
  const v = parseOrThrow(categoryInput, input);
  const existing = await store.list<Category>('categories', { where: 'lower(name) = lower(?)', params: [v.name] });
  if (existing.length) throw new ValidationError({ name: 'You already have a category with this name' });
  const rank = await rankAtEnd(store, 'categories');
  return store.insert<Category>('categories', { ...v, applies_to: ['goal', 'task', 'habit', 'event'], is_default: false, rank });
}

export async function updateCategory(store: Store, id: string, input: Partial<z.input<typeof categoryInput>>): Promise<void> {
  const current = await store.get<Category>('categories', id);
  if (!current) throw new Error('Category not found');
  const v = parseOrThrow(categoryInput, { name: current.name, color: current.color, icon: current.icon, ...input });
  const clash = await store.list<Category>('categories', { where: 'lower(name) = lower(?) AND id != ?', params: [v.name, id] });
  if (clash.length) throw new ValidationError({ name: 'You already have a category with this name' });
  await store.update('categories', id, v);
}

export async function deleteCategory(store: Store, id: string): Promise<void> {
  await store.remove('categories', id);
}
