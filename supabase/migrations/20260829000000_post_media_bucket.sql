-- Create the 'post-media' storage bucket used by Community posts for photo/video/audio uploads.
-- This bucket was referenced by js/community-posts.js (supabase.storage.from('post-media'))
-- but was never actually created, causing all media uploads to fail.

insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do nothing;

-- Anyone can view post media (public feed)
create policy "post-media public read"
  on storage.objects for select
  using (bucket_id = 'post-media');

-- Authenticated users can upload, but only into their own user-id folder
-- (matches the app's upload path: `${currentUser.id}/${Date.now()}.${fileExt}`)
create policy "post-media owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owners can delete their own uploaded media
create policy "post-media owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
