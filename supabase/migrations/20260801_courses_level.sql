-- Adds a level field to courses, matching progressions.level.
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS level TEXT;
