import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from './controls';
import { Icon } from './Icon';
import { Text } from './Text';
import { useTheme } from './theme';
import { gutter, radius, space } from './tokens';

// ───────────────────────────── Screen ─────────────────────────────

export interface ScreenProps {
  children: ReactNode;
  /** Root-tab title shown in the in-content header. Detail screens use the native stack header instead. */
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Content rendered between the header and the scroll area (e.g. a segment bar). */
  toolbar?: ReactNode;
  footer?: ReactNode;
  edges?: 'top' | 'none';
  contentStyle?: StyleProp<ViewStyle>;
  keyboard?: boolean;
}

export function Screen({
  children,
  title,
  subtitle,
  actions,
  scroll = true,
  refreshing,
  onRefresh,
  toolbar,
  footer,
  edges = 'top',
  contentStyle,
  keyboard,
}: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const header = title ? (
    <View style={styles.header}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="callout" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actions ? <View style={styles.headerActions}>{actions}</View> : null}
    </View>
  ) : null;
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: space.huge + (footer ? 0 : insets.bottom) }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.textTertiary} /> : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
  );
  const inner = (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: edges === 'top' ? insets.top : 0 }]}>
      {header}
      {toolbar}
      {body}
      {footer ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.md), borderTopColor: colors.border, backgroundColor: colors.background }]}>{footer}</View> : null}
    </View>
  );
  if (keyboard) {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {inner}
      </KeyboardAvoidingView>
    );
  }
  return inner;
}

// ───────────────────────────── Card & rows ─────────────────────────────

export function Card({ children, style, padded = true, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean; onPress?: () => void; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  const base = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, padded && styles.cardPadded, style];
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [...base, pressed && { backgroundColor: colors.surfacePressed }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={base}>{children}</View>;
}

export interface ListRowProps {
  title: string;
  subtitle?: string | null;
  leading?: ReactNode;
  trailing?: ReactNode;
  icon?: LucideIcon;
  onPress?: () => void;
  onLongPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  muted?: boolean;
  accessibilityLabel?: string;
  numberOfLines?: number;
}

export function ListRow({ title, subtitle, leading, trailing, icon, onPress, onLongPress, chevron, destructive, muted, accessibilityLabel, numberOfLines = 2 }: ListRowProps) {
  const { colors } = useTheme();
  const content = (
    <>
      {leading ?? (icon ? <Icon icon={icon} size={20} tone={destructive ? 'danger' : 'secondary'} /> : null)}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body" tone={destructive ? 'danger' : muted ? 'tertiary' : 'primary'} numberOfLines={numberOfLines} style={muted ? { textDecorationLine: 'line-through' } : undefined}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {chevron ? <Icon icon={ChevronRight} size={18} tone="tertiary" /> : null}
    </>
  );
  if (!onPress && !onLongPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}
    >
      {content}
    </Pressable>
  );
}

/** A bordered group of rows separated by hairlines (iOS-style grouped list, but quieter). */
export function Group({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const items = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  return (
    <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View style={[styles.hairline, { backgroundColor: colors.border }]} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

export function Section({ title, action, onAction, children, style, hint }: { title?: string; action?: string; onAction?: () => void; children: ReactNode; style?: StyleProp<ViewStyle>; hint?: string }) {
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <View style={styles.sectionHeader}>
          <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
            {title}
          </Text>
          {action && onAction ? (
            <Pressable accessibilityRole="button" onPress={onAction} hitSlop={10}>
              <Text variant="captionStrong" tone="accent">
                {action}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {hint ? (
        <Text variant="caption" tone="secondary" style={{ marginTop: -space.xs }}>
          {hint}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return <View style={[styles.hairline, { backgroundColor: colors.border, marginLeft: inset }]} />;
}

// ───────────────────────────── States ─────────────────────────────

export function EmptyState({ icon, title, body, actionLabel, onAction, compact }: { icon?: LucideIcon; title: string; body?: string; actionLabel?: string; onAction?: () => void; compact?: boolean }) {
  return (
    <View style={[styles.empty, compact && { paddingVertical: space.xl }]}>
      {icon ? <Icon icon={icon} size={compact ? 22 : 28} tone="tertiary" /> : null}
      <Text variant="subheading" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="callout" tone="secondary" align="center" style={{ maxWidth: 300 }}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant="secondary" size="sm" style={{ marginTop: space.sm }} /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.empty}>
      <Text variant="subheading" align="center">
        Something went wrong
      </Text>
      <Text variant="callout" tone="secondary" align="center" style={{ maxWidth: 300 }}>
        {message}
      </Text>
      {onRetry ? <Button label="Try again" onPress={onRetry} variant="secondary" size="sm" /> : null}
    </View>
  );
}

export function LoadingState({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.empty, { paddingVertical: space.huge }]} accessibilityLabel={label ?? 'Loading'}>
      <ActivityIndicator color={colors.textTertiary} />
    </View>
  );
}

/** Quiet placeholder bars while content loads. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm }} accessibilityLabel="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <View key={i} style={{ height: 14, width: `${90 - i * 18}%`, borderRadius: 4, backgroundColor: colors.surfaceSecondary }} />
      ))}
    </View>
  );
}

// ───────────────────────────── Progress & badges ─────────────────────────────

export function ProgressBar({ value, tone = 'accent', height = 4 }: { value: number | null; tone?: 'accent' | 'success' | 'warning'; height?: number }) {
  const { colors } = useTheme();
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value));
  const color = { accent: colors.accent, success: colors.success, warning: colors.warning }[tone];
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{ height, borderRadius: height, backgroundColor: colors.surfaceSecondary, overflow: 'hidden' }}
    >
      <View style={{ width: `${pct * 100}%`, height, borderRadius: height, backgroundColor: color }} />
    </View>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' }) {
  const { colors } = useTheme();
  const bg = { neutral: colors.surfaceSecondary, accent: colors.accentSoft, success: colors.successSoft, warning: colors.warningSoft, danger: colors.dangerSoft }[tone];
  const t = ({ neutral: 'secondary', accent: 'accent', success: 'success', warning: 'warning', danger: 'danger' } as const)[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text variant="captionStrong" tone={t}>
        {label}
      </Text>
    </View>
  );
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: gutter,
    paddingTop: space.md,
    paddingBottom: space.md,
    gap: space.md,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: -2 },
  content: { paddingHorizontal: gutter, gap: space.xxl, paddingTop: space.xs },
  footer: { paddingHorizontal: gutter, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  cardPadded: { padding: space.lg, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 52 },
  group: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  hairline: { height: StyleSheet.hairlineWidth },
  section: { gap: space.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  empty: { alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.xxxl, paddingHorizontal: space.lg },
  badge: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm - 2, alignSelf: 'flex-start' },
});
