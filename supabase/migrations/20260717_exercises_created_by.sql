-- Add created_by to exercises and tighten RLS.
--
-- Rules:
--   SELECT  — admin-created (NULL or creator has admin role) → everyone;
--             teacher-created → creator only
--   INSERT  — teachers & admins; must set created_by = own uid
--   UPDATE  — own row only; admins can touch any row
--   DELETE  — own row only; admins can touch any row

ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users;

-- Existing seeded exercises stay NULL → globally visible (admin-curated catalog)

-- ── Helper function (must exist before the SELECT policy references it) ────

CREATE OR REPLACE FUNCTION public.current_user_role_for(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE user_id = p_user_id LIMIT 1;
$$;

-- ── SELECT ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can view exercises" ON public.exercises;

CREATE POLICY "exercises_select"
  ON public.exercises FOR SELECT
  USING (
    -- Legacy / admin-curated rows (no creator set) visible to everyone
    created_by IS NULL
    -- Rows created by an admin are visible to everyone
    OR public.current_user_role_for(created_by) = 'admin'
    -- Teachers see their own exercises
    OR created_by = auth.uid()
  );

-- ── INSERT ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Teachers can insert exercises" ON public.exercises;

CREATE POLICY "exercises_insert"
  ON public.exercises FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND public.current_user_role() IN ('teacher', 'admin')
  );

-- ── UPDATE ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Teachers can update exercises" ON public.exercises;

CREATE POLICY "exercises_update"
  ON public.exercises FOR UPDATE
  USING (
    created_by = auth.uid()
    OR public.current_user_role() = 'admin'
  );

-- ── DELETE ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Teachers can delete exercises" ON public.exercises;

CREATE POLICY "exercises_delete"
  ON public.exercises FOR DELETE
  USING (
    created_by = auth.uid()
    OR public.current_user_role() = 'admin'
  );
