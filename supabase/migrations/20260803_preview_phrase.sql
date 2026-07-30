-- Lets an admin pick which phrase in a Progression is used as the card
-- preview in the Patterns modal (defaults to the first phrase if unset).
-- preview_lesson_id on courses is a reference to the actual lesson row
-- generated for that phrase (not a JSON snapshot) — lessons.pattern_json
-- already holds the data, so pointing at it avoids duplicating/drifting
-- from that copy. Set at "Generate Mini-Course" time.

ALTER TABLE public.progressions
  ADD COLUMN IF NOT EXISTS preview_phrase_name TEXT;

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS preview_lesson_id UUID REFERENCES public.lessons(id) ON DELETE SET NULL;
