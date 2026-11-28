-- Names for preferred-hours and blocked-time windows, e.g. "School" or "Morning routine",
-- so they can be shown on the day plan.
alter table public.availability_windows
  add column label text check (label is null or char_length(btrim(label)) between 1 and 60);
