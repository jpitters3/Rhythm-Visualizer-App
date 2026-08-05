-- Allow admins to update method_rhythms (needed for "Set current pattern as preview" button)
create policy "method_rhythms_admin_update" on method_rhythms
  for update using (
    auth.jwt() ->> 'email' = 'jpitters3@gmail.com'
  );
