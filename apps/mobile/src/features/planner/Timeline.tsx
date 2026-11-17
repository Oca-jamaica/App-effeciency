import { formatHours, utcToLocalMinutes } from '@ascend/domain';
import { router } from 'expo-router';
import { Coffee, Lock, Repeat, type LucideIcon, CircleDot, CalendarClock, Dumbbell, BookOpen } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ScheduleBlock } from '@/data/types';
import { Checkbox, Icon, Text, radius, space, useTheme } from '@/ui';
import type { EventOccurrence } from './events';

export type TimelineItem =
  | { type: 'event'; key: string; start: number; end: number; occurrence: EventOccurrence }
  | { type: 'block'; key: string; start: number; end: number; block: ScheduleBlock }
  | { type: 'free'; key: string; start: number; end: number };

export function clock(ms: number, timeZone: string): string {
  const m = utcToLocalMinutes(ms, timeZone);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Merges events and blocks into one ordered day, with free gaps of 30+ minutes made visible. */
export function buildTimeline(blocks: ScheduleBlock[], events: EventOccurrence[], dayStart: number, dayEnd: number): TimelineItem[] {
  const items: TimelineItem[] = [
    ...events.filter((o) => !o.event.all_day).map((o) => ({ type: 'event' as const, key: `e:${o.key}`, start: o.start, end: o.end, occurrence: o })),
    ...blocks
      .filter((b) => b.status !== 'unplanned' && b.status !== 'skipped')
      .map((b) => ({ type: 'block' as const, key: `b:${b.id}`, start: Date.parse(b.starts_at), end: Date.parse(b.ends_at), block: b })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: TimelineItem[] = [];
  let cursor = dayStart;
  for (const it of items) {
    if (it.start - cursor >= 30 * 60_000 && it.start <= dayEnd) out.push({ type: 'free', key: `f:${cursor}`, start: cursor, end: Math.min(it.start, dayEnd) });
    out.push(it);
    cursor = Math.max(cursor, it.end);
  }
  if (dayEnd - cursor >= 30 * 60_000) out.push({ type: 'free', key: `f:${cursor}`, start: cursor, end: dayEnd });
  return out;
}

const BLOCK_ICON: Record<string, LucideIcon> = { break: Coffee, habit: Repeat, training: Dumbbell, focus: BookOpen, task: CircleDot, custom: CalendarClock, protected_free: Coffee };

export function TimelineRow({
  item,
  timeZone,
  now,
  onBlockPress,
  onToggleDone,
}: {
  item: TimelineItem;
  timeZone: string;
  now: number;
  onBlockPress?: (b: ScheduleBlock) => void;
  onToggleDone?: (b: ScheduleBlock) => void;
}) {
  const { colors, categoryColor } = useTheme();
  const time = `${clock(item.start, timeZone)}–${clock(item.end, timeZone)}`;
  const current = now >= item.start && now < item.end;
  if (item.type === 'free') {
    return (
      <View style={styles.row} accessibilityLabel={`Free time ${time}`}>
        <Text variant="caption" tone="tertiary" tabular style={styles.time}>
          {clock(item.start, timeZone)}
        </Text>
        <View style={[styles.free, { borderColor: colors.border }]}>
          <Text variant="caption" tone="tertiary">
            Free · {formatHours((item.end - item.start) / 60_000)}
          </Text>
        </View>
      </View>
    );
  }
  if (item.type === 'event') {
    const ev = item.occurrence.event;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${ev.title}, ${time}${ev.is_locked ? ', locked' : ''}`}
        onPress={() => router.push({ pathname: '/(app)/event/edit', params: { id: ev.id } })}
        style={styles.row}
      >
        <Text variant="caption" tone={current ? 'accent' : 'secondary'} tabular style={styles.time}>
          {clock(item.start, timeZone)}
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surfaceSecondary, borderLeftColor: categoryColor('slate') }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {ev.title}
            </Text>
            <Text variant="caption" tone="secondary" tabular>
              {time}
              {ev.location ? ` · ${ev.location}` : ''}
            </Text>
          </View>
          {ev.is_locked ? <Icon icon={Lock} size={14} tone="tertiary" /> : null}
        </View>
      </Pressable>
    );
  }
  const b = item.block;
  const done = b.status === 'done';
  const missed = b.status === 'missed';
  const isBreak = b.kind === 'break';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${b.title}, ${time}${done ? ', done' : missed ? ', not done' : ''}${b.is_locked ? ', locked' : ''}`}
      accessibilityHint="Opens options to move, lock, resize or complete"
      onPress={() => onBlockPress?.(b)}
      style={styles.row}
    >
      <Text variant="caption" tone={current ? 'accent' : 'secondary'} tabular style={styles.time}>
        {clock(item.start, timeZone)}
      </Text>
      <View
        style={[
          styles.card,
          {
            backgroundColor: isBreak ? 'transparent' : colors.surface,
            borderColor: current ? colors.accent : colors.border,
            borderWidth: isBreak ? 0 : StyleSheet.hairlineWidth,
            borderLeftColor: b.kind === 'habit' ? colors.success : isBreak ? colors.border : colors.accent,
          },
        ]}
      >
        {!isBreak && onToggleDone && (b.kind === 'task' || b.kind === 'habit') ? (
          <Checkbox checked={done} onToggle={() => onToggleDone(b)} label={`Mark ${b.title} ${done ? 'not done' : 'done'}`} />
        ) : (
          <Icon icon={BLOCK_ICON[b.kind] ?? CircleDot} size={16} tone="tertiary" />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant={isBreak ? 'callout' : 'bodyStrong'} tone={done ? 'tertiary' : isBreak ? 'secondary' : 'primary'} numberOfLines={1} style={done ? { textDecorationLine: 'line-through' } : undefined}>
            {b.title}
          </Text>
          <Text variant="caption" tone={missed ? 'warning' : 'secondary'} numberOfLines={1} tabular>
            {missed ? 'Not done · tap for options' : `${time}${b.origin === 'manual' ? ' · set by you' : ''}`}
          </Text>
        </View>
        {b.is_locked ? <Icon icon={Lock} size={14} tone="tertiary" /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', gap: space.md, minHeight: 44 },
  time: { width: 42, paddingTop: space.md },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderLeftWidth: 3,
  },
  free: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed', borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.md, justifyContent: 'center' },
});
