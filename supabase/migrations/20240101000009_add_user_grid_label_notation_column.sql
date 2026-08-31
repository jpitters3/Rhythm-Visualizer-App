-- Add the grid_label_notation column to the profiles table
alter table profiles 
add column if not exists grid_label_notation text default 'musical';

alter table profiles add constraint valid_grid_notation 
check (grid_label_notation in ('musical', 'numeric'));