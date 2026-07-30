-- level should be a number (e.g. 1, 2, 3), not free text, on both
-- progressions and courses. Uses a USING cast so this is safe to run
-- whether the column currently holds text like "Level 1" or is already
-- empty/NULL, and regardless of whether 20260801_courses_level.sql has
-- been applied yet.

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS level TEXT;

ALTER TABLE public.progressions
  ALTER COLUMN level TYPE INTEGER
  USING NULLIF(regexp_replace(level::text, '\D', '', 'g'), '')::INTEGER;

ALTER TABLE public.courses
  ALTER COLUMN level TYPE INTEGER
  USING NULLIF(regexp_replace(level::text, '\D', '', 'g'), '')::INTEGER;
