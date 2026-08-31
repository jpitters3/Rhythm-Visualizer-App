-- Add is_published column to courses table
ALTER TABLE public.courses 
ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT FALSE;

-- Migrate existing courses to be public (since they were effectively public before)
UPDATE public.courses 
SET is_published = TRUE 
WHERE is_published IS FALSE; -- Safety check, though default handles new ones
