/* Stage 4 in the browser preview: focus timer, projects, training, social, and personal collections. */
import {
  addDays, formatClock, formatHours, learningProgress, pauseTimer, personalRecords, projectProgress, recordsBrokenBy, resumeTimer, sleepMinutes,
  sleepSummary, stopTimer, suggestedBreakMinutes, timerElapsedMs, timerRemainingMs, upcomingBirthdays, type SetRecord,
} from '../../../packages/domain/src/index.ts';
import {
  nextRank, nowIso, store, todayStr, uid, weekStart,
  type Block, type CollKey, type Exercise, type FocusSession, type FocusType, type Item, type Project, type Skill, type Stage, type Task, type Timer, type Training, type Workout, type WorkoutSet,
} from './store.ts';
import { clock, dateLabel, eventsOn } from './logic.ts';
import { Badge, Bar, Btn, Check, Chips, ConfirmButton, Empty, Field, Row, Section, Seg, Sheet, Stepper, mins, useData, useNav, useToast, type Node } from './ui.tsx';

declare const React: typeof import('react');
const { useState, useEffect } = React;

const num = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const openTasks = () => store.all('task').filter((t) => t.status === 'planned' || t.status === 'in_progress' || t.status === 'inbox').sort((a, b) => a.priority - b.priority);

// ───────────────────────────── Focus ─────────────────────────────

export const FOCUS_TYPES: { value: FocusType; label: string }[] = [
  { value: 'focus', label: 'Focus' },
  { value: 'study', label: 'Study' },
  { value: 'learning', label: 'Learning' },
  { value: 'deep_work', label: 'Deep work' },
];
const typeLabel = (t: FocusType) => FOCUS_TYPES.find((f) => f.value === t)?.label ?? t;

export function getTimer(): Timer | null {
  const t = store.get<Timer>('timer');
  if (!t) return null;
  const s = store.get<FocusSession>(t.sessionId);
  return s && s.status === 'running' ? t : null;
}

/** Starts a timed session. A linked task moves to “in progress”. Returns false if one is already running. */
export function startFocus(type: FocusType, plannedMinutes: number | null, taskId: string | null, block: Block | null = null): boolean {
  if (getTimer()) return false;
  const now = Date.now();
  const id = uid();
  const task = taskId ? store.get<Task>(taskId) : undefined;
  const session: FocusSession = {
    id, kind: 'focus', type, status: 'running', source: 'timer', date: todayStr(), startedAt: new Date(now).toISOString(), seconds: 0, pauseSeconds: 0,
    plannedMinutes, taskId, projectId: task?.projectId ?? null, blockId: block?.id ?? null, quality: null, notes: '',
  };
  const recs: (FocusSession | Timer | Task)[] = [session, { id: 'timer', kind: 'timer', sessionId: id, startedAt: now, pausedAt: null, pausedMs: 0, plannedMinutes }];
  if (task && task.status !== 'in_progress') recs.push({ ...task, status: 'in_progress', history: [{ at: nowIso(), what: 'Started a focus session' }, ...task.history].slice(0, 30) });
  store.save(...recs);
  return true;
}

function finishFocus(quality: number | null, notes: string): FocusSession | null {
  const t = getTimer();
  if (!t) return null;
  const s = store.get<FocusSession>(t.sessionId)!;
  const r = stopTimer(t, Date.now());
  // Under a minute (usually a mis-tap) isn't recorded and doesn't complete a planned block.
  if (r.durationSeconds < 60) {
    store.remove(s.id, 'timer');
    return null;
  }
  const done: FocusSession = { ...s, status: 'completed', seconds: r.durationSeconds, pauseSeconds: r.pauseSeconds, quality, notes: notes.trim() };
  const block = s.blockId ? store.get<Block>(s.blockId) : undefined;
  store.save(done, ...(block && block.status === 'planned' ? [{ ...block, status: 'done' as const }] : []));
  store.remove('timer');
  return done;
}

function discardFocus() {
  const t = getTimer();
  if (!t) return;
  const s = store.get<FocusSession>(t.sessionId)!;
  const r = stopTimer(t, Date.now());
  if (r.durationSeconds < 60) store.remove(s.id, 'timer');
  else {
    store.save({ ...s, status: 'abandoned', seconds: r.durationSeconds, pauseSeconds: r.pauseSeconds });
    store.remove('timer');
  }
}

export function focusMinutes(from: string, to: string): number {
  return Math.round(store.all('focus').filter((s) => s.status === 'completed' && s.date >= from && s.date <= to).reduce((m, s) => m + s.seconds, 0) / 60);
}

export function FocusPane() {
  useData();
  const toast = useToast();
  const today = todayStr();
  const timer = getTimer();
  const [, tick] = useState(0);
  const [type, setType] = useState<FocusType>('study');
  const [planned, setPlanned] = useState<number>(25);
  const [taskId, setTaskId] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [logging, setLogging] = useState(false);
  useEffect(() => {
    if (!timer || timer.pausedAt !== null) return;
    const i = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [timer?.sessionId, timer?.pausedAt]);

  const now = Date.now();
  const session = timer ? store.get<FocusSession>(timer.sessionId) : undefined;
  const linked = session?.taskId ? store.get<Task>(session.taskId) : undefined;
  const remaining = timer ? timerRemainingMs(timer, now) : null;
  const history = store.all('focus').filter((s) => s.status !== 'running').sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 25);
  const todayMin = focusMinutes(today, today);
  const weekMin = focusMinutes(weekStart(today), today);

  return (
    <>
      <div className="card">
        {timer && session ? (
          <>
            <div className="eyebrow">{typeLabel(session.type)}{timer.pausedAt !== null ? ' · paused' : ''}</div>
            <div className="timer num" aria-live="off">{remaining !== null && remaining > 0 ? formatClock(remaining) : formatClock(timerElapsedMs(timer, now))}</div>
            <p className="muted small">
              {linked ? linked.title : 'No task linked'}
              {remaining !== null ? (remaining > 0 ? ` · ${formatClock(timerElapsedMs(timer, now))} focused` : ` · planned ${timer.plannedMinutes} min reached. Take about ${suggestedBreakMinutes(timer.plannedMinutes ?? 25)} minutes off.`) : ''}
            </p>
            {remaining !== null ? <Bar value={Math.min(1, timerElapsedMs(timer, now) / ((timer.plannedMinutes ?? 1) * 60_000))} /> : null}
            <div className="btn-row">
              <Btn small onClick={() => setFinishing(true)}>Finish</Btn>
              {timer.pausedAt === null
                ? <Btn small kind="secondary" onClick={() => store.save({ ...timer, ...pauseTimer(timer, Date.now()) })}>Pause</Btn>
                : <Btn small kind="secondary" onClick={() => store.save({ ...timer, ...resumeTimer(timer, Date.now()) })}>Resume</Btn>}
              <Btn small kind="ghost" onClick={() => { discardFocus(); toast('Session discarded'); }}>Discard</Btn>
            </div>
          </>
        ) : (
          <>
            <div className="eyebrow">Start a session</div>
            <Field label="Type"><Chips value={type} onChange={setType} options={FOCUS_TYPES} /></Field>
            <Field label="Length"><Chips value={planned} onChange={setPlanned} options={[{ value: 25, label: '25 min' }, { value: 50, label: '50 min' }, { value: 90, label: '90 min' }, { value: 0, label: 'Open-ended' }]} /></Field>
            <Field label="Working on (optional)">
              <select id="focus-task" className="input" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">Nothing specific</option>
                {openTasks().map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </Field>
            <Btn full onClick={() => startFocus(type, planned || null, taskId || null)}>Start</Btn>
          </>
        )}
      </div>
      <div className="strip three">
        <Stat value={formatHours(todayMin)} label="Today" />
        <Stat value={formatHours(weekMin)} label="This week" />
        <Stat value={String(store.all('focus').filter((s) => s.status === 'completed' && s.date >= weekStart(today)).length)} label="Sessions" />
      </div>
      <Section title="History" action="Log a session" onAction={() => setLogging(true)} hint="Sessions linked to a task count towards it, so the planner schedules only what’s left.">
        {history.length ? (
          <div className="group">
            {history.map((s) => {
              const t = s.taskId ? store.get<Task>(s.taskId) : undefined;
              return (
                <Row
                  key={s.id}
                  title={<>{typeLabel(s.type)} · {mins(Math.round(s.seconds / 60))}{s.status === 'abandoned' ? <> <Badge>Stopped early</Badge></> : null}</>}
                  sub={[dateLabel(s.date), t?.title, s.quality ? `focus ${s.quality}/5` : null, s.source === 'manual' ? 'logged' : null].filter(Boolean).join(' · ')}
                  trail={<button type="button" className="x" aria-label="Delete session" onClick={() => { store.remove(s.id); toast('Session deleted', () => store.save(s)); }}>✕</button>}
                />
              );
            })}
          </div>
        ) : <p className="muted small">No sessions yet.</p>}
      </Section>
      <Section title="Study timelapses">
        <p className="muted small">Record a timelapse with your phone’s camera, then upload it in the ASCEND mobile app. Videos are stored privately in your account, only you can watch them, and nothing is ever shared automatically. Uploading isn’t available in this browser preview.</p>
      </Section>
      {finishing ? <FinishSheet onClose={() => setFinishing(false)} /> : null}
      {logging ? <LogSessionSheet onClose={() => setLogging(false)} /> : null}
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="stat"><div className="num">{value}</div><div className="muted small">{label}</div></div>;
}

const SCALE = [1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }));

function FinishSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [quality, setQuality] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  return (
    <Sheet title="Finish session" onClose={onClose} footer={<Btn full onClick={() => { const s = finishFocus(quality, notes); onClose(); toast(s ? `${mins(Math.round(s.seconds / 60))} recorded` : 'Sessions under a minute aren’t recorded'); }}>Save session</Btn>}>
      <Field label="How focused were you? (optional)"><Chips value={quality} onChange={(v) => setQuality(quality === v ? null : v)} options={SCALE} /></Field>
      <Field label="Notes (optional)"><textarea id="focus-notes" className="input" rows={2} maxLength={2000} placeholder="What you covered, what got in the way…" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}

function LogSessionSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<FocusType>('study');
  const [date, setDate] = useState(todayStr());
  const [minutes, setMinutes] = useState(45);
  const [taskId, setTaskId] = useState('');
  const save = () => {
    if (date > todayStr()) { toast('Sessions can only be logged for today or earlier'); return; }
    const task = taskId ? store.get<Task>(taskId) : undefined;
    store.save({ id: uid(), kind: 'focus', type, status: 'completed', source: 'manual', date, startedAt: new Date(`${date}T12:00:00`).toISOString(), seconds: minutes * 60, pauseSeconds: 0, plannedMinutes: null, taskId: taskId || null, projectId: task?.projectId ?? null, blockId: null, quality: null, notes: '' });
    toast('Session logged');
    onClose();
  };
  return (
    <Sheet title="Log a session" onClose={onClose} footer={<Btn full onClick={save}>Save</Btn>}>
      <Field label="Type"><Chips value={type} onChange={setType} options={FOCUS_TYPES} /></Field>
      <div className="grid2">
        <Field label="Date"><input id="log-date" className="input" type="date" max={todayStr()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
        <Field label="Length"><Stepper value={minutes} onChange={setMinutes} min={5} max={600} step={5} fmt={mins} /></Field>
      </div>
      <Field label="Task (optional)">
        <select id="log-task" className="input" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
          <option value="">Nothing specific</option>
          {openTasks().map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </Field>
    </Sheet>
  );
}

// ───────────────────────────── Projects & missions ─────────────────────────────

const PROJECT_STATUS: { value: Project['status']; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

function progressOf(p: Project) {
  const stages = store.all('stage').filter((s) => s.projectId === p.id);
  const tasks = store.all('task').filter((t) => t.projectId === p.id);
  return projectProgress({ milestones: [], tasks, stages: stages.map((s) => ({ status: s.done ? 'done' : 'open' })) });
}

export function ProjectList({ onNew }: { onNew: () => void }) {
  useData();
  const nav = useNav();
  const all = store.all('project').sort((a, b) => a.rank - b.rank);
  const open = all.filter((p) => p.status !== 'completed' && p.status !== 'archived');
  const closed = all.filter((p) => p.status === 'completed' || p.status === 'archived');
  if (!all.length) return <Empty title="Projects and missions" body="A project groups stages, tasks and notes around something you’re building. A mission is a short, focused push with a clear objective and deadline." action="Start a project" onAction={onNew} />;
  const row = (p: Project) => {
    const pr = progressOf(p);
    return (
      <Row
        key={p.id}
        title={<>{p.title} {p.type === 'mission' ? <Badge tone="accent">Mission</Badge> : null} {p.status === 'on_hold' ? <Badge>On hold</Badge> : null}</>}
        sub={<><Bar value={pr.ratio} />{pr.stagesTotal && !pr.label.endsWith('stages') ? `Stage ${Math.min(pr.stagesDone + 1, pr.stagesTotal)} of ${pr.stagesTotal} · ` : ''}{pr.label}{p.deadline ? ` · by ${dateLabel(p.deadline)}` : ''}</>}
        onClick={() => nav.open({ type: 'project', id: p.id })}
      />
    );
  };
  return (
    <>
      <div className="group">{open.map(row)}</div>
      {closed.length ? <Section title="Completed & archived"><div className="group">{closed.map(row)}</div></Section> : null}
    </>
  );
}

export function ProjectForm({ project, onClose }: { project?: Project; onClose: () => void }) {
  const toast = useToast();
  const nav = useNav();
  const [type, setType] = useState<Project['type']>(project?.type ?? 'project');
  const [title, setTitle] = useState(project?.title ?? '');
  const [objective, setObjective] = useState(project?.objective ?? '');
  const [deadline, setDeadline] = useState(project?.deadline ?? '');
  const [err, setErr] = useState<Record<string, string>>({});
  const save = () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = 'Give it a name';
    if (type === 'mission' && !objective.trim()) e.objective = 'A mission needs a clear objective';
    if (type === 'mission' && !deadline) e.deadline = 'A mission needs a deadline';
    setErr(e);
    if (Object.keys(e).length) return;
    const rec: Project = project
      ? { ...project, type, title: title.trim(), objective: objective.trim(), deadline: deadline || null }
      : { id: uid(), kind: 'project', type, title: title.trim(), objective: objective.trim(), status: 'active', deadline: deadline || null, summary: '', rank: nextRank(store.all('project')), createdAt: nowIso() };
    store.save(rec);
    toast(project ? 'Saved' : type === 'mission' ? 'Mission started' : 'Project created');
    onClose();
    if (!project) nav.open({ type: 'project', id: rec.id });
  };
  return (
    <Sheet title={project ? 'Edit' : 'New project'} onClose={onClose} footer={<Btn full onClick={save}>Save</Btn>}>
      <Seg value={type} onChange={setType} options={[{ value: 'project', label: 'Project' }, { value: 'mission', label: 'Mission' }]} />
      <Field label="Name" error={err.title}><input id="project-title" className="input" autoFocus maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === 'mission' ? 'Finish my coursework draft' : 'Build my portfolio website'} /></Field>
      <Field label={type === 'mission' ? 'Objective' : 'What is it? (optional)'} error={err.objective}><textarea id="project-objective" className="input" rows={2} maxLength={2000} value={objective} onChange={(e) => setObjective(e.target.value)} /></Field>
      <Field label={type === 'mission' ? 'Deadline' : 'Deadline (optional)'} error={err.deadline}><input id="project-deadline" className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
    </Sheet>
  );
}

export function ProjectDetail({ id, onBack }: { id: string; onBack: () => void }) {
  useData();
  const toast = useToast();
  const nav = useNav();
  const p = store.get<Project>(id);
  const [stage, setStage] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskMin, setTaskMin] = useState(30);
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  if (!p) return <div className="screen"><BackLink onBack={onBack} /><Empty title="Not found" body="This project may have been deleted." /></div>;
  const stages = store.all('stage').filter((s) => s.projectId === id).sort((a, b) => a.rank - b.rank);
  const tasks = store.all('task').filter((t) => t.projectId === id);
  const pr = progressOf(p);
  const focusMin = Math.round(store.all('focus').filter((s) => s.status === 'completed' && (s.projectId === id || (s.taskId && tasks.some((t) => t.id === s.taskId)))).reduce((m, s) => m + s.seconds, 0) / 60);
  const addStage = () => {
    if (!stage.trim()) return;
    store.save({ id: uid(), kind: 'stage', projectId: id, title: stage.trim(), done: false, rank: nextRank(stages) });
    setStage('');
  };
  const addTask = () => {
    if (!taskTitle.trim()) return;
    store.save({ id: uid(), kind: 'task', title: taskTitle.trim(), priority: 3, status: 'planned', due: p.deadline, doDate: null, estimate: taskMin, splittable: taskMin > 60, window: 'any', goalId: null, milestoneId: null, projectId: id, completedAt: null, createdAt: nowIso(), history: [{ at: nowIso(), what: `Created in ${p.title}` }] });
    setTaskTitle('');
    toast('Task added. ASCEND will plan it into your days.');
  };
  return (
    <div className="screen">
      <BackLink onBack={onBack} />
      <header className="head">
        <div>
          <div className="eyebrow">{p.type === 'mission' ? 'Mission' : 'Project'} · {PROJECT_STATUS.find((s) => s.value === p.status)?.label}</div>
          <h1>{p.title}</h1>
          {p.objective ? <p className="muted">{p.objective}</p> : null}
        </div>
      </header>
      <div className="card">
        <Bar value={pr.ratio} />
        <p className="muted small">{pr.label}{pr.stagesTotal && !pr.label.endsWith('stages') ? ` · ${pr.stagesDone} of ${pr.stagesTotal} stages` : ''} · {focusMin ? `${formatHours(focusMin)} focused` : 'no focused time yet'}{p.deadline ? ` · due ${dateLabel(p.deadline)}` : ''}</p>
        {p.status === 'completed' && p.summary ? <p className="small">{p.summary}</p> : null}
      </div>
      <Section title="Stages" hint="The phases of the work, in order.">
        {stages.length ? (
          <div className="group">
            {stages.map((s, i) => (
              <Row key={s.id} lead={<Check checked={s.done} label={`Stage ${i + 1} done`} onChange={() => store.save({ ...s, done: !s.done })} />} title={<span className={s.done ? 'row-title done' : ''}>{i + 1}. {s.title}</span>} trail={<button type="button" className="x" aria-label="Delete stage" onClick={() => { store.remove(s.id); toast('Stage deleted', () => store.save(s)); }}>✕</button>} />
            ))}
          </div>
        ) : null}
        <div className="btn-row"><input id="stage-title" className="input" placeholder="Add a stage, e.g. Research" maxLength={200} value={stage} onChange={(e) => setStage(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addStage()} /><Btn small kind="secondary" onClick={addStage}>Add</Btn></div>
      </Section>
      <Section title="Tasks" hint="Tasks here are scheduled automatically, like any other task.">
        {tasks.length ? (
          <div className="group">
            {tasks.sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed')).map((t) => (
              <Row key={t.id} title={<span className={t.status === 'completed' ? 'row-title done' : ''}>{t.title}</span>} sub={t.estimate ? mins(t.estimate) : undefined} onClick={() => nav.open({ type: 'task', id: t.id })} />
            ))}
          </div>
        ) : null}
        <div className="btn-row"><input id="project-task" className="input" placeholder="Add a task" maxLength={300} value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTask()} /><Btn small kind="secondary" onClick={addTask}>Add</Btn></div>
        <Field label="Estimate for new tasks"><Stepper value={taskMin} onChange={setTaskMin} min={5} max={480} step={5} fmt={mins} /></Field>
      </Section>
      <Section title="Status">
        <Chips value={p.status} onChange={(v) => (v === 'completed' ? setCompleting(true) : store.save({ ...p, status: v }))} options={PROJECT_STATUS} />
        <div className="btn-row wrap">
          <Btn small kind="secondary" onClick={() => setEditing(true)}>Edit</Btn>
          <ConfirmButton label="Delete" confirmLabel={`Delete${tasks.length ? ` (its ${tasks.length} task${tasks.length === 1 ? '' : 's'} are kept)` : ''}`} onConfirm={() => { store.save(...tasks.map((t) => ({ ...t, projectId: null }))); store.remove(id, ...stages.map((s) => s.id)); onBack(); toast('Project deleted'); }} />
        </div>
      </Section>
      {editing ? <ProjectForm project={p} onClose={() => setEditing(false)} /> : null}
      {completing ? <CompleteSheet project={p} onClose={() => setCompleting(false)} /> : null}
    </div>
  );
}

function CompleteSheet({ project, onClose }: { project: Project; onClose: () => void }) {
  const toast = useToast();
  const [summary, setSummary] = useState(project.summary);
  return (
    <Sheet title="Complete" onClose={onClose} footer={<Btn full onClick={() => { store.save({ ...project, status: 'completed', summary: summary.trim() }); toast('Completed. Well done.'); onClose(); }}>Mark complete</Btn>}>
      <Field label="What did you achieve? (optional)" hint="A short record you can look back on."><textarea id="project-summary" className="input" rows={3} maxLength={4000} value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
    </Sheet>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return <button type="button" className="back" onClick={onBack}>‹ Back</button>;
}

// ───────────────────────────── Training ─────────────────────────────

const STARTER_EXERCISES: [string, string][] = [
  ['Squat', 'Legs'], ['Deadlift', 'Back'], ['Bench press', 'Chest'], ['Overhead press', 'Shoulders'], ['Pull-up', 'Back'],
  ['Barbell row', 'Back'], ['Lunge', 'Legs'], ['Push-up', 'Chest'], ['Plank (seconds)', 'Core'], ['Romanian deadlift', 'Legs'],
];

const setsAsRecords = (sets: WorkoutSet[]): SetRecord[] => sets.map((s) => ({ exerciseId: s.exerciseId, sessionId: s.workoutId, reps: s.reps, weight: s.weight, isWarmup: false, completedAt: s.at }));
const volumeOf = (sets: WorkoutSet[]) => sets.reduce((v, s) => v + s.reps * (s.weight ?? 0), 0);

let lastTrainingTab: 'workouts' | 'sport' = 'workouts';
export function TrainingPane() {
  useData();
  const [tab, setTabState] = useState<'workouts' | 'sport'>(lastTrainingTab);
  const setTab = (t: 'workouts' | 'sport') => { lastTrainingTab = t; setTabState(t); };
  return (
    <>
      <Seg value={tab} onChange={setTab} options={[{ value: 'workouts', label: 'Workouts' }, { value: 'sport', label: 'Sport & skills' }]} />
      {tab === 'workouts' ? <Workouts /> : <SportAndSkills />}
    </>
  );
}

function Workouts() {
  const nav = useNav();
  const today = todayStr();
  const workouts = store.all('workout').sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const open = workouts.find((w) => w.status === 'open');
  const start = () => {
    if (open) { nav.open({ type: 'workout', id: open.id }); return; }
    if (!store.all('exercise').length) store.save(...STARTER_EXERCISES.map(([name, muscle]) => ({ id: uid(), kind: 'exercise' as const, name, muscle })));
    const w: Workout = { id: uid(), kind: 'workout', date: today, title: 'Workout', status: 'open', notes: '', startedAt: nowIso() };
    store.save(w);
    nav.open({ type: 'workout', id: w.id });
  };
  const week = workouts.filter((w) => w.date >= weekStart(today) && w.status === 'done').length;
  return (
    <>
      <div className="card">
        <div className="eyebrow">{open ? 'In progress' : 'Gym'}</div>
        <p className="muted small">{open ? `Started ${dateLabel(open.date)}` : `${week} workout${week === 1 ? '' : 's'} this week. Log sets as you go; personal records are spotted automatically.`}</p>
        <Btn full onClick={start}>{open ? 'Continue workout' : 'Start a workout'}</Btn>
      </div>
      <Section title="History">
        {workouts.filter((w) => w.status === 'done').length ? (
          <div className="group">
            {workouts.filter((w) => w.status === 'done').slice(0, 20).map((w) => {
              const sets = store.all('set').filter((s) => s.workoutId === w.id);
              const ex = new Set(sets.map((s) => s.exerciseId)).size;
              return <Row key={w.id} title={w.title} sub={`${dateLabel(w.date)} · ${ex} exercise${ex === 1 ? '' : 's'} · ${sets.length} sets${volumeOf(sets) ? ` · ${Math.round(volumeOf(sets)).toLocaleString()} kg volume` : ''}`} onClick={() => nav.open({ type: 'workout', id: w.id })} />;
            })}
          </div>
        ) : <p className="muted small">Finished workouts appear here.</p>}
      </Section>
      {open ? null : <p className="muted small">To have training planned into your days, add it as a habit (for example Gym, Mon/Wed/Fri, 60 min) or as a recurring training event in the calendar.</p>}
    </>
  );
}

export function WorkoutDetail({ id, onBack }: { id: string; onBack: () => void }) {
  useData();
  const toast = useToast();
  const w = store.get<Workout>(id);
  const exercises = store.all('exercise').sort((a, b) => a.name.localeCompare(b.name));
  const [exerciseId, setExerciseId] = useState(exercises[0]?.id ?? '');
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('8');
  const [newEx, setNewEx] = useState('');
  if (!w) return <div className="screen"><BackLink onBack={onBack} /><Empty title="Not found" body="This workout may have been deleted." /></div>;
  const sets = store.all('set').filter((s) => s.workoutId === id).sort((a, b) => a.at.localeCompare(b.at));
  const byExercise = new Map<string, WorkoutSet[]>();
  for (const s of sets) byExercise.set(s.exerciseId, [...(byExercise.get(s.exerciseId) ?? []), s]);
  const addSet = () => {
    const r = num(reps);
    const kg = num(weight);
    if (!exerciseId) { toast('Choose an exercise'); return; }
    if (r === null || r <= 0 || r > 1000 || !Number.isInteger(r)) { toast('Enter the number of reps'); return; }
    if (kg !== null && (kg < 0 || kg > 1000)) { toast('Enter a weight between 0 and 1000 kg'); return; }
    const previous = store.all('set').filter((s) => s.exerciseId === exerciseId);
    const set: WorkoutSet = { id: uid(), kind: 'set', workoutId: id, exerciseId, date: w.date, weight: kg, reps: r, at: nowIso() };
    const broken = previous.length ? recordsBrokenBy(setsAsRecords(previous), setsAsRecords([set])[0]!) : [];
    store.save(set);
    if (broken.length) toast(`New personal record: ${broken.map((b) => (b === 'heaviest' ? 'heaviest weight' : b === 'one_rep_max' ? 'estimated 1-rep max' : 'most reps')).join(', ')}`);
  };
  const addExercise = () => {
    const name = newEx.trim();
    if (!name) return;
    if (exercises.some((e) => e.name.toLowerCase() === name.toLowerCase())) { toast('You already have that exercise'); return; }
    const e: Exercise = { id: uid(), kind: 'exercise', name, muscle: '' };
    store.save(e);
    setExerciseId(e.id);
    setNewEx('');
  };
  return (
    <div className="screen">
      <BackLink onBack={onBack} />
      <header className="head"><div><div className="eyebrow">{dateLabel(w.date)}{w.status === 'open' ? ' · in progress' : ''}</div><h1>{w.title}</h1></div></header>
      {[...byExercise.entries()].map(([exId, list]) => {
        const ex = store.get<Exercise>(exId);
        const pr = personalRecords(setsAsRecords(store.all('set').filter((s) => s.exerciseId === exId)));
        return (
          <Section key={exId} title={ex?.name ?? 'Exercise'} hint={pr.bestOneRepMax ? `Best estimated 1-rep max: ${pr.bestOneRepMax.value} kg` : undefined}>
            <div className="group">
              {list.map((s, i) => (
                <Row key={s.id} title={<span className="num">Set {i + 1}: {s.weight !== null ? `${s.weight} kg × ` : ''}{s.reps}</span>} trail={w.status === 'open' ? <button type="button" className="x" aria-label="Delete set" onClick={() => store.remove(s.id)}>✕</button> : undefined} />
              ))}
            </div>
          </Section>
        );
      })}
      {w.status === 'open' ? (
        <>
          <Section title="Add a set">
            <Field label="Exercise">
              <select id="set-exercise" className="input" value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}>
                {exercises.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
            <div className="grid2">
              <Field label="Weight (kg, optional)"><input id="set-weight" className="input" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
              <Field label="Reps"><input id="set-reps" className="input" inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value)} /></Field>
            </div>
            <Btn full onClick={addSet}>Add set</Btn>
            <div className="btn-row"><input id="new-exercise" className="input" placeholder="New exercise" maxLength={100} value={newEx} onChange={(e) => setNewEx(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addExercise()} /><Btn small kind="secondary" onClick={addExercise}>Add</Btn></div>
          </Section>
          <div className="btn-row wrap">
            <Btn onClick={() => { store.save({ ...w, status: 'done' }); toast(sets.length ? 'Workout saved' : 'Workout saved with no sets'); onBack(); }}>Finish workout</Btn>
            <ConfirmButton label="Discard" confirmLabel="Discard workout" onConfirm={() => { store.remove(id, ...sets.map((s) => s.id)); onBack(); }} />
          </div>
        </>
      ) : (
        <ConfirmButton label="Delete workout" confirmLabel="Delete workout and its sets" onConfirm={() => { store.remove(id, ...sets.map((s) => s.id)); toast('Workout deleted'); onBack(); }} />
      )}
    </div>
  );
}

function SportAndSkills() {
  const nav = useNav();
  const [logging, setLogging] = useState(false);
  const [newSkill, setNewSkill] = useState(false);
  const training = store.all('training').sort((a, b) => b.date.localeCompare(a.date));
  const skills = store.all('skill').sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div className="btn-row wrap"><Btn small onClick={() => setLogging(true)}>Log training</Btn><Btn small kind="secondary" onClick={() => setNewSkill(true)}>New skill</Btn></div>
      <Section title="Skills" hint="Rate yourself from 0 to 10 and update it as you improve. Each change is kept, so you can see your progress.">
        {skills.length ? (
          <div className="group">
            {skills.map((s) => <Row key={s.id} title={s.name} sub={<><Bar value={s.level / 10} />{s.level}/10{s.target !== null ? ` · target ${s.target}` : ''}{s.area ? ` · ${s.area}` : ''}</>} onClick={() => nav.open({ type: 'skill', id: s.id })} />)}
          </div>
        ) : <p className="muted small">Add skills you’re developing — first touch, weak foot, sprint speed, serve — and link them to training sessions.</p>}
      </Section>
      <Section title="Training log">
        {training.length ? (
          <div className="group">
            {training.slice(0, 25).map((t) => (
              <Row key={t.id} title={`${t.sport} · ${mins(t.minutes)}`} sub={[dateLabel(t.date), `intensity ${t.intensity}/5`, t.focus, t.skillIds.map((id) => store.get<Skill>(id)?.name).filter(Boolean).join(', ')].filter(Boolean).join(' · ')} trail={<button type="button" className="x" aria-label="Delete session" onClick={() => store.remove(t.id)}>✕</button>} />
            ))}
          </div>
        ) : <p className="muted small">No training logged yet.</p>}
      </Section>
      {logging ? <LogTrainingSheet onClose={() => setLogging(false)} /> : null}
      {newSkill ? <SkillForm onClose={() => setNewSkill(false)} /> : null}
    </>
  );
}

function LogTrainingSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const sports = [...new Set(store.all('training').map((t) => t.sport))];
  const [sport, setSport] = useState(sports[0] ?? '');
  const [date, setDate] = useState(todayStr());
  const [minutes, setMinutes] = useState(60);
  const [intensity, setIntensity] = useState(3);
  const [focus, setFocus] = useState('');
  const [notes, setNotes] = useState('');
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const skills = store.all('skill');
  const save = () => {
    if (!sport.trim()) { toast('Which sport or activity?'); return; }
    if (date > todayStr()) { toast('Log sessions that have happened. Plan future ones in the calendar.'); return; }
    const t: Training = { id: uid(), kind: 'training', date, sport: sport.trim(), minutes, intensity, focus: focus.trim(), notes: notes.trim(), skillIds };
    store.save(t);
    toast('Training logged');
    onClose();
  };
  return (
    <Sheet title="Log training" onClose={onClose} footer={<Btn full onClick={save}>Save</Btn>}>
      <Field label="Sport or activity"><input id="training-sport" className="input" list="sport-list" maxLength={80} placeholder="Football" value={sport} onChange={(e) => setSport(e.target.value)} /><datalist id="sport-list">{sports.map((s) => <option key={s} value={s} />)}</datalist></Field>
      <div className="grid2">
        <Field label="Date"><input id="training-date" className="input" type="date" max={todayStr()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
        <Field label="Length"><Stepper value={minutes} onChange={setMinutes} min={5} max={600} step={5} fmt={mins} /></Field>
      </div>
      <Field label="Intensity"><Chips value={intensity} onChange={setIntensity} options={SCALE} /></Field>
      <Field label="Focus (optional)"><input id="training-focus" className="input" maxLength={200} placeholder="Passing under pressure" value={focus} onChange={(e) => setFocus(e.target.value)} /></Field>
      {skills.length ? <Field label="Skills worked on"><Chips value={skillIds} onChange={(id) => setSkillIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))} options={skills.map((s) => ({ value: s.id, label: s.name }))} /></Field> : null}
      <Field label="Notes (optional)"><textarea id="training-notes" className="input" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}

function SkillForm({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [level, setLevel] = useState(3);
  const [target, setTarget] = useState<number | null>(7);
  const save = () => {
    if (!name.trim()) { toast('Name the skill'); return; }
    store.save({ id: uid(), kind: 'skill', name: name.trim(), area: area.trim(), level, target, history: [{ at: nowIso(), level }] });
    toast('Skill added');
    onClose();
  };
  return (
    <Sheet title="New skill" onClose={onClose} footer={<Btn full onClick={save}>Save</Btn>}>
      <Field label="Skill"><input id="skill-name" className="input" autoFocus maxLength={100} placeholder="Weak-foot passing" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Area (optional)"><input id="skill-area" className="input" maxLength={60} placeholder="Football" value={area} onChange={(e) => setArea(e.target.value)} /></Field>
      <Field label="Where you are now (0–10)"><Stepper value={level} onChange={setLevel} min={0} max={10} step={1} fmt={(v) => `${v}/10`} /></Field>
      <Field label="Target (optional)"><Chips value={target} onChange={(v) => setTarget(target === v ? null : v)} options={[5, 6, 7, 8, 9, 10].map((v) => ({ value: v, label: String(v) }))} /></Field>
    </Sheet>
  );
}

export function SkillDetail({ id, onBack }: { id: string; onBack: () => void }) {
  useData();
  const toast = useToast();
  const s = store.get<Skill>(id);
  if (!s) return <div className="screen"><BackLink onBack={onBack} /><Empty title="Not found" body="This skill may have been deleted." /></div>;
  const sessions = store.all('training').filter((t) => t.skillIds.includes(id)).sort((a, b) => b.date.localeCompare(a.date));
  const setLevel = (level: number) => store.save({ ...s, level, history: [{ at: nowIso(), level }, ...s.history].slice(0, 100) });
  return (
    <div className="screen">
      <BackLink onBack={onBack} />
      <header className="head"><div><div className="eyebrow">{s.area || 'Skill'}</div><h1>{s.name}</h1></div></header>
      <div className="card">
        <Bar value={s.level / 10} />
        <Field label="Current level"><Stepper value={s.level} onChange={setLevel} min={0} max={10} step={1} fmt={(v) => `${v}/10`} /></Field>
        <p className="muted small">{s.target !== null ? `Target ${s.target}/10. ` : ''}{sessions.length} training session{sessions.length === 1 ? '' : 's'}, {mins(sessions.reduce((m, t) => m + t.minutes, 0))} in total.</p>
      </div>
      <Section title="Progress">
        <div className="group">{s.history.slice(0, 12).map((h, i) => <Row key={`${h.at}${i}`} title={<span className="num">{h.level}/10</span>} sub={dateLabel(h.at.slice(0, 10))} />)}</div>
      </Section>
      {sessions.length ? <Section title="Sessions"><div className="group">{sessions.slice(0, 15).map((t) => <Row key={t.id} title={`${t.sport} · ${mins(t.minutes)}`} sub={[dateLabel(t.date), t.focus].filter(Boolean).join(' · ')} />)}</div></Section> : null}
      <ConfirmButton label="Delete skill" confirmLabel="Delete skill and its history" onConfirm={() => { store.save(...sessions.map((t) => ({ ...t, skillIds: t.skillIds.filter((x) => x !== id) }))); store.remove(id); toast('Skill deleted'); onBack(); }} />
    </div>
  );
}

// ───────────────────────────── Social ─────────────────────────────

function birthdayParts(v: Record<string, string>) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.birthday ?? '');
  return m ? { birthdayMonth: Number(m[2]), birthdayDay: Number(m[3]), birthYear: v.yearKnown === 'no' ? null : Number(m[1]) } : { birthdayMonth: null, birthdayDay: null, birthYear: null };
}

export function SocialPane({ onNewEvent }: { onNewEvent: () => void }) {
  useData();
  const nav = useNav();
  const today = todayStr();
  const plans: { title: string; date: string; start: number }[] = [];
  for (let i = 0; i < 30; i++) {
    const d = addDays(today, i);
    for (const o of eventsOn(d)) if (o.event.type === 'social') plans.push({ title: o.event.title, date: d, start: o.start });
  }
  const people = store.all('item').filter((i) => i.coll === 'people').map((p) => ({ ...birthdayParts(p.v), p }));
  const birthdays = upcomingBirthdays(people, today, 60);
  const experiences = store.all('item').filter((i) => i.coll === 'experiences' && i.v.status !== 'done').sort((a, b) => (a.v.date || '9999').localeCompare(b.v.date || '9999'));
  return (
    <>
      <Section title="Social plans" action="Add" onAction={onNewEvent} hint="Plans with people go in your calendar, so the scheduler works around them.">
        {plans.length ? <div className="group">{plans.slice(0, 12).map((p, i) => <Row key={i} title={p.title} sub={`${dateLabel(p.date)} · ${clock(p.start)}`} />)}</div> : <p className="muted small">Nothing in the next 30 days.</p>}
      </Section>
      <Section title="Birthdays" action="People" onAction={() => nav.open({ type: 'coll', id: 'people' })}>
        {birthdays.length ? <div className="group">{birthdays.map((b) => <Row key={b.person.p.id} title={b.person.p.v.name ?? ''} sub={`${b.inDays === 0 ? 'Today' : b.inDays === 1 ? 'Tomorrow' : `${dateLabel(b.date)} · in ${b.inDays} days`}${b.turning ? ` · turns ${b.turning}` : ''}`} />)}</div> : <p className="muted small">No birthdays in the next 60 days. Add people with their birthdays to see them here.</p>}
      </Section>
      <Section title="Experiences to have" action="All" onAction={() => nav.open({ type: 'coll', id: 'experiences' })}>
        {experiences.length ? <div className="group">{experiences.slice(0, 8).map((e) => <Row key={e.id} title={e.v.title ?? ''} sub={[e.v.status === 'planned' ? 'Planned' : 'Someday', e.v.date ? dateLabel(e.v.date) : null, e.v.cost].filter(Boolean).join(' · ')} />)}</div> : <p className="muted small">Places to visit, food to try, things to do with friends.</p>}
      </Section>
    </>
  );
}

// ───────────────────────────── Personal collections ─────────────────────────────

type FieldType = 'text' | 'long' | 'date' | 'time' | 'number' | 'select' | 'url' | 'scale';
interface FieldDef { k: string; label: string; t: FieldType; opts?: { value: string; label: string }[]; req?: boolean; ph?: string; hint?: string; max?: number }
interface CollDef {
  key: CollKey; title: string; one: string; blurb: string; fields: FieldDef[];
  head: (v: Record<string, string>) => string; sub: (v: Record<string, string>, today: string) => Node;
  order: (a: Item, b: Item) => number; defaults?: (today: string) => Record<string, string>;
  unique?: string; check?: (v: Record<string, string>) => string | null; filters?: { value: string; label: string; test: (v: Record<string, string>, today: string) => boolean }[];
  summary?: (items: Item[], today: string) => Node;
}

const o = (...pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
const byDateDesc = (k: string) => (a: Item, b: Item) => (b.v[k] ?? '').localeCompare(a.v[k] ?? '') || b.createdAt.localeCompare(a.createdAt);
const newest = (a: Item, b: Item) => b.updatedAt.localeCompare(a.updatedAt);
const clip = (s: string | undefined, n = 80) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? '');
const label = (opts: { value: string; label: string }[], v: string | undefined) => opts.find((x) => x.value === v)?.label ?? '';

const LEARN_TYPES = o(['book', 'Book'], ['course', 'Course'], ['video', 'Video'], ['podcast', 'Podcast'], ['article', 'Article'], ['other', 'Other']);
const LEARN_STATUS = o(['want', 'Want to'], ['in_progress', 'In progress'], ['done', 'Finished']);
const IDEA_STATUS = o(['spark', 'Spark'], ['exploring', 'Exploring'], ['building', 'Building'], ['parked', 'Parked'], ['done', 'Done']);
const EXP_STATUS = o(['wishlist', 'Someday'], ['planned', 'Planned'], ['done', 'Done']);
const VAULT_TYPES = o(['note', 'Note'], ['lesson', 'Lesson'], ['quote', 'Quote'], ['video', 'Video'], ['article', 'Article'], ['research', 'Research']);

export const COLLS: CollDef[] = [
  {
    key: 'journal', title: 'Daily Journal', one: 'entry', blurb: 'One entry per day. Private to you; ASCEND’s assistant can only read it if you allow that in settings.',
    fields: [
      { k: 'date', label: 'Date', t: 'date', req: true }, { k: 'mood', label: 'Mood', t: 'scale' }, { k: 'energy', label: 'Energy', t: 'scale' },
      { k: 'wins', label: 'Wins', t: 'long', ph: 'What went well today?' }, { k: 'lessons', label: 'Lessons', t: 'long' }, { k: 'gratitude', label: 'Grateful for', t: 'long' },
      { k: 'tomorrow', label: 'Tomorrow’s priority', t: 'text' }, { k: 'body', label: 'Anything else', t: 'long' },
    ],
    head: (v) => dateLabel(v.date ?? '', { weekday: 'long', day: 'numeric', month: 'short' }), sub: (v) => [v.mood ? `mood ${v.mood}/5` : '', clip(v.wins || v.body)].filter(Boolean).join(' · '),
    order: byDateDesc('date'), defaults: (t) => ({ date: t }), unique: 'date',
  },
  {
    key: 'decisions', title: 'Decision Journal', one: 'decision', blurb: 'Record important decisions and your reasoning, then review the outcome later.',
    fields: [
      { k: 'title', label: 'Decision', t: 'text', req: true }, { k: 'date', label: 'Decided on', t: 'date' }, { k: 'context', label: 'Context', t: 'long' },
      { k: 'options', label: 'Options considered', t: 'long' }, { k: 'choice', label: 'What I chose', t: 'text' }, { k: 'reasoning', label: 'Why', t: 'long' },
      { k: 'expected', label: 'Expected outcome', t: 'long' }, { k: 'review', label: 'Review on', t: 'date' }, { k: 'outcome', label: 'What actually happened', t: 'long' },
      { k: 'verdict', label: 'Looking back', t: 'select', opts: o(['good', 'Good call'], ['mixed', 'Mixed'], ['different', 'Would choose differently']) },
    ],
    head: (v) => v.title ?? '', sub: (v, today) => [v.date ? dateLabel(v.date) : '', v.review && !v.outcome ? (v.review <= today ? 'ready to review' : `review ${dateLabel(v.review)}`) : '', v.verdict ? label(o(['good', 'Good call'], ['mixed', 'Mixed'], ['different', 'Would choose differently']), v.verdict) : ''].filter(Boolean).join(' · '),
    order: byDateDesc('date'), defaults: (t) => ({ date: t }),
    filters: [{ value: 'review', label: 'To review', test: (v, t) => !!v.review && v.review <= t && !v.outcome }],
  },
  {
    key: 'learning', title: 'Reading & Learning', one: 'item', blurb: 'Books, courses and videos, with progress and what you took from them.',
    fields: [
      { k: 'title', label: 'Title', t: 'text', req: true }, { k: 'type', label: 'Type', t: 'select', opts: LEARN_TYPES }, { k: 'status', label: 'Status', t: 'select', opts: LEARN_STATUS },
      { k: 'current', label: 'Progress', t: 'number' }, { k: 'total', label: 'Out of', t: 'number' }, { k: 'unit', label: 'Measured in', t: 'select', opts: o(['pages', 'Pages'], ['chapters', 'Chapters'], ['lessons', 'Lessons'], ['percent', 'Percent']) },
      { k: 'url', label: 'Link', t: 'url' }, { k: 'takeaways', label: 'Key takeaways', t: 'long' },
    ],
    head: (v) => v.title ?? '',
    sub: (v) => { const p = learningProgress(num(v.current ?? ''), num(v.total ?? ''), v.unit || 'pages'); return <><Bar value={p.ratio} />{[label(LEARN_TYPES, v.type), label(LEARN_STATUS, v.status), p.label].filter(Boolean).join(' · ')}</>; },
    order: newest, defaults: () => ({ type: 'book', status: 'in_progress', unit: 'pages' }),
    check: (v) => (num(v.current ?? '') !== null && num(v.current ?? '')! < 0 ? 'Progress can’t be negative' : null),
    filters: [{ value: 'active', label: 'In progress', test: (v) => v.status === 'in_progress' }, { value: 'want', label: 'Want to', test: (v) => v.status === 'want' }],
  },
  {
    key: 'vault', title: 'Knowledge Vault', one: 'note', blurb: 'Notes, lessons, quotes, videos and research you want to keep and find again.',
    fields: [
      { k: 'title', label: 'Title', t: 'text', req: true }, { k: 'type', label: 'Type', t: 'select', opts: VAULT_TYPES }, { k: 'url', label: 'Link', t: 'url' },
      { k: 'content', label: 'Content', t: 'long', max: 20000 }, { k: 'tags', label: 'Tags', t: 'text', hint: 'Separate with commas' },
    ],
    head: (v) => v.title ?? '', sub: (v) => [label(VAULT_TYPES, v.type), v.tags, clip(v.content, 60)].filter(Boolean).join(' · '), order: newest, defaults: () => ({ type: 'note' }),
  },
  {
    key: 'ideas', title: 'Idea Incubator', one: 'idea', blurb: 'Capture ideas quickly, then develop the promising ones.',
    fields: [
      { k: 'title', label: 'Idea', t: 'text', req: true }, { k: 'status', label: 'Stage', t: 'select', opts: IDEA_STATUS }, { k: 'problem', label: 'What problem does it solve?', t: 'long' },
      { k: 'notes', label: 'Notes', t: 'long' }, { k: 'next', label: 'Next small step', t: 'text' },
    ],
    head: (v) => v.title ?? '', sub: (v) => [label(IDEA_STATUS, v.status), v.next ? `next: ${clip(v.next, 50)}` : ''].filter(Boolean).join(' · '), order: newest, defaults: () => ({ status: 'spark' }),
  },
  {
    key: 'people', title: 'People & birthdays', one: 'person', blurb: 'The people who matter to you, their birthdays, and when you last caught up.',
    fields: [
      { k: 'name', label: 'Name', t: 'text', req: true }, { k: 'relationship', label: 'Relationship', t: 'select', opts: o(['friend', 'Friend'], ['family', 'Family'], ['teammate', 'Teammate'], ['classmate', 'Classmate'], ['colleague', 'Colleague'], ['mentor', 'Mentor'], ['other', 'Other']) },
      { k: 'birthday', label: 'Birthday', t: 'date' }, { k: 'yearKnown', label: 'Birth year known?', t: 'select', opts: o(['yes', 'Yes'], ['no', 'No, ignore the year']) },
      { k: 'lastContact', label: 'Last caught up', t: 'date' }, { k: 'notes', label: 'Notes', t: 'long', ph: 'Gift ideas, things to ask about…' },
    ],
    head: (v) => v.name ?? '',
    sub: (v, today) => { const b = upcomingBirthdays([birthdayParts(v)], today, 366)[0]; return [b ? (b.inDays === 0 ? 'Birthday today' : `birthday in ${b.inDays} days`) : '', v.lastContact ? `caught up ${dateLabel(v.lastContact)}` : ''].filter(Boolean).join(' · '); },
    order: (a, b) => (a.v.name ?? '').localeCompare(b.v.name ?? ''), defaults: () => ({ yearKnown: 'yes' }),
  },
  {
    key: 'experiences', title: 'Experiences', one: 'experience', blurb: 'Places to visit, food to try and things to do, before and after.',
    fields: [
      { k: 'title', label: 'Experience', t: 'text', req: true }, { k: 'status', label: 'Status', t: 'select', opts: EXP_STATUS },
      { k: 'category', label: 'Kind', t: 'select', opts: o(['place', 'Place'], ['food', 'Food'], ['event', 'Event'], ['adventure', 'Adventure'], ['culture', 'Culture'], ['other', 'Other']) },
      { k: 'date', label: 'Planned for', t: 'date' }, { k: 'completed', label: 'Done on', t: 'date' }, { k: 'cost', label: 'Rough cost', t: 'text' },
      { k: 'notes', label: 'Notes', t: 'long' }, { k: 'reflection', label: 'How was it?', t: 'long' },
    ],
    head: (v) => v.title ?? '', sub: (v) => [label(EXP_STATUS, v.status), v.status === 'done' && v.completed ? dateLabel(v.completed) : v.date ? dateLabel(v.date) : '', v.cost].filter(Boolean).join(' · '),
    order: (a, b) => Number(a.v.status === 'done') - Number(b.v.status === 'done') || newest(a, b), defaults: () => ({ status: 'wishlist', category: 'place' }),
    check: (v) => (v.status === 'done' && !v.completed ? 'Add the date you did it' : null),
    filters: [{ value: 'todo', label: 'To do', test: (v) => v.status !== 'done' }, { value: 'done', label: 'Done', test: (v) => v.status === 'done' }],
  },
  {
    key: 'sleep', title: 'Sleep & Recovery', one: 'night', blurb: 'Optional, simple, and private: how long you slept and how you feel.',
    fields: [
      { k: 'date', label: 'Morning of', t: 'date', req: true }, { k: 'bed', label: 'Went to bed', t: 'time' }, { k: 'wake', label: 'Woke up', t: 'time' },
      { k: 'energy', label: 'Energy', t: 'scale' }, { k: 'recovery', label: 'Recovery', t: 'scale', hint: 'How rested your body feels.' }, { k: 'notes', label: 'Notes', t: 'long' },
    ],
    head: (v) => dateLabel(v.date ?? ''),
    sub: (v) => { const m = v.bed && v.wake ? sleepMinutes(v.bed, v.wake) : null; return [m ? `${Math.floor(m / 60)}h ${m % 60}m` : '', v.energy ? `energy ${v.energy}/5` : '', v.recovery ? `recovery ${v.recovery}/5` : ''].filter(Boolean).join(' · '); },
    order: byDateDesc('date'), defaults: (t) => ({ date: t }), unique: 'date',
    summary: (items, today) => {
      const s = sleepSummary(items.map((i) => ({ sleepDate: i.v.date ?? '', minutes: i.v.bed && i.v.wake ? sleepMinutes(i.v.bed, i.v.wake) : null, energy: num(i.v.energy ?? '') })), today, 14);
      if (!s.nights) return null;
      return (
        <div className="card">
          <div className="eyebrow">Last 14 days</div>
          <p className="small">{s.averageMinutes !== null ? `Average ${Math.floor(s.averageMinutes / 60)}h ${Math.round(s.averageMinutes % 60)}m over ${s.nights} night${s.nights === 1 ? '' : 's'}` : `${s.nights} nights logged`}{s.averageEnergy !== null ? ` · energy ${s.averageEnergy.toFixed(1)}/5` : ''}.</p>
          {s.energyDifferenceWithSevenHours !== null && Math.abs(s.energyDifferenceWithSevenHours) >= 0.5 ? <p className="muted small">Your energy was {Math.abs(s.energyDifferenceWithSevenHours).toFixed(1)} points {s.energyDifferenceWithSevenHours > 0 ? 'higher' : 'lower'} after nights of 7 hours or more. A pattern to notice, not a rule.</p> : null}
        </div>
      );
    },
  },
];

export const collDef = (key: string) => COLLS.find((c) => c.key === key);

export function CollectionScreen({ id, onBack }: { id: string; onBack: () => void }) {
  useData();
  const toast = useToast();
  const def = collDef(id);
  const today = todayStr();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  if (!def) return <div className="screen"><BackLink onBack={onBack} /><Empty title="Not found" body="This section doesn’t exist." /></div>;
  const all = store.all('item').filter((i) => i.coll === def.key);
  const q = query.trim().toLowerCase();
  const f = def.filters?.find((x) => x.value === filter);
  const items = all.filter((i) => (!f || f.test(i.v, today)) && (!q || Object.values(i.v).some((x) => x.toLowerCase().includes(q)))).sort(def.order);
  return (
    <div className="screen">
      <BackLink onBack={onBack} />
      <header className="head">
        <div><h1>{def.title}</h1><p className="muted">{def.blurb}</p></div>
        <button type="button" className="plus" aria-label={`New ${def.one}`} onClick={() => setEditing('new')}>+</button>
      </header>
      {def.summary?.(all, today) ?? null}
      {all.length > 4 ? <input id="coll-search" className="input" type="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} /> : null}
      {def.filters && all.length ? <Chips value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, ...def.filters.map(({ value, label: l }) => ({ value, label: l }))]} /> : null}
      {items.length ? (
        <div className="group">{items.map((i) => <Row key={i.id} title={def.head(i.v)} sub={def.sub(i.v, today) || undefined} onClick={() => setEditing(i)} />)}</div>
      ) : all.length ? <p className="muted small">Nothing matches.</p> : (
        <Empty title={`No ${def.one === 'entry' ? 'entries' : `${def.one}s`} yet`} body={def.blurb} action={`Add ${/^[aeiou]/.test(def.one) ? 'an' : 'a'} ${def.one}`} onAction={() => setEditing('new')} />
      )}
      {editing ? <ItemForm def={def} item={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onDeleted={(i) => toast('Deleted', () => store.save(i))} /> : null}
    </div>
  );
}

function ItemForm({ def, item, onClose, onDeleted }: { def: CollDef; item?: Item; onClose: () => void; onDeleted: (i: Item) => void }) {
  const toast = useToast();
  const today = todayStr();
  const [v, setV] = useState<Record<string, string>>(item?.v ?? def.defaults?.(today) ?? {});
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, val: string) => setV((cur) => ({ ...cur, [k]: val }));
  const save = () => {
    const clean: Record<string, string> = {};
    for (const fd of def.fields) {
      const raw = (v[fd.k] ?? '').trim();
      if (fd.req && !raw) { setErr(`${fd.label} is required`); return; }
      if (raw.length > (fd.max ?? (fd.t === 'long' ? 5000 : 300))) { setErr(`${fd.label} is too long`); return; }
      if (fd.t === 'url' && raw && !/^https?:\/\/\S+$/i.test(raw)) { setErr('Links must start with http:// or https://'); return; }
      if (fd.t === 'number' && raw && num(raw) === null) { setErr(`${fd.label} must be a number`); return; }
      if (raw) clean[fd.k] = raw;
    }
    const problem = def.check?.(clean);
    if (problem) { setErr(problem); return; }
    if (def.unique && store.all('item').some((i) => i.coll === def.key && i.id !== item?.id && i.v[def.unique!] === clean[def.unique!])) {
      setErr(`You already have ${def.one === 'entry' ? 'an entry' : `a ${def.one}`} for ${dateLabel(clean[def.unique!] ?? '')}. Open it from the list instead.`);
      return;
    }
    store.save(item ? { ...item, v: clean, updatedAt: nowIso() } : { id: uid(), kind: 'item', coll: def.key, v: clean, createdAt: nowIso(), updatedAt: nowIso() });
    toast('Saved');
    onClose();
  };
  return (
    <Sheet title={item ? def.head(item.v) || def.title : `New ${def.one}`} onClose={onClose} footer={<div className="btn-row wrap"><Btn onClick={save}>Save</Btn>{item ? <ConfirmButton label="Delete" confirmLabel={`Delete ${def.one}`} onConfirm={() => { store.remove(item.id); onDeleted(item); onClose(); }} /> : null}</div>}>
      {err ? <p className="warn small" role="alert">{err}</p> : null}
      {def.fields.map((fd) => {
        const id = `f-${def.key}-${fd.k}`;
        const val = v[fd.k] ?? '';
        const input =
          fd.t === 'long' ? <textarea id={id} className="input" rows={3} placeholder={fd.ph} value={val} onChange={(e) => set(fd.k, e.target.value)} />
          : fd.t === 'select' ? <select id={id} className="input" value={val} onChange={(e) => set(fd.k, e.target.value)}><option value="">—</option>{fd.opts!.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
          : fd.t === 'scale' ? <Chips value={val} onChange={(x) => set(fd.k, val === x ? '' : x)} options={['1', '2', '3', '4', '5'].map((x) => ({ value: x, label: x }))} />
          : <input id={id} className="input" type={fd.t === 'number' ? 'text' : fd.t === 'url' ? 'url' : fd.t} inputMode={fd.t === 'number' ? 'decimal' : undefined} placeholder={fd.ph} value={val} onChange={(e) => set(fd.k, e.target.value)} />;
        return <Field key={fd.k} label={fd.label} hint={fd.hint ?? (fd.t === 'scale' ? '1 is low, 5 is high' : undefined)}>{input}</Field>;
      })}
    </Sheet>
  );
}

// ───────────────────────────── Insights additions ─────────────────────────────

export function Stage4Insights() {
  const today = todayStr();
  const ws = weekStart(today);
  const focusWeek = focusMinutes(ws, today);
  const training = store.all('training').filter((t) => t.date >= ws && t.date <= today);
  const workouts = store.all('workout').filter((w) => w.status === 'done' && w.date >= ws);
  const learning = store.all('item').filter((i) => i.coll === 'learning' && i.v.status === 'in_progress');
  const projects = store.all('project').filter((p) => p.status === 'active');
  if (!focusWeek && !training.length && !workouts.length && !learning.length && !projects.length) return null;
  return (
    <Section title="Development this week" hint="From sessions you recorded.">
      <div className="card">
        <div className="strip">
          <Stat value={formatHours(focusWeek)} label="Focused" />
          <Stat value={String(workouts.length)} label="Workouts" />
          <Stat value={mins(training.reduce((m, t) => m + t.minutes, 0))} label="Training" />
        </div>
      </div>
      {projects.length ? <div className="group">{projects.map((p) => { const pr = progressOf(p); return <Row key={p.id} title={p.title} sub={<><Bar value={pr.ratio} />{pr.label}</>} />; })}</div> : null}
    </Section>
  );
}

/** Clearly-marked example data for Stage 4 sections, added alongside the core examples. */
export function stage4Examples(today: string, taskIds: string[]) {
  const ex = { example: true as const };
  const d = (n: number) => addDays(today, n);
  const p1 = uid();
  const skill1 = uid(), skill2 = uid();
  const exercises = STARTER_EXERCISES.slice(0, 4).map(([name, muscle]) => ({ id: uid(), kind: 'exercise' as const, name, muscle, ...ex }));
  const w1 = uid();
  const item = (coll: CollKey, v: Record<string, string>): Item => ({ id: uid(), kind: 'item', coll, v, createdAt: nowIso(), updatedAt: nowIso(), ...ex });
  const birthday = `2008-${d(9).slice(5)}`;
  return [
    { id: p1, kind: 'project' as const, type: 'mission' as const, title: 'Coursework draft in 3 weeks', objective: 'A complete first draft of my History coursework, ready for feedback.', status: 'active' as const, deadline: d(21), summary: '', rank: 1, createdAt: nowIso(), ...ex },
    ...['Research and sources', 'Plan the argument', 'Write the draft', 'Check and submit'].map((title, i): Stage => ({ id: uid(), kind: 'stage', projectId: p1, title, done: i === 0, rank: i + 1, ...ex })),
    ...([['Outline the three main arguments', 45], ['Write the introduction', 60]] as const).map(([title, estimate]): Task => ({ id: uid(), kind: 'task', title, priority: 2, status: 'planned', due: d(21), doDate: null, estimate, splittable: estimate > 50, window: 'any', goalId: null, milestoneId: null, projectId: p1, completedAt: null, createdAt: nowIso(), history: [{ at: nowIso(), what: 'Created' }], ...ex })),
    ...exercises,
    { id: w1, kind: 'workout' as const, date: d(-3), title: 'Lower body', status: 'done' as const, notes: '', startedAt: new Date(Date.now() - 3 * 86400_000).toISOString(), ...ex },
    ...[[60, 8], [70, 6], [75, 5]].map(([kg, reps], i): WorkoutSet => ({ id: uid(), kind: 'set', workoutId: w1, exerciseId: exercises[0]!.id, date: d(-3), weight: kg!, reps: reps!, at: new Date(Date.now() - 3 * 86400_000 + i * 180_000).toISOString(), ...ex })),
    { id: skill1, kind: 'skill' as const, name: 'Weak-foot passing', area: 'Football', level: 4, target: 7, history: [{ at: nowIso(), level: 4 }, { at: new Date(Date.now() - 20 * 86400_000).toISOString(), level: 3 }], ...ex },
    { id: skill2, kind: 'skill' as const, name: 'First touch', area: 'Football', level: 6, target: 8, history: [{ at: nowIso(), level: 6 }], ...ex },
    { id: uid(), kind: 'training' as const, date: d(-2), sport: 'Football', minutes: 90, intensity: 4, focus: 'Passing under pressure', notes: '', skillIds: [skill1, skill2], ...ex },
    { id: uid(), kind: 'focus' as const, type: 'study' as const, status: 'completed' as const, source: 'timer' as const, date: d(-1), startedAt: new Date(Date.now() - 86400_000).toISOString(), seconds: 50 * 60, pauseSeconds: 0, plannedMinutes: 50, taskId: taskIds[0] ?? null, projectId: null, blockId: null, quality: 4, notes: '', ...ex },
    item('learning', { title: 'Atomic Habits', type: 'book', status: 'in_progress', current: '112', total: '320', unit: 'pages' }),
    item('people', { name: 'Sam', relationship: 'friend', birthday, yearKnown: 'yes' }),
    item('experiences', { title: 'Try the new ramen place', status: 'planned', category: 'food', date: d(5), cost: '£15' }),
    item('ideas', { title: 'Revision flashcards from my notes', status: 'exploring', next: 'Sketch how it would work' }),
    item('sleep', { date: d(-1), bed: '23:10', wake: '07:00', energy: '3' }),
    item('sleep', { date: today, bed: '22:30', wake: '07:00', energy: '4' }),
  ];
}

