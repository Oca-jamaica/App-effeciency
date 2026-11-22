/* ASCEND browser preview — interface. React is loaded as a global (UMD) by the page. */
import { addDays, describeFrequency, formatHours, monthStatus, parseCapture, parseTime, startOfMonth, addMonths, utcToLocalMinutes, type PlanResult } from '../../../packages/domain/src/index.ts';
import {
  TZ, exampleRecords, logTask, nextRank, nowIso, store, todayStr, uid, weekStart,
  type Block, type CalEvent, type Goal, type Habit, type Note, type Prefs, type Priority, type Task, type Window,
} from './store.ts';
import {
  activeGoals, atLocal, blocksOn, clock, dateLabel, hourLabel, eventsOn, goalProgressFor, habitDay, habitEntries, habitRule, laterTodaySlot,
  minutesBetween, moveMissedTo, previewDay, replanToday, setHabitLog,
} from './logic.ts';

import {
  Badge, Bar, Btn, Check, Chips, ConfirmButton, DAYS, DueBadge, Empty, Field, IconBtn, NavCtx, type Node, type Route, Row, Section, Seg, Sheet, Stepper, ToastCtx, type ToastFn, hhmm, mins, useData, useNav, useNow, useToast,
} from './ui.tsx';
import {
  COLLS, CollectionScreen, FocusPane, ProjectDetail, ProjectForm, ProjectList, SkillDetail, SocialPane, Stage4Insights, TrainingPane, WorkoutDetail, getTimer, stage4Examples, startFocus,
} from './stage4.tsx';

declare const React: typeof import('react');
declare const ReactDOM: { createRoot(el: Element): { render(node: import('react').ReactNode): void } };
const { useState, useEffect, useMemo, useRef } = React;

// ───────────────────────────── Home ─────────────────────────────

function Home() {
  useData();
  const now = useNow();
  const today = todayStr();
  const toast = useToast();
  const nav = useNav();
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [selected, setSelected] = useState<Block | null>(null);
  const inputsKey = useMemo(() => {
    const parts: string[] = [];
    for (const r of store.records.values()) if (r.kind !== 'block') parts.push(`${r.id}:${JSON.stringify(r).length}:${'status' in r ? r.status : ''}:${'rank' in r ? r.rank : ''}`);
    return parts.sort().join('|') + `|${Math.floor(now / 300_000)}`;
  }, [store.getVersion(), now]);
  useEffect(() => {
    if (!store.ready) return;
    setPlan(replanToday(today, Date.now()));
  }, [inputsKey, today, store.ready]);

  const p = store.prefs();
  const blocks = blocksOn(today).filter((b) => b.status !== 'unplanned' && b.status !== 'skipped');
  const events = eventsOn(today);
  const work = blocks.filter((b) => b.type !== 'break');
  const current = work.find((b) => b.start <= now && b.end > now && b.status !== 'done');
  const next = work.find((b) => b.start > now && b.status === 'planned');
  const focus = current ?? next;
  const missed = blocks.filter((b) => b.status === 'missed');
  const habits = habitDay(today).filter((h) => h.due || h.log);
  const tasks = store.all('task');
  const deadlines = tasks.filter((t) => t.due && t.status !== 'completed' && t.status !== 'cancelled' && t.due <= addDays(today, 7)).sort((a, b) => (a.due! < b.due! ? -1 : 1));
  const doneToday = tasks.filter((t) => t.completedAt && t.completedAt.slice(0, 10) >= addDays(today, -1)).length;
  const focusPlanned = blocks.filter((b) => b.type === 'task').reduce((s, b) => s + minutesBetween(b.start, b.end), 0);
  const hour = new Date(now).getHours();
  const greet = (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening') + (p.name ? `, ${p.name.split(' ')[0]}` : '');
  const hasExamples = [...store.records.values()].some((r) => 'example' in r && r.example);

  const complete = (b: Block) => {
    if (b.status === 'done') {
      store.save({ ...b, status: 'planned' });
      if (b.habitId) setHabitLog(b.habitId, today, null);
      return;
    }
    if (b.taskId) {
      const t = store.get<Task>(b.taskId);
      if (t && t.status !== 'completed') store.save(logTask({ ...t, status: 'completed', completedAt: nowIso() }, 'Completed'));
    }
    if (b.habitId) setHabitLog(b.habitId, today, 'done');
    store.save({ ...b, status: 'done' });
    toast(`Done: ${b.title}`);
  };

  // Timeline: events + blocks + visible free gaps.
  const bounds = { start: Math.max(atLocal(today, parseTime(p.dayStart)), Math.floor((now - 3_600_000) / 300_000) * 300_000), end: atLocal(today, parseTime(p.dayEnd)) };
  type Item = { key: string; start: number; end: number; ev?: CalEvent; block?: Block };
  const items: Item[] = [
    ...events.map((o) => ({ key: `e${o.event.id}`, start: o.start, end: o.end, ev: o.event })),
    ...blocks.map((b) => ({ key: b.id, start: b.start, end: b.end, block: b })),
  ].filter((i) => i.end > bounds.start).sort((a, b) => a.start - b.start);
  const timeline: (Item | { key: string; start: number; end: number; free: true })[] = [];
  let cursor = bounds.start;
  for (const it of items) {
    if (it.start - cursor >= 30 * 60_000) timeline.push({ key: `f${cursor}`, start: cursor, end: it.start, free: true });
    timeline.push(it);
    cursor = Math.max(cursor, it.end);
  }
  if (bounds.end - cursor >= 30 * 60_000) timeline.push({ key: `f${cursor}`, start: cursor, end: bounds.end, free: true });

  if (!store.ready) return <div className="screen"><p className="muted">Loading your data…</p></div>;
  const empty = store.all('task').length + store.all('habit').length + store.all('goal').length + store.all('event').length === 0;

  return (
    <div className="screen">
      <header className="head">
        <div>
          <h1>{greet}</h1>
          <p className="muted">{new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <button type="button" className="plus" aria-label="Quick capture" onClick={nav.capture}>+</button>
      </header>

      {empty ? (
        <div className="card welcome">
          <h2>Welcome to ASCEND</h2>
          <p>Add your goals, habits, commitments and tasks. ASCEND plans a realistic day around them — with breaks and free time protected — and adjusts when things change.</p>
          <div className="btn-row">
            <Btn onClick={nav.capture}>Capture your first task</Btn>
            <Btn kind="secondary" onClick={() => { const ex = exampleRecords(today); store.save(...ex, ...stage4Examples(today, ex.filter((r) => r.kind === 'task').map((r) => r.id))); toast('Example week loaded. Clear it any time from Profile.'); }}>Try an example week</Btn>
          </div>
        </div>
      ) : null}
      {hasExamples ? (
        <div className="notice">You’re looking at example data. <button type="button" className="link-btn" onClick={() => { const ids = [...store.records.values()].filter((r) => 'example' in r && r.example).map((r) => r.id); store.remove(...ids, ...store.all('block').map((b) => b.id)); toast('Examples cleared'); }}>Clear examples</button></div>
      ) : null}

      {!empty ? (
        <>
          <div className="strip">
            <Stat value={`${work.filter((b) => b.status === 'done').length}/${work.length}`} label="Planned done" />
            <Stat value={`${habits.filter((h) => h.log?.status === 'done').length}/${habits.length}`} label="Habits" />
            <Stat value={formatHours(focusPlanned)} label="Focus planned" />
            <Stat value={String(doneToday)} label="Tasks done" />
          </div>

          {getTimer() ? <div className="notice">A focus session is running. <button type="button" className="link-btn" onClick={() => nav.go('planner', 'focus')}>Open timer</button></div> : null}
          <div className="card">
            <div className="eyebrow">{current ? 'Now' : 'Next'}</div>
            {focus ? (
              <>
                <div className="focus-title">{focus.title}</div>
                <p className="muted small">{clock(focus.start)}–{clock(focus.end)} · {focus.reason}</p>
                <div className="btn-row wrap">
                  <Btn small onClick={() => complete(focus)}>Mark done</Btn>
                  {current && focus.type === 'task' && !getTimer() ? <Btn small kind="secondary" onClick={() => { startFocus('focus', minutesBetween(Date.now(), focus.end), focus.taskId, focus); nav.go('planner', 'focus'); }}>Start focus</Btn> : null}
                  <Btn small kind="secondary" onClick={() => setSelected(focus)}>Options</Btn>
                </div>
              </>
            ) : (
              <p className="muted">{work.length ? 'Nothing else planned today. The rest of the day is yours.' : 'Nothing planned yet. Add tasks with estimates and ASCEND will fit them around your commitments.'}</p>
            )}
          </div>

          {plan?.warnings.map((w) => <div key={w.code} className="card warn-card">{w.message}</div>)}
          {missed.map((b) => (
            <div key={b.id} className="card missed" role="button" tabIndex={0} onClick={() => setSelected(b)}>
              Not done: <strong>{b.title}</strong> · {minutesBetween(b.start, b.end)} min
              <div className="accent small">Tap to reschedule, shorten, or take it off today</div>
            </div>
          ))}

          <Section title="Today" action="Replan" onAction={() => { setPlan(replanToday(today, Date.now())); toast('Replanned'); }}>
            <div className="timeline">
              {timeline.map((it) =>
                'free' in it ? (
                  <div key={it.key} className="tl-row"><span className="tl-time">{clock(it.start)}</span><div className="tl-free">Free · {formatHours(minutesBetween(it.start, it.end))}</div></div>
                ) : it.ev ? (
                  <div key={it.key} className="tl-row"><span className="tl-time">{clock(it.start)}</span><div className="tl-card tl-event"><div className="tl-title">{it.ev.title}{it.ev.locked ? <span className="lock" title="Locked">●</span> : null}</div><div className="tl-sub">{clock(it.start)}–{clock(it.end)} · fixed</div></div></div>
                ) : it.block ? (
                  <div key={it.key} className="tl-row">
                    <span className={`tl-time${now >= it.start && now < it.end ? ' accent' : ''}`}>{clock(it.start)}</span>
                    <div className={`tl-card tl-${it.block.type}${it.block.status === 'done' ? ' is-done' : ''}${now >= it.start && now < it.end ? ' is-now' : ''}`} role="button" tabIndex={0} onClick={() => setSelected(it.block!)}>
                      {it.block.type !== 'break' ? <Check checked={it.block.status === 'done'} onChange={() => complete(it.block!)} label={`Mark ${it.block.title} done`} /> : null}
                      <div className="row-main">
                        <div className="tl-title">{it.block.title}{it.block.locked ? <span className="lock" title="Locked">●</span> : null}</div>
                        <div className={`tl-sub${it.block.status === 'missed' ? ' warn' : ''}`}>{it.block.status === 'missed' ? 'Not done · tap for options' : `${clock(it.start)}–${clock(it.end)}${it.block.origin === 'manual' ? ' · set by you' : ''}`}</div>
                      </div>
                    </div>
                  </div>
                ) : null,
              )}
              {!timeline.length ? <p className="muted">The planning day is over.</p> : null}
            </div>
            {plan?.unscheduled.length ? (
              <div className="group">
                <div className="group-label">Not scheduled today</div>
                {plan.unscheduled.map((u) => <Row key={u.id} title={u.title} sub={u.message} onClick={() => nav.open({ type: u.kind, id: u.id })} />)}
              </div>
            ) : null}
          </Section>

          {habits.length ? (
            <Section title="Habits">
              <div className="group">
                {habits.map(({ habit, log }) => (
                  <Row key={habit.id} lead={<Check checked={log?.status === 'done'} label={`${habit.name} done today`} onChange={() => setHabitLog(habit.id, today, log?.status === 'done' ? null : 'done')} />} title={habit.name} sub={habit.duration ? `${habit.duration} min${habit.time ? ` · ${habit.time}` : ''}` : null} muted={log?.status === 'done'} onClick={() => nav.open({ type: 'habit', id: habit.id })} />
                ))}
              </div>
            </Section>
          ) : null}

          {deadlines.length ? (
            <Section title="Deadlines">
              <div className="group">
                {deadlines.map((t) => <Row key={t.id} title={t.title} trail={<DueBadge date={t.due!} today={today} />} onClick={() => nav.open({ type: 'task', id: t.id })} />)}
              </div>
            </Section>
          ) : null}

          <UpcomingEvents today={today} />
        </>
      ) : null}
      {selected ? <BlockSheet block={store.get<Block>(selected.id) ?? selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function UpcomingEvents({ today }: { today: string }) {
  const rows: { key: string; title: string; when: string }[] = [];
  for (let i = 1; i <= 3; i++) {
    const d = addDays(today, i);
    for (const o of eventsOn(d)) rows.push({ key: `${o.event.id}${d}`, title: o.event.title, when: `${i === 1 ? 'Tomorrow' : dateLabel(d, { weekday: 'long' })} · ${clock(o.start)}–${clock(o.end)}` });
  }
  if (!rows.length) return null;
  return (
    <Section title="Coming up">
      <div className="group">{rows.slice(0, 5).map((r) => <Row key={r.key} title={r.title} sub={r.when} />)}</div>
    </Section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="stat"><div className="num">{value}</div><div className="muted small">{label}</div></div>;
}

function BlockSheet({ block, onClose }: { block: Block; onClose: () => void }) {
  const toast = useToast();
  const nav = useNav();
  const today = todayStr();
  const [mode, setMode] = useState<'menu' | 'time' | 'length'>('menu');
  const [time, setTime] = useState(utcToLocalMinutes(block.start, TZ));
  const [len, setLen] = useState(minutesBetween(block.start, block.end));
  const done = (msg: string) => { toast(msg); onClose(); };
  const length = minutesBetween(block.start, block.end);
  const later = block.status === 'missed' ? laterTodaySlot(block.date, Date.now(), length) : null;
  return (
    <Sheet title={block.title} onClose={onClose}>
      <p className="muted small">{clock(block.start)}–{clock(block.end)} · {block.reason}</p>
      {mode === 'time' ? (
        <>
          <Field label="New start time"><input className="input" type="time" value={hhmm(time)} onChange={(e) => setTime(parseTime(e.target.value || '00:00'))} /></Field>
          <Btn full onClick={() => { const s = atLocal(block.date, time); store.save({ ...block, start: s, end: s + length * 60_000, origin: 'manual', reason: 'Moved by you' }); done('Moved. The rest of your day adjusts around it.'); }}>Move here</Btn>
        </>
      ) : mode === 'length' ? (
        <>
          <Stepper value={len} onChange={setLen} min={5} max={480} fmt={mins} />
          {block.taskId ? <Btn full onClick={() => { store.save({ ...block, end: block.start + len * 60_000, origin: 'manual' }); const t = store.get<Task>(block.taskId!); if (t) store.save(logTask({ ...t, estimate: len }, `Estimate changed to ${len} min`)); done('Length and estimate updated'); }}>Change and update the task’s estimate</Btn> : null}
          <Btn full kind="secondary" onClick={() => { store.save({ ...block, end: block.start + len * 60_000, origin: 'manual' }); done('Length updated'); }}>Change this block only</Btn>
        </>
      ) : (
        <>
          {block.status === 'missed' ? (
            <div className="group">
              <div className="group-label">This didn’t happen. What would help?</div>
              {later ? <Row title={`Later today, ${clock(later.start)}–${clock(later.end)}`} onClick={() => { moveMissedTo(block, later); const t = block.taskId && store.get<Task>(block.taskId); if (t) store.save(logTask(t, 'Rescheduled to later today')); done('Rescheduled for later today'); }} /> : null}
              {block.taskId ? <Row title="Tomorrow" sub="Planned into tomorrow’s best free slot" onClick={() => { store.save({ ...block, status: 'skipped' }); const t = store.get<Task>(block.taskId!); if (t) store.save(logTask({ ...t, doDate: addDays(today, 1) }, 'Moved to tomorrow')); done('Moved to tomorrow'); }} /> : null}
              {block.taskId && later ? <Row title={`Shorten to ${Math.max(10, Math.round(length / 2 / 5) * 5)} minutes`} sub="Do a smaller version later today" onClick={() => { const short = Math.max(10, Math.round(length / 2 / 5) * 5); moveMissedTo(block, { start: later.start, end: later.start + short * 60_000 }); done('Shortened and rescheduled'); }} /> : null}
              {block.taskId ? <Row title="Break it into smaller tasks" onClick={() => { onClose(); nav.open({ type: 'task', id: block.taskId! }); }} /> : null}
              <Row title="Take it off today’s plan" sub="Nothing is deleted" onClick={() => { store.save({ ...block, status: 'unplanned' }); done('Taken off today’s plan'); }} />
            </div>
          ) : null}
          <div className="group">
            {block.type !== 'break' && block.status !== 'done' ? <Row title="Mark as done" onClick={() => { if (block.taskId) { const t = store.get<Task>(block.taskId); if (t) store.save(logTask({ ...t, status: 'completed', completedAt: nowIso() }, 'Completed')); } if (block.habitId) setHabitLog(block.habitId, block.date, 'done'); store.save({ ...block, status: 'done' }); done('Done'); }} /> : null}
            {block.status !== 'done' ? <Row title="Change time" onClick={() => setMode('time')} /> : null}
            {block.status !== 'done' ? <Row title="Change length" onClick={() => setMode('length')} /> : null}
            <Row title={block.locked ? 'Unlock' : 'Lock in place'} sub={block.locked ? undefined : 'Re-planning will never move it'} onClick={() => { store.save({ ...block, locked: !block.locked }); done(block.locked ? 'Unlocked' : 'Locked in place'); }} />
            {block.status === 'planned' ? <Row title="Take off today’s plan" onClick={() => { store.save({ ...block, status: 'unplanned' }); done('Taken off today’s plan'); }} /> : null}
            {block.taskId ? <Row title="Open task" onClick={() => { onClose(); nav.open({ type: 'task', id: block.taskId! }); }} /> : null}
          </div>
        </>
      )}
    </Sheet>
  );
}

// ───────────────────────────── Capture ─────────────────────────────

function CaptureSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const today = todayStr();
  const [text, setText] = useState('');
  const [type, setType] = useState<'task' | 'event' | 'habit' | 'goal' | 'idea' | null>(null);
  const draft = useMemo(() => parseCapture(text, today), [text, today]);
  const eff = type ?? (draft.type === 'event' || draft.type === 'habit' || draft.type === 'goal' || draft.type === 'idea' ? draft.type : draft.type === 'note' ? 'idea' : 'task');
  const understood = [draft.date ? dateLabel(draft.date) : null, draft.timeMinutes !== null ? hhmm(draft.timeMinutes) : null, draft.durationMinutes ? `${draft.durationMinutes} min` : null, draft.priority ? `P${draft.priority}` : null, ...draft.tags.map((t) => `#${t}`)].filter(Boolean);
  const save = (again: boolean) => {
    const title = draft.title || text.trim();
    if (!title) return;
    const goal = draft.tags.length ? activeGoals().find((g) => draft.tags.some((t) => g.title.toLowerCase().replace(/[^a-z0-9]/g, '').includes(t.replace(/[^a-z0-9]/g, '')))) : undefined;
    if (eff === 'task') {
      const planned = !!(draft.durationMinutes || draft.date || goal);
      store.save({ id: uid(), kind: 'task', title, priority: (draft.priority ?? 3) as Priority, status: planned ? 'planned' : 'inbox', due: draft.date, doDate: null, estimate: draft.durationMinutes, splittable: (draft.durationMinutes ?? 0) > 90, window: 'any', goalId: goal?.id ?? null, milestoneId: null, completedAt: null, createdAt: nowIso(), history: [{ at: nowIso(), what: 'Captured' }] });
    } else if (eff === 'event') {
      const start = draft.timeMinutes ?? 9 * 60;
      store.save({ id: uid(), kind: 'event', title, date: draft.date ?? today, start, end: Math.min(24 * 60 - 1, start + (draft.durationMinutes ?? 60)), repeat: 'none', exdates: [], locked: false, busy: true, type: 'event' });
    } else if (eff === 'habit') {
      store.save({ id: uid(), kind: 'habit', name: title, freq: 'daily', days: null, times: null, interval: null, startDate: today, duration: draft.durationMinutes, window: 'any', time: draft.timeMinutes !== null ? hhmm(draft.timeMinutes) : null, status: 'active', goalId: goal?.id ?? null, rank: nextRank(store.all('habit')), createdAt: nowIso() });
    } else if (eff === 'goal') {
      store.save({ id: uid(), kind: 'goal', title, why: '', status: 'active', rank: nextRank(activeGoals()), deadline: draft.date, mode: 'milestones', target: null, current: null, unit: '', manual: null, createdAt: nowIso() });
    } else {
      store.save({ id: uid(), kind: 'item', coll: 'ideas', v: { title, status: 'spark' }, createdAt: nowIso(), updatedAt: nowIso() });
    }
    toast(`${eff[0]!.toUpperCase()}${eff.slice(1)} saved: ${title}`);
    setText('');
    setType(null);
    if (!again) onClose();
  };
  return (
    <Sheet title="Capture" onClose={onClose} footer={<div className="btn-row"><Btn onClick={() => save(false)} disabled={!text.trim()}>Save</Btn><Btn kind="secondary" onClick={() => save(true)} disabled={!text.trim()}>Save & add another</Btn></div>}>
      <textarea id="capture-text" className="input capture" autoFocus rows={3} placeholder="Revise unit 3 tomorrow 4pm 45m #economics" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(false); } }} />
      {understood.length ? <p className="accent small">Understood: {understood.join(' · ')}</p> : <p className="muted small">Try “tomorrow”, “fri 6pm”, “45m”, “!p1” or “#goal”. Start with “idea:” to file an idea.</p>}
      <Chips value={eff} onChange={(v) => setType(v)} options={[{ value: 'task', label: 'Task' }, { value: 'event', label: 'Event' }, { value: 'habit', label: 'Habit' }, { value: 'goal', label: 'Goal' }, { value: 'idea', label: 'Idea' }]} />
    </Sheet>
  );
}

// ───────────────────────────── Goals & habits ─────────────────────────────

function GoalsTab() {
  useData();
  const [tab, setTabState] = useState(lastGoalsSub);
  const setTab = (t: typeof lastGoalsSub) => { lastGoalsSub = t; setTabState(t); };
  const [form, setForm] = useState<'goal' | 'habit' | 'project' | null>(null);
  return (
    <div className="screen">
      <header className="head">
        <h1>Goals</h1>
        <button type="button" className="plus" aria-label={tab === 'goals' ? 'New goal' : tab === 'habits' ? 'New habit' : 'New project'} onClick={() => setForm(tab === 'goals' ? 'goal' : tab === 'habits' ? 'habit' : 'project')}>+</button>
      </header>
      <Seg value={tab} onChange={setTab} options={[{ value: 'goals', label: 'Goals' }, { value: 'habits', label: 'Habits' }, { value: 'projects', label: 'Projects' }]} />
      {tab === 'goals' ? <GoalList onNew={() => setForm('goal')} /> : tab === 'habits' ? <HabitList onNew={() => setForm('habit')} /> : <ProjectList onNew={() => setForm('project')} />}
      {form === 'project' ? <ProjectForm onClose={() => setForm(null)} /> : null}
      {form === 'goal' ? <GoalForm onClose={() => setForm(null)} /> : null}
      {form === 'habit' ? <HabitForm onClose={() => setForm(null)} /> : null}
    </div>
  );
}

function GoalList({ onNew }: { onNew: () => void }) {
  const nav = useNav();
  const toast = useToast();
  const goals = activeGoals();
  const finished = store.all('goal').filter((g) => g.status === 'completed' || g.status === 'archived');
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const move = (id: string, to: number) => {
    const others = goals.filter((g) => g.id !== id);
    const before = others[to - 1]?.rank ?? (others[0] ? others[0].rank - 1 : 0);
    const after = others[to]?.rank ?? before + 2;
    const g = goals.find((x) => x.id === id);
    if (!g || goals.indexOf(g) === to) return;
    store.save({ ...g, rank: (before + after) / 2 });
    toast(`Moved to priority ${to + 1}`);
  };
  const rowIndexAt = (y: number) => {
    const rows = listRef.current ? [...listRef.current.querySelectorAll<HTMLElement>('[data-goal-row]')] : [];
    let idx = rows.length - 1;
    rows.forEach((r, i) => { const box = r.getBoundingClientRect(); if (y < box.top + box.height / 2 && idx === rows.length - 1 && i < idx) idx = i; });
    for (let i = 0; i < rows.length; i++) { const box = rows[i]!.getBoundingClientRect(); if (y < box.top + box.height / 2) return i; }
    return idx;
  };
  if (!goals.length && !finished.length) return <Empty title="What do you want to achieve?" body="Create your own goals, then put them in order. Your priority list shapes how ASCEND plans each day." action="Create a goal" onAction={onNew} />;
  return (
    <>
      <Section title="Priorities" hint="Drag the handle to reorder, or use the arrows. ASCEND never reorders this without asking.">
        <div ref={listRef} className="goal-list">
          {goals.map((g, i) => {
            const p = goalProgressFor(g);
            return (
              <div key={g.id} data-goal-row className={`goal-row${drag?.id === g.id ? ' dragging' : ''}${drag && drag.over === i && drag.id !== g.id ? ' drop-target' : ''}`}>
                <span
                  className="handle"
                  aria-hidden="true"
                  onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag({ id: g.id, over: i }); }}
                  onPointerMove={(e) => drag?.id === g.id && setDrag({ id: g.id, over: rowIndexAt(e.clientY) })}
                  onPointerUp={() => { if (drag?.id === g.id) move(g.id, drag.over); setDrag(null); }}
                >⋮⋮</span>
                <span className="prio">{i + 1}</span>
                <div className="row-main" role="button" tabIndex={0} onClick={() => nav.open({ type: 'goal', id: g.id })} onKeyDown={(e) => e.key === 'Enter' && nav.open({ type: 'goal', id: g.id })}>
                  <div className="row-title">{g.title} {g.status === 'paused' ? <Badge>Paused</Badge> : null}{g.example ? <Badge>Example</Badge> : null}</div>
                  <Bar value={p.ratio} />
                  <div className="row-sub">{p.label}{g.deadline ? ` · by ${dateLabel(g.deadline, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</div>
                </div>
                <div className="arrows">
                  <button type="button" aria-label={`Move ${g.title} up`} disabled={i === 0} onClick={() => move(g.id, i - 1)}>▲</button>
                  <button type="button" aria-label={`Move ${g.title} down`} disabled={i === goals.length - 1} onClick={() => move(g.id, i + 1)}>▼</button>
                </div>
              </div>
            );
          })}
        </div>
      </Section>
      {finished.length ? (
        <Section title="Completed & archived">
          <div className="group">{finished.map((g) => <Row key={g.id} title={g.title} sub={g.status === 'completed' ? 'Achieved' : 'Archived'} muted={g.status === 'completed'} onClick={() => nav.open({ type: 'goal', id: g.id })} />)}</div>
        </Section>
      ) : null}
    </>
  );
}

function HabitList({ onNew }: { onNew: () => void }) {
  const nav = useNav();
  const today = todayStr();
  const list = habitDay(today);
  if (!list.length) return <Empty title="Build habits that last" body="Reading, revision, gym, football practice — create your own, on the days that suit you. They’re planned into your day automatically." action="Create a habit" onAction={onNew} />;
  return (
    <div className="group">
      {list.map(({ habit, due, log, c30 }) => (
        <Row key={habit.id} lead={due || log ? <Check checked={log?.status === 'done'} label={`${habit.name} done today`} onChange={() => setHabitLog(habit.id, today, log?.status === 'done' ? null : 'done')} /> : <span className="check-gap" />} title={<>{habit.name}{habit.status === 'paused' ? <> <Badge>Paused</Badge></> : null}</>} sub={`${describeFrequency(habitRule(habit))}${c30.rate !== null ? ` · ${Math.round(c30.rate * 100)}% last 30 days` : ''}${!due && !log && habit.status === 'active' ? ' · not today' : ''}`} onClick={() => nav.open({ type: 'habit', id: habit.id })} />
      ))}
    </div>
  );
}

function GoalForm({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(goal?.title ?? '');
  const [why, setWhy] = useState(goal?.why ?? '');
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');
  const [mode, setMode] = useState<Goal['mode']>(goal?.mode ?? 'milestones');
  const [target, setTarget] = useState(goal?.target?.toString() ?? '');
  const [current, setCurrent] = useState(goal?.current?.toString() ?? '');
  const [unit, setUnit] = useState(goal?.unit ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    if (!title.trim()) return setError('Give your goal a name');
    if (mode === 'target' && !target.trim()) return setError('Set a target value');
    const base: Goal = goal ?? { id: uid(), kind: 'goal', title: '', why: '', status: 'active', rank: nextRank(activeGoals()), deadline: null, mode: 'milestones', target: null, current: null, unit: '', manual: null, createdAt: nowIso() };
    store.save({ ...base, title: title.trim(), why: why.trim(), deadline: deadline || null, mode, target: target ? Number(target) : null, current: current ? Number(current) : null, unit: unit.trim() });
    toast(goal ? 'Goal saved' : 'Goal created. Add milestones to map the way.');
    onClose();
  };
  return (
    <Sheet title={goal ? 'Edit goal' : 'New goal'} onClose={onClose} footer={<Btn full onClick={save}>{goal ? 'Save changes' : 'Create goal'}</Btn>}>
      <Field label="Goal" error={error}><input id="goal-title" className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Improve my Economics grade" maxLength={200} /></Field>
      <Field label="Why it matters to you" hint="A reason you’ll still believe on a hard day."><textarea id="goal-why" className="input" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
      <Field label="Deadline (optional)"><input id="goal-deadline" className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
      <Field label="How progress is measured"><Chips value={mode} onChange={setMode} options={[{ value: 'milestones', label: 'Milestones' }, { value: 'tasks', label: 'Tasks' }, { value: 'target', label: 'Target' }, { value: 'manual', label: 'Manual %' }]} /></Field>
      {mode === 'target' ? (
        <div className="grid3">
          <Field label="Target"><input id="goal-target" className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
          <Field label="Now"><input id="goal-current" className="input" inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
          <Field label="Unit"><input id="goal-unit" className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="km, grade…" /></Field>
        </div>
      ) : null}
    </Sheet>
  );
}

const NOTE_TYPES: { value: Note['type']; label: string }[] = [
  { value: 'strategy', label: 'Strategy' },
  { value: 'info', label: 'Important info' },
  { value: 'learning', label: 'What I’ve learned' },
  { value: 'problem', label: 'Problems to overcome' },
  { value: 'next_steps', label: 'Next steps' },
];

function GoalDetail({ id, onBack }: { id: string; onBack: () => void }) {
  useData();
  const toast = useToast();
  const nav = useNav();
  const goal = store.get<Goal>(id);
  const [edit, setEdit] = useState(false);
  const [ms, setMs] = useState('');
  const [msDate, setMsDate] = useState('');
  const [check, setCheck] = useState('');
  const [noteType, setNoteType] = useState<Note['type']>('strategy');
  const [note, setNote] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [progress, setProgress] = useState('');
  if (!goal) return <div className="screen"><Back onBack={onBack} /><Empty title="This goal no longer exists" body="It may have been deleted." /></div>;
  const p = goalProgressFor(goal);
  const milestones = store.all('milestone').filter((m) => m.goalId === id).sort((a, b) => a.rank - b.rank);
  const checks = store.all('check').filter((c) => c.goalId === id).sort((a, b) => a.rank - b.rank);
  const notes = store.all('note').filter((n) => n.goalId === id);
  const links = store.all('link').filter((l) => l.goalId === id);
  const tasks = store.all('task').filter((t) => t.goalId === id);
  const addLink = () => {
    let url = linkUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try { new URL(url); } catch { return toast('That doesn’t look like a valid link'); }
    store.save({ id: uid(), kind: 'link', goalId: id, title: linkTitle.trim() || url.replace(/^https?:\/\/(www\.)?/, ''), url, createdAt: nowIso() });
    setLinkTitle(''); setLinkUrl('');
  };
  return (
    <div className="screen">
      <Back onBack={onBack} />
      <div className="detail-head">
        <h1>{goal.title}</h1>
        <div className="chips-inline">
          {goal.status !== 'active' ? <Badge tone={goal.status === 'completed' ? 'good' : 'neutral'}>{goal.status === 'completed' ? 'Achieved' : goal.status === 'paused' ? 'Paused' : 'Archived'}</Badge> : null}
          {goal.deadline ? <span className="muted small">By {dateLabel(goal.deadline, { day: 'numeric', month: 'long', year: 'numeric' })}</span> : null}
        </div>
        {goal.why ? <p className="muted"><strong>Why it matters:</strong> {goal.why}</p> : null}
      </div>
      <div className="card">
        <div className="between"><strong>Progress</strong><span className="muted small">{p.ratio !== null ? `${Math.round(p.ratio * 100)}%` : ''}</span></div>
        <Bar value={p.ratio} />
        <span className="muted small">{p.label}</span>
        {goal.mode === 'manual' || goal.mode === 'target' ? (
          <div className="inline-form">
            <input id="goal-progress" className="input" inputMode="decimal" placeholder={goal.mode === 'manual' ? 'Progress %' : `Current ${goal.unit || 'value'}`} value={progress} onChange={(e) => setProgress(e.target.value)} />
            <Btn small onClick={() => { const v = Number(progress); if (!Number.isFinite(v) || progress === '') return; store.save(goal.mode === 'manual' ? { ...goal, manual: Math.max(0, Math.min(100, v)) } : { ...goal, current: v }); setProgress(''); toast('Progress recorded'); }}>Update</Btn>
          </div>
        ) : null}
      </div>

      <Section title="Milestones">
        <div className="group">
          {milestones.map((m) => (
            <Row key={m.id} lead={<Check checked={m.done} label={`${m.title} done`} onChange={() => { store.save({ ...m, done: !m.done, doneAt: m.done ? null : nowIso() }); if (!m.done) toast('Milestone complete. Progress updated.'); }} />} title={m.title} sub={[m.deadline ? `By ${dateLabel(m.deadline)}` : null, `${tasks.filter((t) => t.milestoneId === m.id).length} tasks`].filter(Boolean).join(' · ')} muted={m.done} trail={<button type="button" className="x" aria-label={`Delete ${m.title}`} onClick={() => { store.remove(m.id); toast('Milestone deleted', () => store.save(m)); }}>✕</button>} />
          ))}
        </div>
        <div className="inline-form">
          <input id="ms-title" className="input" placeholder="Add a milestone…" value={ms} onChange={(e) => setMs(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ms.trim() && (store.save({ id: uid(), kind: 'milestone', goalId: id, title: ms.trim(), deadline: msDate || null, done: false, doneAt: null, rank: nextRank(milestones) }), setMs(''), setMsDate(''))} />
          <input id="ms-date" className="input input-date" type="date" aria-label="Milestone deadline" value={msDate} onChange={(e) => setMsDate(e.target.value)} />
          <Btn small kind="secondary" disabled={!ms.trim()} onClick={() => { store.save({ id: uid(), kind: 'milestone', goalId: id, title: ms.trim(), deadline: msDate || null, done: false, doneAt: null, rank: nextRank(milestones) }); setMs(''); setMsDate(''); }}>Add</Btn>
        </div>
      </Section>

      <Section title="Linked tasks" action="Add task" onAction={() => nav.open({ type: 'task', id: `new:${id}` })}>
        {tasks.length ? <div className="group">{tasks.map((t) => <Row key={t.id} title={t.title} sub={`${t.status.replace('_', ' ')}${t.due ? ` · due ${dateLabel(t.due)}` : ''}`} muted={t.status === 'completed'} onClick={() => nav.open({ type: 'task', id: t.id })} />)}</div> : <p className="muted small">Tasks linked here are prioritised by this goal’s place in your list.</p>}
      </Section>

      <Section title="Action checklist">
        <div className="group">{checks.map((c) => <Row key={c.id} lead={<Check square checked={c.done} label={c.title} onChange={() => store.save({ ...c, done: !c.done })} />} title={c.title} muted={c.done} trail={<button type="button" className="x" aria-label={`Delete ${c.title}`} onClick={() => store.remove(c.id)}>✕</button>} />)}</div>
        <input id="check-title" className="input" placeholder="Add an action and press Enter…" value={check} onChange={(e) => setCheck(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && check.trim()) { store.save({ id: uid(), kind: 'check', goalId: id, title: check.trim(), done: false, rank: nextRank(checks) }); setCheck(''); } }} />
      </Section>

      <Section title="Notes">
        {NOTE_TYPES.filter((t) => notes.some((n) => n.type === t.value)).map((t) => (
          <div key={t.value} className="note-group">
            <div className="eyebrow">{t.label}</div>
            {notes.filter((n) => n.type === t.value).map((n) => <div key={n.id} className="note">{n.text}<button type="button" className="x" aria-label="Delete note" onClick={() => { store.remove(n.id); toast('Note deleted', () => store.save(n)); }}>✕</button></div>)}
          </div>
        ))}
        <Chips value={noteType} onChange={setNoteType} options={NOTE_TYPES} />
        <textarea id="note-text" className="input" rows={3} placeholder="Your strategy, what you’ve learned, problems, next steps…" value={note} onChange={(e) => setNote(e.target.value)} />
        <Btn small kind="secondary" disabled={!note.trim()} onClick={() => { store.save({ id: uid(), kind: 'note', goalId: id, type: noteType, text: note.trim(), createdAt: nowIso() }); setNote(''); toast('Note saved'); }}>Save note</Btn>
      </Section>

      <Section title="Videos & resources">
        <div className="group">{links.map((l) => <Row key={l.id} lead={<span className="link-kind">{/youtu|vimeo/i.test(l.url) ? '▶' : '↗'}</span>} title={<a href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a>} sub={l.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)} trail={<button type="button" className="x" aria-label={`Remove ${l.title}`} onClick={() => store.remove(l.id)}>✕</button>} />)}</div>
        <div className="inline-form">
          <input id="link-url" className="input" placeholder="Paste a link" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
          <input id="link-title" className="input" placeholder="Title (optional)" value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} />
          <Btn small kind="secondary" disabled={!linkUrl.trim()} onClick={addLink}>Save</Btn>
        </div>
      </Section>

      <div className="btn-row wrap">
        <Btn small kind="secondary" onClick={() => setEdit(true)}>Edit goal</Btn>
        {goal.status === 'active' ? <Btn small kind="secondary" onClick={() => { store.save({ ...goal, status: 'paused' }); toast('Goal paused'); }}>Pause</Btn> : <Btn small kind="secondary" onClick={() => { store.save({ ...goal, status: 'active', rank: nextRank(activeGoals()) }); toast('Goal is active'); }}>Make active</Btn>}
        {goal.status !== 'completed' ? <Btn small kind="secondary" onClick={() => { store.save({ ...goal, status: 'completed' }); toast('Goal achieved. Well done.'); }}>Mark achieved</Btn> : null}
        <Btn small kind="secondary" onClick={() => { store.save({ ...goal, status: 'archived' }); toast('Goal archived'); }}>Archive</Btn>
        <ConfirmButton label="Delete goal" confirmLabel="Delete" onConfirm={() => { const related = [...milestones, ...checks, ...notes, ...links]; store.remove(id, ...related.map((r) => r.id)); onBack(); toast('Goal deleted', () => store.save(goal, ...related)); }} />
      </div>
      {edit ? <GoalForm goal={goal} onClose={() => setEdit(false)} /> : null}
    </div>
  );
}

function Back({ onBack }: { onBack: () => void }) {
  return <button type="button" className="back" onClick={onBack}>‹ Back</button>;
}


function HabitForm({ habit, onClose }: { habit?: Habit; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(habit?.name ?? '');
  const [freq, setFreq] = useState<Habit['freq']>(habit?.freq ?? 'daily');
  const [days, setDays] = useState<number[]>(habit?.days ?? [1, 3, 5]);
  const [times, setTimes] = useState(habit?.times ?? 3);
  const [interval, setInterval] = useState(habit?.interval ?? 2);
  const [duration, setDuration] = useState(habit?.duration ?? 30);
  const [window, setWindow] = useState<Window>(habit?.window ?? 'any');
  const [time, setTime] = useState(habit?.time ?? '');
  const [goalId, setGoalId] = useState(habit?.goalId ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    if (!name.trim()) return setError('Give the habit a name');
    if (freq === 'weekdays' && !days.length) return setError('Choose at least one day');
    const base: Habit = habit ?? { id: uid(), kind: 'habit', name: '', freq: 'daily', days: null, times: null, interval: null, startDate: todayStr(), duration: null, window: 'any', time: null, status: 'active', goalId: null, rank: nextRank(store.all('habit')), createdAt: nowIso() };
    store.save({ ...base, name: name.trim(), freq, days: freq === 'weekdays' || freq === 'times_per_week' ? [...days].sort() : null, times: freq === 'times_per_week' || freq === 'times_per_month' ? times : null, interval: freq === 'every_n_days' ? interval : null, duration: duration || null, window, time: time || null, goalId: goalId || null });
    toast(habit ? 'Habit saved' : 'Habit created. It appears in your plan on the days it’s due.');
    onClose();
  };
  return (
    <Sheet title={habit ? 'Edit habit' : 'New habit'} onClose={onClose} footer={<Btn full onClick={save}>{habit ? 'Save changes' : 'Create habit'}</Btn>}>
      <Field label="Habit" error={error}><input id="habit-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Read, revision, weak-foot drills…" maxLength={120} /></Field>
      <Field label="How often"><Chips value={freq} onChange={setFreq} options={[{ value: 'daily', label: 'Every day' }, { value: 'weekdays', label: 'Specific days' }, { value: 'times_per_week', label: 'Times a week' }, { value: 'times_per_month', label: 'Times a month' }, { value: 'every_n_days', label: 'Every few days' }]} /></Field>
      {freq === 'weekdays' || freq === 'times_per_week' ? <Field label={freq === 'weekdays' ? 'On these days' : 'Preferred days (optional)'}><Chips value={days} onChange={(d) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))} options={DAYS} /></Field> : null}
      {freq === 'times_per_week' || freq === 'times_per_month' ? <Field label={`Times per ${freq === 'times_per_week' ? 'week' : 'month'}`}><Stepper value={times} onChange={setTimes} min={1} max={freq === 'times_per_week' ? 7 : 31} step={1} /></Field> : null}
      {freq === 'every_n_days' ? <Field label="Every"><Stepper value={interval} onChange={setInterval} min={2} max={60} step={1} fmt={(v) => `${v} days`} /></Field> : null}
      <Field label="Time to block out" hint="Used to fit it into your day. Set to 0 for no time block."><Stepper value={duration} onChange={setDuration} min={0} max={240} fmt={(v) => (v ? mins(v) : 'Off')} /></Field>
      <Field label="Best time of day"><Chips value={window} onChange={setWindow} options={[{ value: 'any', label: 'Any time' }, { value: 'morning', label: 'Morning' }, { value: 'afternoon', label: 'Afternoon' }, { value: 'evening', label: 'Evening' }]} /></Field>
      <Field label="Preferred time (optional)"><input id="habit-time" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
      <Field label="Supports goal (optional)"><select id="habit-goal" className="input" value={goalId} onChange={(e) => setGoalId(e.target.value)}><option value="">No goal</option>{activeGoals().map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></Field>
    </Sheet>
  );
}

function HabitDetail({ id, onBack }: { id: string; onBack: () => void }) {
  useData();
  const toast = useToast();
  const today = todayStr();
  const [month, setMonth] = useState(startOfMonth(today));
  const [edit, setEdit] = useState(false);
  const habit = store.get<Habit>(id);
  if (!habit) return <div className="screen"><Back onBack={onBack} /><Empty title="This habit no longer exists" body="It may have been deleted." /></div>;
  const info = habitDay(today).find((h) => h.habit.id === id)!;
  const entries = habitEntries(id);
  const grid = monthStatus(habitRule(habit), entries, month);
  const lead = (new Date(`${month}T12:00:00Z`).getUTCDay() + 6) % 7;
  const cycle = (date: string) => {
    if (date > today) return;
    const cur = store.get<import('./store.ts').HabitLog>(`${id}_${date}`)?.status ?? null;
    setHabitLog(id, date, cur === null ? 'done' : cur === 'done' ? 'partial' : cur === 'partial' ? 'skipped' : null);
  };
  return (
    <div className="screen">
      <Back onBack={onBack} />
      <div className="detail-head">
        <h1>{habit.name}</h1>
        <p className="muted">{describeFrequency(habitRule(habit))}{habit.duration ? ` · ${habit.duration} min` : ''}{habit.time ? ` · around ${habit.time}` : ''}{habit.status === 'paused' ? ' · paused' : ''}</p>
      </div>
      <div className="card">
        <div className="strip">
          <Stat value={info?.c30.rate === null || !info ? '—' : `${Math.round(info.c30.rate * 100)}%`} label="Last 30 days" />
          <Stat value={String(entries.filter((e) => e.status !== 'skipped').length)} label="Times done" />
          <Stat value={`${info?.runs.current ?? 0}`} label={`Current run (${info?.runs.unit ?? 'days'})`} />
          <Stat value={`${info?.runs.best ?? 0}`} label="Best run" />
        </div>
        <p className="muted small">A missed day lowers consistency a little. It never erases your progress.</p>
      </div>
      <Section title="History" hint="Tap a day to cycle: done → partly → rest day → clear.">
        <div className="between">
          <IconBtn label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>‹</IconBtn>
          <strong>{dateLabel(month, { month: 'long', year: 'numeric' })}</strong>
          <IconBtn label="Next month" onClick={() => setMonth(addMonths(month, 1))}>›</IconBtn>
        </div>
        <div className="cal">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="cal-h">{d}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
          {grid.map((g) => (
            <button key={g.date} type="button" disabled={g.date > today} aria-label={`${dateLabel(g.date)}: ${g.status ?? (g.scheduled ? 'not done' : 'not scheduled')}`} onClick={() => cycle(g.date)} className={`cal-d s-${g.status ?? 'none'}${g.scheduled ? ' sched' : ''}${g.date === today ? ' today' : ''}`}>
              {Number(g.date.slice(8))}
            </button>
          ))}
        </div>
      </Section>
      <div className="btn-row wrap">
        <Btn small kind="secondary" onClick={() => setEdit(true)}>Edit habit</Btn>
        <Btn small kind="secondary" onClick={() => { store.save({ ...habit, status: habit.status === 'active' ? 'paused' : 'active' }); toast(habit.status === 'active' ? 'Paused. Your history is kept.' : 'Resumed'); }}>{habit.status === 'active' ? 'Pause' : 'Resume'}</Btn>
        <Btn small kind="secondary" onClick={() => { store.save({ ...habit, status: 'archived' }); onBack(); toast('Habit archived', () => store.save(habit)); }}>Archive</Btn>
        <ConfirmButton label="Delete habit" confirmLabel="Delete" onConfirm={() => { const logs = store.all('hlog').filter((l) => l.habitId === id); store.remove(id, ...logs.map((l) => l.id)); onBack(); toast('Habit deleted', () => store.save(habit, ...logs)); }} />
      </div>
      {edit ? <HabitForm habit={habit} onClose={() => setEdit(false)} /> : null}
    </div>
  );
}

// ───────────────────────────── Planner ─────────────────────────────

type PlannerSub = 'calendar' | 'tasks' | 'focus' | 'training' | 'social';
// Sub-tabs are remembered while the page is open, so coming back from a detail screen lands where you were.
let lastPlannerSub: PlannerSub = 'calendar';
let lastGoalsSub: 'goals' | 'habits' | 'projects' = 'goals';
function PlannerTab({ initial }: { initial?: string }) {
  useData();
  const nav = useNav();
  const [tab, setTabState] = useState<PlannerSub>((['calendar', 'tasks', 'focus', 'training', 'social'] as const).find((t) => t === initial) ?? lastPlannerSub);
  const setTab = (t: PlannerSub) => { lastPlannerSub = t; setTabState(t); };
  useEffect(() => { lastPlannerSub = tab; }, [tab]);
  const [eventForm, setEventForm] = useState<CalEvent | 'new' | 'social' | null>(null);
  return (
    <div className="screen">
      <header className="head">
        <h1>Planner</h1>
        {tab === 'calendar' || tab === 'tasks' ? (
          <button type="button" className="plus" aria-label={tab === 'tasks' ? 'New task' : 'New event'} onClick={() => (tab === 'calendar' ? setEventForm('new') : nav.open({ type: 'task', id: 'new:' }))}>+</button>
        ) : <span className="plus-spacer" aria-hidden="true" />}
      </header>
      <Seg value={tab} onChange={setTab} options={[{ value: 'calendar', label: 'Calendar' }, { value: 'tasks', label: 'Tasks' }, { value: 'focus', label: 'Focus' }, { value: 'training', label: 'Training' }, { value: 'social', label: 'Social' }]} />
      {tab === 'calendar' ? <CalendarPane onEvent={setEventForm} /> : tab === 'tasks' ? <TasksPane /> : tab === 'focus' ? <FocusPane /> : tab === 'training' ? <TrainingPane /> : <SocialPane onNewEvent={() => setEventForm('social')} />}
      {eventForm ? <EventForm event={eventForm === 'new' || eventForm === 'social' ? undefined : eventForm} defaultType={eventForm === 'social' ? 'social' : undefined} onClose={() => setEventForm(null)} /> : null}
    </div>
  );
}

function CalendarPane({ onEvent }: { onEvent: (e: CalEvent) => void }) {
  const today = todayStr();
  const now = useNow();
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [date, setDate] = useState(today);
  const p = store.prefs();
  const dayStartH = Math.floor(parseTime(p.dayStart) / 60);
  const dayEndH = Math.ceil(parseTime(p.dayEnd) / 60);
  const HOUR = 52;
  const origin = atLocal(date, dayStartH * 60);
  const y = (ms: number) => ((ms - origin) / 3_600_000) * HOUR;
  const isToday = date === today;
  const preview = !isToday && date > today ? previewDay(date, Date.now()) : null;
  const blocks: { key: string; start: number; end: number; title: string; type: string; locked: boolean; done: boolean; preview?: boolean }[] = isToday
    ? blocksOn(date).filter((b) => b.status !== 'unplanned' && b.status !== 'skipped').map((b) => ({ key: b.id, start: b.start, end: b.end, title: b.title, type: b.type, locked: b.locked, done: b.status === 'done' }))
    : (preview?.blocks ?? []).map((b) => ({ key: b.key, start: b.start, end: b.end, title: b.title, type: b.kind, locked: false, done: false, preview: true }));
  const events = eventsOn(date);
  const ws = weekStart(date);
  return (
    <>
      <Seg value={mode} onChange={setMode} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} />
      <div className="between">
        <IconBtn label="Previous" onClick={() => setDate(addDays(date, mode === 'day' ? -1 : -7))}>‹</IconBtn>
        <button type="button" className="link-btn strong" onClick={() => setDate(today)}>{mode === 'day' ? (isToday ? `Today · ${dateLabel(date)}` : dateLabel(date, { weekday: 'long', day: 'numeric', month: 'short' })) : `Week of ${dateLabel(ws)}`}</button>
        <IconBtn label="Next" onClick={() => setDate(addDays(date, mode === 'day' ? 1 : 7))}>›</IconBtn>
      </div>
      {mode === 'day' ? (
        <>
          {preview ? <p className="muted small">Preview of how this day would be planned. It’s confirmed automatically on the day.</p> : null}
          <div className="daygrid" style={{ height: (dayEndH - dayStartH) * HOUR + 12 }}>
            {Array.from({ length: dayEndH - dayStartH + 1 }, (_, i) => <div key={i} className="hour" style={{ top: i * HOUR }}><span>{hourLabel(date, dayStartH + i)}</span></div>)}
            {events.map((o) => <button type="button" key={o.event.id} className="dg-item dg-event" style={{ top: Math.max(0, y(o.start)), height: Math.max(20, y(o.end) - Math.max(0, y(o.start))) }} onClick={() => onEvent(o.event)}>{o.event.locked ? '● ' : ''}{o.event.title}</button>)}
            {blocks.map((b) => <div key={b.key} className={`dg-item dg-${b.type}${b.done ? ' is-done' : ''}${b.preview ? ' is-preview' : ''}`} style={{ top: y(b.start), height: Math.max(20, y(b.end) - y(b.start)) }}>{b.locked ? '● ' : ''}{b.title}</div>)}
            {isToday && y(now) > 0 && y(now) < (dayEndH - dayStartH) * HOUR ? <div className="now-line" style={{ top: y(now) }} /> : null}
          </div>
        </>
      ) : (
        <div className="group">
          {Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map((d) => {
            const evs = eventsOn(d);
            const due = store.all('task').filter((t) => t.due === d && t.status !== 'completed' && t.status !== 'cancelled');
            return <Row key={d} lead={<span className={`wd${d === today ? ' accent' : ''}`}>{dateLabel(d, { weekday: 'short' })}<br /><strong>{Number(d.slice(8))}</strong></span>} title={evs.length ? evs.map((o) => `${clock(o.start)} ${o.event.title}`).join(' · ') : 'Free'} sub={due.length ? `Due: ${due.map((t) => t.title).join(', ')}` : null} onClick={() => { setDate(d); setMode('day'); }} />;
          })}
        </div>
      )}
    </>
  );
}

function EventForm({ event, onClose, defaultType }: { event?: CalEvent; onClose: () => void; defaultType?: CalEvent['type'] }) {
  const toast = useToast();
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(event?.date ?? todayStr());
  const [start, setStart] = useState(hhmm(event?.start ?? 9 * 60));
  const [end, setEnd] = useState(hhmm(event?.end ?? 10 * 60));
  const [repeat, setRepeat] = useState<CalEvent['repeat']>(event?.repeat ?? 'none');
  const [type, setType] = useState<CalEvent['type']>(event?.type ?? defaultType ?? 'event');
  const [locked, setLocked] = useState(event?.locked ?? false);
  const [busy, setBusy] = useState(event?.busy ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    if (!title.trim()) return setError('Give it a title');
    if (parseTime(end || '00:00') === parseTime(start || '00:00')) return setError('End must be after start');
    store.save({ id: event?.id ?? uid(), kind: 'event', title: title.trim(), date, start: parseTime(start), end: parseTime(end), repeat, exdates: event?.exdates ?? [], locked, busy, type });
    toast(busy ? 'Saved. Your plan adjusts around it.' : 'Saved');
    onClose();
  };
  return (
    <Sheet title={event ? 'Edit event' : 'New event'} onClose={onClose} footer={<div className="btn-row wrap"><Btn onClick={save}>{event ? 'Save changes' : 'Add to calendar'}</Btn>{event ? <ConfirmButton label="Delete" confirmLabel={event.repeat !== 'none' ? 'Delete all' : 'Delete'} onConfirm={() => { store.remove(event.id); toast('Event deleted', () => store.save(event)); onClose(); }} /> : null}{event && event.repeat !== 'none' ? <Btn kind="ghost" small onClick={() => { store.save({ ...event, exdates: [...event.exdates, todayStr()] }); toast('Removed today’s occurrence'); onClose(); }}>Skip today only</Btn> : null}</div>}>
      <Field label="Title" error={error}><input id="ev-title" className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></Field>
      <Field label="Type"><Chips value={type} onChange={setType} options={[{ value: 'event', label: 'Event' }, { value: 'class', label: 'Class' }, { value: 'work', label: 'Work' }, { value: 'training', label: 'Training' }, { value: 'social', label: 'Social' }]} /></Field>
      <div className="grid3">
        <Field label="Date"><input id="ev-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Starts"><input id="ev-start" className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Ends"><input id="ev-end" className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <Field label="Repeat"><Chips value={repeat} onChange={setRepeat} options={[{ value: 'none', label: 'Never' }, { value: 'daily', label: 'Daily' }, { value: 'weekdays', label: 'Weekdays' }, { value: 'weekly', label: 'Weekly' }]} /></Field>
      <label className="toggle"><input id="ev-locked" type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} /><span><strong>Fixed commitment (locked)</strong><br /><span className="muted small">ASCEND never moves it.</span></span></label>
      <label className="toggle"><input id="ev-busy" type="checkbox" checked={busy} onChange={(e) => setBusy(e.target.checked)} /><span><strong>Busy</strong><br /><span className="muted small">Nothing else is scheduled during it.</span></span></label>
    </Sheet>
  );
}

function TasksPane() {
  const nav = useNav();
  const toast = useToast();
  const today = todayStr();
  const [list, setList] = useState<'today' | 'inbox' | 'upcoming' | 'all' | 'done'>('today');
  const all = store.all('task');
  const open = all.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
  const shown = (list === 'inbox' ? open.filter((t) => t.status === 'inbox')
    : list === 'today' ? open.filter((t) => (t.due && t.due <= today) || t.doDate === today || t.status === 'in_progress' || blocksOn(today).some((b) => b.taskId === t.id && b.status !== 'unplanned'))
    : list === 'upcoming' ? open.filter((t) => t.status !== 'inbox' && ((t.due && t.due > today) || (t.doDate && t.doDate > today)))
    : list === 'all' ? open
    : all.filter((t) => t.status === 'completed' || t.status === 'cancelled')).sort((a, b) => a.priority - b.priority || (a.due ?? '9') .localeCompare(b.due ?? '9'));
  const inbox = open.filter((t) => t.status === 'inbox').length;
  const toggle = (t: Task) => {
    if (t.status === 'completed') store.save(logTask({ ...t, status: 'planned', completedAt: null }, 'Reopened'));
    else { store.save(logTask({ ...t, status: 'completed', completedAt: nowIso() }, 'Completed')); toast('Done', () => store.save(t)); }
  };
  return (
    <>
      <Chips value={list} onChange={setList} options={[{ value: 'today', label: 'Today' }, { value: 'inbox', label: inbox ? `Inbox ${inbox}` : 'Inbox' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'all', label: 'All open' }, { value: 'done', label: 'Done' }]} />
      {shown.length ? (
        <div className="group">{shown.map((t) => <Row key={t.id} lead={<Check checked={t.status === 'completed'} label={`Complete ${t.title}`} onChange={() => toggle(t)} />} title={t.title} sub={[t.priority <= 2 ? `P${t.priority}` : null, t.due ? `due ${t.due === today ? 'today' : dateLabel(t.due)}` : null, t.estimate ? `${t.estimate} min` : null, t.status === 'inbox' ? 'not planned yet' : null].filter(Boolean).join(' · ') || null} muted={t.status === 'completed' || t.status === 'cancelled'} onClick={() => nav.open({ type: 'task', id: t.id })} />)}</div>
      ) : (
        <Empty title={list === 'inbox' ? 'Inbox zero' : list === 'today' ? 'Nothing due today' : 'No tasks here'} body={list === 'inbox' ? 'Captured tasks wait here until you give them an estimate, date or goal.' : 'Add a task and ASCEND will find time for it.'} action="New task" onAction={() => nav.open({ type: 'task', id: 'new:' })} />
      )}
    </>
  );
}

function TaskDetail({ id, onBack }: { id: string; onBack: () => void }) {
  useData();
  const toast = useToast();
  const isNew = id.startsWith('new:');
  const existing = isNew ? undefined : store.get<Task>(id);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [priority, setPriority] = useState<Priority>(existing?.priority ?? 3);
  const [estimate, setEstimate] = useState(existing?.estimate ?? 30);
  const [hasEstimate, setHasEstimate] = useState(isNew || existing?.estimate != null);
  const [splittable, setSplittable] = useState(existing?.splittable ?? false);
  const [due, setDue] = useState(existing?.due ?? '');
  const [doDate, setDoDate] = useState(existing?.doDate ?? '');
  const [window, setWindow] = useState<Window>(existing?.window ?? 'any');
  const [goalId, setGoalId] = useState(existing?.goalId ?? (isNew ? id.slice(4) : ''));
  const [milestoneId, setMilestoneId] = useState(existing?.milestoneId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [parts, setParts] = useState<string[]>(['', '']);
  if (!isNew && !existing) return <div className="screen"><Back onBack={onBack} /><Empty title="This task no longer exists" body="It may have been deleted." /></div>;
  const milestones = store.all('milestone').filter((m) => m.goalId === goalId && !m.done);
  const save = () => {
    if (!title.trim()) return setError('Give the task a name');
    const est = hasEstimate ? estimate : null;
    const base: Task = existing ?? { id: uid(), kind: 'task', title: '', priority: 3, status: 'inbox', due: null, doDate: null, estimate: null, splittable: false, window: 'any', goalId: null, milestoneId: null, completedAt: null, createdAt: nowIso(), history: [{ at: nowIso(), what: 'Created' }] };
    const planned = !!(est || due || doDate || goalId);
    let next: Task = { ...base, title: title.trim(), priority, estimate: est, splittable, due: due || null, doDate: doDate || null, window, goalId: goalId || null, milestoneId: milestoneId || null, status: base.status === 'inbox' && planned ? 'planned' : base.status };
    if (existing) {
      if (existing.due !== next.due) next = logTask(next, `Deadline ${next.due ? `set to ${dateLabel(next.due)}` : 'removed'}`);
      if (existing.estimate !== next.estimate) next = logTask(next, `Estimate ${next.estimate ? `set to ${next.estimate} min` : 'removed'}`);
      if (existing.doDate !== next.doDate) next = logTask(next, `Rescheduled${next.doDate ? ` to ${dateLabel(next.doDate)}` : ''}`);
    }
    store.save(next);
    toast(existing ? 'Task saved' : planned ? 'Task added and scheduled' : 'Added to your inbox');
    onBack();
  };
  return (
    <div className="screen">
      <Back onBack={onBack} />
      <h1>{isNew ? 'New task' : 'Task'}</h1>
      {existing ? (
        <div className="btn-row wrap">
          {existing.status === 'completed' ? <Btn small kind="secondary" onClick={() => store.save(logTask({ ...existing, status: 'planned', completedAt: null }, 'Reopened'))}>Reopen</Btn> : <Btn small onClick={() => { store.save(logTask({ ...existing, status: 'completed', completedAt: nowIso() }, 'Completed')); toast('Done'); }}>Complete</Btn>}
          {existing.status !== 'completed' && existing.status !== 'cancelled' ? <Btn small kind="secondary" onClick={() => store.save(logTask({ ...existing, status: existing.status === 'in_progress' ? 'planned' : 'in_progress' }, existing.status === 'in_progress' ? 'Marked planned' : 'Started'))}>{existing.status === 'in_progress' ? 'Mark planned' : 'Mark in progress'}</Btn> : null}
          {existing.status !== 'cancelled' && existing.status !== 'completed' ? <Btn small kind="secondary" onClick={() => { store.save(logTask({ ...existing, status: 'cancelled' }, 'Cancelled')); toast('Task cancelled', () => store.save(existing)); }}>Cancel task</Btn> : null}
          <ConfirmButton label="Delete" confirmLabel="Delete task" onConfirm={() => { store.remove(existing.id); onBack(); toast('Task deleted', () => store.save(existing)); }} />
        </div>
      ) : null}
      <div className="form">
        <Field label="Task" error={error}><input id="task-title" className="input" autoFocus={isNew} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" maxLength={300} /></Field>
        <Field label="Priority"><Chips value={priority} onChange={setPriority} options={[{ value: 1, label: 'P1 Urgent' }, { value: 2, label: 'P2 High' }, { value: 3, label: 'P3 Normal' }, { value: 4, label: 'P4 Low' }]} /></Field>
        <label className="toggle"><input id="task-has-est" type="checkbox" checked={hasEstimate} onChange={(e) => setHasEstimate(e.target.checked)} /><span><strong>Time estimate</strong><br /><span className="muted small">Needed to fit it into your day.</span></span></label>
        {hasEstimate ? <><Stepper value={estimate} onChange={setEstimate} min={5} max={600} fmt={mins} /><label className="toggle"><input id="task-split" type="checkbox" checked={splittable} onChange={(e) => setSplittable(e.target.checked)} /><span>Can be split across the day</span></label></> : null}
        <div className="grid2">
          <Field label="Deadline"><input id="task-due" className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <Field label="Do it on"><input id="task-do" className="input" type="date" value={doDate} onChange={(e) => setDoDate(e.target.value)} /></Field>
        </div>
        <Field label="Goal"><select id="task-goal" className="input" value={goalId} onChange={(e) => { setGoalId(e.target.value); setMilestoneId(''); }}><option value="">No goal</option>{activeGoals().map((g, i) => <option key={g.id} value={g.id}>{i + 1}. {g.title}</option>)}</select></Field>
        {milestones.length ? <Field label="Milestone"><select id="task-ms" className="input" value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}><option value="">No milestone</option>{milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></Field> : null}
        <Field label="Best time"><Chips value={window} onChange={setWindow} options={[{ value: 'any', label: 'Any time' }, { value: 'morning', label: 'Morning' }, { value: 'afternoon', label: 'Afternoon' }, { value: 'evening', label: 'Evening' }, { value: 'study', label: 'Study hours' }]} /></Field>
        <Btn full onClick={save}>{isNew ? 'Add task' : 'Save changes'}</Btn>
      </div>
      {existing ? (
        <>
          <Section title="Break it down" hint="Smaller steps are easier to start. Each part is scheduled on its own.">
            {parts.map((p, i) => <input key={i} id={`part-${i}`} className="input" placeholder={`Part ${i + 1}`} value={p} onChange={(e) => setParts((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))} />)}
            <div className="btn-row">
              <Btn small kind="ghost" onClick={() => setParts((c) => [...c, ''])}>Add a part</Btn>
              <Btn small kind="secondary" disabled={parts.filter((p) => p.trim()).length < 2} onClick={() => {
                const clean = parts.filter((p) => p.trim());
                const each = existing.estimate ? Math.max(10, Math.round(existing.estimate / clean.length / 5) * 5) : 25;
                store.save(...clean.map((p) => ({ ...existing, id: uid(), title: p.trim(), estimate: each, status: 'planned' as const, completedAt: null, createdAt: nowIso(), history: [{ at: nowIso(), what: `Split from “${existing.title}”` }] })), logTask({ ...existing, status: 'cancelled' }, `Split into ${clean.length} parts`));
                toast(`Split into ${clean.length} smaller tasks`);
                onBack();
              }}>Split</Btn>
            </div>
          </Section>
          <Section title="History">
            <div className="group">{existing.history.map((h, i) => <Row key={i} title={h.what} sub={new Date(h.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} />)}</div>
          </Section>
        </>
      ) : null}
    </div>
  );
}

// ───────────────────────────── Insights ─────────────────────────────

function InsightsTab() {
  useData();
  const nav = useNav();
  const today = todayStr();
  const ws = weekStart(today);
  const blocks = store.all('block').filter((b) => b.date >= ws && b.date <= today && b.type === 'task' && b.status !== 'unplanned' && b.status !== 'skipped');
  const planned = blocks.reduce((s, b) => s + minutesBetween(b.start, b.end), 0);
  const done = blocks.filter((b) => b.status === 'done').reduce((s, b) => s + minutesBetween(b.start, b.end), 0);
  const completed = store.all('task').filter((t) => t.completedAt && t.completedAt.slice(0, 10) >= ws).length;
  const rescheduled = store.all('task').filter((t) => t.history.some((h) => h.at.slice(0, 10) >= ws && /Rescheduled|Moved to tomorrow/.test(h.what))).length;
  const missed = blocks.filter((b) => b.status === 'missed').length;
  const goals = activeGoals();
  const minutesByGoal = (g: Goal) => blocks.filter((b) => b.status === 'done' && b.taskId && store.get<Task>(b.taskId)?.goalId === g.id).reduce((s, b) => s + minutesBetween(b.start, b.end), 0);
  const habits = habitDay(today);
  const empty = !completed && !planned && !goals.length && !habits.length;
  return (
    <div className="screen">
      <header className="head"><div><h1>Insights</h1><p className="muted">This week, from what you actually recorded</p></div></header>
      {empty ? <Empty title="Nothing recorded yet" body="As you complete tasks, follow your plan and log habits, an honest picture of your week builds up here." /> : (
        <>
          <div className="card">
            <div className="strip">
              <Stat value={String(completed)} label="Tasks completed" />
              <Stat value={String(rescheduled)} label="Rescheduled" />
              <Stat value={formatHours(done)} label={`of ${formatHours(planned)} planned`} />
            </div>
            {planned ? <Bar value={done / planned} /> : null}
            {missed ? <p className="muted small">{missed} planned block{missed === 1 ? '' : 's'} didn’t happen. That’s information, not failure: check whether those estimates or times were realistic.</p> : null}
          </div>
          {goals.length ? (
            <Section title="Goals" hint="Progress, and focused time recorded against each goal this week.">
              <div className="group">{goals.map((g, i) => { const p = goalProgressFor(g); const m = minutesByGoal(g); return <Row key={g.id} title={`${i + 1}. ${g.title}`} sub={<><Bar value={p.ratio} />{p.label} · {m ? formatHours(m) : 'no focused time yet'}</>} onClick={() => nav.open({ type: 'goal', id: g.id })} />; })}</div>
              {goals.length > 1 && minutesByGoal(goals[0]!) === 0 && goals.some((g) => minutesByGoal(g) > 0) ? <p className="warn small">Your top priority hasn’t had focused time this week, while others have.</p> : null}
            </Section>
          ) : null}
          <Stage4Insights />
          {habits.length ? (
            <Section title="Habit consistency" hint="Last 30 days. Consistency matters more than streaks.">
              <div className="group">{habits.map(({ habit, c30 }) => <Row key={habit.id} title={habit.name} trail={<span className="num">{c30.rate === null ? '—' : `${Math.round(c30.rate * 100)}%`}</span>} onClick={() => nav.open({ type: 'habit', id: habit.id })} />)}</div>
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}

// ───────────────────────────── Profile ─────────────────────────────

function ProfileTab() {
  useData();
  const toast = useToast();
  const p = store.prefs();
  const set = (patch: Partial<Prefs>) => store.save({ ...p, ...patch });
  const [studyOn, setStudyOn] = useState(!!p.study);
  const nav = useNav();
  const ideas = store.all('note').filter((n) => n.type === 'idea');
  useEffect(() => applyTheme(p.theme), [p.theme]);
  const exportData = async () => {
    const json = JSON.stringify({ format: 'ascend-preview-export', exported_at: nowIso(), records: [...store.records.values()] }, null, 2);
    try {
      const dl = (await (globalThis as { claude?: { use(n: string): Promise<unknown> } }).claude?.use('downloads')) as { save(r: { filename: string; data: string }): Promise<unknown> } | null | undefined;
      if (dl) { await dl.save({ filename: `ascend-export-${todayStr()}.json`, data: json }); return; }
    } catch { /* fall back to clipboard */ }
    try { await navigator.clipboard.writeText(json); toast('Your data was copied to the clipboard as JSON'); } catch { toast('Export isn’t available here'); }
  };
  return (
    <div className="screen">
      <header className="head"><h1>Profile</h1></header>
      <Section title="Personal development">
        <div className="group">{COLLS.map((c) => { const n = store.all('item').filter((i) => i.coll === c.key).length; return <Row key={c.key} title={c.title} sub={c.blurb} trail={n ? <span className="muted small num">{n}</span> : undefined} onClick={() => nav.open({ type: 'coll', id: c.key })} />; })}</div>
      </Section>
      <Section title="You">
        <Field label="Name (for greetings)"><input id="pref-name" className="input" value={p.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} /></Field>
      </Section>
      <Section title="Appearance">
        <Seg value={p.theme} onChange={(v) => set({ theme: v })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </Section>
      <Section title="Planning" hint="ASCEND only plans inside your day, and stops before your free time is used up.">
        <div className="grid2">
          <Field label="Day starts"><input id="pref-start" className="input" type="time" value={p.dayStart} onChange={(e) => e.target.value && e.target.value < p.dayEnd && set({ dayStart: e.target.value })} /></Field>
          <Field label="Day ends"><input id="pref-end" className="input" type="time" value={p.dayEnd} onChange={(e) => e.target.value && e.target.value > p.dayStart && set({ dayEnd: e.target.value })} /></Field>
        </div>
        <Field label="Focus limit per day"><Stepper value={p.maxFocus} onChange={(v) => set({ maxFocus: v })} min={30} max={960} step={30} fmt={mins} /></Field>
        <Field label="Protected free time per day"><Stepper value={p.minFree} onChange={(v) => set({ minFree: v })} min={0} max={720} step={30} fmt={mins} /></Field>
        <Field label="Break after"><Stepper value={p.breakAfter} onChange={(v) => set({ breakAfter: v })} min={25} max={240} fmt={mins} /></Field>
        <Field label="Break length"><Stepper value={p.breakLen} onChange={(v) => set({ breakLen: v })} min={5} max={60} fmt={mins} /></Field>
        <Field label="Buffer around events"><Stepper value={p.buffer} onChange={(v) => set({ buffer: v })} min={0} max={60} fmt={mins} /></Field>
        <label className="toggle"><input id="pref-study" type="checkbox" checked={studyOn} onChange={(e) => { setStudyOn(e.target.checked); set({ study: e.target.checked ? { days: [1, 2, 3, 4, 5], from: '16:00', to: '19:00' } : null }); }} /><span><strong>Study hours</strong><br /><span className="muted small">Tasks marked “Study hours” are planned here first.</span></span></label>
        {p.study ? (
          <>
            <Chips value={p.study.days} onChange={(d) => set({ study: { ...p.study!, days: p.study!.days.includes(d) ? p.study!.days.filter((x) => x !== d) : [...p.study!.days, d] } })} options={DAYS} />
            <div className="grid2">
              <Field label="From"><input id="study-from" className="input" type="time" value={p.study.from} onChange={(e) => e.target.value && set({ study: { ...p.study!, from: e.target.value } })} /></Field>
              <Field label="To"><input id="study-to" className="input" type="time" value={p.study.to} onChange={(e) => e.target.value && set({ study: { ...p.study!, to: e.target.value } })} /></Field>
            </div>
          </>
        ) : null}
      </Section>
      {ideas.length ? (
        <Section title="Ideas captured earlier" hint="New ideas go to the Idea Incubator.">
          <div className="group">{ideas.map((n) => <Row key={n.id} title={n.text} sub={dateLabel(n.createdAt.slice(0, 10))} trail={<button type="button" className="x" aria-label="Delete idea" onClick={() => store.remove(n.id)}>✕</button>} />)}</div>
        </Section>
      ) : null}
      <Section title="Your data">
        <p className="muted small">{store.mode === 'account' ? 'Saved privately to your claude.ai account. Only you can see it.' : store.mode === 'browser' ? 'Saved in this browser only.' : 'Not saved: this browser blocks storage, so data clears when you close the page.'} This browser preview is separate from the mobile app’s data.</p>
        <div className="btn-row wrap">
          <Btn small kind="secondary" onClick={() => void exportData()}>Export my data</Btn>
          <ConfirmButton label="Delete all my data" confirmLabel="Delete everything" onConfirm={() => { store.remove(...[...store.records.keys()]); toast('All data deleted'); }} />
        </div>
      </Section>
    </div>
  );
}

function applyTheme(theme: Prefs['theme']) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

// ───────────────────────────── Shell ─────────────────────────────

type Tab = 'home' | 'goals' | 'planner' | 'insights' | 'profile';
const TABS: { value: Tab; label: string; icon: string }[] = [
  { value: 'home', label: 'Home', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { value: 'goals', label: 'Goals', icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2z' },
  { value: 'planner', label: 'Planner', icon: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm0 4h16M8 2v4m8-4v4' },
  { value: 'insights', label: 'Insights', icon: 'M5 20V10m7 10V4m7 16v-7' },
  { value: 'profile', label: 'Profile', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0' },
];

function App() {
  useData();
  const initialTab = (TABS.find((t) => `#${t.value}` === location.hash)?.value ?? 'home') as Tab;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [route, setRoute] = useState<Route>(null);
  const [sub, setSub] = useState<{ tab: string; n: number } | null>(null);
  const [capture, setCapture] = useState(false);
  const [toastState, setToastState] = useState<{ id: number; msg: string; undo?: () => void } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { applyTheme(store.prefs().theme); }, [store.prefs().theme]);
  useEffect(() => {
    const onHash = () => { const t = TABS.find((x) => `#${x.value}` === location.hash); if (t) { setTab(t.value); setRoute(null); } };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const toast: ToastFn = (msg, undo) => {
    if (timer.current) clearTimeout(timer.current);
    setToastState({ id: Date.now(), msg, undo });
    timer.current = setTimeout(() => setToastState(null), undo ? 5000 : 2600);
  };
  const go = (t: Tab) => { setTab(t); setRoute(null); try { history.replaceState(null, '', `#${t}`); } catch { /* sandboxed */ } window.scrollTo(0, 0); };
  const back = () => setRoute(null);
  const content = route?.type === 'goal' ? <GoalDetail id={route.id} onBack={back} />
    : route?.type === 'project' ? <ProjectDetail id={route.id} onBack={back} />
    : route?.type === 'workout' ? <WorkoutDetail id={route.id} onBack={back} />
    : route?.type === 'skill' ? <SkillDetail id={route.id} onBack={back} />
    : route?.type === 'coll' ? <CollectionScreen key={route.id} id={route.id} onBack={back} />
    : route?.type === 'habit' ? <HabitDetail id={route.id} onBack={back} />
    : route?.type === 'task' ? <TaskDetail key={route.id} id={route.id} onBack={back} />
    : tab === 'home' ? <Home /> : tab === 'goals' ? <GoalsTab /> : tab === 'planner' ? <PlannerTab key={sub?.n ?? 0} initial={sub?.tab} /> : tab === 'insights' ? <InsightsTab /> : <ProfileTab />;
  return (
    <ToastCtx.Provider value={toast}>
      <NavCtx.Provider value={{ open: (r) => { setRoute(r); window.scrollTo(0, 0); }, capture: () => setCapture(true), go: (t, s) => { setSub(s ? { tab: s, n: Date.now() } : null); go(t as Tab); } }}>
        <div className="app">
          {store.error ? <div className="notice warn">{store.error}</div> : null}
          <main>{content}</main>
          <nav className="tabbar" aria-label="Main">
            {TABS.map((t) => (
              <button key={t.value} type="button" className={tab === t.value && !route ? 'on' : ''} aria-current={tab === t.value ? 'page' : undefined} onClick={() => go(t.value)}>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={t.icon} fill="none" stroke="currentColor" strokeWidth={tab === t.value ? 2 : 1.7} strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
          {capture ? <CaptureSheet onClose={() => setCapture(false)} /> : null}
          {toastState ? (
            <div className="toast" role="status" key={toastState.id}>
              <span>{toastState.msg}</span>
              {toastState.undo ? <button type="button" onClick={() => { toastState.undo!(); setToastState(null); }}>Undo</button> : null}
            </div>
          ) : null}
        </div>
      </NavCtx.Provider>
    </ToastCtx.Provider>
  );
}

void store.init();
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
