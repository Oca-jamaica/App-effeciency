/**
 * Deterministic quick-capture parser. Turns "Revise unit 3 tomorrow 4pm 45m !p1 #economics" into a
 * structured draft. It never guesses wildly: anything it does not recognise stays in the title.
 */
import { addDays, formatLocalDate, isValidLocalDate, parseLocalDate, startOfWeek, weekday, type LocalDate } from './time.ts';

export type CaptureType = 'task' | 'goal' | 'habit' | 'event' | 'idea' | 'note' | 'reminder';

export interface CaptureDraft {
  type: CaptureType | null;
  title: string;
  date: LocalDate | null;
  timeMinutes: number | null;
  durationMinutes: number | null;
  priority: number | null;
  tags: string[];
}

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const TYPE_PREFIXES: Record<string, CaptureType> = {
  task: 'task', todo: 'task', goal: 'goal', habit: 'habit', event: 'event', idea: 'idea', note: 'note',
  reminder: 'reminder', remind: 'reminder',
};

function nextDateFor(day: number, today: LocalDate, nextWeek: boolean): LocalDate {
  if (nextWeek) {
    // "next friday" / "next week": that weekday in the following Monday-based week.
    const nextMonday = addDays(startOfWeek(today, 1), 7);
    return addDays(nextMonday, (day + 6) % 7);
  }
  // "friday" means the coming Friday; said on a Friday it means a week today.
  const delta = (day - weekday(today) + 7) % 7 || 7;
  return addDays(today, delta);
}

export function parseCapture(input: string, today: LocalDate): CaptureDraft {
  let text = ` ${input.trim().replace(/\s+/g, ' ')} `;
  const draft: CaptureDraft = {
    type: null,
    title: '',
    date: null,
    timeMinutes: null,
    durationMinutes: null,
    priority: null,
    tags: [],
  };
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean | void): void => {
    const m = re.exec(text);
    if (m && fn(m) !== false) text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
  };

  // Type prefix: "idea: …", "note: …"
  take(/^ (task|todo|goal|habit|event|idea|note|reminder|remind)\s*:\s*/i, (m) => {
    draft.type = TYPE_PREFIXES[(m[1] as string).toLowerCase()] ?? null;
  });
  // "remind me to …" / "remind me …"
  take(/^ remind me( to)? /i, () => {
    draft.type = 'reminder';
  });

  // Priority: !p1 / !1 / !high
  take(/ !(p?[1-4]|high|medium|med|low|urgent)(?=\s)/i, (m) => {
    const v = (m[1] as string).toLowerCase();
    draft.priority = v === 'urgent' ? 1 : v === 'high' ? 2 : v === 'medium' || v === 'med' ? 3 : v === 'low' ? 4 : Number(v.replace('p', ''));
  });

  // Tags
  for (;;) {
    const before = text;
    take(/ #([\p{L}\p{N}_-]+)(?=\s)/u, (m) => {
      draft.tags.push((m[1] as string).toLowerCase());
    });
    if (text === before) break;
  }

  // Duration: 45m, 45 min, 1h, 1.5h, 1h30, 2 hours, for 30 minutes
  take(/ (?:for )?(\d+(?:\.\d+)?)\s?h(?:ours?|rs?)?\s?(\d{1,2})?\s?(?:m(?:in(?:ute)?s?)?)?(?=\s)/i, (m) => {
    const h = Number(m[1]);
    const extra = m[2] ? Number(m[2]) : 0;
    const total = Math.round(h * 60 + extra);
    if (total <= 0 || total > 24 * 60) return false;
    draft.durationMinutes = total;
  });
  if (draft.durationMinutes === null) {
    take(/ (?:for )?(\d{1,3})\s?(?:m|mins?|minutes?)(?=\s)/i, (m) => {
      const v = Number(m[1]);
      if (v <= 0 || v > 24 * 60) return false;
      draft.durationMinutes = v;
    });
  }

  // Time: 4pm, 4:30pm, 16:30, at 9
  take(/ (?:at )?(\d{1,2})(?::(\d{2}))?\s?(am|pm)(?=\s)/i, (m) => {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h < 1 || h > 12 || min > 59) return false;
    const pm = (m[3] as string).toLowerCase() === 'pm';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    draft.timeMinutes = h * 60 + min;
  });
  if (draft.timeMinutes === null) {
    take(/ (?:at )?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (m) => {
      draft.timeMinutes = Number(m[1]) * 60 + Number(m[2]);
    });
  }
  if (draft.timeMinutes === null) {
    take(/ at (\d{1,2})(?=\s)/i, (m) => {
      const h = Number(m[1]);
      if (h > 23) return false;
      // "at 9" means morning for 7–11, afternoon for 1–6 (people rarely mean 3am).
      draft.timeMinutes = (h >= 1 && h <= 6 ? h + 12 : h) * 60;
    });
  }

  // Dates
  take(/ (today|tonight)(?=\s)/i, (m) => {
    draft.date = today;
    if ((m[1] as string).toLowerCase() === 'tonight' && draft.timeMinutes === null) draft.timeMinutes = 20 * 60;
  });
  if (!draft.date) take(/ (tomorrow|tmrw|tmr)(?=\s)/i, () => void (draft.date = addDays(today, 1)));
  if (!draft.date) take(/ in (\d{1,3}) days?(?=\s)/i, (m) => void (draft.date = addDays(today, Number(m[1]))));
  if (!draft.date) take(/ next week(?=\s)/i, () => void (draft.date = nextDateFor(1, today, true)));
  if (!draft.date) {
    take(/ (?:on )?(next )?(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)(?=\s)/i, (m) => {
      const day = WEEKDAYS[(m[2] as string).toLowerCase()];
      if (day === undefined) return false;
      draft.date = nextDateFor(day, today, Boolean(m[1]));
    });
  }
  if (!draft.date) {
    // 21 Nov, 21 November, Nov 21
    take(/ (?:on )?(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9})(?=\s)/i, (m) => {
      const month = MONTHS[(m[2] as string).toLowerCase()];
      if (!month) return false;
      const d = resolveDayMonth(Number(m[1]), month, today);
      if (!d) return false;
      draft.date = d;
    });
  }
  if (!draft.date) {
    take(/ (?:on )?([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?(?=\s)/i, (m) => {
      const month = MONTHS[(m[1] as string).toLowerCase()];
      if (!month) return false;
      const d = resolveDayMonth(Number(m[2]), month, today);
      if (!d) return false;
      draft.date = d;
    });
  }
  if (!draft.date) {
    // 21/11 (day first, as used in the UK and most of the world)
    take(/ (?:on )?(\d{1,2})\/(\d{1,2})(?=\s)/, (m) => {
      const d = resolveDayMonth(Number(m[1]), Number(m[2]), today);
      if (!d) return false;
      draft.date = d;
    });
  }
  if (!draft.date && draft.timeMinutes !== null) draft.date = today;

  draft.title = text.replace(/\s+/g, ' ').trim().replace(/^[-–:,]\s*/, '');
  if (draft.title) draft.title = draft.title.charAt(0).toUpperCase() + draft.title.slice(1);
  return draft;
}

function resolveDayMonth(day: number, month: number, today: LocalDate): LocalDate | null {
  const { year } = parseLocalDate(today);
  for (const y of [year, year + 1]) {
    const d = formatLocalDate(y, month, day);
    if (isValidLocalDate(d) && d >= today) return d;
  }
  return null;
}
