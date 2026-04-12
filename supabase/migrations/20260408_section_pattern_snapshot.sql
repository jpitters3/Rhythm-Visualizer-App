-- Store pattern data directly on composition sections so playback and sharing
-- are resilient to phrase renames on either end.
ALTER TABLE public.composition_sections
  ADD COLUMN IF NOT EXISTS pattern_snapshot JSONB;
