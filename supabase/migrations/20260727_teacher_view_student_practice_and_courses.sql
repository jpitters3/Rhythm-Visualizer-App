-- Teacher dashboard's "View Dashboard" for a student loads practice_items and
-- user_courses by student id, but neither table had a SELECT policy for
-- teachers — only the owning user could read their own rows, so both sections
-- silently rendered empty for the teacher. Mirrors the teacher_students-based
-- policy already used for user_lesson_progress / exercises.

drop policy if exists "Teacher can view their students practice items" on public.practice_items;

create policy "Teacher can view their students practice items"
  on public.practice_items for select
  using (
    exists (
      select 1 from public.teacher_students ts
      where ts.teacher_id = auth.uid()
        and ts.student_id = practice_items.user_id
    )
  );

drop policy if exists "Teacher can view their students courses" on public.user_courses;

create policy "Teacher can view their students courses"
  on public.user_courses for select
  using (
    exists (
      select 1 from public.teacher_students ts
      where ts.teacher_id = auth.uid()
        and ts.student_id = user_courses.user_id
    )
  );
