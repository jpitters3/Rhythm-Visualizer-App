-- =============================================
-- CLIPS: user audio recordings
-- =============================================

create table if not exists clips (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  title         text not null default 'New Recording',
  audio_url     text,
  duration_secs numeric,
  created_at    timestamptz default now() not null
);

alter table clips enable row level security;

create policy "clips_own" on clips
  for all using (auth.uid() = user_id);

-- =============================================
-- STORAGE BUCKET: user-clips (50 MB per file)
-- =============================================

insert into storage.buckets (id, name, public, file_size_limit)
  values ('user-clips', 'user-clips', false, 52428800)
  on conflict (id) do nothing;

create policy "user_clips_insert" on storage.objects
  for insert with check (
    bucket_id = 'user-clips'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "user_clips_select" on storage.objects
  for select using (
    bucket_id = 'user-clips'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "user_clips_update" on storage.objects
  for update using (
    bucket_id = 'user-clips'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "user_clips_delete" on storage.objects
  for delete using (
    bucket_id = 'user-clips'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
