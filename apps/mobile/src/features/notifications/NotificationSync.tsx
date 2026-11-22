import { router } from 'expo-router';
import { useEffect } from 'react';
import { useStore } from '@/data/DataProvider';
import type { Store } from '@/data/store';
import { getTimer } from '@/features/focus/repo';
import { useUserContext } from '@/hooks/useUser';
import { applySchedule, clearSchedule, onNotificationTap, permissionState } from '@/services/notifications';
import { planNotifications } from './plan';

export const ENABLED_KEY = 'notifications_enabled';
const FINGERPRINT_KEY = 'notifications_fingerprint';
const WATCHED = ['habits', 'habit_logs', 'reminders', 'user_preferences', 'focus_sessions', 'schedule_blocks', '_kv'];

export async function notificationsEnabled(store: Store): Promise<boolean> {
  return (await store.getSetting(ENABLED_KEY)) === '1';
}

/** Recomputes the plan and reschedules only when something actually changed. */
export async function resyncNotifications(store: Store, timeZone: string): Promise<void> {
  if (!(await notificationsEnabled(store)) || (await permissionState()) !== 'granted') {
    if ((await store.getSetting(FINGERPRINT_KEY)) !== null) {
      await clearSchedule();
      await store.removeSetting(FINGERPRINT_KEY);
    }
    return;
  }
  const plan = await planNotifications(store, Date.now(), timeZone, await getTimer(store));
  const fingerprint = JSON.stringify(plan.map((n) => [n.key, n.at, n.title, n.body]));
  if ((await store.getSetting(FINGERPRINT_KEY)) === fingerprint) return;
  await applySchedule(plan);
  await store.setSetting(FINGERPRINT_KEY, fingerprint);
}

/** Keeps scheduled notifications in step with the data, and opens the right screen when one is tapped. */
export function NotificationSync() {
  const store = useStore();
  const { timeZone } = useUserContext();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void resyncNotifications(store, timeZone).catch(() => undefined), 2000);
    };
    run();
    const unsub = store.subscribe(WATCHED, run);
    // The seven-day window moves forward each hour even if nothing is edited.
    const interval = setInterval(run, 60 * 60_000);
    return () => {
      unsub();
      clearInterval(interval);
      if (timer) clearTimeout(timer);
    };
  }, [store, timeZone]);
  useEffect(() => onNotificationTap((url) => router.push(url as never)), []);
  return null;
}
