-- Add colour property to composition sections
ALTER TABLE public.composition_sections
  ADD COLUMN IF NOT EXISTS color TEXT DEFAULT NULL;
