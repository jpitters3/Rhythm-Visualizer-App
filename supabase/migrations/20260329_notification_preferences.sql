-- Notification preferences: per-user, per-type in-app and email toggles.
-- A missing row means both channels are enabled (opt-out model).

create table if not exists public.notification_preferences (
  user_id    uuid    not null references auth.users(id) on delete cascade,
  notif_type text    not null,
  in_app     boolean not null default true,
  email      boolean not null default true,
  updated_at timestamptz default now(),
  primary key (user_id, notif_type)
);

alter table public.notification_preferences enable row level security;

create policy "User can read own notification preferences"
  on public.notification_preferences for select
  using (auth.uid() = user_id);

create policy "User can insert own notification preferences"
  on public.notification_preferences for insert
  with check (auth.uid() = user_id);

create policy "User can update own notification preferences"
  on public.notification_preferences for update
  using (auth.uid() = user_id);

create policy "User can delete own notification preferences"
  on public.notification_preferences for delete
  using (auth.uid() = user_id);
