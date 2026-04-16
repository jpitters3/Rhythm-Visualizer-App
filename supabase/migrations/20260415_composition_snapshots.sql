-- Compositions can now be "snapshots" — frozen copies created when a composition
-- is shared via link or assigned to a student.
--
-- is_snapshot = true  → hidden from the creator's composer list, readable by
--                       anyone via share_token (existing policy covers this).
-- is_snapshot = false → normal composition, shown in the creator's list.
--
-- A recipient who clicks "Add to my Composer" always gets a fresh
-- is_snapshot = false copy owned by them, so it appears in their list normally.

ALTER TABLE public.compositions
  ADD COLUMN IF NOT EXISTS is_snapshot BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_compositions_is_snapshot
  ON public.compositions (user_id, is_snapshot);
