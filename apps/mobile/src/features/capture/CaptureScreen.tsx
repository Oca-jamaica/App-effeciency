import type { CaptureType } from '@ascend/domain';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useStore } from '@/data/DataProvider';
import { useToday, useUserContext } from '@/hooks/useUser';
import { Button, ChipGroup, Text, fonts, formatDateLabel, formatTimeLabel, gutter, radius, space, useTheme, useToast } from '@/ui';
import { CAPTURE_TYPES, previewCapture, saveCapture } from './repo';

/**
 * Quick capture: one field, saved instantly and offline. Natural-language shortcuts are understood
 * ("tomorrow 4pm", "45m", "!p1", "#economics") and shown back before saving.
 */
export function CaptureScreen() {
  const store = useStore();
  const toast = useToast();
  const { colors } = useTheme();
  const ctx = useUserContext();
  const { today } = useToday(ctx.timeZone);
  const [text, setText] = useState('');
  const [type, setType] = useState<CaptureType | null>(null);
  const [saving, setSaving] = useState(false);
  const draft = useMemo(() => previewCapture(text, today), [text, today]);
  const effectiveType = type ?? draft.type ?? 'task';

  const save = async (andAnother: boolean) => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const r = await saveCapture(store, text, effectiveType, { today, timeZone: ctx.timeZone });
      toast.show(`${CAPTURE_TYPES.find((c) => c.value === r.type)?.label ?? 'Item'} saved: ${r.title}`);
      setText('');
      setType(null);
      if (!andAnother) router.back();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const chips = [
    draft.date ? formatDateLabel(draft.date) : null,
    draft.timeMinutes !== null ? formatTimeLabel(draft.timeMinutes) : null,
    draft.durationMinutes ? `${draft.durationMinutes} min` : null,
    draft.priority ? `P${draft.priority}` : null,
    ...draft.tags.map((t) => `#${t}`),
  ].filter(Boolean) as string[];

  return (
    <View style={{ flex: 1, padding: gutter, paddingTop: space.xl, gap: space.lg, backgroundColor: colors.surface }}>
      <Text variant="heading" accessibilityRole="header">Capture</Text>
      <TextInput
        autoFocus
        value={text}
        onChangeText={setText}
        placeholder="Revise unit 3 tomorrow 4pm 45m #economics"
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.accent}
        multiline
        accessibilityLabel="What do you want to capture?"
        returnKeyType="done"
        blurOnSubmit
        onSubmitEditing={() => void save(false)}
        style={{
          minHeight: 72,
          fontFamily: fonts.regular,
          fontSize: 17,
          lineHeight: 24,
          color: colors.text,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          padding: space.md,
          textAlignVertical: 'top',
        }}
      />
      {chips.length ? (
        <Text variant="caption" tone="accent">Understood: {chips.join(' · ')}</Text>
      ) : (
        <Text variant="caption" tone="tertiary">Try “tomorrow”, “fri 6pm”, “45m”, “!p1” or “#goal”. Start with “idea:” or “note:” to file it there.</Text>
      )}
      <ChipGroup options={CAPTURE_TYPES} value={effectiveType} onChange={setType} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label="Save" onPress={() => void save(false)} loading={saving} disabled={!text.trim()} style={{ flex: 1 }} />
        <Button label="Save & add another" variant="secondary" onPress={() => void save(true)} disabled={!text.trim() || saving} style={{ flex: 1 }} />
      </View>
    </View>
  );
}
