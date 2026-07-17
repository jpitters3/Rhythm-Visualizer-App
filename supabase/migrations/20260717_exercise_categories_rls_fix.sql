-- Fix broken RLS policy on exercise_categories.
-- The original policy checked profiles.id = auth.uid() but the
-- profiles table uses user_id as the FK to auth.users, so the
-- policy always returned false and writes silently failed.

DROP POLICY IF EXISTS "Teachers and admins can manage categories" ON public.exercise_categories;

CREATE POLICY "Teachers and admins can manage categories"
  ON public.exercise_categories FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND role IN ('teacher', 'admin')
    )
  );
