import { Stack } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { DataProvider } from '@/data/DataProvider';
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
      </Stack>
    </DataProvider>
  );
}
