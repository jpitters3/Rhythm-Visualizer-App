-- Per-folder sort order for assignments
alter table assignments
  add column if not exists sort_order integer;

create index if not exists idx_assignments_sort_order
  on assignments(created_by, folder_id, sort_order);
