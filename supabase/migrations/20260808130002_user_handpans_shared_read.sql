-- user_handpans currently has no policy letting anyone but the owner read
-- a row at all — which means the handpan_audio_recordings "shared" policy
-- (added in the prior migration) can never actually see is_audio_shared,
-- since that nested lookup is itself subject to user_handpans' own RLS.
-- Add a permissive read policy for rows the owner has explicitly opted to
-- share (either half). Postgres OR's this together with whatever the
-- existing owner-only policy already does — it doesn't replace it.

create policy "shared handpans: public read"
  on public.user_handpans for select
  using (is_scale_shared = true or is_audio_shared = true);
