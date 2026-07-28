-- Fixes 20260728_practice_reminders_scheduler.sql: `alter database postgres
-- set app.cron_secret = ...` requires superuser, which even the SQL editor's
-- postgres role doesn't have on hosted Supabase. Supabase Vault is the
-- supported way to give a cron job access to a secret without that
-- privilege — this migration re-points the cron job at Vault instead.
--
-- MANUAL SETUP REQUIRED (replaces step 4 from the previous migration):
--   Run once, in the SQL editor (NOT committed to git):
--     select vault.create_secret('<same random string as the CRON_SECRET
--       edge function secret>', 'practice_reminders_cron_secret');
--   (If you already tried the old `alter database ... set app.cron_secret`
--   command and it failed with a permission error, nothing was saved —
--   just run the vault.create_secret command above instead.)

-- Safe to run whether or not the job from the previous migration exists yet.
do $$
begin
  perform cron.unschedule('send-practice-reminders');
exception when others then
  null;
end $$;

select cron.schedule(
  'send-practice-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://ycdlqkaymkgpbpgtqubs.supabase.co/functions/v1/send-practice-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'practice_reminders_cron_secret'
        limit 1
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
