import { formatTime, parseTime } from '@ascend/domain';
import { useEffect, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { useLive, useStore } from '@/data/DataProvider';
import type { Preferences } from '@/data/types';
import { ValidationError } from '@/data/validation';
import { updatePreferences } from '@/features/settings/repo';
import { useUserContext } from '@/hooks/useUser';
import { permissionState, requestPermission, type PermissionState } from '@/services/notifications';
import { Button, Card, DateTimeField, Row, Screen, Section, Stepper, Text, ToggleRow, space, useToast } from '@/ui';
import { ENABLED_KEY, notificationsEnabled, resyncNotifications } from './NotificationSync';
import { planNotifications } from './plan';

export function NotificationSettingsScreen() {
  const store = useStore();
  const toast = useToast();
  const ctx = useUserContext();
  const p = ctx.prefs;
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const enabled = useLive((s) => notificationsEnabled(s), [], ['_kv']);
  const upcoming = useLive((s) => planNotifications(s, Date.now(), ctx.timeZone), [ctx.timeZone], ['habits', 'habit_logs', 'reminders', 'user_preferences']);

  useEffect(() => {
    const check = () => void permissionState().then(setPermission).catch(() => setPermission('undetermined'));
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, []);

  if (!p) return <Screen edges="none"><Text variant="body" tone="secondary">Your settings haven’t reached this device yet. Connect to the internet and they’ll appear.</Text></Screen>;

  const save = (patch: Partial<Preferences>) =>
    updatePreferences(store, patch).catch((e) => toast.show(e instanceof ValidationError ? e.message : String(e), { kind: 'error' }));

  const setEnabled = async (on: boolean) => {
    if (on) {
      const state = permission === 'granted' ? 'granted' : await requestPermission();
      setPermission(state);
      if (state !== 'granted') {
        toast.show('Notifications are turned off for ASCEND in your phone’s settings.', { kind: 'error' });
        return;
      }
    }
    await store.setSetting(ENABLED_KEY, on ? '1' : '0');
    await resyncNotifications(store, ctx.timeZone).catch(() => undefined);
    toast.show(on ? 'Reminders on' : 'Reminders off. Nothing is scheduled on this device.');
  };

  const on = enabled.data === true && permission === 'granted';
  const quiet = p.quiet_hours_start !== null && p.quiet_hours_end !== null;
  const count = upcoming.data?.length ?? 0;

  return (
    <Screen edges="none">
      <Text variant="callout" tone="secondary">
        ASCEND only reminds you about things you asked for: habit reminder times, reminders you set, and your focus timer. Notifications are scheduled on this device and never sent from a server.
      </Text>
      <ToggleRow label="Reminders on this device" description={on ? `${count} scheduled over the next 7 days` : 'Off'} value={on} onChange={(v) => void setEnabled(v)} />
      {permission === 'denied' ? (
        <Card style={{ gap: space.md }}>
          <Text variant="body">Notifications are blocked for ASCEND in your phone’s settings.</Text>
          <Button label="Open settings" variant="secondary" onPress={() => void Linking.openSettings()} />
        </Card>
      ) : null}
      <Section title="Quiet hours" hint="Habit reminders and block nudges wait until quiet hours end. Reminders you set for a specific time still arrive.">
        <ToggleRow label="Use quiet hours" value={quiet} onChange={(v) => save(v ? { quiet_hours_start: '22:30', quiet_hours_end: '07:00' } : { quiet_hours_start: null, quiet_hours_end: null })} />
        {quiet ? (
          <Row>
            <View style={{ flex: 1 }}><DateTimeField label="From" mode="time" value={parseTime(p.quiet_hours_start ?? '22:30')} onChange={(v: number) => save({ quiet_hours_start: formatTime(v) })} /></View>
            <View style={{ flex: 1 }}><DateTimeField label="Until" mode="time" value={parseTime(p.quiet_hours_end ?? '07:00')} onChange={(v: number) => save({ quiet_hours_end: formatTime(v) })} /></View>
          </Row>
        ) : null}
      </Section>
      <Section title="Limits">
        <View style={{ gap: space.sm }}>
          <View>
            <Text variant="body">Most per day</Text>
            <Text variant="caption" tone="secondary">Reminders you set yourself are always delivered and count first.</Text>
          </View>
          <Stepper value={p.max_notifications_per_day} onChange={(v) => save({ max_notifications_per_day: v })} min={1} max={30} step={1} format={(v) => `${v}`} />
        </View>
        <ToggleRow label="Nudge before planned blocks" description="Five minutes before each task or habit in today’s plan." value={p.notify_block_start} onChange={(v) => save({ notify_block_start: v })} />
      </Section>
    </Screen>
  );
}
