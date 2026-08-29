-- Allow users to edit their own comments (post_comments had no UPDATE
-- policy at all before this), and auto-stamp updated_at on edit so the
-- client can show an "Edited" tag (created_at === updated_at at insert
-- time; they diverge once set_updated_at() fires on an update).

create policy "Users can update their own comments"
  on public.post_comments for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace trigger trg_post_comments_set_updated_at
  before update on public.post_comments
  for each row execute function public.set_updated_at();
