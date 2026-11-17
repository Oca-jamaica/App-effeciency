import { useEffect, useRef, useState } from 'react';
import type { PlanResult } from '@ascend/domain';
import { useLive, useStore } from '@/data/DataProvider';
import type { ScheduleBlock } from '@/data/types';
import { occurrencesInRange, type EventOccurrence } from './events';
import { blocksForDay, buildPlanInput, markMissedBlocks, replanDay } from './schedule';
import { planDay } from '@ascend/domain';

const PLAN_INPUT_TABLES = ['tasks', 'habits', 'habit_logs', 'calendar_events', 'availability_windows', 'user_preferences', 'goals', 'milestones', 'categories'];

/**
 * The plan for a day: persisted blocks plus event occurrences, automatically re-planned (debounced)
 * whenever anything the scheduler reads changes. Re-planning never moves locked/manual/started blocks.
 */
export function useDayPlan(date: string, timeZone: string, isToday: boolean) {
  const store = useStore();
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const blocks = useLive<ScheduleBlock[]>((s) => blocksForDay(s, date), [date], ['schedule_blocks']);
  const events = useLive<EventOccurrence[]>((s) => occurrencesInRange(s, date, date, timeZone), [date, timeZone], ['calendar_events']);

  const replan = async () => {
    setPlanning(true);
    try {
      const now = Date.now();
      if (isToday) {
        await markMissedBlocks(store, date, now);
        setPlan(await replanDay(store, date, now));
      } else {
        // Other days are previewed, not saved: tomorrow is planned for real once it becomes today.
        setPlan(planDay(await buildPlanInput(store, date, Math.max(now, 0))));
      }
      setPlanError(null);
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  };
  const replanRef = useRef(replan);
  replanRef.current = replan;

  useEffect(() => {
    void replanRef.current();
    const unsub = store.subscribe(PLAN_INPUT_TABLES, () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void replanRef.current(), 700);
    });
    return () => {
      unsub();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [store, date, timeZone]);

  return { plan, planning, planError, replan, blocks: blocks.data ?? [], events: events.data ?? [], loading: blocks.loading || events.loading, isPreview: !isToday };
}
