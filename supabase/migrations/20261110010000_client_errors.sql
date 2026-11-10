-- Errors from users' browsers (js/error-reporter.js), read with scripts/client-errors.js
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  message text not null check (char_length(message) <= 500),
  stack text check (char_length(stack) <= 4000),
  page text check (char_length(page) <= 300),
  user_agent text check (char_length(user_agent) <= 300)
);

create index if not exists client_errors_created_at_idx on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;

-- Anyone may report (signed out too); a report can only name its own user
create policy "Anyone can report an error"
  on public.client_errors for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

create policy "Admins can read errors"
  on public.client_errors for select to authenticated
  using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
