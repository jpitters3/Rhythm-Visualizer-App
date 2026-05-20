-- Add a reference phrase to the assignments table.
-- phrase_name is the soft label; phrase_json is a snapshot of the pattern data
-- captured at save time so the reference is stable even if the original is renamed.
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS phrase_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS phrase_json JSONB NULL;
