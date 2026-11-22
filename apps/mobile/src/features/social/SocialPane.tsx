import { addDays, upcomingBirthdays } from '@ascend/domain';
import { router } from 'expo-router';
import { Cake, MapPin, Users } from 'lucide-react-native';
import { View } from 'react-native';
import { useLive } from '@/data/DataProvider';
import type { Experience, Person } from '@/data/types';
import { occurrencesInRange } from '@/features/planner/events';
import { clock } from '@/features/planner/Timeline';
import { useToday, useUserContext } from '@/hooks/useUser';
import { Button, EmptyState, Group, ListRow, Section, Text, formatDateLabel, space } from '@/ui';

/** Planner → Social: plans with friends, birthdays, people and experiences. Time with people is protected, not scored. */
export function SocialPane() {
  const ctx = useUserContext();
  const { today } = useToday(ctx.timeZone);
  const data = useLive(
    async (s) => {
      const [events, people, experiences] = await Promise.all([
        occurrencesInRange(s, today, addDays(today, 30), ctx.timeZone),
        s.list<Person>('people', { orderBy: 'name COLLATE NOCASE' }),
        s.list<Experience>('experiences', { where: "status != 'done'", orderBy: "status = 'someday', COALESCE(target_date, '9999')", limit: 5 }),
      ]);
      return {
        plans: events.filter((o) => o.event.kind === 'social'),
        birthdays: upcomingBirthdays(people.map((p) => ({ ...p, birthdayMonth: p.birthday_month, birthdayDay: p.birthday_day, birthYear: p.birth_year })), today, 60),
        peopleCount: people.length,
        experiences,
      };
    },
    [today, ctx.timeZone],
    ['calendar_events', 'people', 'experiences'],
  );
  const d = data.data;
  return (
    <View style={{ gap: space.xxl }}>
      <Button label="Plan something with friends" icon={Users} onPress={() => router.push({ pathname: '/(app)/event/edit', params: { kind: 'social' } })} />
      <Section title="Coming up">
        {d?.plans.length ? (
          <Group>
            {d.plans.map((o) => (
              <ListRow
                key={o.key}
                title={o.event.title}
                subtitle={`${o.date === today ? 'Today' : formatDateLabel(o.date)} · ${o.event.all_day ? 'All day' : `${clock(o.start, ctx.timeZone)}–${clock(o.end, ctx.timeZone)}`}${o.event.location ? ` · ${o.event.location}` : ''}`}
                chevron
                onPress={() => router.push({ pathname: '/(app)/event/edit', params: { id: o.event.id } })}
              />
            ))}
          </Group>
        ) : (
          <Text variant="callout" tone="secondary">No plans in the next month. Social plans are protected in your schedule like any other commitment.</Text>
        )}
      </Section>
      <Section title="Birthdays" action="People" onAction={() => router.push({ pathname: '/(app)/c/[key]', params: { key: 'people' } })}>
        {d?.birthdays.length ? (
          <Group>
            {d.birthdays.map((b) => (
              <ListRow
                key={b.person.id}
                icon={Cake}
                title={b.person.name}
                subtitle={`${b.inDays === 0 ? 'Today' : b.inDays === 1 ? 'Tomorrow' : formatDateLabel(b.date)}${b.turning ? ` · turning ${b.turning}` : ''}`}
                chevron
                onPress={() => router.push({ pathname: '/(app)/c/[key]/edit', params: { key: 'people', id: b.person.id } })}
              />
            ))}
          </Group>
        ) : d?.peopleCount ? (
          <Text variant="callout" tone="secondary">No birthdays in the next two months.</Text>
        ) : (
          <EmptyState compact title="Remember the people who matter" body="Add friends and family with their birthdays. Only you can see them." actionLabel="Add someone" onAction={() => router.push({ pathname: '/(app)/c/[key]/edit', params: { key: 'people' } })} />
        )}
      </Section>
      <Section title="Experiences" action="All" onAction={() => router.push({ pathname: '/(app)/c/[key]', params: { key: 'experiences' } })}>
        {d?.experiences.length ? (
          <Group>
            {d.experiences.map((e) => (
              <ListRow key={e.id} icon={MapPin} title={e.title} subtitle={[e.status === 'planned' ? 'Planned' : 'Someday', e.target_date ? formatDateLabel(e.target_date) : null, e.location].filter(Boolean).join(' · ')} chevron onPress={() => router.push({ pathname: '/(app)/c/[key]/edit', params: { key: 'experiences', id: e.id } })} />
            ))}
          </Group>
        ) : (
          <Text variant="callout" tone="secondary">Places to visit, events to attend, things to try.</Text>
        )}
      </Section>
    </View>
  );
}
