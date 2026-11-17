import { View } from 'react-native';
import { Screen, Text, Card, space } from '@/ui';

/** Shown when the app was built without a Supabase project configured. Never a fake demo mode. */
export function SetupRequired() {
  return (
    <Screen title="Connect ASCEND" subtitle="This build has no server configured yet.">
      <Card>
        <Text variant="body">
          ASCEND stores your data securely in your own Supabase project. Add its details to <Text variant="bodyStrong">apps/mobile/.env</Text> and restart the
          app:
        </Text>
        <View style={{ gap: space.xs }}>
          <Text variant="callout" tone="secondary">EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co</Text>
          <Text variant="callout" tone="secondary">EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…</Text>
        </View>
        <Text variant="caption" tone="tertiary">
          Full steps are in the repository README under “Running the app”.
        </Text>
      </Card>
    </Screen>
  );
}
