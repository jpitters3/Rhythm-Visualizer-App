-- Allow students to overwrite (upsert) their own submission files.
-- Supabase storage upsert requires both INSERT and UPDATE policies.
-- The INSERT policy already exists; this adds the missing UPDATE.

create policy "Student can update their own submission files"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'assignment-submissions'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'assignment-submissions'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
