-- Allow admin and teacher roles to insert notifications directly from the frontend.
-- The original migration restricted inserts to SECURITY DEFINER triggers only,
-- but the assignments UI also inserts notifications on publish, assign, send-back,
-- and mark-complete — all of which run as the logged-in teacher.

create policy "Admin and teacher can insert notifications"
  on public.notifications for insert
  with check (
    public.current_user_role() in ('admin', 'teacher')
  );
