-- get_composition_for_student was added as a SECURITY DEFINER fallback to let
-- students read assigned compositions. It is no longer needed: assignment items
-- now store a snapshot composition ID, and snapshots always have share_token set,
-- so the existing compositions_shared_read RLS policy covers student access directly.

drop function if exists public.get_composition_for_student(uuid);
