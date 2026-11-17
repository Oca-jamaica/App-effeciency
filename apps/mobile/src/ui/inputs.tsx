import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Check, ChevronDown, X } from 'lucide-react-native';
import { forwardRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, IconButton, tapFeedback } from './controls';
import { Icon } from './Icon';
import { Text } from './Text';
import { useTheme } from './theme';
import { fonts, gutter, radius, space } from './tokens';

// ───────────────────────────── TextField ─────────────────────────────

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string | null;
  hint?: string;
  multiline?: boolean;
  minLines?: number;
}

export type TextFieldRef = ComponentRef<typeof TextInput>;

export const TextField = forwardRef<TextFieldRef, TextFieldProps>(function TextField({ label, error, hint, multiline, minLines = 4, ...rest }, ref) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.xs + 2 }}>
      {label ? (
        <Text variant="captionStrong" tone="secondary">
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        accessibilityLabel={label ?? rest.placeholder}
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.accent}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        maxFontSizeMultiplier={1.6}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : focused ? colors.accent : colors.border,
          },
          multiline && { minHeight: 22 * minLines + 20, paddingTop: 12 },
        ]}
      />
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="tertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

// ───────────────────────────── Sheet ─────────────────────────────

export function Sheet({ visible, onClose, title, children, footer }: { visible: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Close" style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap} pointerEvents="box-none">
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: Math.max(insets.bottom, space.lg) }]}>
          <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />
          <View style={styles.sheetHeader}>
            <Text variant="heading" style={{ flex: 1 }} accessibilityRole="header">
              {title}
            </Text>
            <IconButton icon={X} label="Close" onPress={onClose} />
          </View>
          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingHorizontal: gutter, gap: space.md, paddingBottom: space.md }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: gutter, paddingTop: space.sm }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ───────────────────────────── Select ─────────────────────────────

export interface SelectOption<T> {
  value: T;
  label: string;
  description?: string;
  color?: string;
}

export function SelectField<T extends string | number | null>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose',
  error,
  allowClear,
  clearLabel = 'None',
}: {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (v: T) => void;
  placeholder?: string;
  error?: string | null;
  allowClear?: boolean;
  clearLabel?: string;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View style={{ gap: space.xs + 2 }}>
      <Text variant="captionStrong" tone="secondary">
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.input,
          styles.selectBox,
          { backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: error ? colors.danger : colors.border },
        ]}
      >
        {selected?.color ? <View style={[styles.optionDot, { backgroundColor: selected.color }]} /> : null}
        <Text variant="body" tone={selected ? 'primary' : 'tertiary'} style={{ flex: 1 }} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <Icon icon={ChevronDown} size={18} tone="tertiary" />
      </Pressable>
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        <View style={{ gap: 2 }}>
          {allowClear ? (
            <OptionRow label={clearLabel} selected={value === null} onPress={() => { onChange(null as T); setOpen(false); }} />
          ) : null}
          {options.map((o) => (
            <OptionRow
              key={String(o.value)}
              label={o.label}
              description={o.description}
              color={o.color}
              selected={o.value === value}
              onPress={() => {
                onChange(o.value);
                setOpen(false);
              }}
            />
          ))}
          {options.length === 0 ? (
            <Text variant="callout" tone="secondary" style={{ paddingVertical: space.lg }}>
              Nothing to choose from yet.
            </Text>
          ) : null}
        </View>
      </Sheet>
    </View>
  );
}

function OptionRow({ label, description, color, selected, onPress }: { label: string; description?: string; color?: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.surfacePressed }]}
    >
      {color ? <View style={[styles.optionDot, { backgroundColor: color }]} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body">{label}</Text>
        {description ? (
          <Text variant="caption" tone="secondary">
            {description}
          </Text>
        ) : null}
      </View>
      {selected ? <Icon icon={Check} size={18} tone="accent" /> : null}
    </Pressable>
  );
}

// ───────────────────────────── Date & time ─────────────────────────────

function toDate(date: string | null, minutes: number | null): Date {
  const d = new Date();
  if (date) {
    const [y, m, day] = date.split('-').map(Number);
    d.setFullYear(y!, (m ?? 1) - 1, day ?? 1);
  }
  if (minutes !== null) d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function formatDateLabel(date: string): string {
  const d = toDate(date, null);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}

export function formatTimeLabel(minutes: number): string {
  const d = toDate(null, minutes);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** A date (YYYY-MM-DD) or time (minutes after midnight) picker using the platform's native control. */
export function DateTimeField({
  label,
  mode,
  value,
  onChange,
  allowClear,
  placeholder = 'Not set',
  error,
  minimumDate,
}: {
  label: string;
  mode: 'date' | 'time';
  value: string | number | null;
  onChange: (v: any) => void;
  allowClear?: boolean;
  placeholder?: string;
  error?: string | null;
  minimumDate?: string;
}) {
  const { colors, scheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(() => (mode === 'date' ? toDate((value as string) ?? null, null) : toDate(null, (value as number) ?? 9 * 60)));
  const display =
    value === null || value === undefined ? placeholder : mode === 'date' ? formatDateLabel(value as string) : formatTimeLabel(value as number);

  const commit = (d: Date) => {
    if (mode === 'date') onChange(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    else onChange(d.getHours() * 60 + d.getMinutes());
  };

  const openPicker = () => {
    setDraft(mode === 'date' ? toDate((value as string) ?? null, null) : toDate(null, (value as number) ?? 9 * 60));
    setOpen(true);
  };

  return (
    <View style={{ gap: space.xs + 2 }}>
      <Text variant="captionStrong" tone="secondary">
        {label}
      </Text>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${display}`}
          onPress={openPicker}
          style={({ pressed }) => [
            styles.input,
            styles.selectBox,
            { flex: 1, backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: error ? colors.danger : colors.border },
          ]}
        >
          <Text variant="body" tone={value === null || value === undefined ? 'tertiary' : 'primary'} tabular style={{ flex: 1 }}>
            {display}
          </Text>
        </Pressable>
        {allowClear && value !== null && value !== undefined ? <IconButton icon={X} label={`Clear ${label}`} onPress={() => onChange(null)} filled /> : null}
      </View>
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : null}
      {open && Platform.OS === 'android' ? (
        <DateTimePicker
          value={draft}
          mode={mode}
          minimumDate={minimumDate ? toDate(minimumDate, null) : undefined}
          onChange={(e: DateTimePickerEvent, d?: Date) => {
            setOpen(false);
            if (e.type === 'set' && d) commit(d);
          }}
        />
      ) : null}
      {Platform.OS !== 'android' ? (
        <Sheet
          visible={open}
          onClose={() => setOpen(false)}
          title={label}
          footer={
            <Button
              label="Done"
              onPress={() => {
                commit(draft);
                setOpen(false);
              }}
            />
          }
        >
          <View style={{ alignItems: 'center' }}>
            <DateTimePicker
              value={draft}
              mode={mode}
              display={mode === 'date' ? 'inline' : 'spinner'}
              themeVariant={scheme}
              accentColor={colors.accent}
              minimumDate={minimumDate ? toDate(minimumDate, null) : undefined}
              onChange={(_e: DateTimePickerEvent, d?: Date) => d && setDraft(d)}
            />
          </View>
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md + 2,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
  selectBox: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: space.xs },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingLeft: gutter, paddingRight: space.sm, paddingBottom: space.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 50, paddingHorizontal: space.sm, borderRadius: radius.md },
  optionDot: { width: 10, height: 10, borderRadius: 5 },
});
