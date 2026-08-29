-- Soft-delete comments instead of hard-deleting them: a deleted comment's
-- replies must survive (hard delete would cascade-remove them via the
-- parent_comment_id FK), so deleting just flags the row and the client
-- renders it as a "Comment deleted." placeholder while keeping its thread
-- of replies intact. New replies to an already-deleted comment are blocked
-- server-side as well as in the UI.

alter table public.post_comments
  add column if not exists is_deleted boolean not null default false;

create or replace function public.prevent_reply_to_deleted_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_deleted boolean;
begin
  if new.parent_comment_id is not null then
    select is_deleted into v_parent_deleted
    from public.post_comments
    where id = new.parent_comment_id;

    if v_parent_deleted then
      raise exception 'Cannot reply to a deleted comment';
    end if;
  end if;

  return new;
end;
$$;

create or replace trigger trg_prevent_reply_to_deleted_comment
  before insert on public.post_comments
  for each row execute function public.prevent_reply_to_deleted_comment();
