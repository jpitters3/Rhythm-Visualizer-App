-- Storage bucket for course thumbnails (the .card-thumb background image
-- shown in the Course Marketplace / sidebar). Mirrors lesson-videos'
-- bucket setup: public read, authenticated write (admin-only is enforced
-- in js/course-creator.js since Storage RLS can't see the courses table
-- ownership check cheaply here).

insert into storage.buckets (id, name, public)
values ('course-thumbnails', 'course-thumbnails', true)
on conflict (id) do nothing;

create policy "Course Thumbnails Public Read Access"
on storage.objects for select
using (bucket_id = 'course-thumbnails');

create policy "Course Thumbnails Authenticated Upload Access"
on storage.objects for insert
to authenticated
with check (bucket_id = 'course-thumbnails');

create policy "Course Thumbnails Delete Access"
on storage.objects for delete
to authenticated
using (bucket_id = 'course-thumbnails');
