-- Links each recorded-note storage object back to the handpan it belongs
-- to, so storage.objects RLS (added in the next migration) can answer
-- "is this specific file allowed for this specific reader" precisely —
-- owner always allowed, everyone else only when THIS handpan was shared
-- (not just any handpan the same user happens to own).

create table if not exists public.handpan_audio_recordings (
  id              uuid primary key default gen_random_uuid(),
  user_handpan_id uuid not null references public.user_handpans(id) on delete cascade,
  storage_path    text not null unique,
  owner           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now()
);

create index if not exists handpan_audio_recordings_user_handpan_id_idx
  on public.handpan_audio_recordings(user_handpan_id);

alter table public.handpan_audio_recordings enable row level security;

create policy "own recordings: full read"
  on public.handpan_audio_recordings for select
  using (owner = auth.uid());

create policy "shared recordings: public read"
  on public.handpan_audio_recordings for select
  using (
    exists (
      select 1 from public.user_handpans uh
      where uh.id = user_handpan_id and uh.is_audio_shared = true
    )
  );

create policy "owner can insert their own recordings"
  on public.handpan_audio_recordings for insert
  to authenticated
  with check (owner = auth.uid());

create policy "owner can delete their own recordings"
  on public.handpan_audio_recordings for delete
  using (owner = auth.uid());
