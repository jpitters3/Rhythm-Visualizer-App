-- handpan-audio was public-read, meaning any recording was fetchable by
-- anyone with (or guessing) the URL, shared or not — the is_audio_shared
-- flag was never actually enforced at the storage layer, only used for
-- filename bookkeeping. Make the bucket private and gate SELECT through
-- handpan_audio_recordings (added in the prior migration), so access
-- matches sharing intent precisely: owner always allowed, everyone else
-- only for a specific handpan that was actually shared.

update storage.buckets set public = false where id = 'handpan-audio';

drop policy if exists "handpan-audio public read" on storage.objects;
drop policy if exists "handpan-audio authenticated insert" on storage.objects;

create policy "handpan-audio read: owner or shared"
  on storage.objects for select
  using (
    bucket_id = 'handpan-audio'
    and exists (
      select 1 from public.handpan_audio_recordings r
      where r.storage_path = storage.objects.name
    )
  );

create policy "handpan-audio authenticated insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'handpan-audio');
