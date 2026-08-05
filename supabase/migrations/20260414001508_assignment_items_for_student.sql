-- Security-definer function so students can fetch assignment items without
-- hitting the nested-RLS issue (assignment_items policy → student_assignments
-- subquery → RLS on student_assignments → deadlock/empty result).

create or replace function public.get_assignment_items_for_student(p_assignment_id uuid)
returns setof public.assignment_items
language sql
stable
security definer
set search_path = public
as $$
  select ai.*
  from public.assignment_items ai
  join public.student_assignments sa on sa.assignment_id = ai.assignment_id
  join public.assignments a on a.id = ai.assignment_id
  where ai.assignment_id = p_assignment_id
    and sa.student_id = auth.uid()
    and a.is_published = true;
$$;
