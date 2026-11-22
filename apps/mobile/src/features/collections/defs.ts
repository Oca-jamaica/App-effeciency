/**
 * Declarative definitions for the simpler personal-development records. One framework renders the list,
 * search, form and validation for each, so they all look and behave the same.
 */
import { learningProgress, nextBirthday, sleepMinutes } from '@ascend/domain';
import { z } from 'zod';
import type { SyncedTableName } from '@ascend/domain';
import type { Store } from '../../data/store.ts';
import { hhmm, isoDate, parseOrThrow, url, ValidationError } from '../../data/validation.ts';

export type FieldType = 'text' | 'multiline' | 'date' | 'time' | 'number' | 'rating' | 'select' | 'url' | 'bool' | 'tags' | 'ref';
export type RefSource = 'goals' | 'projects' | 'skills' | 'categories';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  max?: number;
  min?: number;
  integer?: boolean;
  options?: { value: string; label: string }[];
  ref?: RefSource;
  /** Only show this field when another field has one of these values. */
  showIf?: { key: string; values: unknown[] };
}

export interface CollectionDef {
  key: string;
  table: SyncedTableName;
  title: string;
  singular: string;
  description: string;
  fields: FieldDef[];
  orderBy: string;
  searchFields: string[];
  listTitle: (r: Record<string, unknown>) => string;
  listSubtitle?: (r: Record<string, unknown>, today: string) => string | null;
  /** `?` in a filter is bound to today's local date. */
  filters?: { label: string; where: string }[];
  empty: { title: string; body: string };
  defaults?: (today: string) => Record<string, unknown>;
  /** Derive stored values from others before saving (e.g. sleep duration from bed/wake times). */
  derive?: (values: Record<string, unknown>, today: string) => Record<string, unknown>;
  /** Extra checks across fields. Return { field: message } for problems. */
  check?: (values: Record<string, unknown>) => Record<string, string> | null;
}

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
const dateLabel = (d: unknown) => (typeof d === 'string' ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export const COLLECTIONS: CollectionDef[] = [
  {
    key: 'journal',
    table: 'journal_entries',
    title: 'Daily Journal',
    singular: 'entry',
    description: 'A few honest lines a day: what went well, what to improve, what you learned.',
    fields: [
      { key: 'entry_date', label: 'Date', type: 'date', required: true },
      { key: 'went_well', label: 'What went well?', type: 'multiline', max: 10000 },
      { key: 'could_improve', label: 'What could be better?', type: 'multiline', max: 10000 },
      { key: 'learned', label: 'What did you learn?', type: 'multiline', max: 10000 },
      { key: 'looking_forward', label: 'What are you looking forward to?', type: 'multiline', max: 10000 },
      { key: 'free_text', label: 'Anything else', type: 'multiline', max: 50000 },
    ],
    orderBy: 'entry_date DESC',
    searchFields: ['went_well', 'could_improve', 'learned', 'looking_forward', 'free_text'],
    listTitle: (r) => new Date(`${r.entry_date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
    listSubtitle: (r) => (s(r.went_well) ?? s(r.learned) ?? s(r.free_text) ?? '').slice(0, 100) || null,
    empty: { title: 'Start your journal', body: 'Two minutes at the end of the day. Over time it becomes the most useful record you have.' },
    defaults: (today) => ({ entry_date: today }),
    check: (v) => (['went_well', 'could_improve', 'learned', 'looking_forward', 'free_text'].some((k) => s(v[k])) ? null : { went_well: 'Write at least one answer' }),
  },
  {
    key: 'decisions',
    table: 'decisions',
    title: 'Decision Journal',
    singular: 'decision',
    description: 'Record what you decided and why, then check later how it turned out.',
    fields: [
      { key: 'title', label: 'Decision', type: 'text', required: true, max: 200, placeholder: 'e.g. Take Economics at A-level' },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'open', label: 'Still deciding' }, { value: 'decided', label: 'Decided' }, { value: 'reviewed', label: 'Reviewed' }] },
      { key: 'decided_on', label: 'Decided on', type: 'date' },
      { key: 'context', label: 'Situation', type: 'multiline', max: 10000 },
      { key: 'alternatives', label: 'Alternatives considered', type: 'multiline', max: 10000 },
      { key: 'reasoning', label: 'Reasoning', type: 'multiline', max: 10000 },
      { key: 'expected_outcome', label: 'What you expect to happen', type: 'multiline', max: 5000 },
      { key: 'confidence', label: 'Confidence', type: 'rating', max: 5 },
      { key: 'review_on', label: 'Review on', type: 'date', hint: 'When to look back and compare.' },
      { key: 'actual_outcome', label: 'What actually happened', type: 'multiline', max: 5000 },
      { key: 'reflection', label: 'Reflection', type: 'multiline', max: 10000 },
    ],
    orderBy: "status = 'reviewed', COALESCE(review_on, '9999'), created_at DESC",
    searchFields: ['title', 'context', 'reasoning', 'reflection'],
    listTitle: (r) => String(r.title),
    listSubtitle: (r, today) =>
      r.status === 'reviewed' ? 'Reviewed' : r.review_on && String(r.review_on) <= today ? 'Due for review' : r.review_on ? `Review on ${dateLabel(r.review_on)}` : r.status === 'open' ? 'Still deciding' : 'Decided',
    filters: [{ label: 'Due for review', where: "status != 'reviewed' AND review_on IS NOT NULL AND review_on <= ?" }],
    empty: { title: 'Better decisions, over time', body: 'Write down big choices with your reasoning. Reviewing them later is how judgement improves.' },
    defaults: (today) => ({ status: 'decided', decided_on: today }),
  },
  {
    key: 'learning',
    table: 'learning_items',
    title: 'Reading & Learning',
    singular: 'item',
    description: 'Books, courses, articles and topics, with progress.',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, max: 300 },
      { key: 'kind', label: 'Type', type: 'select', options: [{ value: 'book', label: 'Book' }, { value: 'course', label: 'Course' }, { value: 'article', label: 'Article' }, { value: 'topic', label: 'Topic' }, { value: 'video', label: 'Video' }, { value: 'podcast', label: 'Podcast' }] },
      { key: 'author_or_provider', label: 'Author or provider', type: 'text', max: 200 },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'want', label: 'Want to start' }, { value: 'in_progress', label: 'In progress' }, { value: 'completed', label: 'Finished' }, { value: 'dropped', label: 'Stopped' }] },
      { key: 'progress_unit', label: 'Measure progress in', type: 'select', options: [{ value: 'pages', label: 'Pages' }, { value: 'chapters', label: 'Chapters' }, { value: 'lessons', label: 'Lessons' }, { value: 'minutes', label: 'Minutes' }, { value: 'percent', label: 'Percent' }] },
      { key: 'progress_current', label: 'Progress so far', type: 'number', min: 0 },
      { key: 'progress_total', label: 'Total', type: 'number', min: 1, showIf: { key: 'progress_unit', values: ['pages', 'chapters', 'lessons', 'minutes'] } },
      { key: 'url', label: 'Link', type: 'url' },
      { key: 'goal_id', label: 'Supports goal', type: 'ref', ref: 'goals' },
      { key: 'skill_id', label: 'Develops skill', type: 'ref', ref: 'skills' },
      { key: 'rating', label: 'Rating', type: 'rating', max: 5, showIf: { key: 'status', values: ['completed', 'dropped'] } },
      { key: 'notes', label: 'Notes', type: 'multiline', max: 20000 },
    ],
    orderBy: "CASE status WHEN 'in_progress' THEN 0 WHEN 'want' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END, updated_at DESC",
    searchFields: ['title', 'author_or_provider', 'notes'],
    listTitle: (r) => String(r.title),
    listSubtitle: (r) => {
      const p = learningProgress(r.progress_current as number | null, r.progress_total as number | null, String(r.progress_unit));
      const st = { want: 'Want to start', in_progress: 'In progress', completed: 'Finished', dropped: 'Stopped' }[String(r.status)] ?? '';
      return [st, r.status === 'in_progress' ? p.label : null, s(r.author_or_provider)].filter(Boolean).join(' · ');
    },
    filters: [
      { label: 'In progress', where: "status = 'in_progress'" },
      { label: 'Finished', where: "status = 'completed'" },
    ],
    empty: { title: 'What are you learning?', body: 'Track books, courses and topics. Study sessions can be linked to them from the focus timer.' },
    defaults: () => ({ kind: 'book', status: 'want', progress_unit: 'pages' }),
    derive: (v, today) => ({
      started_on: v.status === 'in_progress' || v.status === 'completed' ? (v.started_on ?? today) : v.started_on ?? null,
      completed_on: v.status === 'completed' ? (v.completed_on ?? today) : null,
      progress_total: v.progress_unit === 'percent' ? null : v.progress_total ?? null,
    }),
    check: (v) =>
      v.progress_unit === 'percent' && typeof v.progress_current === 'number' && v.progress_current > 100
        ? { progress_current: 'Percent can’t be over 100' }
        : typeof v.progress_total === 'number' && typeof v.progress_current === 'number' && v.progress_current > v.progress_total
          ? { progress_current: 'Progress can’t be more than the total' }
          : null,
  },
  {
    key: 'vault',
    table: 'knowledge_items',
    title: 'Knowledge Vault',
    singular: 'item',
    description: 'Notes, articles, books and resources worth keeping, searchable by title, text and tag.',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, max: 300 },
      { key: 'kind', label: 'Type', type: 'select', options: [{ value: 'note', label: 'Note' }, { value: 'article', label: 'Article' }, { value: 'video', label: 'Video' }, { value: 'book', label: 'Book' }, { value: 'course', label: 'Course' }, { value: 'link', label: 'Link' }, { value: 'info', label: 'Important info' }] },
      { key: 'url', label: 'Link', type: 'url' },
      { key: 'body', label: 'Content', type: 'multiline', max: 100000 },
      { key: 'source_name', label: 'Source', type: 'text', max: 120 },
      { key: 'tags', label: 'Tags', type: 'tags', hint: 'Separate with commas.' },
      { key: 'goal_id', label: 'Related goal', type: 'ref', ref: 'goals' },
      { key: 'project_id', label: 'Related project', type: 'ref', ref: 'projects' },
      { key: 'is_favorite', label: 'Favourite', type: 'bool' },
    ],
    orderBy: 'is_favorite DESC, updated_at DESC',
    searchFields: ['title', 'body', 'source_name', 'tags', 'url'],
    listTitle: (r) => String(r.title),
    listSubtitle: (r) => [String(r.kind ?? '').replace('_', ' '), ...(Array.isArray(r.tags) ? (r.tags as string[]).map((t) => `#${t}`) : [])].filter(Boolean).join(' · '),
    filters: [{ label: 'Favourites', where: 'is_favorite = 1' }],
    empty: { title: 'Your second brain', body: 'Save anything worth keeping. Links saved inside goals appear here too.' },
    defaults: () => ({ kind: 'note', tags: [], is_favorite: false }),
  },
  {
    key: 'ideas',
    table: 'ideas',
    title: 'Idea Incubator',
    singular: 'idea',
    description: 'Capture business and project ideas, research them, and turn the best into projects.',
    fields: [
      { key: 'title', label: 'Idea', type: 'text', required: true, max: 200 },
      { key: 'description', label: 'Description', type: 'multiline', max: 10000 },
      { key: 'status', label: 'Stage', type: 'select', options: [{ value: 'seed', label: 'Seed' }, { value: 'exploring', label: 'Exploring' }, { value: 'validated', label: 'Validated' }, { value: 'parked', label: 'Parked' }, { value: 'converted', label: 'Became a project' }] },
      { key: 'potential', label: 'Potential', type: 'rating', max: 5 },
      { key: 'category_id', label: 'Category', type: 'ref', ref: 'categories' },
      { key: 'research', label: 'Research', type: 'multiline', max: 20000 },
      { key: 'next_steps', label: 'Next steps', type: 'multiline', max: 5000 },
      { key: 'project_id', label: 'Linked project', type: 'ref', ref: 'projects' },
    ],
    orderBy: "status = 'parked', status = 'converted', COALESCE(potential, 0) DESC, updated_at DESC",
    searchFields: ['title', 'description', 'research', 'next_steps'],
    listTitle: (r) => String(r.title),
    listSubtitle: (r) => [{ seed: 'Seed', exploring: 'Exploring', validated: 'Validated', parked: 'Parked', converted: 'Became a project' }[String(r.status)], r.potential ? `potential ${r.potential}/5` : null].filter(Boolean).join(' · '),
    empty: { title: 'Ideas worth exploring', body: 'Write ideas down before they disappear. Research them here and promote the best into projects.' },
    defaults: () => ({ status: 'seed' }),
  },
  {
    key: 'experiences',
    table: 'experiences',
    title: 'Experiences',
    singular: 'experience',
    description: 'Places to visit, events to attend, things to try.',
    fields: [
      { key: 'title', label: 'Experience', type: 'text', required: true, max: 200, placeholder: 'e.g. Watch a Champions League final' },
      { key: 'category', label: 'Type', type: 'select', options: [{ value: 'place', label: 'Place' }, { value: 'event', label: 'Event' }, { value: 'activity', label: 'Activity' }, { value: 'skill', label: 'New skill' }, { value: 'other', label: 'Other' }] },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'someday', label: 'Someday' }, { value: 'planned', label: 'Planned' }, { value: 'done', label: 'Done' }] },
      { key: 'target_date', label: 'When', type: 'date', showIf: { key: 'status', values: ['someday', 'planned'] } },
      { key: 'completed_on', label: 'Done on', type: 'date', showIf: { key: 'status', values: ['done'] } },
      { key: 'location', label: 'Where', type: 'text', max: 200 },
      { key: 'rating', label: 'How was it?', type: 'rating', max: 5, showIf: { key: 'status', values: ['done'] } },
      { key: 'description', label: 'Description', type: 'multiline', max: 5000 },
      { key: 'notes', label: 'Notes', type: 'multiline', max: 5000 },
    ],
    orderBy: "status = 'done', COALESCE(target_date, '9999'), created_at DESC",
    searchFields: ['title', 'location', 'description', 'notes'],
    listTitle: (r) => String(r.title),
    listSubtitle: (r) => (r.status === 'done' ? `Done ${dateLabel(r.completed_on)}` : [r.status === 'planned' ? 'Planned' : 'Someday', r.target_date ? dateLabel(r.target_date) : null, s(r.location)].filter(Boolean).join(' · ')),
    filters: [
      { label: 'To do', where: "status != 'done'" },
      { label: 'Done', where: "status = 'done'" },
    ],
    empty: { title: 'Collect experiences', body: 'A list of things you want to see and do. Ticking them off becomes part of your timeline.' },
    defaults: () => ({ category: 'activity', status: 'someday' }),
    derive: (v, today) => ({ completed_on: v.status === 'done' ? (v.completed_on ?? today) : null, rating: v.status === 'done' ? v.rating ?? null : null }),
  },
  {
    key: 'people',
    table: 'people',
    title: 'People & birthdays',
    singular: 'person',
    description: 'The people you make plans with, and their birthdays.',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, max: 120 },
      { key: 'relationship', label: 'Relationship', type: 'text', max: 80, placeholder: 'Friend, teammate, family…' },
      { key: 'birthday_month', label: 'Birthday month', type: 'select', options: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => ({ value: String(i + 1), label: m })) },
      { key: 'birthday_day', label: 'Birthday day', type: 'number', integer: true, min: 1, max: 31 },
      { key: 'birth_year', label: 'Birth year (optional)', type: 'number', integer: true, min: 1900, max: 2100 },
      { key: 'notes', label: 'Notes', type: 'multiline', max: 5000, hint: 'Gift ideas, things to remember.' },
    ],
    orderBy: 'name COLLATE NOCASE',
    searchFields: ['name', 'relationship', 'notes'],
    listTitle: (r) => String(r.name),
    listSubtitle: (r, today) => {
      if (!r.birthday_month || !r.birthday_day) return s(r.relationship);
      const next = nextBirthday(Number(r.birthday_month), Number(r.birthday_day), today);
      return [s(r.relationship), `Birthday ${dateLabel(next)}`].filter(Boolean).join(' · ');
    },
    empty: { title: 'Your people', body: 'Add friends and family to remember birthdays and plan time together. Only you can see this.' },
    derive: (v) => ({ birthday_month: v.birthday_month ? Number(v.birthday_month) : null, birthday_day: v.birthday_month ? v.birthday_day ?? null : null, birth_year: v.birthday_month ? v.birth_year ?? null : null }),
    check: (v) => {
      if (!!v.birthday_month !== !!v.birthday_day) return { birthday_day: 'Enter both the month and the day' };
      if (v.birthday_month && v.birthday_day) {
        const max = new Date(Date.UTC(2000, Number(v.birthday_month), 0)).getUTCDate();
        if (Number(v.birthday_day) > max) return { birthday_day: `That month has ${max} days` };
      }
      return null;
    },
  },
  {
    key: 'sleep',
    table: 'sleep_logs',
    title: 'Sleep & Recovery',
    singular: 'night',
    description: 'Optional, simple, and private: how long you slept and how you feel.',
    fields: [
      { key: 'sleep_date', label: 'Morning of', type: 'date', required: true },
      { key: 'bed_at', label: 'Went to bed', type: 'time' },
      { key: 'wake_at', label: 'Woke up', type: 'time' },
      { key: 'energy', label: 'Energy', type: 'rating', max: 5 },
      { key: 'recovery', label: 'Recovery', type: 'rating', max: 5, hint: 'How rested your body feels.' },
      { key: 'notes', label: 'Notes', type: 'multiline', max: 2000 },
    ],
    orderBy: 'sleep_date DESC',
    searchFields: ['notes'],
    listTitle: (r) => new Date(`${r.sleep_date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
    listSubtitle: (r) =>
      [r.duration_minutes ? `${Math.floor(Number(r.duration_minutes) / 60)}h ${Number(r.duration_minutes) % 60}m` : null, r.energy ? `energy ${r.energy}/5` : null, r.recovery ? `recovery ${r.recovery}/5` : null].filter(Boolean).join(' · ') || null,
    empty: { title: 'Sleep, simply', body: 'Log nights when you want to. Over a couple of weeks, patterns between sleep and energy become visible.' },
    defaults: (today) => ({ sleep_date: today }),
    derive: (v) => ({ duration_minutes: s(v.bed_at) && s(v.wake_at) ? sleepMinutes(String(v.bed_at), String(v.wake_at)) : null }),
  },
  {
    key: 'notes',
    table: 'notes',
    title: 'Workspace',
    singular: 'note',
    description: 'Project notes, research and documents, organised in folders.',
    fields: [
      { key: 'title', label: 'Title', type: 'text', max: 200 },
      { key: 'body', label: 'Note', type: 'multiline', max: 100000 },
      { key: 'folder', label: 'Folder', type: 'text', max: 80, placeholder: 'e.g. Research' },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects' },
      { key: 'tags', label: 'Tags', type: 'tags' },
      { key: 'pinned', label: 'Pin to top', type: 'bool' },
    ],
    orderBy: 'pinned DESC, updated_at DESC',
    searchFields: ['title', 'body', 'folder', 'tags'],
    listTitle: (r) => s(r.title) ?? (String(r.body ?? '').split('\n')[0]?.slice(0, 80) || 'Untitled'),
    listSubtitle: (r) => [s(r.folder), new Date(String(r.updated_at)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })].filter(Boolean).join(' · '),
    empty: { title: 'Your workspace', body: 'Notes, research and documents for your projects. Goal notes live inside each goal.' },
    defaults: () => ({ note_type: 'general', tags: [], pinned: false }),
    check: (v) => (s(v.title) || s(v.body) ? null : { body: 'Write something first' }),
  },
];

export function collectionDef(key: string): CollectionDef {
  const d = COLLECTIONS.find((c) => c.key === key);
  if (!d) throw new Error(`Unknown collection ${key}`);
  return d;
}

/** Workspace notes exclude notes that belong to a goal (those are shown inside the goal). */
export function baseWhere(def: CollectionDef): string | undefined {
  return def.key === 'notes' ? 'goal_id IS NULL' : undefined;
}

function fieldSchema(f: FieldDef): z.ZodTypeAny {
  const nullableText = (max: number) => z.string().max(max, `Keep this under ${max} characters`).transform((v) => (v.trim() ? v.trim() : null)).nullable().optional();
  switch (f.type) {
    case 'text':
      return f.required ? z.string().trim().min(1, `${f.label} is required`).max(f.max ?? 200) : nullableText(f.max ?? 200);
    case 'multiline':
      return nullableText(f.max ?? 10000);
    case 'date':
      return f.required ? isoDate : isoDate.nullable().optional();
    case 'time':
      return hhmm.nullable().optional();
    case 'number': {
      let n = z.number({ message: 'Enter a number' }).finite();
      if (f.integer) n = n.int('Use a whole number');
      if (f.min !== undefined) n = n.min(f.min, `At least ${f.min}`);
      if (f.max !== undefined) n = n.max(f.max, `At most ${f.max}`);
      return n.nullable().optional();
    }
    case 'rating':
      return z.number().int().min(1).max(f.max ?? 5).nullable().optional();
    case 'select':
      return z.enum((f.options ?? []).map((o) => o.value) as [string, ...string[]]).optional();
    case 'url':
      return z.union([z.literal('').transform(() => null), url]).nullable().optional();
    case 'bool':
      return z.boolean().optional();
    case 'tags':
      return z.array(z.string().trim().min(1).max(40)).max(20).optional();
    case 'ref':
      return z.string().uuid().nullable().optional();
  }
}

export function parseTags(text: string): string[] {
  return [...new Set(text.split(',').map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))].slice(0, 20);
}

/** Validates and saves a record of any collection. Returns the saved id. */
export async function saveRecord(store: Store, def: CollectionDef, id: string | null, raw: Record<string, unknown>, today: string): Promise<string> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of def.fields) shape[f.key] = fieldSchema(f);
  const parsed = parseOrThrow(z.object(shape), raw) as Record<string, unknown>;
  for (const f of def.fields) if (f.type === 'select' && parsed[f.key] === undefined && def.defaults) parsed[f.key] = def.defaults(today)[f.key];
  const values = { ...(def.defaults?.(today) ?? {}), ...parsed };
  Object.assign(values, def.derive?.(values, today) ?? {});
  const problems = def.check?.(values);
  if (problems) throw new ValidationError(problems);
  for (const k of Object.keys(values)) if (values[k] === undefined) values[k] = null;
  if (def.key === 'notes' && !values.note_type) values.note_type = 'general';
  if (id) {
    const current = await store.get(def.table, id);
    const changes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) if (current && k in current) changes[k] = v;
    await store.update(def.table, id, changes);
    return id;
  }
  // Day-based records (journal, sleep): reuse an existing entry for the same day instead of duplicating it.
  const dayKey = def.table === 'journal_entries' ? 'entry_date' : def.table === 'sleep_logs' ? 'sleep_date' : null;
  if (dayKey) {
    const [existing] = await store.list<{ id: string }>(def.table, { where: `${dayKey} = ?`, params: [String(values[dayKey])], limit: 1 });
    if (existing) {
      await store.update(def.table, existing.id, values);
      return existing.id;
    }
  }
  const row = await store.insert(def.table, values);
  return row.id;
}

export async function listRecords(store: Store, def: CollectionDef, opts: { search?: string; filter?: string; today?: string } = {}): Promise<Record<string, unknown>[]> {
  const where: string[] = [];
  const params: string[] = [];
  const base = baseWhere(def);
  if (base) where.push(base);
  if (opts.filter) {
    where.push(opts.filter);
    for (let i = 0; i < (opts.filter.match(/\?/g) ?? []).length; i++) params.push(opts.today ?? new Date().toISOString().slice(0, 10));
  }
  const q = opts.search?.trim().toLowerCase();
  if (q) {
    where.push(`(${def.searchFields.map((f) => `lower(COALESCE(${f}, '')) LIKE ?`).join(' OR ')})`);
    for (let i = 0; i < def.searchFields.length; i++) params.push(`%${q.replace(/[%_]/g, '')}%`);
  }
  return (await store.list<{ id: string }>(def.table, { where: where.join(' AND ') || undefined, params, orderBy: def.orderBy, limit: 500 })) as unknown as Record<string, unknown>[];
}

