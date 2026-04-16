-- Allow a student to fetch a composition (with its sections) that has been
-- assigned to them via assignment_items → student_assignments → assignments.
--
-- Uses SECURITY DEFINER to bypass RLS on compositions/composition_sections,
-- then enforces access by checking the assignment chain for the calling user.

create or replace function public.get_composition_for_student(p_composition_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select row_to_json(result) from (
    select
      c.id,
      c.title,
      c.user_id,
      c.share_token,
      coalesce(
        (
          select json_agg(s order by s.position)
          from public.composition_sections s
          where s.composition_id = c.id
        ),
        '[]'::json
      ) as composition_sections
    from public.compositions c
    where c.id = p_composition_id
      and exists (
        select 1
        from public.assignment_items ai
        join public.student_assignments sa on sa.assignment_id = ai.assignment_id
        join public.assignments a          on a.id = ai.assignment_id
        where (ai.config->>'composition_id')::uuid = p_composition_id
          and sa.student_id = auth.uid()
          and a.is_published = true
      )
  ) result;
$$;
