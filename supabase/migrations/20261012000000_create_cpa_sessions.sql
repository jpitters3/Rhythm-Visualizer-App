-- Chord Play Along session history — one row per finished phrase, so a
-- player can see their progress on a scale's chords over time (the "My
-- Progress" dashboard in js/chord-play-along.js). Mirrors
-- practice_history's precedent (Coaching Mode, see
-- 20240210_create_practice_history.sql): a jsonb column holding the
-- per-chord breakdown rather than a child table, since nothing outside
-- this game ever needs to query a single chord-attempt row on its own —
-- the dashboard always aggregates across every session in JS.
--
-- scale_key is js/chord-play-along.js's own normalizeScaleKey() output —
-- the same scoping its cpa_disabled_chords_* localStorage keys already
-- use. Chord signatures (root-quality-inversion) aren't scale-specific, so
-- mixing scales together here would average practice across different
-- physical tone-field layouts, which isn't a meaningful "progress" signal.
create table public.cpa_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  scale_key text not null,
  round_count integer not null,
  bpm integer,

  overall_score integer,
  note_accuracy integer,
  timing_accuracy integer,

  -- Array of { signature, label, notes, correct, incorrect } — the exact
  -- shape js/chord-play-along.js's chordBreakdown() already builds for the
  -- finish-screen summary, saved as-is.
  chord_results jsonb not null,

  created_at timestamptz not null default now()
);

alter table public.cpa_sessions enable row level security;

create policy "Users can insert their own chord play along sessions"
  on public.cpa_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can view their own chord play along sessions"
  on public.cpa_sessions for select
  using (auth.uid() = user_id);

-- Teacher dashboard read access — same teacher_students-based pattern as
-- practice_items/user_courses (20260727_teacher_view_student_practice_and_courses.sql).
create policy "Teacher can view their students chord play along sessions"
  on public.cpa_sessions for select
  using (
    exists (
      select 1 from public.teacher_students ts
      where ts.teacher_id = auth.uid()
        and ts.student_id = cpa_sessions.user_id
    )
  );

-- Admin read access — same hardcoded-email pattern as
-- 20260702000002_method_rhythms_admin_policy.sql (mirrors js/config.js's
-- ADMIN_EMAILS, currently a single-admin allowlist).
create policy "Admin can view all chord play along sessions"
  on public.cpa_sessions for select
  using (auth.jwt() ->> 'email' = 'jpitters3@gmail.com');

create index cpa_sessions_user_id_idx on public.cpa_sessions (user_id);
create index cpa_sessions_user_scale_idx on public.cpa_sessions (user_id, scale_key);
