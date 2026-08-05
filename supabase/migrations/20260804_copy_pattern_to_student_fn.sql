-- Lets a teacher copy one of their phrases into an assigned student's own
-- Library (patterns table), so a 'phrase' assignment item stays available
-- to the student after they submit/complete the assignment.
-- SECURITY DEFINER is required because a teacher has no RLS insert access
-- to another user's patterns rows; this function checks the teacher_students
-- relationship itself instead of relying on RLS.

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
    SELECT 1 FROM public.teacher_students
    WHERE teacher_id = auth.uid() AND student_id = p_student_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to copy a pattern to this student';
  END IF;

  -- Skip if the student already has a pattern with this exact name — avoids
  -- piling up duplicates when a student is re-assigned or an assignment with
  -- the same phrase is saved and assigned again.
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

REVOKE ALL ON FUNCTION public.copy_pattern_to_student(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.copy_pattern_to_student(uuid, text, jsonb) TO authenticated;
