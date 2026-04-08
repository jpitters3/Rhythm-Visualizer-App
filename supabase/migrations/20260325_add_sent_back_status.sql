-- Add 'sent_back' as a valid student_assignment status.
-- This distinguishes teacher-returned submissions from student-initiated in_progress.

-- 1. Drop and recreate the check constraint on student_assignments.status
alter table public.student_assignments
  drop constraint if exists student_assignments_status_check;

alter table public.student_assignments
  add constraint student_assignments_status_check
  check (status in ('pending', 'in_progress', 'submitted', 'sent_back', 'reviewed'));

-- 2. Allow students to advance from sent_back → in_progress or submitted
drop policy if exists "Student can update own assignment status" on public.student_assignments;

create policy "Student can update own assignment status"
  on public.student_assignments for update
  using (public.current_user_role() = 'student' and student_id = auth.uid())
  with check (
    student_id = auth.uid()
    and status in ('in_progress', 'submitted')
  );
