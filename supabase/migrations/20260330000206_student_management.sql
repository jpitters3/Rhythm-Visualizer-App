-- =============================================================================
-- Student Management
-- Migration: 20260330_student_management.sql
--
-- Changes:
--   1. Add last_seen_at to profiles (updated on login)
--   2. RLS policy: teacher can view lesson progress of their own students
--   3. RLS policy: admin can view all lesson progress
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. last_seen_at on profiles
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists last_seen_at timestamptz;


-- ---------------------------------------------------------------------------
-- 2. Teacher can view their students' lesson progress
-- Relies on public.current_user_role() defined in 20260324_assignment_submission_system.sql
-- ---------------------------------------------------------------------------
create policy "Teacher can view their students lesson progress"
  on public.user_lesson_progress for select
  using (
    public.current_user_role() = 'teacher'
    and exists (
      select 1 from public.student_assignments sa
      where sa.student_id = user_lesson_progress.user_id
        and sa.assigned_by = auth.uid()
    )
  );


-- ---------------------------------------------------------------------------
-- 3. Admin can view all lesson progress
-- ---------------------------------------------------------------------------
create policy "Admin can view all lesson progress"
  on public.user_lesson_progress for select
  using (public.current_user_role() = 'admin');


-- ---------------------------------------------------------------------------
-- 4. RPC: get_students_for_teacher()
-- Returns all students assigned by the calling teacher, with joined_at pulled
-- from auth.users (not accessible directly from the client).
-- Also computes last_assignment_update via GROUP BY to avoid a second round-trip.
-- ---------------------------------------------------------------------------
create or replace function public.get_students_for_teacher()
returns table (
  user_id              uuid,
  first_name           text,
  last_name            text,
  username             text,
  last_seen_at         timestamptz,
  joined_at            timestamptz,
  last_assignment_update timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.user_id,
    p.first_name,
    p.last_name,
    p.username,
    p.last_seen_at,
    u.created_at as joined_at,
    max(sa.updated_at) as last_assignment_update
  from public.profiles p
  join auth.users u on u.id = p.user_id
  join public.student_assignments sa on sa.student_id = p.user_id
  where sa.assigned_by = auth.uid()
  group by p.user_id, p.first_name, p.last_name, p.username, p.last_seen_at, u.created_at;
$$;
