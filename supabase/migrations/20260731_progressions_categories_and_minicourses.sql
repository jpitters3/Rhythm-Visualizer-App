-- Adds category/tags to progressions (for the Patterns modal's category
-- filter), and the matching snapshot columns on courses so a generated
-- Mini-Course carries its category/tags/intended scale forward without a
-- join back to progressions — consistent with the existing
-- reference-at-progression / snapshot-at-lesson decision.

ALTER TABLE public.progressions
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS progression_id  UUID REFERENCES public.progressions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category        TEXT,
  ADD COLUMN IF NOT EXISTS tags            TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS intended_scale  TEXT;

CREATE INDEX IF NOT EXISTS idx_courses_progression_id
  ON public.courses(progression_id)
  WHERE progression_id IS NOT NULL;
