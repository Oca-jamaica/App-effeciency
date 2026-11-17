import { utcToLocalDate } from '@ascend/domain';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useLive } from '@/data/DataProvider';
import { loadUserContext, type UserContext } from '@/features/planner/schedule';

/** The signed-in user's profile, preferences and timezone, kept live. */
export function useUserContext(): UserContext {
  const { data } = useLive((s) => loadUserContext(s), [], ['profiles', 'user_preferences']);
  return data ?? { profile: null, prefs: null, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', weekStartsOn: 1 };
}

/** Today's date in the user's timezone; updates when the day changes or the app returns to the foreground. */
export function useToday(timeZone: string): { today: string; now: number } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setNow(Date.now()));
    return () => {
      clearInterval(tick);
      sub.remove();
    };
  }, []);
  return { today: utcToLocalDate(now, timeZone), now };
}
