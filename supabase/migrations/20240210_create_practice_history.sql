-- Create practice_history table
create table public.practice_history (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  pattern_name text,
  bpm integer,
  total_notes integer,
  correct_notes integer,
  note_accuracy integer,
  timing_accuracy integer,
  overall_score integer,
  note_results jsonb, -- Stores the full array of result objects
  problem_measures integer[],
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.practice_history enable row level security;

-- Policies
create policy "Users can insert their own practice history"
  on public.practice_history for insert
  with check (auth.uid() = user_id);

create policy "Users can view their own practice history"
  on public.practice_history for select
  using (auth.uid() = user_id);

-- Optional: Index on user_id for faster lookups
create index practice_history_user_id_idx on public.practice_history (user_id);
