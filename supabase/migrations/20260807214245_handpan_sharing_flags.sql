-- Lets a user opt in, after guided calibration, to sharing their custom
-- handpan's scale (tuning + tonefield layout) and/or their own recorded
-- note audio with other players. Both default false — sharing is opt-in.
-- This only captures the permission; there's no public discovery/browse
-- surface yet, that's a separate, later feature.

alter table public.user_handpans
  add column if not exists is_scale_shared boolean not null default false,
  add column if not exists is_audio_shared boolean not null default false;

comment on column public.user_handpans.is_scale_shared is
  'User opted to share this handpan''s tuning/tonefield layout with other players.';
comment on column public.user_handpans.is_audio_shared is
  'User opted to share their own recorded note audio with other players.';
