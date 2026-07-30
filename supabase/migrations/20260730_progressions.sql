-- Progressions: admin-authored ordered phrase sequences, the source data
-- for generating Pattern Mini-Courses. Mirrors the compositions /
-- composition_sections shape (soft FK to patterns.name by design — patterns
-- has no stable id anything else in this codebase references).
--
-- v1 / placeholder scope: bare-bones data model + a minimal admin picker
-- (see js/progressions.js). When the full Progressions authoring UX is
-- built (Library-integrated ordered multi-select, dedicated Progressions
-- tab, three-dot menu actions), this migration's tables can stay as-is —
-- only js/progressions.js + the #progressionsModal markup + its button in
-- the Library header are expected to be replaced wholesale.

-- ============================================================
-- PROGRESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.progressions (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name            TEXT        NOT NULL DEFAULT 'Untitled Progression',
  level           TEXT,
  intended_scale  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_progressions_user_id
  ON public.progressions(user_id);

ALTER TABLE public.progressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "progressions_user_all"
  ON public.progressions FOR ALL
  TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- PROGRESSION PHRASES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.progression_phrases (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  progression_id  UUID        REFERENCES public.progressions(id) ON DELETE CASCADE NOT NULL,
  position        INTEGER     NOT NULL DEFAULT 0,
  phrase_name     TEXT        NOT NULL,   -- soft FK to patterns.name
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_progression_phrases_prog_pos
  ON public.progression_phrases(progression_id, position);

ALTER TABLE public.progression_phrases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "progression_phrases_user_all"
  ON public.progression_phrases FOR ALL
  TO authenticated
  USING (
    progression_id IN (
      SELECT id FROM public.progressions WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    progression_id IN (
      SELECT id FROM public.progressions WHERE user_id = auth.uid()
    )
  );
