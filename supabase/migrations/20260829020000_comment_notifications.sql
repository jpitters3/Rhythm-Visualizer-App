-- Notify the relevant member when a Community post/comment gets a
-- comment or reply:
--   - top-level comment on a post -> notifies the post's author
--   - reply to a comment          -> notifies that comment's author
-- Implemented as a security-definer trigger (same pattern as
-- notify_student_on_assignment / notify_teacher_on_submission in
-- 20260324_assignment_submission_system.sql) so it fires regardless of the
-- commenter's role and doesn't depend on client-side RLS permission to
-- insert notifications for someone else.

create or replace function public.notify_on_post_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_commenter text;
  v_type      text;
  v_title     text;
  v_snippet   text;
begin
  if new.parent_comment_id is not null then
    select user_id into v_recipient from public.post_comments where id = new.parent_comment_id;
    v_type  := 'comment_reply';
    v_title := 'New reply to your comment';
  else
    select user_id into v_recipient from public.community_posts where id = new.post_id;
    v_type  := 'post_comment';
    v_title := 'New comment on your post';
  end if;

  -- No recipient found, or commenting/replying on your own content: skip.
  if v_recipient is null or v_recipient = new.user_id then
    return new;
  end if;

  select coalesce(
    nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''),
    username,
    new.user_id::text
  ) into v_commenter
  from public.profiles
  where user_id = new.user_id;

  v_snippet := left(coalesce(new.content, ''), 140);

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_recipient,
    v_type,
    v_title,
    coalesce(v_commenter, 'Someone') || ': "' || v_snippet || '"',
    jsonb_build_object(
      'post_id',           new.post_id,
      'comment_id',        new.id,
      'parent_comment_id', new.parent_comment_id,
      'commenter_id',      new.user_id
    )
  );

  return new;
end;
$$;

create or replace trigger trg_notify_on_post_comment
  after insert on public.post_comments
  for each row execute function public.notify_on_post_comment();
