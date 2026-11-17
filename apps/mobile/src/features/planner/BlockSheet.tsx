import { addDays, localToUtc, utcToLocalMinutes } from '@ascend/domain';
import { router } from 'expo-router';
import { CalendarArrowUp, Check, Clock, ExternalLink, Lock, LockOpen, Scissors, SkipForward, Timer, Trash2, Undo2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useStore } from '@/data/DataProvider';
import type { ScheduleBlock } from '@/data/types';
import { cancelTask, completeTask } from '@/features/tasks/repo';
import { setHabitLog } from '@/features/habits/repo';
import { Button, DateTimeField, Group, ListRow, Sheet, Stepper, Text, confirm, space, useToast } from '@/ui';
import {
  describeSlot,
  missedOptions,
  moveBlock,
  rescheduleMissedToDay,
  rescheduleMissedToSlot,
  resizeBlock,
  setBlockLocked,
  setBlockStatus,
  unplanBlock,
  type MissedOptions,
} from './schedule';
import { clock } from './Timeline';

export function BlockSheet({ block, onClose, timeZone, today }: { block: ScheduleBlock | null; onClose: () => void; timeZone: string; today: string }) {
  const store = useStore();
  const toast = useToast();
  const [mode, setMode] = useState<'menu' | 'move' | 'resize'>('menu');
  const [missed, setMissed] = useState<MissedOptions | null>(null);
  const [time, setTime] = useState<number>(9 * 60);
  const [length, setLength] = useState(30);

  useEffect(() => {
    setMode('menu');
    setMissed(null);
    if (!block) return;
    setTime(utcToLocalMinutes(Date.parse(block.starts_at), timeZone));
    setLength(Math.round((Date.parse(block.ends_at) - Date.parse(block.starts_at)) / 60_000));
    if (block.status === 'missed') {
      missedOptions(store, block.id, Date.now())
        .then(setMissed)
        .catch(() => setMissed(null));
    }
  }, [block, store, timeZone]);

  if (!block) return null;
  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      toast.show(message);
      onClose();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
    }
  };
  const isWork = block.kind === 'task' || block.kind === 'habit';
  const range = `${clock(Date.parse(block.starts_at), timeZone)}–${clock(Date.parse(block.ends_at), timeZone)}`;

  const markDone = () =>
    run(async () => {
      if (block.task_id) await completeTask(store, block.task_id, today);
      else if (block.habit_id) await setHabitLog(store, block.habit_id, block.block_date, 'done');
      await setBlockStatus(store, block.id, 'done');
    }, 'Done. Nice work.');

  return (
    <Sheet visible onClose={onClose} title={block.title}>
      <Text variant="callout" tone="secondary">
        {range}
        {block.reason ? ` · ${block.reason}` : ''}
      </Text>

      {mode === 'move' ? (
        <View style={{ gap: space.md }}>
          <DateTimeField label="New start time" mode="time" value={time} onChange={setTime} />
          <Button
            label="Move here"
            onPress={() => run(() => moveBlock(store, block.id, localToUtc(block.block_date, time, timeZone)), 'Moved. The rest of your day adjusts around it.')}
          />
          <Button label="Back" variant="ghost" onPress={() => setMode('menu')} />
        </View>
      ) : mode === 'resize' ? (
        <View style={{ gap: space.md, alignItems: 'center' }}>
          <Stepper value={length} onChange={setLength} min={5} max={480} step={5} format={(v) => `${v} min`} />
          {block.task_id ? (
            <Button
              label="Change and update the task’s estimate"
              onPress={() => run(() => resizeBlock(store, block.id, length, true), 'Length and estimate updated')}
              fullWidth
            />
          ) : null}
          <Button label="Change this block only" variant="secondary" onPress={() => run(() => resizeBlock(store, block.id, length, false), 'Length updated')} fullWidth />
          <Button label="Back" variant="ghost" onPress={() => setMode('menu')} />
        </View>
      ) : (
        <>
          {block.status === 'missed' ? (
            <View style={{ gap: space.sm }}>
              <Text variant="subheading">This didn’t happen. What would help?</Text>
              <Group>
                {missed?.laterToday ? (
                  <ListRow
                    icon={Clock}
                    title={`Later today, ${describeSlot(missed.laterToday, timeZone)}`}
                    onPress={() => run(() => rescheduleMissedToSlot(store, block.id, missed.laterToday!), 'Rescheduled for later today')}
                  />
                ) : null}
                <ListRow
                  icon={CalendarArrowUp}
                  title={missed?.tomorrow ? `Tomorrow, ${describeSlot(missed.tomorrow, timeZone)}` : 'Tomorrow'}
                  subtitle="It will be planned into tomorrow’s best free slot"
                  onPress={() => run(() => rescheduleMissedToDay(store, block.id, addDays(block.block_date, 1)), 'Moved to tomorrow')}
                />
                {block.task_id ? (
                  <ListRow
                    icon={Timer}
                    title={`Shorten to ${missed?.shortenTo ?? 15} minutes`}
                    subtitle="Do a smaller version; the rest stays on the task"
                    onPress={() =>
                      run(async () => {
                        await resizeBlock(store, block.id, missed?.shortenTo ?? 15, false);
                        if (missed?.laterToday) await rescheduleMissedToSlot(store, block.id, { start: missed.laterToday.start, end: missed.laterToday.start + (missed.shortenTo ?? 15) * 60_000 });
                        else await rescheduleMissedToDay(store, block.id, addDays(block.block_date, 1));
                      }, 'Shortened and rescheduled')
                    }
                  />
                ) : null}
                {block.task_id ? (
                  <ListRow
                    icon={Scissors}
                    title="Break it into smaller tasks"
                    chevron
                    onPress={() => {
                      onClose();
                      router.push({ pathname: '/(app)/task/[id]', params: { id: block.task_id!, split: '1' } });
                    }}
                  />
                ) : null}
                <ListRow icon={SkipForward} title="Take it off today’s plan" subtitle="Nothing is deleted" onPress={() => run(() => unplanBlock(store, block.id), 'Taken off today’s plan')} />
                {block.task_id ? (
                  <ListRow
                    icon={Trash2}
                    title="It’s no longer relevant"
                    subtitle="Cancels the task (you can reopen it later)"
                    destructive
                    onPress={async () => {
                      const ok = await confirm({ title: 'Cancel this task?', message: 'It moves to Completed → Cancelled and can be reopened at any time.', confirmLabel: 'Cancel task', destructive: true, cancelLabel: 'Keep it' });
                      if (ok) await run(async () => { await cancelTask(store, block.task_id!); await unplanBlock(store, block.id); }, 'Task cancelled');
                    }}
                  />
                ) : null}
              </Group>
            </View>
          ) : null}
          <Group>
            {isWork && block.status !== 'done' ? <ListRow icon={Check} title="Mark as done" onPress={markDone} /> : null}
            {block.status === 'done' ? <ListRow icon={Undo2} title="Mark as not done" onPress={() => run(() => setBlockStatus(store, block.id, 'planned'), 'Marked as not done')} /> : null}
            {block.status !== 'done' ? <ListRow icon={Clock} title="Change time" chevron onPress={() => setMode('move')} /> : null}
            {block.status !== 'done' ? <ListRow icon={Timer} title="Change length" chevron onPress={() => setMode('resize')} /> : null}
            <ListRow
              icon={block.is_locked ? LockOpen : Lock}
              title={block.is_locked ? 'Unlock' : 'Lock in place'}
              subtitle={block.is_locked ? undefined : 'Re-planning will never move it'}
              onPress={() => run(() => setBlockLocked(store, block.id, !block.is_locked), block.is_locked ? 'Unlocked' : 'Locked in place')}
            />
            {block.status === 'planned' ? <ListRow icon={SkipForward} title="Take off today’s plan" onPress={() => run(() => unplanBlock(store, block.id), 'Taken off today’s plan')} /> : null}
            {block.task_id ? (
              <ListRow
                icon={ExternalLink}
                title="Open task"
                chevron
                onPress={() => {
                  onClose();
                  router.push({ pathname: '/(app)/task/[id]', params: { id: block.task_id! } });
                }}
              />
            ) : null}
            {block.habit_id ? (
              <ListRow
                icon={ExternalLink}
                title="Open habit"
                chevron
                onPress={() => {
                  onClose();
                  router.push({ pathname: '/(app)/habit/[id]', params: { id: block.habit_id! } });
                }}
              />
            ) : null}
          </Group>
        </>
      )}
    </Sheet>
  );
}
