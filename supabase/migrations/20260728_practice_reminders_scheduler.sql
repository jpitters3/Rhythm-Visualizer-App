-- Scheduling for practice reminders (see 20260728_practice_reminders.sql).
-- A cron job ticks every 15 minutes and calls the send-practice-reminders
-- edge function, which does the actual timezone/day-of-week matching and
-- sends the ones that are due right now. Reminder times are constrained to
-- :00/:15/:30/:45 (see the time_of_day check constraint below) specifically
-- so a 15-minute tick can never skip past one — 96 invocations/day instead
-- of 1440.
--
-- MANUAL SETUP REQUIRED (not safe to put secrets in a migration file):
--   1. Deploy the edge function: supabase functions deploy send-practice-reminders
--   2. In Supabase Dashboard → Edge Functions → send-practice-reminders →
--      disable "Verify JWT" (this function is called by pg_cron, not a
--      logged-in user, so it can't send a user JWT).
--   3. Set an Edge Function secret CRON_SECRET to a random string (used by
--      the function to reject requests that aren't from our own cron job).
--   4. Run once, in the SQL editor (NOT committed to git — this is exactly
--      why it's not in this migration):
--        alter database postgres set app.cron_secret = '<same random string as CRON_SECRET>';
--   Steps 3 and 4 must use the same secret value.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Only sent once per local calendar day per reminder, even if the cron tick
-- is slightly late or the function is retried.
alter table public.practice_reminders
  add column if not exists last_sent_date date;

-- Enforce the 15-minute grid server-side too (the UI snaps to it, but this
-- is the backstop — see js/practice-reminders.js's snapTo15()).
alter table public.practice_reminders
  add constraint practice_reminders_time_15min_grid
  check (extract(minute from time_of_day)::int % 15 = 0);

select cron.schedule(
  'send-practice-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://ycdlqkaymkgpbpgtqubs.supabase.co/functions/v1/send-practice-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
