-- Recurring practice reminders (Dashboard "Set/Manage Reminders").
-- Each row is one recurring reminder, similar to a calendar recurring event:
-- daily or weekly-on-specific-days, at a given local time, with an optional
-- lead time (notify N minutes before). Sending (email/push) is a separate,
-- later piece — this just captures what the user configured.

create table if not exists public.practice_reminders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  frequency     text not null check (frequency in ('daily', 'weekly')),
  days_of_week  smallint[] not null default '{}', -- 0=Sunday..6=Saturday; only used when frequency='weekly'
  time_of_day   time not null,
  timezone      text not null default 'UTC', -- IANA name, captured client-side at save time
  lead_minutes  int not null default 0 check (lead_minutes >= 0),
  notify_email  boolean not null default true,
  notify_push   boolean not null default false, -- push sending not implemented yet
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.practice_reminders enable row level security;

create policy "Users can view their own reminders"
  on public.practice_reminders for select
  using (auth.uid() = user_id);

create policy "Users can insert their own reminders"
  on public.practice_reminders for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own reminders"
  on public.practice_reminders for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own reminders"
  on public.practice_reminders for delete
  using (auth.uid() = user_id);

create index if not exists practice_reminders_user_id_idx on public.practice_reminders(user_id);

-- Reuses public.set_updated_at() from 20260324_assignment_submission_system.sql
create or replace trigger practice_reminders_set_updated_at
  before update on public.practice_reminders
  for each row execute function public.set_updated_at();
