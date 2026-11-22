import { Stack } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { DataProvider } from '@/data/DataProvider';
import { NotificationSync } from '@/features/notifications/NotificationSync';
import { useAuth } from '@/services/auth';
import { fonts, useTheme } from '@/ui';

export default function AppLayout() {
  const { session, signOut } = useAuth();
  const { colors } = useTheme();
  if (!session) return null;
  return (
    <DataProvider
      userId={session.user.id}
      onAuthExpired={() => void signOut()}
      fallback={
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
          <ActivityIndicator color={colors.textTertiary} />
        </View>
      }
    >
      <NotificationSync />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: fonts.semibold, fontSize: 17, color: colors.text },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="capture" options={{ presentation: 'formSheet', headerShown: false, sheetAllowedDetents: [0.62, 0.95], sheetGrabberVisible: true, sheetCornerRadius: 18, contentStyle: { backgroundColor: colors.surface } }} />
        <Stack.Screen name="goal/edit" options={{ presentation: 'modal', title: 'Goal' }} />
        <Stack.Screen name="task/edit" options={{ presentation: 'modal', title: 'Task' }} />
        <Stack.Screen name="habit/edit" options={{ presentation: 'modal', title: 'Habit' }} />
        <Stack.Screen name="event/edit" options={{ presentation: 'modal', title: 'Event' }} />
        <Stack.Screen name="goal/[id]" options={{ title: '' }} />
        <Stack.Screen name="task/[id]" options={{ title: '' }} />
        <Stack.Screen name="habit/[id]" options={{ title: '' }} />
        <Stack.Screen name="settings/scheduling" options={{ title: 'Scheduling' }} />
        <Stack.Screen name="settings/hours" options={{ title: 'Preferred hours' }} />
        <Stack.Screen name="settings/categories" options={{ title: 'Categories' }} />
        <Stack.Screen name="settings/sync" options={{ title: 'Sync' }} />
        <Stack.Screen name="settings/notifications" options={{ title: 'Reminders' }} />
        <Stack.Screen name="project/edit" options={{ presentation: 'modal', title: 'Project' }} />
        <Stack.Screen name="project/[id]" options={{ title: '' }} />
        <Stack.Screen name="video/[id]" options={{ title: 'Timelapse' }} />
        <Stack.Screen name="workout/[id]" options={{ title: 'Workout' }} />
        <Stack.Screen name="exercise/[id]" options={{ title: 'Exercise' }} />
        <Stack.Screen name="skill/[id]" options={{ title: 'Skill' }} />
        <Stack.Screen name="c/[key]/index" options={{ title: '' }} />
        <Stack.Screen name="c/[key]/edit" options={{ presentation: 'modal', title: '' }} />
      </Stack>
    </DataProvider>
  );
}
