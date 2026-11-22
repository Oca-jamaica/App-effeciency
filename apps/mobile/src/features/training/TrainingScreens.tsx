import { formatHours } from '@ascend/domain';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Dumbbell, Plus, Trophy, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { useLive, useStore } from '@/data/DataProvider';
import type { Exercise, Skill, Sport, TrainingSession } from '@/data/types';
import { ValidationError } from '@/data/validation';
import { useGoalOptions } from '@/features/shared/options';
import {
  Badge, Button, Card, Checkbox, ChipGroup, DateTimeField, EmptyState, Group, IconButton, ListRow, LoadingState, ProgressBar, Row, Screen, Section,
  SegmentedControl, SelectField, Sheet, Stepper, Text, TextField, ToggleRow, confirm, space, useToast,
} from '@/ui';
import {
  addSet, addStarterExercises, createExercise, createPlan, createSkill, createSport, deletePlan, deleteSet, deleteWorkout, exerciseHistory, finishWorkout,
  listExercises, listPlans, listSkills, listSports, listTraining, listWorkouts, loadWorkout, logTraining, openWorkout, setSkillLevel, skillHistory, startWorkout,
} from './repo';

const SESSION_TYPES = [
  { value: 'technical' as const, label: 'Technical' },
  { value: 'tactical' as const, label: 'Tactical' },
  { value: 'match' as const, label: 'Match' },
  { value: 'conditioning' as const, label: 'Conditioning' },
  { value: 'recovery' as const, label: 'Recovery' },
];

/** Planner → Training: workouts and sport development. */
export function TrainingPane() {
  const [tab, setTab] = useState<'workouts' | 'sport'>('workouts');
  return (
    <View style={{ gap: space.xl }}>
      <SegmentedControl segments={[{ value: 'workouts', label: 'Workouts' }, { value: 'sport', label: 'Sport & skills' }]} value={tab} onChange={setTab} />
      {tab === 'workouts' ? <WorkoutsPane /> : <SportPane />}
    </View>
  );
}

function WorkoutsPane() {
  const store = useStore();
  const toast = useToast();
  const [planSheet, setPlanSheet] = useState(false);
  const data = useLive(
    async (s) => ({ open: await openWorkout(s), recent: await listWorkouts(s, 15), plans: await listPlans(s), exercises: await listExercises(s) }),
    [],
    ['workout_sessions', 'workout_plans', 'workout_plan_items', 'exercises', 'workout_sets'],
  );
  if (data.loading && !data.data) return <LoadingState />;
  const { open, recent = [], plans = [], exercises = [] } = data.data ?? {};
  const fail = (e: unknown) => toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
  const begin = (planId: string | null) => startWorkout(store, planId).then((w) => router.push({ pathname: '/(app)/workout/[id]', params: { id: w.id } })).catch(fail);
  return (
    <>
      {open ? (
        <Card onPress={() => router.push({ pathname: '/(app)/workout/[id]', params: { id: open.id } })} accessibilityLabel={`Continue ${open.title}`}>
          <Text variant="label" tone="accent">In progress</Text>
          <Text variant="heading">{open.title}</Text>
          <Text variant="caption" tone="secondary">Started {new Date(open.started_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}. Tap to continue.</Text>
        </Card>
      ) : (
        <Card>
          <Text variant="subheading">Start a workout</Text>
          {plans.length ? <ChipGroup options={plans.map((p) => ({ value: p.plan.id, label: p.plan.name }))} value={null} onChange={(id) => void begin(id)} /> : null}
          <Button label="Empty workout" icon={Dumbbell} variant={plans.length ? 'secondary' : 'primary'} onPress={() => void begin(null)} />
        </Card>
      )}
      <Section title="Plans" action="New plan" onAction={() => (exercises.length ? setPlanSheet(true) : toast.show('Add some exercises first', { kind: 'info' }))}>
        {plans.length ? (
          <Group>
            {plans.map(({ plan, items }) => (
              <ListRow
                key={plan.id}
                title={plan.name}
                subtitle={items.map((i) => `${i.exercise?.name ?? '?'} ${i.target_sets}×${i.target_reps ?? '–'}`).join(' · ')}
                onLongPress={async () => {
                  if (await confirm({ title: `Delete “${plan.name}”?`, message: 'Past workouts are kept.', confirmLabel: 'Delete', destructive: true })) await deletePlan(store, plan.id);
                }}
              />
            ))}
          </Group>
        ) : (
          <Text variant="callout" tone="secondary">Save routines you repeat, like “Leg day” or “Upper body”.</Text>
        )}
      </Section>
      <Section title="Exercises" action="Add" onAction={() => router.push('/(app)/exercise/new')}>
        {exercises.length ? (
          <Group>
            {exercises.slice(0, 30).map((e) => (
              <ListRow key={e.id} title={e.name} subtitle={[e.muscle_group, e.equipment].filter(Boolean).join(' · ') || null} chevron onPress={() => router.push({ pathname: '/(app)/exercise/[id]', params: { id: e.id } })} />
            ))}
          </Group>
        ) : (
          <EmptyState compact title="No exercises yet" body="Add your own, or start with a common set you can edit." actionLabel="Add common exercises" onAction={() => addStarterExercises(store).then((n) => toast.show(`Added ${n} exercises`)).catch(fail)} />
        )}
      </Section>
      {recent.length ? (
        <Section title="Recent workouts">
          <Group>
            {recent.map((w) => (
              <ListRow
                key={w.id}
                title={w.title}
                subtitle={`${new Date(w.started_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}${w.ended_at ? ` · ${formatHours((Date.parse(w.ended_at) - Date.parse(w.started_at)) / 60_000)}` : ' · in progress'}${w.perceived_effort ? ` · effort ${w.perceived_effort}/10` : ''}`}
                chevron
                onPress={() => router.push({ pathname: '/(app)/workout/[id]', params: { id: w.id } })}
              />
            ))}
          </Group>
        </Section>
      ) : null}
      {planSheet ? <PlanSheet exercises={exercises} onClose={() => setPlanSheet(false)} /> : null}
    </>
  );
}

function PlanSheet({ exercises, onClose }: { exercises: Exercise[]; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [name, setName] = useState('');
  const [items, setItems] = useState<{ exerciseId: string; sets: number; reps: number }[]>([]);
  return (
    <Sheet
      visible
      onClose={onClose}
      title="New plan"
      footer={
        <Button
          label="Save plan"
          onPress={() =>
            createPlan(store, name, items.map((i) => ({ exerciseId: i.exerciseId, sets: i.sets, reps: i.reps, weight: null })))
              .then(() => {
                toast.show('Plan saved');
                onClose();
              })
              .catch((e) => toast.show(e instanceof ValidationError ? e.message : String(e), { kind: 'error' }))
          }
        />
      }
    >
      <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Leg day" autoFocus />
      <Text variant="captionStrong" tone="secondary">Exercises</Text>
      <ChipGroup
        options={exercises.map((e) => ({ value: e.id, label: e.name }))}
        value={items.map((i) => i.exerciseId)}
        onChange={(id) => setItems((cur) => (cur.some((i) => i.exerciseId === id) ? cur.filter((i) => i.exerciseId !== id) : [...cur, { exerciseId: id, sets: 3, reps: 8 }]))}
      />
      {items.map((it, idx) => (
        <View key={it.exerciseId} style={{ gap: space.xs }}>
          <Text variant="bodyStrong">{exercises.find((e) => e.id === it.exerciseId)?.name}</Text>
          <Row>
            <Stepper value={it.sets} onChange={(v) => setItems((cur) => cur.map((x, j) => (j === idx ? { ...x, sets: v } : x)))} min={1} max={10} format={(v) => `${v} sets`} />
            <Stepper value={it.reps} onChange={(v) => setItems((cur) => cur.map((x, j) => (j === idx ? { ...x, reps: v } : x)))} min={1} max={50} format={(v) => `${v} reps`} />
          </Row>
        </View>
      ))}
    </Sheet>
  );
}

/** Logging a workout: pick an exercise, enter reps and weight, see records as they happen. */
export function WorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const toast = useToast();
  const data = useLive(
    async (s) => {
      const detail = await loadWorkout(s, id);
      const exercises = await listExercises(s);
      const plan = detail?.session.plan_id ? (await listPlans(s)).find((p) => p.plan.id === detail.session.plan_id) : null;
      return { detail, exercises, plan };
    },
    [id],
    ['workout_sessions', 'workout_sets', 'exercises', 'workout_plans'],
  );
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [reps, setReps] = useState(8);
  const [weight, setWeight] = useState('');
  const [warmup, setWarmup] = useState(false);
  const [finishing, setFinishing] = useState(false);
  if (data.loading && !data.data) return <LoadingState />;
  const d = data.data?.detail;
  if (!d) return <EmptyState title="This workout no longer exists" actionLabel="Back" onAction={() => router.back()} />;
  const exercises = data.data!.exercises;
  const planned = data.data!.plan?.items ?? [];
  const finished = !!d.session.ended_at;
  const unit = exercises.find((e) => e.id === exerciseId)?.weight_unit ?? 'kg';
  const log = async () => {
    if (!exerciseId) return toast.show('Choose an exercise', { kind: 'info' });
    const w = weight.trim() ? Number(weight.replace(',', '.')) : null;
    try {
      const { records } = await addSet(store, id, exerciseId, { reps, weight: w, isWarmup: warmup });
      if (records.length) toast.show(`New personal record: ${records.map((r) => ({ heaviest: 'heaviest weight', one_rep_max: 'best estimated 1RM', reps: 'most reps' })[r]).join(', ')}`);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
    }
  };
  return (
    <>
      <Stack.Screen options={{ title: d.session.title, headerRight: () => <IconButton icon={Trash2} label="Delete workout" tone="danger" onPress={async () => { if (await confirm({ title: 'Delete this workout?', confirmLabel: 'Delete', destructive: true })) { await deleteWorkout(store, id); router.back(); } }} /> }} />
      <Screen edges="none" footer={!finished ? <Button label="Finish workout" onPress={() => setFinishing(true)} /> : undefined}>
        <Text variant="caption" tone="secondary">
          {new Date(d.session.started_at).toLocaleString(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit' })}
          {d.volume ? ` · volume ${Math.round(d.volume)} ${unit}` : ''}
          {d.session.perceived_effort ? ` · effort ${d.session.perceived_effort}/10` : ''}
        </Text>
        {planned.length && !finished ? (
          <Section title="Plan">
            <ChipGroup options={planned.map((p) => ({ value: p.exercise_id, label: `${p.exercise?.name ?? '?'} ${p.target_sets}×${p.target_reps ?? '–'}` }))} value={exerciseId} onChange={(v) => { setExerciseId(v); const p = planned.find((x) => x.exercise_id === v); if (p?.target_reps) setReps(p.target_reps); }} />
          </Section>
        ) : null}
        {!finished ? (
          <Card>
            <SelectField label="Exercise" value={exerciseId} options={exercises.map((e) => ({ value: e.id, label: e.name }))} onChange={setExerciseId} placeholder="Choose an exercise" />
            <Row style={{ justifyContent: 'space-between' }}>
              <Stepper value={reps} onChange={setReps} min={0} max={100} step={1} format={(v) => `${v} reps`} />
              <View style={{ width: 110 }}>
                <TextField placeholder={unit} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" accessibilityLabel={`Weight in ${unit}`} />
              </View>
            </Row>
            <ToggleRow label="Warm-up set" value={warmup} onChange={setWarmup} />
            <Button label="Log set" icon={Plus} onPress={() => void log()} />
          </Card>
        ) : null}
        {d.groups.length ? (
          d.groups.map((g) => (
            <Section key={g.exercise.id} title={g.exercise.name}>
              <Group>
                {g.sets.map((s) => (
                  <ListRow
                    key={s.id}
                    title={`${s.reps ?? '–'} reps${s.weight !== null ? ` × ${s.weight} ${g.exercise.weight_unit}` : ''}`}
                    subtitle={s.is_warmup ? 'Warm-up' : null}
                    onLongPress={finished ? undefined : () => deleteSet(store, s.id)}
                  />
                ))}
              </Group>
            </Section>
          ))
        ) : (
          <Text variant="callout" tone="secondary">No sets yet.</Text>
        )}
        {d.session.notes ? <Text variant="body" tone="secondary">{d.session.notes}</Text> : null}
      </Screen>
      {finishing ? <FinishWorkoutSheet sessionId={id} onClose={() => setFinishing(false)} /> : null}
    </>
  );
}

function FinishWorkoutSheet({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [effort, setEffort] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  return (
    <Sheet visible onClose={onClose} title="Finish workout" footer={<Button label="Save workout" onPress={() => finishWorkout(store, sessionId, effort, notes).then(() => { toast.show('Workout saved'); onClose(); }).catch((e) => toast.show(String(e), { kind: 'error' }))} />}>
      <Text variant="captionStrong" tone="secondary">How hard was it? (1–10)</Text>
      <ChipGroup options={[3, 5, 7, 8, 9, 10].map((n) => ({ value: n, label: String(n) }))} value={effort} onChange={(v) => setEffort(v === effort ? null : v)} />
      <TextField label="Notes" value={notes} onChangeText={setNotes} multiline minLines={3} />
    </Sheet>
  );
}

export function ExerciseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const toast = useToast();
  const isNew = id === 'new';
  const data = useLive(async (s) => (isNew ? null : { ex: await s.get<Exercise>('exercises', id), history: await exerciseHistory(s, id) }), [id], ['exercises', 'workout_sets', 'workout_sessions']);
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [equipment, setEquipment] = useState('');
  const [unit, setUnit] = useState<'kg' | 'lb'>('kg');
  const [error, setError] = useState<string | null>(null);
  if (isNew) {
    return (
      <Screen
        edges="none"
        keyboard
        footer={<Button label="Add exercise" onPress={() => createExercise(store, { name, muscle_group: group, equipment, weight_unit: unit }).then(() => { toast.show('Exercise added'); router.back(); }).catch((e) => setError(e instanceof ValidationError ? e.message : String(e)))} />}
      >
        <TextField label="Name" value={name} onChangeText={setName} error={error} autoFocus />
        <TextField label="Muscle group" value={group} onChangeText={setGroup} />
        <TextField label="Equipment" value={equipment} onChangeText={setEquipment} />
        <SegmentedControl segments={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} value={unit} onChange={setUnit} />
      </Screen>
    );
  }
  if (!data.data?.ex) return <LoadingState />;
  const { ex, history } = data.data;
  const r = history.records;
  return (
    <>
      <Stack.Screen options={{ title: ex.name }} />
      <Screen edges="none">
        <Section title="Personal records">
          {r.heaviest || r.mostReps ? (
            <Group>
              {r.heaviest ? <ListRow icon={Trophy} title={`Heaviest: ${r.heaviest.weight} ${ex.weight_unit} × ${r.heaviest.reps}`} /> : null}
              {r.bestOneRepMax ? <ListRow icon={Trophy} title={`Best estimated 1RM: ${r.bestOneRepMax.value} ${ex.weight_unit}`} subtitle={`From ${r.bestOneRepMax.weight} × ${r.bestOneRepMax.reps}`} /> : null}
              {r.mostReps ? <ListRow icon={Trophy} title={`Most reps: ${r.mostReps.reps}${r.mostReps.weight ? ` at ${r.mostReps.weight} ${ex.weight_unit}` : ''}`} /> : null}
            </Group>
          ) : (
            <Text variant="callout" tone="secondary">Records appear once you log working sets.</Text>
          )}
        </Section>
        <Section title="History">
          {history.sessions.length ? (
            <Group>
              {history.sessions.map(({ session, sets }) => (
                <ListRow key={session.id} title={new Date(session.started_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} subtitle={sets.filter((s) => !s.is_warmup).map((s) => `${s.reps}×${s.weight ?? 0}`).join('  ')} />
              ))}
            </Group>
          ) : (
            <Text variant="callout" tone="secondary">Not used in a workout yet.</Text>
          )}
        </Section>
      </Screen>
    </>
  );
}

function SportPane() {
  const store = useStore();
  const toast = useToast();
  const [logOpen, setLogOpen] = useState(false);
  const [newSkill, setNewSkill] = useState(false);
  const [sportName, setSportName] = useState('');
  const data = useLive(
    async (s) => ({ sports: await listSports(s), sessions: await listTraining(s, undefined, 20), skills: await listSkills(s) }),
    [],
    ['sports', 'training_sessions', 'training_session_skills', 'skills'],
  );
  if (data.loading && !data.data) return <LoadingState />;
  const { sports = [], sessions = [], skills = [] } = data.data ?? {};
  const sportName_ = (id: string) => sports.find((x) => x.id === id)?.name ?? 'Training';
  if (!sports.length) {
    return (
      <Card>
        <Text variant="subheading">Which sport do you play?</Text>
        <Text variant="callout" tone="secondary">Log training sessions, rate the skills you work on, and see them develop over time.</Text>
        <TextField placeholder="e.g. Football" value={sportName} onChangeText={setSportName} />
        <Button label="Add sport" onPress={() => createSport(store, sportName).then(() => setSportName('')).catch((e) => toast.show(String(e), { kind: 'error' }))} disabled={!sportName.trim()} />
      </Card>
    );
  }
  return (
    <>
      <Button label="Log a training session" icon={Plus} onPress={() => setLogOpen(true)} />
      <Section title="Skills" action="Add skill" onAction={() => setNewSkill(true)} hint="Rate yourself 0–10. Training sessions add ratings over time.">
        {skills.length ? (
          <Group>
            {skills.filter((s) => !s.parent_id).flatMap((s) => [s, ...skills.filter((c) => c.parent_id === s.id)]).map((s) => (
              <View key={s.id}>
                <ListRow title={`${s.parent_id ? '   ' : ''}${s.name}`} subtitle={`Level ${s.level}/10${s.target_level ? ` · target ${s.target_level}` : ''}`} chevron onPress={() => router.push({ pathname: '/(app)/skill/[id]', params: { id: s.id } })} />
                <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm, marginTop: -space.xs }}>
                  <ProgressBar value={s.level / 10} />
                </View>
              </View>
            ))}
          </Group>
        ) : (
          <Text variant="callout" tone="secondary">e.g. Weak foot, first touch, crossing, sprint speed.</Text>
        )}
      </Section>
      <Section title="Recent sessions">
        {sessions.length ? (
          <Group>
            {sessions.map((s) => (
              <ListRow
                key={s.id}
                title={`${sportName_(s.sport_id)} · ${SESSION_TYPES.find((t) => t.value === s.session_type)?.label ?? s.session_type}`}
                subtitle={[new Date(s.started_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }), `${s.duration_minutes} min`, s.performance_rating ? `performance ${s.performance_rating}/10` : null, s.skills.length ? `${s.skills.length} skill${s.skills.length === 1 ? '' : 's'}` : null, s.focus].filter(Boolean).join(' · ')}
              />
            ))}
          </Group>
        ) : (
          <Text variant="callout" tone="secondary">No sessions logged yet.</Text>
        )}
      </Section>
      {logOpen ? <LogTrainingSheet sports={sports} skills={skills} onClose={() => setLogOpen(false)} /> : null}
      {newSkill ? <NewSkillSheet skills={skills} onClose={() => setNewSkill(false)} /> : null}
    </>
  );
}

function LogTrainingSheet({ sports, skills, onClose }: { sports: Sport[]; skills: Skill[]; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const goals = useGoalOptions();
  const [sportId, setSportId] = useState<string>(sports[0]!.id);
  const [type, setType] = useState<TrainingSession['session_type']>('technical');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [minutes, setMinutes] = useState(60);
  const [intensity, setIntensity] = useState<number | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [focus, setFocus] = useState('');
  const [notes, setNotes] = useState('');
  const [goalId, setGoalId] = useState<string | null>(null);
  const [worked, setWorked] = useState<Record<string, number | null>>({});
  return (
    <Sheet
      visible
      onClose={onClose}
      title="Log training"
      footer={
        <Button
          label="Save session"
          onPress={() =>
            logTraining(
              store,
              { sport_id: sportId, session_type: type, started_at: new Date(`${date}T12:00:00`).toISOString(), duration_minutes: minutes, intensity, performance_rating: rating, focus, notes, goal_id: goalId },
              Object.entries(worked).map(([skillId, r]) => ({ skillId, rating: r })),
            )
              .then(() => {
                toast.show('Session logged');
                onClose();
              })
              .catch((e) => toast.show(e instanceof ValidationError ? e.message : String(e), { kind: 'error' }))
          }
        />
      }
    >
      {sports.length > 1 ? <ChipGroup options={sports.map((s) => ({ value: s.id, label: s.name }))} value={sportId} onChange={setSportId} /> : null}
      <ChipGroup options={SESSION_TYPES} value={type} onChange={setType} />
      <DateTimeField label="Date" mode="date" value={date} onChange={setDate} />
      <Stepper value={minutes} onChange={setMinutes} min={5} max={300} step={5} format={(v) => `${v} min`} />
      <Text variant="captionStrong" tone="secondary">Intensity (1–10)</Text>
      <ChipGroup options={[3, 5, 7, 8, 9, 10].map((n) => ({ value: n, label: String(n) }))} value={intensity} onChange={(v) => setIntensity(v === intensity ? null : v)} />
      <Text variant="captionStrong" tone="secondary">How did you perform? (1–10)</Text>
      <ChipGroup options={[3, 5, 6, 7, 8, 9, 10].map((n) => ({ value: n, label: String(n) }))} value={rating} onChange={(v) => setRating(v === rating ? null : v)} />
      {skills.length ? (
        <View style={{ gap: space.xs }}>
          <Text variant="captionStrong" tone="secondary">Skills worked on</Text>
          {skills.map((s) => (
            <Row key={s.id} style={{ justifyContent: 'space-between' }}>
              <Row>
                <Checkbox shape="square" checked={s.id in worked} label={s.name} onToggle={() => setWorked((cur) => { const n = { ...cur }; if (s.id in n) delete n[s.id]; else n[s.id] = 6; return n; })} />
                <Text variant="body">{s.name}</Text>
              </Row>
              {s.id in worked ? <Stepper value={worked[s.id] ?? 6} onChange={(v) => setWorked((cur) => ({ ...cur, [s.id]: v }))} min={1} max={10} step={1} format={(v) => `${v}/10`} /> : null}
            </Row>
          ))}
        </View>
      ) : null}
      <TextField label="Focus" value={focus} onChangeText={setFocus} placeholder="e.g. Crossing on the run" />
      <SelectField label="Development goal" value={goalId} options={goals} onChange={setGoalId} allowClear placeholder="None" />
      <TextField label="Performance notes" value={notes} onChangeText={setNotes} multiline minLines={3} />
    </Sheet>
  );
}

function NewSkillSheet({ skills, onClose }: { skills: Skill[]; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const goals = useGoalOptions();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [level, setLevel] = useState(3);
  const [target, setTarget] = useState(7);
  const [goalId, setGoalId] = useState<string | null>(null);
  return (
    <Sheet visible onClose={onClose} title="New skill" footer={<Button label="Add skill" onPress={() => createSkill(store, { name, parentId, level, targetLevel: target, goalId }).then(() => { toast.show('Skill added'); onClose(); }).catch((e) => toast.show(e instanceof ValidationError ? e.message : String(e), { kind: 'error' }))} />}>
      <TextField label="Skill" value={name} onChangeText={setName} placeholder="e.g. Weak foot" autoFocus />
      {skills.length ? <SelectField label="Part of (optional)" value={parentId} options={skills.filter((s) => !s.parent_id).map((s) => ({ value: s.id, label: s.name }))} onChange={setParentId} allowClear placeholder="Top level" /> : null}
      <Row style={{ justifyContent: 'space-between' }}><Text variant="body">Current level</Text><Stepper value={level} onChange={setLevel} min={0} max={10} step={1} format={(v) => `${v}/10`} /></Row>
      <Row style={{ justifyContent: 'space-between' }}><Text variant="body">Target</Text><Stepper value={target} onChange={setTarget} min={0} max={10} step={1} format={(v) => `${v}/10`} /></Row>
      <SelectField label="Supports goal" value={goalId} options={goals} onChange={setGoalId} allowClear placeholder="None" />
    </Sheet>
  );
}

export function SkillScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const toast = useToast();
  const data = useLive(async (s) => ({ skill: await s.get<Skill>('skills', id), history: await skillHistory(s, id) }), [id], ['skills', 'skill_progress_entries', 'training_session_skills']);
  const [level, setLevel] = useState<number | null>(null);
  const [note, setNote] = useState('');
  if (!data.data?.skill) return <LoadingState />;
  const { skill, history } = data.data;
  const current = level ?? skill.level;
  return (
    <>
      <Stack.Screen options={{ title: skill.name }} />
      <Screen edges="none">
        <Card>
          <Text variant="subheading">Level {skill.level}/10{skill.target_level ? ` · target ${skill.target_level}` : ''}</Text>
          <ProgressBar value={skill.level / 10} height={6} />
          <Row style={{ justifyContent: 'space-between' }}>
            <Stepper value={current} onChange={setLevel} min={0} max={10} step={1} format={(v) => `${v}/10`} />
            <Button label="Update" size="sm" disabled={current === skill.level} onPress={() => setSkillLevel(store, id, current, note).then(() => { setNote(''); setLevel(null); toast.show('Level updated'); }).catch((e) => toast.show(String(e), { kind: 'error' }))} />
          </Row>
          <TextField placeholder="What changed? (optional)" value={note} onChangeText={setNote} />
        </Card>
        <Section title="Progress history">
          {history.length ? (
            <Group>
              {[...history].reverse().map((h, i) => (
                <ListRow key={i} title={h.kind === 'level' ? `Level set to ${h.value}/10` : `Training rating ${h.value}/10`} subtitle={[new Date(h.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }), h.note].filter(Boolean).join(' · ')} trailing={<Badge label={h.kind === 'level' ? 'Self-assessed' : 'Training'} />} />
              ))}
            </Group>
          ) : (
            <Text variant="callout" tone="secondary">Log training sessions that work on this skill to see it develop.</Text>
          )}
        </Section>
      </Screen>
    </>
  );
}
