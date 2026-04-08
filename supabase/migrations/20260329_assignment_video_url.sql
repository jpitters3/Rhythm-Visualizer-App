-- Add optional video URL to assignments so teachers can link a reference video.
alter table public.assignments
  add column if not exists video_url text;
