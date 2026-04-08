-- Allow a teacher to remove a student from their roster
create policy "Teacher can remove their students"
  on public.teacher_students for delete
  using (teacher_id = auth.uid());
