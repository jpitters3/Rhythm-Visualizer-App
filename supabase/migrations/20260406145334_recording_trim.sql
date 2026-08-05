-- Non-destructive trim points for composition recording sections.
-- trim_start / trim_end are in seconds (float). NULL trim_end means "play to end of file".

ALTER TABLE composition_sections
  ADD COLUMN IF NOT EXISTS trim_start FLOAT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trim_end   FLOAT DEFAULT NULL;
