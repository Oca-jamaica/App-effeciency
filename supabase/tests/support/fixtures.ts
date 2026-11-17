import { randomUUID } from 'node:crypto';

/**
 * A valid row for every synced table, created through sync_push in dependency order. Used by the
 * generic isolation tests so that every table is exercised, including ones added later.
 */
export function fixtureChanges(): { changes: { table: string; id: string; op: 'upsert'; patch: Record<string, unknown> }[]; ids: Record<string, string> } {
  const ids: Record<string, string> = {
    availability_windows: randomUUID(),
    categories: randomUUID(),
    goals: randomUUID(),
    milestones: randomUUID(),
    goal_checklist_items: randomUUID(),
    goal_progress_entries: randomUUID(),
    notes: randomUUID(),
    knowledge_items: randomUUID(),
    habits: randomUUID(),
    habit_logs: randomUUID(),
    tasks: randomUUID(),
    task_events: randomUUID(),
    calendar_events: randomUUID(),
    reminders: randomUUID(),
    schedule_blocks: randomUUID(),
  };
  const now = new Date().toISOString();
  const patches: Record<string, Record<string, unknown>> = {
    availability_windows: { weekday: 1, start_time: '16:00', end_time: '19:00', kind: 'study' },
    categories: { name: `Cat ${ids.categories!.slice(0, 6)}`, color: 'blue', icon: 'book', applies_to: ['goal', 'task'], is_default: false, rank: 'b0' },
    goals: { title: 'Improve Economics results', status: 'active', rank: 'a0', progress_mode: 'milestones', category_id: ids.categories, started_on: '2026-11-01' },
    milestones: { goal_id: ids.goals, title: 'Finish unit 3', status: 'open', rank: 'a0', deadline: '2026-12-01' },
    goal_checklist_items: { goal_id: ids.goals, title: 'Buy revision guide', is_done: false, rank: 'a0' },
    goal_progress_entries: { goal_id: ids.goals, value: 55, source: 'manual', recorded_at: now },
    notes: { title: 'Strategy', body: 'Past papers every Sunday', note_type: 'strategy', goal_id: ids.goals, pinned: false, tags: ['economics'] },
    knowledge_items: { kind: 'video', title: 'Elasticity explained', url: 'https://www.youtube.com/watch?v=abc', goal_id: ids.goals, milestone_id: ids.milestones, tags: [], is_favorite: false },
    habits: { name: 'Revision', frequency_kind: 'weekdays', days_of_week: [1, 3, 5], start_date: '2026-11-01', duration_minutes: 45, preferred_window: 'evening', status: 'active', reminder_times: ['18:00'], rank: 'a0', goal_id: ids.goals },
    habit_logs: { habit_id: ids.habits, log_date: '2026-11-16', status: 'done', logged_at: now },
    tasks: { title: 'Past paper 2023', priority: 2, status: 'planned', estimated_minutes: 60, splittable: false, min_chunk_minutes: 25, preferred_window: 'any', goal_id: ids.goals, milestone_id: ids.milestones, rank: 'a0', due_date: '2026-11-20' },
    task_events: { task_id: ids.tasks, event_type: 'created', origin: 'user', occurred_at: now, to_value: { status: 'planned' } },
    calendar_events: { title: 'Football training', starts_at: '2026-11-17T17:00:00Z', ends_at: '2026-11-17T18:30:00Z', all_day: false, timezone: 'Europe/London', kind: 'training', is_locked: true, busy: true, exdates: [] },
    reminders: { title: 'Bring boots', remind_at: '2026-11-17T16:00:00Z', event_id: ids.calendar_events },
    schedule_blocks: { block_date: '2026-11-17', starts_at: '2026-11-17T15:00:00Z', ends_at: '2026-11-17T16:00:00Z', kind: 'task', task_id: ids.tasks, title: 'Past paper 2023', origin: 'auto', is_locked: false, status: 'planned' },
  };
  const order = Object.keys(ids);
  return {
    ids,
    changes: order.map((table) => ({ table, id: ids[table]!, op: 'upsert' as const, patch: patches[table]! })),
  };
}
