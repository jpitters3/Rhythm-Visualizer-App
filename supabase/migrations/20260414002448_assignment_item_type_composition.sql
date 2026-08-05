-- Add composition_reference to the allowed item_type values on assignment_items.
-- The original CHECK constraint must be dropped and recreated since Postgres
-- doesn't support ALTER ... ADD VALUE for plain CHECK constraints.

ALTER TABLE public.assignment_items
  DROP CONSTRAINT IF EXISTS assignment_items_item_type_check;

ALTER TABLE public.assignment_items
  ADD CONSTRAINT assignment_items_item_type_check
  CHECK (item_type IN ('mark_complete', 'quiz', 'audio', 'video', 'link', 'composition_reference'));
