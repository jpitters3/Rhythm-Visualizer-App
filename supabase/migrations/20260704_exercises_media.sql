-- Add video and studio pattern columns to exercises
alter table public.exercises
  add column if not exists video_url          text,
  add column if not exists studio_pattern_json jsonb;
