-- handpan_audio_sequences has no user_id — it's a shared, ownerless counter
-- (keyed by pitch+scale+handpan-id, not by user), and the only legitimate
-- access path is next_handpan_audio_seq(), a SECURITY DEFINER function
-- that bypasses table-level RLS by design. Right now the table has RLS
-- disabled entirely, meaning anyone — including unauthenticated requests —
-- can read AND overwrite these counters directly via PostgREST, which can
-- corrupt the sequence and cause filename collisions. Lock it down
-- completely: enable RLS with zero policies, so no direct client access is
-- possible at all; the RPC function keeps working since SECURITY DEFINER
-- runs with the function owner's privileges, not the caller's.

alter table public.handpan_audio_sequences enable row level security;

revoke all on public.handpan_audio_sequences from anon, authenticated;
