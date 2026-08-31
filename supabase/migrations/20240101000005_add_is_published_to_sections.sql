-- Add is_published column to sections table
ALTER TABLE public.sections
ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT FALSE;

-- Migrate existing sections to be public (maintain current visibility)
UPDATE public.sections
SET is_published = TRUE
WHERE is_published IS FALSE;
