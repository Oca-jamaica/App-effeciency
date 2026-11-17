-- ASCEND foundation: private helpers, identity, preferences, categories, and the sync API.
-- Conventions: docs/03-database.md. Every user-owned table is registered with
-- ascend_private.register_owned_table(), which applies RLS, grants, triggers and indexes uniformly.

create schema if not exists ascend_private;
revoke all on schema ascend_private from public;
grant usage on schema ascend_private to authenticated, service_role;

-- ─────────────────────────── helpers ───────────────────────────

-- Server time is the only clock trusted for sync cursors.
create or replace function ascend_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  if tg_op = 'INSERT' and new.created_at is null then
    new.created_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create or replace function ascend_private.guard_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'id cannot be changed' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Registry of tables exposed to sync_push / sync_pull. Not exposed through the API.
create table ascend_private.sync_tables (
  name text primary key,
  sync_order integer not null,
  natural_key text[]
);
grant select on ascend_private.sync_tables to authenticated, service_role;

create or replace function ascend_private.register_owned_table(
  tbl regclass,
  sync_order integer,
  natural_key text[] default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  rel text := (select c.relname from pg_catalog.pg_class c where c.oid = tbl);
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('revoke all on %s from public, anon', tbl);
  execute format('grant select, insert, update, delete on %s to authenticated', tbl);
  execute format('grant all on %s to service_role', tbl);
  execute format(
    'create policy %I on %s for select to authenticated using (user_id = (select auth.uid()))',
    rel || '_owner_select', tbl);
  execute format(
    'create policy %I on %s for insert to authenticated with check (user_id = (select auth.uid()))',
    rel || '_owner_insert', tbl);
  execute format(
    'create policy %I on %s for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
    rel || '_owner_update', tbl);
  execute format(
    'create policy %I on %s for delete to authenticated using (user_id = (select auth.uid()))',
    rel || '_owner_delete', tbl);
  execute format(
    'create trigger set_updated_at before insert or update on %s for each row execute function ascend_private.set_updated_at()',
    tbl);
  execute format(
    'create trigger guard_identity before update on %s for each row execute function ascend_private.guard_identity()',
    tbl);
  execute format('create index %I on %s (user_id, updated_at, id)', rel || '_sync_idx', tbl);
  insert into ascend_private.sync_tables (name, sync_order, natural_key)
  values (rel, sync_order, natural_key)
  on conflict (name) do update set sync_order = excluded.sync_order, natural_key = excluded.natural_key;
end;
$$;

-- ─────────────────────────── identity & preferences ───────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  user_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  display_name text check (char_length(display_name) <= 80),
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  locale text check (char_length(locale) <= 35),
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  onboarding_completed_at timestamptz,
  check (id = user_id)
);
select ascend_private.register_owned_table('public.profiles', 10);

create table public.user_preferences (
  id uuid primary key references auth.users (id) on delete cascade,
  user_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  day_start time not null default '07:00',
  day_end time not null default '22:30',
  default_task_minutes smallint not null default 30 check (default_task_minutes between 5 and 480),
  max_focus_minutes_per_day smallint not null default 360 check (max_focus_minutes_per_day between 30 and 960),
  max_block_minutes smallint not null default 90 check (max_block_minutes between 15 and 240),
  break_after_minutes smallint not null default 90 check (break_after_minutes between 25 and 240),
  break_minutes smallint not null default 15 check (break_minutes between 5 and 60),
  buffer_minutes smallint not null default 10 check (buffer_minutes between 0 and 60),
  min_free_minutes_per_day smallint not null default 120 check (min_free_minutes_per_day between 0 and 720),
  schedule_inbox_with_deadline boolean not null default true,
  ai_enabled boolean not null default false,
  ai_auto_apply_low_risk boolean not null default false,
  ai_daily_briefing boolean not null default true,
  ai_access_journal boolean not null default false,
  ai_access_decisions boolean not null default false,
  ai_access_notes boolean not null default true,
  ai_access_memory boolean not null default true,
  ai_access_sleep boolean not null default false,
  quiet_hours_start time default '22:30',
  quiet_hours_end time default '07:00',
  max_notifications_per_day smallint not null default 8 check (max_notifications_per_day between 0 and 50),
  notify_block_start boolean not null default false,
  check (id = user_id),
  check (day_end > day_start)
);
select ascend_private.register_owned_table('public.user_preferences', 11);

create table public.availability_windows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  kind text not null check (kind in ('work', 'study', 'training', 'protected_free', 'no_scheduling')),
  check (end_time > start_time),
  unique (id, user_id)
);
select ascend_private.register_owned_table('public.availability_windows', 12);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color text not null default 'slate' check (char_length(color) <= 32),
  icon text not null default 'circle' check (char_length(icon) <= 48),
  applies_to text[] not null default '{goal,task,habit,event}',
  is_default boolean not null default false,
  rank text collate "C" not null,
  archived_at timestamptz,
  unique (id, user_id)
);
create unique index categories_user_name_uniq on public.categories (user_id, lower(name)) where deleted_at is null;
select ascend_private.register_owned_table('public.categories', 13);

-- New accounts get a profile, preferences and the default categories (all editable and deletable).
create or replace function ascend_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz text := coalesce(nullif(new.raw_user_meta_data ->> 'timezone', ''), 'UTC');
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = tz) then
    tz := 'UTC';
  end if;
  insert into public.profiles (id, user_id, timezone, display_name)
  values (new.id, new.id, tz, nullif(left(new.raw_user_meta_data ->> 'display_name', 80), ''));
  insert into public.user_preferences (id, user_id) values (new.id, new.id);
  insert into public.categories (user_id, name, color, icon, is_default, rank)
  values
    (new.id, 'Academics', 'blue', 'graduation-cap', true, 'a0'),
    (new.id, 'Fitness', 'green', 'dumbbell', true, 'a1'),
    (new.id, 'Football & sport', 'teal', 'trophy', true, 'a2'),
    (new.id, 'Personal development', 'violet', 'sprout', true, 'a3'),
    (new.id, 'Social', 'amber', 'users', true, 'a4'),
    (new.id, 'Business', 'indigo', 'briefcase', true, 'a5'),
    (new.id, 'Projects', 'rose', 'folder-kanban', true, 'a6'),
    (new.id, 'Other', 'slate', 'circle', true, 'a7');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function ascend_private.handle_new_user();

-- ─────────────────────────── sync API ───────────────────────────

-- Apply a batch of changes from a device. Runs as the calling user, so RLS applies to every row.
-- Each change: {"table": text, "id": uuid, "op": "upsert" | "delete", "patch": {...}, "meta": {...}}
-- Result per change: {"id", "status": applied | merged | remapped | gone | rejected, "row"?, "new_id"?, "code"?, "message"?}
create or replace function public.sync_push(changes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ch jsonb;
  results jsonb := '[]'::jsonb;
  tbl text;
  rid uuid;
  op text;
  patch jsonb;
  meta jsonb;
  nk text[];
  cols text[];
  setlist text;
  collist text;
  res jsonb;
  exists_flag boolean;
  existing_id uuid;
  existing_status text;
  merged boolean;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if changes is null or jsonb_typeof(changes) <> 'array' then
    raise exception 'changes must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(changes) > 500 then
    raise exception 'batch too large (max 500)' using errcode = '22023';
  end if;

  for ch in select value from jsonb_array_elements(changes) loop
    tbl := ch ->> 'table';
    op := ch ->> 'op';
    patch := coalesce(ch -> 'patch', '{}'::jsonb);
    meta := coalesce(ch -> 'meta', '{}'::jsonb);
    merged := false;
    res := null;
    begin
      rid := (ch ->> 'id')::uuid;
      if rid is null then
        raise exception 'missing id' using errcode = '22023';
      end if;
      select st.natural_key into nk from ascend_private.sync_tables st where st.name = tbl;
      if not found then
        raise exception 'unknown table %', tbl using errcode = '22023';
      end if;
      if jsonb_typeof(patch) <> 'object' then
        raise exception 'patch must be an object' using errcode = '22023';
      end if;
      -- Server-controlled columns are never taken from the client.
      patch := patch - 'id' - 'user_id' - 'updated_at';

      if op = 'delete' then
        execute format(
          'update public.%1$I t set deleted_at = coalesce(t.deleted_at, clock_timestamp()) where t.id = $1 returning to_jsonb(t.*)',
          tbl) into res using rid;
        results := results || case
          when res is null then jsonb_build_object('id', rid, 'status', 'gone')
          else jsonb_build_object('id', rid, 'status', 'applied', 'row', res)
        end;

      elsif op = 'upsert' then
        -- Completion is sticky: an offline edit cannot silently un-complete a task.
        if tbl = 'tasks' and patch ? 'status' and not coalesce((meta ->> 'reopen')::boolean, false) then
          select t.status into existing_status from public.tasks t where t.id = rid;
          if existing_status = 'completed' and patch ->> 'status' in ('inbox', 'planned', 'in_progress') then
            patch := patch - 'status' - 'completed_at';
            merged := true;
          end if;
        end if;

        select array_agg(a.attname::text order by a.attnum) into cols
        from pg_catalog.pg_attribute a
        where a.attrelid = format('public.%I', tbl)::regclass
          and a.attnum > 0 and not a.attisdropped
          and patch ? a.attname::text;

        execute format('select true from public.%I t where t.id = $1', tbl) into exists_flag using rid;

        if coalesce(exists_flag, false) then
          if cols is null then
            execute format('select to_jsonb(t.*) from public.%I t where t.id = $1', tbl) into res using rid;
          else
            select string_agg(format('%1$I = r.%1$I', c), ', ') into setlist
            from unnest(cols) c where c <> 'created_at';
            if setlist is null then
              execute format('select to_jsonb(t.*) from public.%I t where t.id = $1', tbl) into res using rid;
            else
              execute format(
                'update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I, $1) r where t.id = $2 returning to_jsonb(t.*)',
                tbl, setlist) into res using patch, rid;
            end if;
          end if;
          results := results || jsonb_build_object('id', rid, 'status', case when merged then 'merged' else 'applied' end, 'row', res);
        else
          existing_id := null;
          if nk is not null then
            execute format(
              'select t.id from public.%1$I t, jsonb_populate_record(null::public.%1$I, $1) r where %2$s and t.deleted_at is null',
              tbl,
              (select string_agg(format('t.%1$I = r.%1$I', c), ' and ') from unnest(nk) c))
            into existing_id using patch;
          end if;
          if existing_id is not null then
            -- Another device already created this natural-key row: merge into it and tell the device its id.
            select string_agg(format('%1$I = r.%1$I', c), ', ') into setlist
            from unnest(cols) c where c <> 'created_at' and not (c = any (nk));
            if setlist is null then
              execute format('select to_jsonb(t.*) from public.%I t where t.id = $1', tbl) into res using existing_id;
            else
              execute format(
                'update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I, $1) r where t.id = $2 returning to_jsonb(t.*)',
                tbl, setlist) into res using patch, existing_id;
            end if;
            results := results || jsonb_build_object('id', rid, 'status', 'remapped', 'new_id', existing_id, 'row', res);
          else
            select string_agg(format('%I', c), ', ') into collist from unnest(cols) c;
            execute format(
              'insert into public.%1$I (id%2$s) select $2%3$s from jsonb_populate_record(null::public.%1$I, $1) r returning to_jsonb(%1$I.*)',
              tbl,
              coalesce(', ' || collist, ''),
              coalesce(', ' || (select string_agg(format('r.%I', c), ', ') from unnest(cols) c), ''))
            into res using patch, rid;
            results := results || jsonb_build_object('id', rid, 'status', case when merged then 'merged' else 'applied' end, 'row', res);
          end if;
        end if;
      else
        raise exception 'invalid op %', op using errcode = '22023';
      end if;
    exception when others then
      results := results || jsonb_build_object('id', ch ->> 'id', 'status', 'rejected', 'code', sqlstate, 'message', sqlerrm);
    end;
  end loop;
  return results;
end;
$$;

-- Rows changed since the device's per-table cursors, using keyset pagination on (updated_at, id).
-- cursors: {"<table>": {"ts": timestamptz | null, "id": uuid | null}}. Tombstones are included.
create or replace function public.sync_pull(cursors jsonb default '{}'::jsonb, max_rows integer default 500)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  t record;
  since_ts timestamptz;
  since_id uuid;
  rows_json jsonb;
  n integer;
  lim integer := least(greatest(coalesce(max_rows, 500), 1), 2000);
  result jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  for t in select st.name from ascend_private.sync_tables st order by st.sync_order loop
    since_ts := coalesce((cursors -> t.name ->> 'ts')::timestamptz, '-infinity'::timestamptz);
    since_id := coalesce((cursors -> t.name ->> 'id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid);
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(x.*) order by x.updated_at, x.id), ''[]''::jsonb), count(*)
         from (select * from public.%I r
                where (r.updated_at, r.id) > ($1, $2)
                order by r.updated_at, r.id
                limit $3) x',
      t.name) into rows_json, n using since_ts, since_id, lim + 1;
    if n > lim then
      rows_json := rows_json - lim;
    end if;
    result := result || jsonb_build_object(t.name, jsonb_build_object('rows', rows_json, 'has_more', n > lim));
  end loop;
  return jsonb_build_object('tables', result, 'server_time', clock_timestamp());
end;
$$;

revoke all on function public.sync_push(jsonb) from public, anon;
revoke all on function public.sync_pull(jsonb, integer) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_pull(jsonb, integer) to authenticated;
revoke all on function ascend_private.register_owned_table(regclass, integer, text[]) from public;
revoke all on function ascend_private.handle_new_user() from public;
