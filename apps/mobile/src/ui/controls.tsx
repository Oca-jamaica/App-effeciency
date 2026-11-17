import * as Haptics from 'expo-haptics';
import { Check, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './Icon';
import { Text } from './Text';
import { useTheme } from './theme';
import { radius, space, touchTarget } from './tokens';

export function tapFeedback(kind: 'light' | 'success' | 'warning' = 'light'): void {
  if (kind === 'light') Haptics.selectionAsync().catch(() => undefined);
  else Haptics.notificationAsync(kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}

// ───────────────────────────── Button ─────────────────────────────

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

export function Button({ label, onPress, variant = 'primary', size = 'md', icon, loading, disabled, fullWidth, style, accessibilityHint }: ButtonProps) {
  const { colors } = useTheme();
  const inactive = disabled || loading;
  const bg = { primary: colors.accent, secondary: colors.surfaceSecondary, ghost: 'transparent', danger: colors.dangerSoft }[variant];
  const bgPressed = { primary: colors.accentPressed, secondary: colors.surfacePressed, ghost: colors.surfaceSecondary, danger: colors.dangerSoft }[variant];
  const tone = variant === 'primary' ? 'onAccent' : variant === 'danger' ? 'danger' : variant === 'ghost' ? 'accent' : 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' && styles.buttonSm,
        { backgroundColor: pressed ? bgPressed : bg, opacity: disabled ? 0.45 : 1 },
        fullWidth && { alignSelf: 'stretch' },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onAccent : colors.textSecondary} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Icon icon={icon} size={size === 'sm' ? 16 : 18} tone={tone} /> : null}
          <Text variant={size === 'sm' ? 'captionStrong' : 'bodyStrong'} tone={tone}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary' | 'accent' | 'danger';
  filled?: boolean;
  size?: number;
  disabled?: boolean;
}

export function IconButton({ icon, label, onPress, tone = 'secondary', filled, size = 20, disabled }: IconButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.iconButton,
        filled && { backgroundColor: colors.surfaceSecondary },
        pressed && { backgroundColor: colors.surfacePressed },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Icon icon={icon} size={size} tone={tone} />
    </Pressable>
  );
}

// ───────────────────────────── Chip ─────────────────────────────

export function Chip({ label, selected, onPress, icon, color }: { label: string; selected?: boolean; onPress?: () => void; icon?: LucideIcon; color?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      disabled={!onPress}
      onPress={() => {
        tapFeedback();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.accentSoft : pressed ? colors.surfacePressed : colors.surfaceSecondary,
          borderColor: selected ? colors.accent : 'transparent',
        },
      ]}
    >
      {color ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
      {icon ? <Icon icon={icon} size={14} tone={selected ? 'accent' : 'secondary'} /> : null}
      <Text variant="captionStrong" tone={selected ? 'accent' : 'secondary'}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ChipGroup<T extends string | number>({
  options,
  value,
  onChange,
  scroll,
}: {
  options: readonly { value: T; label: string; color?: string }[];
  value: T | null | readonly T[];
  onChange: (v: T) => void;
  scroll?: boolean;
}) {
  const isSelected = (v: T) => (Array.isArray(value) ? (value as readonly T[]).includes(v) : value === v);
  const chips = options.map((o) => (
    <Chip key={String(o.value)} label={o.label} color={o.color} selected={isSelected(o.value)} onPress={() => onChange(o.value)} />
  ));
  if (scroll) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {chips}
      </ScrollView>
    );
  }
  return <View style={[styles.chipRow, { flexWrap: 'wrap' }]}>{chips}</View>;
}

// ───────────────────────────── Checkbox ─────────────────────────────

export function Checkbox({
  checked,
  onToggle,
  label,
  shape = 'circle',
  partial,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  shape?: 'circle' | 'square';
  partial?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: partial ? 'mixed' : checked }}
      accessibilityLabel={label}
      hitSlop={10}
      onPress={() => {
        tapFeedback(checked ? 'light' : 'success');
        onToggle();
      }}
      style={[
        styles.checkbox,
        shape === 'square' && { borderRadius: 6 },
        {
          borderColor: checked || partial ? colors.accent : colors.borderStrong,
          backgroundColor: checked ? colors.accent : partial ? colors.accentSoft : 'transparent',
        },
      ]}
    >
      {checked ? <Check size={14} color={colors.onAccent} strokeWidth={2.75} /> : partial ? <View style={[styles.partial, { backgroundColor: colors.accent }]} /> : null}
    </Pressable>
  );
}

// ───────────────────────────── SegmentedControl ─────────────────────────────

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  scrollable,
}: {
  segments: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  scrollable?: boolean;
}) {
  const { colors } = useTheme();
  if (scrollable) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
        {segments.map((s) => {
          const active = s.value === value;
          return (
            <Pressable
              key={s.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => {
                if (!active) tapFeedback();
                onChange(s.value);
              }}
              style={[styles.tab, active && { borderBottomColor: colors.text }]}
            >
              <Text variant="subheading" tone={active ? 'primary' : 'tertiary'}>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    );
  }
  return (
    <View accessibilityRole="tablist" style={[styles.segmented, { backgroundColor: colors.surfaceSecondary }]}>
      {segments.map((s) => {
        const active = s.value === value;
        return (
          <Pressable
            key={s.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (!active) tapFeedback();
              onChange(s.value);
            }}
            style={[styles.segment, active && { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text variant="captionStrong" tone={active ? 'primary' : 'secondary'}>
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ───────────────────────────── Toggle row ─────────────────────────────

export function ToggleRow({ label, description, value, onChange }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body">{label}</Text>
        {description ? (
          <Text variant="caption" tone="secondary">
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={(v) => {
          tapFeedback();
          onChange(v);
        }}
        trackColor={{ false: colors.borderStrong, true: colors.accent }}
        thumbColor="#FFFFFF"
        ios_backgroundColor={colors.borderStrong}
      />
    </View>
  );
}

// ───────────────────────────── Stepper ─────────────────────────────

export function Stepper({ value, onChange, min, max, step = 1, format }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => string }) {
  const { colors } = useTheme();
  const btn = (label: string, delta: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={delta < 0 ? value <= min : value >= max}
      onPress={() => {
        tapFeedback();
        onChange(Math.min(max, Math.max(min, value + delta)));
      }}
      style={({ pressed }) => [styles.stepBtn, { backgroundColor: pressed ? colors.surfacePressed : colors.surfaceSecondary }]}
    >
      <Text variant="bodyStrong">{delta < 0 ? '−' : '+'}</Text>
    </Pressable>
  );
  return (
    <View style={styles.stepper} accessibilityRole="adjustable" accessibilityValue={{ text: format ? format(value) : String(value) }}>
      {btn('Decrease', -step)}
      <Text variant="bodyStrong" tabular style={{ minWidth: 64, textAlign: 'center' }}>
        {format ? format(value) : value}
      </Text>
      {btn('Increase', step)}
    </View>
  );
}

export function Row({ children, gap = space.sm, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSm: { minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.sm },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  iconButton: {
    width: touchTarget - 4,
    height: touchTarget - 4,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    minHeight: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partial: { width: 10, height: 2, borderRadius: 1 },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3, gap: 3 },
  segment: {
    flex: 1,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm + 1,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabsRow: { flexDirection: 'row', gap: space.xl, paddingHorizontal: 16 },
  tab: { paddingVertical: space.sm, borderBottomWidth: 2, borderBottomColor: 'transparent', minHeight: 40, justifyContent: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingVertical: space.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
