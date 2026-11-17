/**
 * Browser preview data store. Records live in the viewer's private claude.ai artifact database
 * (data/users/<id>), or in this browser's storage when that isn't available.
 */
import { addDays, localToUtc, parseTime, startOfWeek, utcToLocalDate } from '../../../packages/domain/src/index.ts';

export type Priority = 1 | 2 | 3 | 4;
export type Window = 'any' | 'morning' | 'afternoon' | 'evening' | 'study';

export interface Goal { id: string; kind: 'goal'; title: string; why: string; status: 'active' | 'paused' | 'completed' | 'archived'; rank: number; deadline: string | null; mode: 'milestones' | 'tasks' | 'target' | 'manual'; target: number | null; current: number | null; unit: string; manual: number | null; createdAt: string; example?: boolean }
export interface Milestone { id: string; kind: 'milestone'; goalId: string; title: string; deadline: string | null; done: boolean; doneAt: string | null; rank: number; example?: boolean }
export interface Check { id: string; kind: 'check'; goalId: string; title: string; done: boolean; rank: number; example?: boolean }
export interface Note { id: string; kind: 'note'; goalId: string | null; type: 'strategy' | 'info' | 'learning' | 'problem' | 'next_steps' | 'idea'; text: string; createdAt: string; example?: boolean }
export interface Link { id: string; kind: 'link'; goalId: string; title: string; url: string; createdAt: string; example?: boolean }
export interface TaskHistory { at: string; what: string }
export interface Task { id: string; kind: 'task'; title: string; priority: Priority; status: 'inbox' | 'planned' | 'in_progress' | 'completed' | 'cancelled'; due: string | null; doDate: string | null; estimate: number | null; splittable: boolean; window: Window; goalId: string | null; milestoneId: string | null; completedAt: string | null; createdAt: string; history: TaskHistory[]; example?: boolean }
export interface Habit { id: string; kind: 'habit'; name: string; freq: 'daily' | 'weekdays' | 'times_per_week' | 'times_per_month' | 'every_n_days'; days: number[] | null; times: number | null; interval: number | null; startDate: string; duration: number | null; window: Window; time: string | null; status: 'active' | 'paused' | 'archived'; goalId: string | null; rank: number; createdAt: string; example?: boolean }
export interface HabitLog { id: string; kind: 'hlog'; habitId: string; date: string; status: 'done' | 'partial' | 'skipped'; example?: boolean }
export interface CalEvent { id: string; kind: 'event'; title: string; date: string; start: number; end: number; repeat: 'none' | 'daily' | 'weekdays' | 'weekly'; exdates: string[]; locked: boolean; busy: boolean; type: 'event' | 'class' | 'work' | 'training' | 'social'; example?: boolean }
export interface Block { id: string; kind: 'block'; date: string; start: number; end: number; type: 'task' | 'habit' | 'break'; taskId: string | null; habitId: string | null; title: string; origin: 'auto' | 'manual'; locked: boolean; status: 'planned' | 'done' | 'missed' | 'skipped' | 'unplanned'; reason: string; example?: boolean }
export interface StudyWindow { days: number[]; from: string; to: string }
export interface Prefs { id: 'prefs'; kind: 'prefs'; dayStart: string; dayEnd: string; maxFocus: number; minFree: number; breakAfter: number; breakLen: number; buffer: number; defaultEstimate: number; study: StudyWindow | null; theme: 'system' | 'light' | 'dark'; name: string }

export type Rec = Goal | Milestone | Check | Note | Link | Task | Habit | HabitLog | CalEvent | Block | Prefs;

export const DEFAULT_PREFS: Prefs = {
  id: 'prefs', kind: 'prefs', dayStart: '07:00', dayEnd: '22:30', maxFocus: 360, minFree: 120, breakAfter: 90, breakLen: 15, buffer: 10,
  defaultEstimate: 30, study: null, theme: 'system', name: '',
};

export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export const todayStr = () => utcToLocalDate(Date.now(), TZ);
export const uid = () =>
  (globalThis.crypto && 'randomUUID' in globalThis.crypto ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9-]/g, '');
export const nowIso = () => new Date().toISOString();

// ───────────────────────────── persistence ─────────────────────────────

export type StorageMode = 'account' | 'browser' | 'memory';
interface Backend {
  mode: StorageMode;
  put(rec: Rec): Promise<void>;
  remove(id: string): Promise<void>;
}

type Listener = () => void;

interface ClaudeDb {
  collection(path: string): {
    doc(id: string): { set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void> };
    onSnapshot(next: (s: { docChanges(): { type: string; doc: { id: string; data(): Record<string, unknown> | undefined } }[] }) => void, err?: (e: { code: string; message: string }) => void): () => void;
  };
}

class Store {
  records = new Map<string, Rec>();
  ready = false;
  mode: StorageMode = 'memory';
  error: string | null = null;
  private backend: Backend | null = null;
  private listeners = new Set<Listener>();
  private pending = new Map<string, number>();
  private version = 0;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  getVersion() {
    return this.version;
  }
  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  all<K extends Rec['kind']>(kind: K): Extract<Rec, { kind: K }>[] {
    const out: Extract<Rec, { kind: K }>[] = [];
    for (const r of this.records.values()) if (r.kind === kind) out.push(r as Extract<Rec, { kind: K }>);
    return out;
  }
  get<T extends Rec>(id: string): T | undefined {
    return this.records.get(id) as T | undefined;
  }
  prefs(): Prefs {
    return { ...DEFAULT_PREFS, ...(this.records.get('prefs') as Prefs | undefined) };
  }

  /** Writes records (optimistically) and persists each changed one. */
  save(...recs: Rec[]) {
    for (const r of recs) {
      this.records.set(r.id, r);
      this.persist(r.id, () => this.backend!.put(r));
    }
    this.emit();
  }
  remove(...ids: string[]) {
    for (const id of ids) {
      if (!this.records.has(id)) continue;
      this.records.delete(id);
      this.persist(id, () => this.backend!.remove(id));
    }
    this.emit();
  }
  private persist(id: string, fn: () => Promise<void>) {
    if (!this.backend) return;
    this.pending.set(id, (this.pending.get(id) ?? 0) + 1);
    fn()
      .catch((e: { message?: string }) => {
        this.error = `Couldn’t save a change: ${e?.message ?? 'unknown error'}`;
        this.emit();
      })
      .finally(() => {
        const n = (this.pending.get(id) ?? 1) - 1;
        if (n <= 0) this.pending.delete(id);
        else this.pending.set(id, n);
      });
  }

  async init() {
    const claude = (globalThis as { claude?: { use(name: string): Promise<unknown> } }).claude;
    try {
      const db = (await claude?.use('db')) as ClaudeDb | null | undefined;
      const user = (await claude?.use('user')) as { id(): Promise<string | null> } | null | undefined;
      const id = db && user ? await user.id() : null;
      if (db && id) {
        const col = db.collection(`data/users/${id}`);
        this.backend = { mode: 'account', put: (r) => col.doc(r.id).set(r as unknown as Record<string, unknown>), remove: (rid) => col.doc(rid).delete() };
        this.mode = 'account';
        const timer = setTimeout(() => {
          if (!this.ready) {
            this.ready = true;
            this.error = 'Your saved data is taking a while to load. Changes you make are still saved.';
            this.emit();
          }
        }, 10_000);
        col.onSnapshot(
          (snap) => {
            for (const ch of snap.docChanges()) {
              if (this.pending.has(ch.doc.id)) continue;
              if (ch.type === 'removed') this.records.delete(ch.doc.id);
              else {
                const d = ch.doc.data();
                if (d && typeof d.kind === 'string') this.records.set(ch.doc.id, d as unknown as Rec);
              }
            }
            clearTimeout(timer);
            this.ready = true;
            this.emit();
          },
          (e) => {
            clearTimeout(timer);
            this.ready = true;
            this.error = `Saved data couldn’t load (${e.code}).`;
            this.emit();
          },
        );
        return;
      }
    } catch {
      /* fall through to browser storage */
    }
    this.useBrowserStorage();
  }

  private useBrowserStorage() {
    const KEY = 'ascend-preview-v1';
    let ok = false;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) for (const r of JSON.parse(raw) as Rec[]) this.records.set(r.id, r);
      ok = true;
    } catch {
      ok = false;
    }
    const flush = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify([...this.records.values()]));
      } catch {
        /* storage unavailable: keep working in memory */
      }
    };
    this.mode = ok ? 'browser' : 'memory';
    this.backend = { mode: this.mode, put: async () => flush(), remove: async () => flush() };
    this.ready = true;
    this.emit();
  }
}

export const store = new Store();

// ───────────────────────────── helpers used across screens ─────────────────────────────

export function nextRank(items: { rank: number }[]): number {
  return items.reduce((m, i) => Math.max(m, i.rank), 0) + 1;
}

export function logTask(t: Task, what: string): Task {
  return { ...t, history: [{ at: nowIso(), what }, ...t.history].slice(0, 30) };
}

export function eventInstants(e: CalEvent, date: string): { start: number; end: number } {
  const start = localToUtc(date, e.start, TZ);
  const endDate = e.end <= e.start ? addDays(date, 1) : date;
  return { start, end: localToUtc(endDate, e.end % (24 * 60), TZ) };
}

export function occursOn(e: CalEvent, date: string): boolean {
  if (date < e.date || e.exdates.includes(date)) return false;
  if (e.repeat === 'none') return date === e.date;
  if (e.repeat === 'daily') return true;
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (e.repeat === 'weekdays') return wd >= 1 && wd <= 5;
  return wd === new Date(`${e.date}T12:00:00Z`).getUTCDay();
}

export function dayBoundsMs(date: string, p: Prefs) {
  return { start: localToUtc(date, parseTime(p.dayStart), TZ), end: localToUtc(date, parseTime(p.dayEnd), TZ) };
}

export function weekStart(date: string) {
  return startOfWeek(date, 1);
}

/** Clearly-marked example data, created only when the viewer asks for it. */
export function exampleRecords(today: string): Rec[] {
  const d = (n: number) => addDays(today, n);
  const ex = { example: true as const };
  const g1 = uid(), g2 = uid(), g3 = uid();
  const m1 = uid(), m2 = uid(), m3 = uid(), m4 = uid();
  const h1 = uid(), h2 = uid(), h3 = uid();
  const t = (title: string, extra: Partial<Task>): Task => ({ id: uid(), kind: 'task', title, priority: 3, status: 'planned', due: null, doDate: null, estimate: 30, splittable: false, window: 'any', goalId: null, milestoneId: null, completedAt: null, createdAt: nowIso(), history: [{ at: nowIso(), what: 'Created' }], ...ex, ...extra });
  return [
    { id: g1, kind: 'goal', title: 'Improve Economics results', why: 'Get the grade I need for my first-choice university.', status: 'active', rank: 1, deadline: d(180), mode: 'milestones', target: null, current: null, unit: '', manual: null, createdAt: nowIso(), ...ex },
    { id: g2, kind: 'goal', title: 'Become a two-footed player', why: 'Be selected for the first team next season.', status: 'active', rank: 2, deadline: d(120), mode: 'target', target: 10, current: 4, unit: 'weak-foot rating', manual: null, createdAt: nowIso(), ...ex },
    { id: g3, kind: 'goal', title: 'Build a personal project', why: 'Learn by shipping something real.', status: 'active', rank: 3, deadline: null, mode: 'tasks', target: null, current: null, unit: '', manual: null, createdAt: nowIso(), ...ex },
    { id: m1, kind: 'milestone', goalId: g1, title: 'Master unit 1: markets and elasticity', deadline: d(14), done: true, doneAt: nowIso(), rank: 1, ...ex },
    { id: m2, kind: 'milestone', goalId: g1, title: 'Master unit 2: market failure', deadline: d(35), done: false, doneAt: null, rank: 2, ...ex },
    { id: m3, kind: 'milestone', goalId: g1, title: 'Score 70%+ on two full past papers', deadline: d(90), done: false, doneAt: null, rank: 3, ...ex },
    { id: m4, kind: 'milestone', goalId: g3, title: 'First working version', deadline: d(30), done: false, doneAt: null, rank: 1, ...ex },
    { id: uid(), kind: 'check', goalId: g1, title: 'Buy the revision guide', done: true, rank: 1, ...ex },
    { id: uid(), kind: 'check', goalId: g1, title: 'Ask for feedback on my last essay', done: false, rank: 2, ...ex },
    { id: uid(), kind: 'note', goalId: g1, type: 'strategy', text: 'One past-paper question every Sunday. Mark it myself against the scheme, then redo the weakest part.', createdAt: nowIso(), ...ex },
    { id: uid(), kind: 'note', goalId: g1, type: 'problem', text: 'I lose marks on evaluation. Practise “it depends on…” paragraphs.', createdAt: nowIso(), ...ex },
    { id: uid(), kind: 'link', goalId: g1, title: 'Price elasticity of demand explained', url: 'https://www.youtube.com/results?search_query=price+elasticity+of+demand', createdAt: nowIso(), ...ex },
    { id: h1, kind: 'habit', name: 'Read', freq: 'daily', days: null, times: null, interval: null, startDate: d(-40), duration: 20, window: 'evening', time: '21:30', status: 'active', goalId: null, rank: 1, createdAt: nowIso(), ...ex },
    { id: h2, kind: 'habit', name: 'Gym', freq: 'weekdays', days: [1, 3, 5], times: null, interval: null, startDate: d(-40), duration: 60, window: 'evening', time: null, status: 'active', goalId: null, rank: 2, createdAt: nowIso(), ...ex },
    { id: h3, kind: 'habit', name: 'Weak-foot drills', freq: 'times_per_week', days: null, times: 3, interval: null, startDate: d(-40), duration: 30, window: 'afternoon', time: null, status: 'active', goalId: g2, rank: 3, createdAt: nowIso(), ...ex },
    ...Array.from({ length: 30 }, (_, i) => d(-1 - i)).filter((_, i) => i % 5 !== 2).map((date) => ({ id: `${h1}_${date}`, kind: 'hlog' as const, habitId: h1, date, status: 'done' as const, ...ex })),
    ...[d(-2), d(-4), d(-7), d(-9), d(-11)].map((date) => ({ id: `${h3}_${date}`, kind: 'hlog' as const, habitId: h3, date, status: 'done' as const, ...ex })),
    { id: uid(), kind: 'event', title: 'School', date: d(-30), start: 8 * 60 + 30, end: 15 * 60 + 30, repeat: 'weekdays', exdates: [], locked: true, busy: true, type: 'class', ...ex },
    { id: uid(), kind: 'event', title: 'Football training', date: d(-29), start: 17 * 60 + 30, end: 19 * 60, repeat: 'weekly', exdates: [], locked: true, busy: true, type: 'training', ...ex },
    { id: uid(), kind: 'event', title: 'Dinner with friends', date: d(2), start: 19 * 60, end: 21 * 60, repeat: 'none', exdates: [], locked: false, busy: true, type: 'social', ...ex },
    t('Economics essay: globalisation', { priority: 2, due: d(3), estimate: 120, splittable: true, goalId: g1, milestoneId: m2 }),
    t('Past paper 2023, section A', { estimate: 60, goalId: g1, milestoneId: m3, due: d(9) }),
    t('Email the coach about Saturday', { estimate: 15, priority: 2, due: today }),
    t('Sketch the project’s main screens', { estimate: 45, goalId: g3, milestoneId: m4 }),
    t('Look into a summer coding course', { status: 'inbox', estimate: null }),
  ];
}
