-- Tracking which lessons a user has completed
create table if not exists user_lesson_progress (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  lesson_id uuid references lessons(id) on delete cascade not null,
  completed_at timestamptz default now(),
  unique(user_id, lesson_id)
);

-- RLS
alter table user_lesson_progress enable row level security;

create policy "Users can view own progress"
  on user_lesson_progress for select
  using (auth.uid() = user_id);

create policy "Users can update own progress"
  on user_lesson_progress for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own progress"
  on user_lesson_progress for delete
  using (auth.uid() = user_id);
