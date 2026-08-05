-- copy_pattern_to_student's authorization check used teacher_students, but
-- the assignment system doesn't require that relationship at all — any
-- teacher can assign to any student profile (see the "Admin and teacher can
-- assign students" policy on student_assignments: role check only, no
-- teacher_students lookup). Re-check authorization against student_assignments
-- instead, which is guaranteed to already contain the (teacher, student) pair
-- by the time this is called from handleAssign().

CREATE OR REPLACE FUNCTION public.copy_pattern_to_student(
  p_student_id uuid,
  p_name text,
  p_data jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.student_assignments
    WHERE assigned_by = auth.uid() AND student_id = p_student_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to copy a pattern to this student';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.patterns
    WHERE user_id = p_student_id AND name = p_name
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.patterns (user_id, name, data, source)
  VALUES (p_student_id, p_name, p_data, 'assignment');
END;
$$;
