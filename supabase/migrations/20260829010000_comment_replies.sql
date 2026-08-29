-- Allow comments to reply to other comments (threaded replies), so Community
-- discussions can nest a reply under a specific comment rather than only
-- under the post.

alter table public.post_comments
  add column if not exists parent_comment_id uuid references public.post_comments(id) on delete cascade;

create index if not exists post_comments_parent_comment_id_idx
  on public.post_comments (parent_comment_id);

-- No RLS changes needed: existing policies key off post_id/user_id, which
-- replies still populate the same as top-level comments.
