-- Storage bucket for user-recorded handpan note audio (guided calibration's
-- "record my own handpan sounds" mode), plus a race-safe per (pitch, scale)
-- sequence counter so uploaded filenames can follow the
-- [pitch]_[scale_slug]_[00001].wav convention admins can later browse and
-- promote specific recordings into the app's own built-in sample library.

insert into storage.buckets (id, name, public)
values ('handpan-audio', 'handpan-audio', true)
on conflict (id) do nothing;

-- Public read (bucket is public), authenticated users may upload/select.
-- Mirrors the existing (untracked) policy shape already in place for the
-- handpan-images bucket.
create policy "handpan-audio public read"
  on storage.objects for select
  using (bucket_id = 'handpan-audio');

create policy "handpan-audio authenticated insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'handpan-audio');

create table if not exists public.handpan_audio_sequences (
  seq_key   text primary key,     -- e.g. 'Cs3_dkurd9'
  next_seq  integer not null default 1
);

comment on table public.handpan_audio_sequences is
  'Race-safe per (pitch, scale_name slug) counters for handpan-audio filenames.';

-- Atomic "give me the next number for this key" — single statement, safe
-- under concurrent calls (two people finishing the same pitch+scale at
-- once must not collide).
create or replace function public.next_handpan_audio_seq(p_seq_key text)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.handpan_audio_sequences (seq_key, next_seq)
  values (p_seq_key, 2)
  on conflict (seq_key) do update
    set next_seq = handpan_audio_sequences.next_seq + 1
  returning next_seq - 1;
$$;

grant execute on function public.next_handpan_audio_seq(text) to authenticated;
