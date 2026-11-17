/**
 * A deliberately small subset of RFC 5545 recurrence rules, evaluated on local calendar dates.
 *
 * Supported: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, BYDAY (weekly), COUNT, UNTIL.
 * Rules are stored as standard RRULE strings so they stay interoperable with calendar apps.
 */
import {
  addDays,
  addMonths,
  isValidLocalDate,
  parseLocalDate,
  startOfWeek,
  weekday,
  type LocalDate,
} from './time.ts';

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RecurrenceRule {
  freq: Frequency;
  interval: number;
  /** Weekdays (0 = Sunday … 6 = Saturday); only meaningful for WEEKLY. */
  byDay?: number[];
  count?: number;
  until?: LocalDate;
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export function parseRRule(input: string): RecurrenceRule {
  const body = input.trim().replace(/^RRULE:/i, '');
  const fields = new Map<string, string>();
  for (const part of body.split(';')) {
    if (!part) continue;
    const [k, v] = part.split('=');
    if (!k || v === undefined) throw new Error(`Invalid RRULE part: ${part}`);
    fields.set(k.toUpperCase(), v.toUpperCase());
  }
  const freq = fields.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    throw new Error(`Unsupported FREQ: ${freq ?? '(missing)'}`);
  }
  const rule: RecurrenceRule = { freq, interval: 1 };
  const interval = fields.get('INTERVAL');
  if (interval !== undefined) {
    const n = Number(interval);
    if (!Number.isInteger(n) || n < 1 || n > 365) throw new Error(`Invalid INTERVAL: ${interval}`);
    rule.interval = n;
  }
  const byDay = fields.get('BYDAY');
  if (byDay) {
    rule.byDay = byDay.split(',').map((code) => {
      const idx = DAY_CODES.indexOf(code as (typeof DAY_CODES)[number]);
      if (idx < 0) throw new Error(`Unsupported BYDAY value: ${code}`);
      return idx;
    });
    rule.byDay.sort((a, b) => a - b);
  }
  const count = fields.get('COUNT');
  if (count !== undefined) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid COUNT: ${count}`);
    rule.count = n;
  }
  const until = fields.get('UNTIL');
  if (until !== undefined) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(until);
    const date = m ? `${m[1]}-${m[2]}-${m[3]}` : until;
    if (!isValidLocalDate(date)) throw new Error(`Invalid UNTIL: ${until}`);
    rule.until = date;
  }
  return rule;
}

export function formatRRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.map((d) => DAY_CODES[d]).join(',')}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  if (rule.until) parts.push(`UNTIL=${rule.until.replaceAll('-', '')}`);
  return parts.join(';');
}

/**
 * Dates on which the rule produces an occurrence, from `start` (the series' first date), limited to
 * the window [from, to]. Exclusion dates are removed.
 */
export function occurrencesBetween(
  rule: RecurrenceRule,
  start: LocalDate,
  from: LocalDate,
  to: LocalDate,
  exdates: readonly LocalDate[] = [],
): LocalDate[] {
  const out: LocalDate[] = [];
  const excluded = new Set(exdates);
  let produced = 0;
  const limit = rule.until && rule.until < to ? rule.until : to;
  const push = (d: LocalDate): boolean => {
    if (d < start) return true;
    if (d > limit) return false;
    produced += 1;
    if (rule.count !== undefined && produced > rule.count) return false;
    if (d >= from && !excluded.has(d)) out.push(d);
    return true;
  };

  // Hard cap protects against pathological windows.
  const MAX_ITER = 5000;
  if (rule.freq === 'DAILY') {
    for (let i = 0, d = start; i < MAX_ITER; i++, d = addDays(d, rule.interval)) if (!push(d)) break;
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byDay?.length ? rule.byDay : [weekday(start)];
    const firstWeek = startOfWeek(start, 0);
    outer: for (let w = 0; w < MAX_ITER; w++) {
      const weekStart = addDays(firstWeek, w * 7 * rule.interval);
      if (weekStart > limit) break;
      for (const wd of days) {
        if (!push(addDays(weekStart, wd))) break outer;
      }
    }
  } else if (rule.freq === 'MONTHLY') {
    const { day } = parseLocalDate(start);
    for (let i = 0; i < MAX_ITER; i++) {
      const d = addMonths(start, i * rule.interval);
      // Skip months that do not contain the start's day-of-month (e.g. the 31st), as RFC 5545 does.
      if (parseLocalDate(d).day !== day) continue;
      if (!push(d)) break;
    }
  } else {
    for (let i = 0; i < MAX_ITER; i++) {
      const d = addMonths(start, i * 12 * rule.interval);
      if (parseLocalDate(d).day !== parseLocalDate(start).day) continue;
      if (!push(d)) break;
    }
  }
  return out;
}

export function nextOccurrence(
  rule: RecurrenceRule,
  start: LocalDate,
  after: LocalDate,
  exdates: readonly LocalDate[] = [],
): LocalDate | null {
  const from = addDays(after, 1);
  const horizon = addDays(from, Math.max(400, rule.interval * 400));
  return occurrencesBetween(rule, start, from, horizon, exdates)[0] ?? null;
}

/** A short human description, e.g. "Every 2 weeks on Mon, Thu". */
export function describeRule(rule: RecurrenceRule): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[rule.freq];
  let text = rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;
  if (rule.freq === 'DAILY' && rule.interval === 1) text = 'Daily';
  if (rule.freq === 'WEEKLY' && rule.byDay?.length) {
    const sorted = [...rule.byDay].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    if (rule.interval === 1 && sorted.join() === '1,2,3,4,5') text = 'Every weekday';
    else text += ` on ${sorted.map((d) => names[d]).join(', ')}`;
  }
  if (rule.count) text += `, ${rule.count} times`;
  if (rule.until) text += `, until ${rule.until}`;
  return text;
}
