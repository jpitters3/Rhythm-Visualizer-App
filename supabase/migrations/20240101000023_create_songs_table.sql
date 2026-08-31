
-- Create songs table for the Song Library
create table if not exists songs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null, -- The creator (Admin)
  name text not null,
  pattern_json jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table songs enable row level security;

-- Policies

-- 1. Everyone (authenticated) can VIEW songs
create policy "Enable read access for all users" on songs
  for select using (auth.role() = 'authenticated');

-- 2. Only authenticated users can INSERT (Application logic will restrict this to Admins via UI/Business Logic)
-- We allow auth users to insert so admins can do it without raw SQL access, relying on app-level checks or stricter DB policies later if needed.
create policy "Enable insert for authenticated users" on songs
  for insert with check (auth.role() = 'authenticated');

-- 3. Only the creator can DELETE (or maybe just open it up to auth for MVP ease if admins are the only ones inserting)
create policy "Enable delete for users based on user_id" on songs
  for delete using (auth.uid() = user_id);
