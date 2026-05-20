-- Add phrase to the allowed item_type values on assignment_items.
ALTER TABLE public.assignment_items
  DROP CONSTRAINT IF EXISTS assignment_items_item_type_check;

ALTER TABLE public.assignment_items
  ADD CONSTRAINT assignment_items_item_type_check
  CHECK (item_type IN ('mark_complete', 'quiz', 'audio', 'video', 'link', 'composition_reference', 'phrase'));
