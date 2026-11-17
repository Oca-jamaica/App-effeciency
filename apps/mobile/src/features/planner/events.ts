import { z } from 'zod';
import { addDays, localToUtc, occurrencesBetween, parseRRule, utcToLocalDate, utcToLocalMinutes } from '@ascend/domain';
import type { Store } from '../../data/store.ts';
import type { CalendarEvent, EventKind } from '../../data/types.ts';
import { isoDate, optionalText, parseOrThrow, requiredTitle, ValidationError } from '../../data/validation.ts';

export const eventInput = z.object({
  title: requiredTitle(),
  description: optionalText(5000),
  location: optionalText(300),
  date: isoDate,
  start_minutes: z.number().int().min(0).max(24 * 60),
  end_minutes: z.number().int().min(0).max(24 * 60),
  end_date: isoDate.optional(),
  all_day: z.boolean().default(false),
  kind: z.enum(['event', 'commitment', 'class', 'work', 'training', 'social', 'travel', 'other']).default('event'),
  is_locked: z.boolean().default(false),
  busy: z.boolean().default(true),
  recurrence_rule: z.string().max(200).nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  goal_id: z.string().uuid().nullable().optional(),
});
export type EventInput = z.input<typeof eventInput>;

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  event: 'Event',
  commitment: 'Fixed commitment',
  class: 'Class / lesson',
  work: 'Work',
  training: 'Training',
  social: 'Social',
  travel: 'Travel',
  other: 'Other',
};

function toInstants(v: z.output<typeof eventInput>, timeZone: string): { starts_at: string; ends_at: string } {
  if (v.all_day) {
    const end = v.end_date ?? v.date;
    if (end < v.date) throw new ValidationError({ end_date: 'End date must be after the start date' });
    return {
      starts_at: new Date(localToUtc(v.date, 0, timeZone)).toISOString(),
      ends_at: new Date(localToUtc(addDays(end, 1), 0, timeZone)).toISOString(),
    };
  }
  const endDate = v.end_date ?? (v.end_minutes <= v.start_minutes ? addDays(v.date, 1) : v.date);
  const start = localToUtc(v.date, v.start_minutes, timeZone);
  const end = localToUtc(endDate, v.end_minutes, timeZone);
  if (end <= start) throw new ValidationError({ end_minutes: 'End time must be after the start time' });
  return { starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() };
}

function checkRule(rule: string | null | undefined): void {
  if (!rule) return;
  try {
    parseRRule(rule);
  } catch {
    throw new ValidationError({ recurrence_rule: 'Invalid repeat rule' });
  }
}

export async function createEvent(store: Store, input: EventInput, timeZone: string): Promise<CalendarEvent> {
  const v = parseOrThrow(eventInput, input);
  checkRule(v.recurrence_rule);
  return store.insert<CalendarEvent>('calendar_events', {
    title: v.title,
    description: v.description ?? null,
    location: v.location ?? null,
    ...toInstants(v, timeZone),
    all_day: v.all_day,
    timezone: timeZone,
    kind: v.kind,
    // Fixed commitments are always locked: neither the scheduler nor the AI may move them.
    is_locked: v.kind === 'commitment' ? true : v.is_locked,
    busy: v.busy,
    recurrence_rule: v.recurrence_rule ?? null,
    exdates: [],
    category_id: v.category_id ?? null,
    goal_id: v.goal_id ?? null,
  });
}

export async function updateEvent(store: Store, id: string, input: EventInput, timeZone: string): Promise<CalendarEvent> {
  const v = parseOrThrow(eventInput, input);
  checkRule(v.recurrence_rule);
  return store.update<CalendarEvent>('calendar_events', id, {
    title: v.title,
    description: v.description ?? null,
    location: v.location ?? null,
    ...toInstants(v, timeZone),
    all_day: v.all_day,
    kind: v.kind,
    is_locked: v.kind === 'commitment' ? true : v.is_locked,
    busy: v.busy,
    recurrence_rule: v.recurrence_rule ?? null,
    category_id: v.category_id ?? null,
    goal_id: v.goal_id ?? null,
  });
}

/** Removes a whole series, or (with `occurrenceDate`) just one occurrence of a repeating event. */
export async function deleteEvent(store: Store, id: string, occurrenceDate?: string): Promise<void> {
  const ev = await store.get<CalendarEvent>('calendar_events', id);
  if (!ev) return;
  if (occurrenceDate && ev.recurrence_rule) {
    await store.update('calendar_events', id, { exdates: [...new Set([...ev.exdates, occurrenceDate])].sort() });
    return;
  }
  await store.remove('calendar_events', id);
}

export interface EventOccurrence {
  key: string;
  event: CalendarEvent;
  start: number;
  end: number;
  date: string;
  isRecurring: boolean;
}

/** Every event occurrence overlapping [from, to] (local dates), with repeating events expanded. */
export async function occurrencesInRange(store: Store, from: string, to: string, timeZone: string): Promise<EventOccurrence[]> {
  const rangeStart = new Date(localToUtc(from, 0, timeZone)).toISOString();
  const rangeEnd = new Date(localToUtc(addDays(to, 1), 0, timeZone)).toISOString();
  const events = await store.list<CalendarEvent>('calendar_events', {
    where: '(recurrence_rule IS NOT NULL) OR (starts_at < ? AND ends_at > ?)',
    params: [rangeEnd, rangeStart],
  });
  const overrides = new Set(events.filter((e) => e.recurrence_parent_id && e.original_start).map((e) => `${e.recurrence_parent_id}|${e.original_start}`));
  const out: EventOccurrence[] = [];
  for (const ev of events) {
    const start = Date.parse(ev.starts_at);
    const end = Date.parse(ev.ends_at);
    if (!ev.recurrence_rule) {
      out.push({ key: ev.id, event: ev, start, end, date: utcToLocalDate(start, ev.timezone || timeZone), isRecurring: false });
      continue;
    }
    let rule;
    try {
      rule = parseRRule(ev.recurrence_rule);
    } catch {
      continue;
    }
    const tz = ev.timezone || timeZone;
    const seriesStartDate = utcToLocalDate(start, tz);
    const startMinutes = utcToLocalMinutes(start, tz);
    const duration = end - start;
    // Look back a day so overnight events that started yesterday are included.
    for (const d of occurrencesBetween(rule, seriesStartDate, addDays(from, -1), to, ev.exdates)) {
      const s = localToUtc(d, startMinutes, tz);
      const iso = new Date(s).toISOString();
      if (overrides.has(`${ev.id}|${iso}`)) continue;
      if (s + duration <= Date.parse(rangeStart) || s >= Date.parse(rangeEnd)) continue;
      out.push({ key: `${ev.id}:${d}`, event: ev, start: s, end: s + duration, date: d, isRecurring: true });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.key.localeCompare(b.key));
}
