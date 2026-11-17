import { Tabs } from 'expo-router/js-tabs';
import { BarChart3, CalendarDays, Home, Target, UserRound, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, type ColorValue } from 'react-native';
import { fonts, useTheme } from '@/ui';

function tabIcon(Icon: LucideIcon) {
  return ({ color, focused }: { color: ColorValue; focused: boolean }) => <Icon size={22} color={String(color)} strokeWidth={focused ? 2 : 1.75} />;
}

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: { backgroundColor: colors.tabBar, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11, marginTop: 2 },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon(Home) }} />
      <Tabs.Screen name="goals" options={{ title: 'Goals', tabBarIcon: tabIcon(Target) }} />
      <Tabs.Screen name="planner" options={{ title: 'Planner', tabBarIcon: tabIcon(CalendarDays) }} />
      <Tabs.Screen name="insights" options={{ title: 'Insights', tabBarIcon: tabIcon(BarChart3) }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon(UserRound) }} />
    </Tabs>
  );
}
