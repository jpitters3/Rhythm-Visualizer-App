-- Per-student lesson settings override (Plan B: Reset/Restore).
--
-- Mirrors student_exercise_progress's precedent: a student-owned override of
-- an admin-owned shared resource (here, lessons.pattern_json), upserted on
-- (user_id, lesson_id), never mutating the shared row. The shared lesson
-- pattern stays the single canonical version; this table only ever gets
-- read/written by the owning student and (via RLS) never touched by anyone
-- else, admins' "Update Lesson" flow included.
--
-- custom_bpm is only meaningful when custom_pattern_name is null — a full
-- pattern override already carries its own bpm (and beats/subdivision)
-- inside patterns.data, so the two never both apply at once.
--
-- previous_bpm/previous_pattern_name are a one-level undo slot: whatever was
-- active immediately before the last Reset, so Restore can put it straight
-- back. A fresh Save-for-this-lesson clears them — Restore only ever
-- un-does the most recent Reset, not a longer history.
create table public.student_lesson_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,

  custom_bpm integer,
  custom_pattern_name text,

  previous_bpm integer,
  previous_pattern_name text,

  updated_at timestamptz not null default now(),

  unique (user_id, lesson_id)
);

alter table public.student_lesson_settings enable row level security;

create policy "Own lesson settings"
  on public.student_lesson_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
