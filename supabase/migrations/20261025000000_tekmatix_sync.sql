-- Syncs Panafide users to Tekmatix via the sync-tekmatix edge function:
-- on profile insert, on updates to synced profile columns, and on auth
-- email changes. last_seen_at and other columns are ignored on purpose.
--
-- MANUAL SETUP, once per environment in the SQL editor (not committed).
-- Until both secrets exist the triggers do nothing, so an environment
-- stays out of Tekmatix unless it is deliberately configured:
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/sync-tekmatix',
--     'tekmatix_sync_url');
--   select vault.create_secret('<same value as TEKMATIX_SYNC_SECRET>',
--     'tekmatix_sync_secret');

create or replace function public.request_tekmatix_sync(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'tekmatix_sync_url' limit 1;
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'tekmatix_sync_secret' limit 1;

  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', v_secret
    ),
    body := jsonb_build_object('user_id', p_user_id)
  );
exception when others then
  -- A sync failure must never block the user's own profile or email update.
  raise warning 'tekmatix sync skipped for %: %', p_user_id, sqlerrm;
end;
$$;

-- Clients must not be able to trigger syncs directly via RPC.
revoke execute on function public.request_tekmatix_sync(uuid) from public, anon, authenticated;

create or replace function public.profiles_tekmatix_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.first_name, new.last_name, new.username, new.role,
    new.subscription_tier, new.subscription_status,
    new.subscription_expires_at, new.handpan_scale
  ) is not distinct from (
    old.first_name, old.last_name, old.username, old.role,
    old.subscription_tier, old.subscription_status,
    old.subscription_expires_at, old.handpan_scale
  ) then
    return new;
  end if;

  perform public.request_tekmatix_sync(new.user_id);
  return new;
end;
$$;

drop trigger if exists profiles_tekmatix_sync on public.profiles;
create trigger profiles_tekmatix_sync
  after insert or update on public.profiles
  for each row execute function public.profiles_tekmatix_sync();

create or replace function public.auth_email_tekmatix_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.request_tekmatix_sync(new.id);
  return new;
end;
$$;

drop trigger if exists auth_email_tekmatix_sync on auth.users;
create trigger auth_email_tekmatix_sync
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.auth_email_tekmatix_sync();
