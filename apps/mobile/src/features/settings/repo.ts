import { z } from 'zod';
import type { Store } from '../../data/store.ts';
import { rankAtEnd } from '../../data/ranks.ts';
import type { AvailabilityKind, AvailabilityWindowRow, Category, Preferences, Profile } from '../../data/types.ts';
import { hhmm, parseOrThrow, requiredTitle, ValidationError } from '../../data/validation.ts';

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
  })
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
  })
  .refine((w) => w.end_time > w.start_time, { message: 'End must be after start', path: ['end_time'] });

export async function listAvailability(store: Store): Promise<AvailabilityWindowRow[]> {
  return store.list<AvailabilityWindowRow>('availability_windows', { orderBy: 'kind, weekday, start_time' });
}

/** Adds the same window on several weekdays at once (e.g. study hours Mon–Fri 16:00–19:00). */
export async function addAvailability(store: Store, input: z.input<typeof availabilityInput>): Promise<void> {
  const v = parseOrThrow(availabilityInput, input);
  await store.write(async (tx) => {
    for (const weekday of v.weekdays) {
      await tx.insert('availability_windows', { weekday, start_time: v.start_time, end_time: v.end_time, kind: v.kind });
    }
  });
}

export async function removeAvailability(store: Store, ids: string[]): Promise<void> {
  await store.write(async (tx) => {
    for (const id of ids) await tx.remove('availability_windows', id);
  });
}

export const AVAILABILITY_LABELS: Record<AvailabilityKind, { label: string; description: string }> = {
  study: { label: 'Study hours', description: 'Academic tasks are planned here first.' },
  work: { label: 'Work hours', description: 'Work and project tasks are planned here first.' },
  training: { label: 'Training time', description: 'Fitness and sport go here first.' },
  protected_free: { label: 'Protected free time', description: 'Nothing is ever scheduled here.' },
  no_scheduling: { label: 'Unavailable', description: 'Time you are busy or away.' },
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
