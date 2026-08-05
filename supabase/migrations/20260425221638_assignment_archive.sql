-- Assignment archive flag
alter table assignments
  add column if not exists is_archived boolean not null default false;

create index if not exists idx_assignments_archived
  on assignments(created_by, is_archived);
