import { diffDays, goalRoadmap } from '@ascend/domain';
import { StyleSheet, View } from 'react-native';
import type { Goal, Milestone } from '@/data/types';
import { Card, Row, Text, formatDateLabel, space, useTheme } from '@/ui';

const DOT = 14;

/** The goal's milestones as markers on a line from its start to its deadline, with today shown. */
export function RoadmapCard({ goal, milestones, today }: { goal: Goal; milestones: Milestone[]; today: string }) {
  const { colors } = useTheme();
  const r = goalRoadmap({
    startDate: goal.started_on || goal.created_at.slice(0, 10),
    deadline: goal.deadline,
    today,
    milestones: milestones.map((m) => ({ id: m.id, title: m.title, deadline: m.deadline, status: m.status })),
  });
  if (!r.markers.length || !r.end) return null;
  const pct = (p: number) => `${Math.round(p * 1000) / 10}%` as const;
  const when = (d: string) => {
    const n = diffDays(today, d);
    return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 0 ? `in ${n} days` : `${-n} day${n === -1 ? '' : 's'} late`;
  };
  return (
    <Card>
      <Text variant="subheading">Roadmap</Text>
      <View style={styles.track} accessibilityRole="image" accessibilityLabel={`Roadmap: ${r.markers.map((m) => `${m.title} ${m.done ? 'done' : `by ${formatDateLabel(m.date!)}`}`).join('; ')}`}>
        <View style={[styles.line, { backgroundColor: colors.border }]} />
        {r.todayPosition !== null ? <View style={[styles.fill, { backgroundColor: colors.accent, opacity: 0.35, width: pct(r.todayPosition) }]} /> : null}
        {r.todayPosition !== null ? <View style={[styles.today, { left: pct(r.todayPosition), backgroundColor: colors.textTertiary }]} /> : null}
        {r.markers.map((m) => (
          <View
            key={m.id}
            style={[
              styles.dot,
              {
                left: pct(m.position ?? 0),
                backgroundColor: m.done ? colors.accent : colors.surface,
                borderColor: m.done ? colors.accent : m.overdue ? colors.warning : colors.accent,
              },
            ]}
          />
        ))}
      </View>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="caption" tone="tertiary">{formatDateLabel(r.start)}</Text>
        <Text variant="caption" tone="tertiary">{goal.deadline ? `Deadline ${formatDateLabel(r.end)}` : formatDateLabel(r.end)}</Text>
      </Row>
      {r.next ? (
        <Text variant="callout">
          <Text variant="captionStrong" tone="secondary">Next: </Text>
          {r.next.title} · {when(r.next.date!)}
        </Text>
      ) : (
        <Text variant="callout" tone="secondary">Every dated milestone is done.</Text>
      )}
      {r.overdueCount ? (
        <Text variant="caption" tone="secondary">
          {r.overdueCount} milestone{r.overdueCount === 1 ? ' is' : 's are'} past {r.overdueCount === 1 ? 'its' : 'their'} date. Mark {r.overdueCount === 1 ? 'it' : 'them'} done or choose a new date.
        </Text>
      ) : null}
      {r.undated.length ? <Text variant="caption" tone="tertiary">{r.undated.length} milestone{r.undated.length === 1 ? ' has' : 's have'} no date, so {r.undated.length === 1 ? 'it isn’t' : 'they aren’t'} on the line.</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  track: { height: 28, justifyContent: 'center', marginHorizontal: DOT / 2, marginTop: space.xs },
  line: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2 },
  fill: { position: 'absolute', left: 0, height: 3, borderRadius: 2 },
  today: { position: 'absolute', width: 2, height: 22, marginLeft: -1, borderRadius: 1 },
  dot: { position: 'absolute', width: DOT, height: DOT, marginLeft: -DOT / 2, borderRadius: DOT / 2, borderWidth: 2 },
});
