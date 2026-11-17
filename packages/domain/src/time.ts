/**
 * Calendar-date and timezone utilities.
 *
 * Conventions used across ASCEND:
 * - `LocalDate` is an ISO calendar date string `YYYY-MM-DD` in the user's timezone.
 * - Instants are epoch milliseconds (UTC).
 * - "Minutes" (`dayMinutes`) are minutes since local midnight (0–1440).
 *
 * Only `Intl.DateTimeFormat` is used, so this works identically in Node, Deno and Hermes.
 */

export type LocalDate = string;

export const MINUTE = 60_000;
export const DAY_MINUTES = 24 * 60;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  const hour = get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: hour === 24 ? 0 : hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `timeZone` from UTC at instant `ms`, in minutes (local − UTC). */
export function tzOffsetMinutes(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(ms / 1000) * 1000;
  return Math.round((asUtc - truncated) / MINUTE);
}

export function parseLocalDate(date: LocalDate): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function formatLocalDate(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isValidLocalDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const { year, month, day } = parseLocalDate(date);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * The UTC instant at which local wall-clock time `minutes` after midnight on `date` occurs in
 * `timeZone`. Times inside a DST gap resolve forward (e.g. 02:30 on a spring-forward day becomes
 * 03:30), which is the conventional and least surprising behaviour for scheduling.
 */
export function localToUtc(date: LocalDate, minutes: number, timeZone: string): number {
  const { year, month, day } = parseLocalDate(date);
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0) + minutes * MINUTE;
  const offset1 = tzOffsetMinutes(wallAsUtc, timeZone);
  let candidate = wallAsUtc - offset1 * MINUTE;
  const offset2 = tzOffsetMinutes(candidate, timeZone);
  if (offset2 !== offset1) {
    candidate = wallAsUtc - offset2 * MINUTE;
    const offset3 = tzOffsetMinutes(candidate, timeZone);
    if (offset3 !== offset2) {
      // In a DST gap: the wall time does not exist. Use the later offset, which moves forward.
      candidate = wallAsUtc - Math.min(offset1, offset2) * MINUTE;
    }
  }
  return candidate;
}

export function utcToLocalDate(ms: number, timeZone: string): LocalDate {
  const p = zonedParts(ms, timeZone);
  return formatLocalDate(p.year, p.month, p.day);
}

export function utcToLocalMinutes(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  return p.hour * 60 + p.minute;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return formatLocalDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addMonths(date: LocalDate, months: number): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return formatLocalDate(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(day, lastDay));
}

/** Whole days from `a` to `b` (b − a). */
export function diffDays(a: LocalDate, b: LocalDate): number {
  const pa = parseLocalDate(a);
  const pb = parseLocalDate(b);
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / (24 * 3600_000),
  );
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function startOfWeek(date: LocalDate, weekStartsOn = 1): LocalDate {
  const delta = (weekday(date) - weekStartsOn + 7) % 7;
  return addDays(date, -delta);
}

export function startOfMonth(date: LocalDate): LocalDate {
  const { year, month } = parseLocalDate(date);
  return formatLocalDate(year, month, 1);
}

export function daysInMonth(date: LocalDate): number {
  const { year, month } = parseLocalDate(date);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(...dates: (LocalDate | null | undefined)[]): LocalDate | null {
  let best: LocalDate | null = null;
  for (const d of dates) if (d && (best === null || d < best)) best = d;
  return best;
}

/** `HH:MM[:SS]` → minutes after midnight. */
export function parseTime(time: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!m) throw new Error(`Invalid time: ${time}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new Error(`Invalid time: ${time}`);
  return h * 60 + min;
}

export function formatTime(minutes: number): string {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function enumerateDates(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function roundUpToStep(ms: number, stepMinutes: number): number {
  const step = stepMinutes * MINUTE;
  return Math.ceil(ms / step) * step;
}
