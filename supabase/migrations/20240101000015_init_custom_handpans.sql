-- 1. Create the user_handpans table
create table if not exists public.user_handpans (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  builder text,
  scale_name text,
  top_image_url text not null,
  bottom_image_url text,
  note_map jsonb default '[]'::jsonb,
  is_active boolean default false,
  created_at timestamptz default now()
);

-- 2. Enable RLS
alter table public.user_handpans enable row level security;

-- 3. Policies for user_handpans
create policy "Users can view their own handpans"
  on public.user_handpans for select
  using (auth.uid() = user_id);

create policy "Users can insert their own handpans"
  on public.user_handpans for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own handpans"
  on public.user_handpans for update
  using (auth.uid() = user_id);

create policy "Users can delete their own handpans"
  on public.user_handpans for delete
  using (auth.uid() = user_id);

-- 4. Storage Bucket: handpan-images
insert into storage.buckets (id, name, public)
values ('handpan-images', 'handpan-images', true)
on conflict (id) do nothing;

-- 5. Storage Policies
create policy "Public Access to Handpan Images"
  on storage.objects for select
  using ( bucket_id = 'handpan-images' );

create policy "Users can upload handpan images"
  on storage.objects for insert
  with check (
    bucket_id = 'handpan-images' AND
    auth.uid() = owner
  );

create policy "Users can update their handpan images"
  on storage.objects for update
  using (
    bucket_id = 'handpan-images' AND
    auth.uid() = owner
  );
