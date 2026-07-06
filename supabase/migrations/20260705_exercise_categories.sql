-- Exercise category ordering table
create table if not exists public.exercise_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort_order  int  not null default 0
);

alter table public.exercise_categories enable row level security;

create policy "Anyone can read categories"
  on public.exercise_categories for select
  using (true);

create policy "Teachers and admins can manage categories"
  on public.exercise_categories for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('teacher', 'admin')
    )
  );

insert into public.exercise_categories (name, sort_order) values
  ('Scale Runs',    10),
  ('Rudiments',     20),
  ('Rhythm',        30),
  ('Improvisation', 40)
on conflict (name) do nothing;
