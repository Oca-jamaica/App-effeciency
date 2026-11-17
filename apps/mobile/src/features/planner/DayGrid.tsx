import { localToUtc, utcToLocalMinutes } from '@ascend/domain';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { ScheduleBlock } from '@/data/types';
import { Text, radius, space, useTheme } from '@/ui';
import type { EventOccurrence } from './events';

const HOUR = 56;
const SNAP_MIN = 5;

/**
 * Day view as a time grid. Planned blocks can be dragged (hold, then move) to reschedule; they snap to
 * 5 minutes and become "set by you". Events show as fixed; locked items cannot be dragged.
 */
export function DayGrid({
  date,
  timeZone,
  startHour,
  endHour,
  blocks,
  events,
  now,
  onMoveBlock,
  onBlockPress,
}: {
  date: string;
  timeZone: string;
  startHour: number;
  endHour: number;
  blocks: ScheduleBlock[];
  events: EventOccurrence[];
  now: number;
  onMoveBlock: (block: ScheduleBlock, newStart: number) => void;
  onBlockPress: (block: ScheduleBlock) => void;
}) {
  const { colors } = useTheme();
  const origin = localToUtc(date, startHour * 60, timeZone);
  const toY = (ms: number) => ((ms - origin) / 3_600_000) * HOUR;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
  const nowY = toY(now);

  return (
    <View style={{ height: (endHour - startHour) * HOUR + 16, marginTop: space.sm }}>
      {hours.map((h, i) => (
        <View key={h} style={[styles.hourLine, { top: i * HOUR }]}>
          <Text variant="caption" tone="tertiary" tabular style={styles.hourLabel}>
            {String(h % 24).padStart(2, '0')}:00
          </Text>
          <View style={[styles.rule, { backgroundColor: colors.border }]} />
        </View>
      ))}
      {events
        .filter((o) => !o.event.all_day)
        .map((o) => {
          const top = Math.max(0, toY(o.start));
          const height = Math.max(22, toY(o.end) - top);
          return (
            <View key={o.key} style={[styles.item, { top, height, backgroundColor: colors.surfaceSecondary, borderLeftColor: colors.textTertiary }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {o.event.is_locked ? <Lock size={11} color={colors.textTertiary} /> : null}
                <Text variant="captionStrong" numberOfLines={1} onPress={() => router.push({ pathname: '/(app)/event/edit', params: { id: o.event.id } })}>
                  {o.event.title}
                </Text>
              </View>
            </View>
          );
        })}
      {blocks
        .filter((b) => b.status !== 'unplanned' && b.status !== 'skipped')
        .map((b) => (
          <DraggableBlock key={b.id} block={b} top={toY(Date.parse(b.starts_at))} height={Math.max(22, toY(Date.parse(b.ends_at)) - toY(Date.parse(b.starts_at)))} onPress={() => onBlockPress(b)} onDrop={(deltaPx) => {
            const minutes = Math.round(((deltaPx / HOUR) * 60) / SNAP_MIN) * SNAP_MIN;
            if (minutes === 0) return;
            const newStartLocal = utcToLocalMinutes(Date.parse(b.starts_at), timeZone) + minutes;
            onMoveBlock(b, localToUtc(date, newStartLocal, timeZone));
          }} />
        ))}
      {nowY > 0 && nowY < (endHour - startHour) * HOUR ? <View style={[styles.now, { top: nowY, backgroundColor: colors.accent }]} accessibilityLabel="Current time" /> : null}
    </View>
  );
}

function DraggableBlock({ block, top, height, onDrop, onPress }: { block: ScheduleBlock; top: number; height: number; onDrop: (delta: number) => void; onPress: () => void }) {
  const { colors } = useTheme();
  const offset = useSharedValue(0);
  const lifted = useSharedValue(0);
  const draggable = !block.is_locked && block.status !== 'done' && block.kind !== 'break';
  useEffect(() => {
    offset.value = 0;
  }, [top, offset]);
  const haptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  const pan = usePanGesture({
    enabled: draggable,
    activateAfterLongPress: 300,
    onActivate: () => {
      'worklet';
      lifted.value = 1;
      runOnJS(haptic)();
    },
    onUpdate: (e) => {
      'worklet';
      const snap = (HOUR / 60) * SNAP_MIN;
      offset.value = Math.round(e.translationY / snap) * snap;
    },
    onDeactivate: () => {
      'worklet';
      lifted.value = 0;
      runOnJS(onDrop)(offset.value);
    },
  });
  const tap = useTapGesture({
    onActivate: () => {
      'worklet';
      runOnJS(onPress)();
    },
  });
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }], zIndex: lifted.value ? 20 : 1, opacity: lifted.value ? 0.92 : 1 }));
  const accent = block.kind === 'habit' ? colors.success : block.kind === 'break' ? colors.border : colors.accent;
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.item, { top, height, backgroundColor: block.kind === 'break' ? 'transparent' : colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, borderLeftColor: accent }, style]}>
        <GestureDetector gesture={tap}>
          <View
            style={{ flex: 1 }}
            accessible
            accessibilityRole="button"
            accessibilityLabel={`${block.title}${block.is_locked ? ', locked' : ''}${draggable ? '. Hold and drag to move.' : ''}`}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {block.is_locked ? <Lock size={11} color={colors.textTertiary} /> : null}
              <Text variant="captionStrong" numberOfLines={1} tone={block.status === 'done' ? 'tertiary' : block.kind === 'break' ? 'secondary' : 'primary'} style={block.status === 'done' ? { textDecorationLine: 'line-through' } : undefined}>
                {block.title}
              </Text>
            </View>
          </View>
        </GestureDetector>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hourLine: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 16, marginTop: -8 },
  hourLabel: { width: 40 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  item: { position: 'absolute', left: 48, right: 0, borderRadius: radius.sm, borderLeftWidth: 3, paddingHorizontal: space.sm, paddingVertical: 3, overflow: 'hidden' },
  now: { position: 'absolute', left: 44, right: 0, height: 2, borderRadius: 1 },
});
