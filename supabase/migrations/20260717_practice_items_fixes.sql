-- Consolidates all practice_items fixes:
--   1. category column for Daily / Other grouping
--   2. UPDATE policy (missing from dashboard-created table)
--   3. item_type constraint expanded to include 'exercise'

-- ── 1. Category column ──────────────────────────────────────────────────────

ALTER TABLE public.practice_items
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other'
  CHECK (category IN ('daily', 'other'));

-- ── 2. UPDATE policy ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can update own practice items" ON public.practice_items;

CREATE POLICY "Users can update own practice items"
  ON public.practice_items FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── 3. item_type constraint ─────────────────────────────────────────────────

ALTER TABLE public.practice_items
  DROP CONSTRAINT IF EXISTS practice_items_item_type_check;

ALTER TABLE public.practice_items
  ADD CONSTRAINT practice_items_item_type_check
  CHECK (item_type IN ('lesson', 'pattern', 'exercise'));
