-- Practice Plan Tables

create table if not exists practice_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  item_type text check (item_type in ('pattern', 'lesson')) not null,
  reference_id uuid not null, -- Stores the ID of the pattern or lesson
  title text, -- Cachced title for display optimization
  sort_order int default 0,
  created_at timestamptz default now()
);

-- RLS Policies
alter table practice_items enable row level security;

create policy "Users can view their own practice items"
  on practice_items for select
  using (auth.uid() = user_id);

create policy "Users can insert their own practice items"
  on practice_items for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own practice items"
  on practice_items for update
  using (auth.uid() = user_id);

create policy "Users can delete their own practice items"
  on practice_items for delete
  using (auth.uid() = user_id);
