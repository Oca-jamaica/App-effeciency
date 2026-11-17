import * as Haptics from 'expo-haptics';
import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useTheme } from './theme';

/**
 * A list whose rows can be reordered by long-pressing and dragging. Rows have a fixed height.
 * Screen-reader users get "Move up" / "Move down" actions on every row instead.
 */
export function ReorderableList<T>({
  data,
  keyOf,
  itemHeight,
  renderItem,
  onMove,
}: {
  data: readonly T[];
  keyOf: (item: T) => string;
  itemHeight: number;
  renderItem: (item: T, index: number) => ReactNode;
  /** Called after a drop with the item's key and its new index. */
  onMove: (key: string, toIndex: number) => void;
}) {
  const positions = useSharedValue<Record<string, number>>({});
  const active = useSharedValue<string | null>(null);

  useEffect(() => {
    const next: Record<string, number> = {};
    data.forEach((item, i) => (next[keyOf(item)] = i));
    positions.value = next;
  }, [data, keyOf, positions]);

  return (
    <View style={{ height: data.length * itemHeight }}>
      {data.map((item, index) => {
        const key = keyOf(item);
        return (
          <Row key={key} id={key} index={index} count={data.length} itemHeight={itemHeight} positions={positions} active={active} onMove={onMove}>
            {renderItem(item, index)}
          </Row>
        );
      })}
    </View>
  );
}

function Row({
  id,
  index,
  count,
  itemHeight,
  positions,
  active,
  onMove,
  children,
}: {
  id: string;
  index: number;
  count: number;
  itemHeight: number;
  positions: SharedValue<Record<string, number>>;
  active: SharedValue<string | null>;
  onMove: (key: string, toIndex: number) => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const top = useSharedValue(index * itemHeight);
  const startTop = useSharedValue(0);

  useEffect(() => {
    top.value = index * itemHeight;
  }, [index, itemHeight, top]);

  useAnimatedReaction(
    () => positions.value[id],
    (pos, prev) => {
      if (pos !== undefined && pos !== prev && active.value !== id) top.value = withTiming(pos * itemHeight, { duration: 160 });
    },
  );

  const haptic = () => Haptics.selectionAsync().catch(() => undefined);

  const pan = usePanGesture({
    activateAfterLongPress: 280,
    onActivate: () => {
      'worklet';
      active.value = id;
      startTop.value = top.value;
      runOnJS(haptic)();
    },
    onUpdate: (e) => {
      'worklet';
      top.value = Math.max(0, Math.min((count - 1) * itemHeight, startTop.value + e.translationY));
      const target = Math.max(0, Math.min(count - 1, Math.round(top.value / itemHeight)));
      const from = positions.value[id];
      if (from === undefined || target === from) return;
      const next: Record<string, number> = {};
      for (const [k, p] of Object.entries(positions.value)) {
        if (k === id) next[k] = target;
        else if (from < target && p > from && p <= target) next[k] = p - 1;
        else if (from > target && p < from && p >= target) next[k] = p + 1;
        else next[k] = p;
      }
      positions.value = next;
      runOnJS(haptic)();
    },
    onDeactivate: () => {
      'worklet';
      const pos = positions.value[id] ?? 0;
      top.value = withTiming(pos * itemHeight, { duration: 160 });
      active.value = null;
      runOnJS(onMove)(id, pos);
    },
  });

  const style = useAnimatedStyle(() => {
    const isActive = active.value === id;
    return {
      position: 'absolute',
      left: 0,
      right: 0,
      height: itemHeight,
      top: top.value,
      zIndex: isActive ? 10 : 0,
      transform: [{ scale: withTiming(isActive ? 1.02 : 1, { duration: 120 }) }],
      opacity: isActive ? 0.96 : 1,
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[style, { backgroundColor: colors.background }]}
        accessibilityActions={[
          { name: 'moveUp', label: 'Move up' },
          { name: 'moveDown', label: 'Move down' },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'moveUp' && index > 0) onMove(id, index - 1);
          if (e.nativeEvent.actionName === 'moveDown' && index < count - 1) onMove(id, index + 1);
        }}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
