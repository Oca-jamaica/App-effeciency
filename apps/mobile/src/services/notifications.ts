/**
 * Local notifications on this device. Nothing is sent from a server; reminders are scheduled from
 * the on-device plan (see features/notifications/plan.ts) and replaced whenever it changes.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { PlannedNotification } from '@/features/notifications/plan';

export const CHANNEL_ID = 'reminders';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export type PermissionState = 'granted' | 'denied' | 'undetermined';

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Reminders',
    description: 'Habit reminders, reminders you set, and your focus timer',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function permissionState(): Promise<PermissionState> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

/** Asks the operating system for permission. Only called when the person turns reminders on. */
export async function requestPermission(): Promise<PermissionState> {
  await ensureChannel();
  const p = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

function urlFor(n: PlannedNotification): string {
  if (n.kind === 'habit') return `/habit/${n.key.split(':')[1]}`;
  if (n.kind === 'focus') return '/planner?tab=focus';
  if (n.kind === 'block') return '/planner';
  return '/';
}

/** Replaces every pending ASCEND notification with the given plan. */
export async function applySchedule(plan: PlannedNotification[]): Promise<void> {
  await ensureChannel();
  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const n of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: n.key,
      content: { title: n.title, body: n.body, data: { url: urlFor(n) }, sound: n.kind === 'focus' ? 'default' : undefined },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: n.at, channelId: CHANNEL_ID },
    });
  }
}

export async function clearSchedule(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/** Opens the screen a tapped notification refers to. Only our own app paths are followed. */
export function onNotificationTap(open: (url: string) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const url = r.notification.request.content.data?.url;
    if (typeof url === 'string' && /^\/[a-z/?=0-9a-f-]*$/i.test(url)) open(url);
  });
  return () => sub.remove();
}
