-- 1. Create the 'lesson-videos' bucket
insert into storage.buckets (id, name, public)
values ('lesson-videos', 'lesson-videos', true)
on conflict (id) do nothing;

-- 2. Allow public read access to lesson videos
create policy "Public Read Access" 
on storage.objects for select 
using (bucket_id = 'lesson-videos');

-- 3. Allow authenticated users to upload to lesson-videos (filtered by admin in JS)
create policy "Authenticated Upload Access" 
on storage.objects for insert 
to authenticated 
with check (bucket_id = 'lesson-videos');

-- 4. Allow authenticated users to delete/update their own uploads
create policy "Delete Access" 
on storage.objects for delete 
to authenticated 
using (bucket_id = 'lesson-videos');
