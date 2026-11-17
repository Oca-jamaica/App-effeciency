import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tapFeedback } from './controls';
import { Text } from './Text';
import { useTheme } from './theme';
import { radius, space } from './tokens';

type ToastKind = 'success' | 'error' | 'info';
interface ToastState {
  id: number;
  message: string;
  kind: ToastKind;
  action?: { label: string; onPress: () => void };
}

interface ToastApi {
  show: (message: string, opts?: { kind?: ToastKind; action?: { label: string; onPress: () => void } }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Brief, non-blocking confirmation of what just happened, with an optional Undo. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback<ToastApi['show']>((message, opts) => {
    if (timer.current) clearTimeout(timer.current);
    if (opts?.kind === 'error') tapFeedback('warning');
    setToast({ id: Date.now(), message, kind: opts?.kind ?? 'success', action: opts?.action });
    timer.current = setTimeout(() => setToast(null), opts?.action ? 5000 : 2600);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast ? <ToastView key={toast.id} toast={toast} onDismiss={() => setToast(null)} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const bg = scheme === 'dark' ? '#E9EDF3' : '#1A1E24';
  const fg = scheme === 'dark' ? '#101318' : '#F6F6F3';
  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      exiting={FadeOutDown.duration(140)}
      style={[styles.toastWrap, { bottom: insets.bottom + 72 }]}
      pointerEvents="box-none"
    >
      <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.toast, { backgroundColor: bg }]}>
        {toast.kind === 'error' ? <View style={[styles.mark, { backgroundColor: colors.danger }]} /> : null}
        <Text variant="callout" style={{ color: fg, flex: 1 }}>
          {toast.message}
        </Text>
        {toast.action ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => {
              toast.action?.onPress();
              onDismiss();
            }}
          >
            <Text variant="captionStrong" style={{ color: scheme === 'dark' ? '#3A63BF' : '#8AAEF2' }}>
              {toast.action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

export function useToast(): ToastApi {
  const t = useContext(ToastContext);
  if (!t) throw new Error('useToast must be used inside ToastProvider');
  return t;
}

/** Native confirmation dialog. Resolves true when the user confirms. */
export function confirm(opts: { title: string; message?: string; confirmLabel: string; destructive?: boolean; cancelLabel?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      opts.title,
      opts.message,
      [
        { text: opts.cancelLabel ?? 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: opts.confirmLabel, style: opts.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

const styles = StyleSheet.create({
  toastWrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    maxWidth: 480,
    width: '100%',
  },
  mark: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
});
