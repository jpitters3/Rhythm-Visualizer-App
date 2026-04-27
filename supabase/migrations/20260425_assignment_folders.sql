-- Assignment Folders
-- Allows teachers to categorize their assignments into named folders.

create table if not exists assignment_folders (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

alter table assignments
  add column if not exists folder_id uuid references assignment_folders(id) on delete set null;

-- Index for fast per-teacher folder lookups
create index if not exists idx_assignment_folders_created_by
  on assignment_folders(created_by);

create index if not exists idx_assignments_folder_id
  on assignments(folder_id);

-- RLS
alter table assignment_folders enable row level security;

create policy "Teachers manage own folders"
  on assignment_folders
  for all
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "Admins manage all folders"
  on assignment_folders
  for all
  using (exists (
    select 1 from profiles where user_id = auth.uid() and role = 'admin'
  ));
