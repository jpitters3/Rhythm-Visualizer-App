-- =============================================================================
-- Teacher Invitations & Teacher-Student Relationships
-- Migration: 20260330_teacher_invitations.sql
-- =============================================================================


-- ---------------------------------------------------------------------------
-- TABLE: teacher_invitations
-- Created by teacher; accepted/declined by student.
-- token is used for email link flow (student has no account yet).
-- ---------------------------------------------------------------------------
create table if not exists public.teacher_invitations (
  id            uuid    default gen_random_uuid() primary key,
  teacher_id    uuid    not null references auth.users(id) on delete cascade,
  student_email text    not null,
  student_id    uuid    references auth.users(id) on delete cascade,
  token         text    unique default encode(gen_random_bytes(32), 'hex'),
  status        text    not null default 'pending'
                        check (status in ('pending', 'accepted', 'declined')),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (teacher_id, student_email)
);

alter table public.teacher_invitations enable row level security;

-- Teacher can see their own invitations
create policy "Teacher can view own invitations"
  on public.teacher_invitations for select
  using (teacher_id = auth.uid());

-- Student can see invitations addressed to them
create policy "Student can view own invitations"
  on public.teacher_invitations for select
  using (student_id = auth.uid());

-- Teachers can insert their own invitations (via RPC only — belt-and-suspenders)
create policy "Teacher can create invitations"
  on public.teacher_invitations for insert
  with check (
    public.current_user_role() in ('teacher', 'admin')
    and teacher_id = auth.uid()
  );


-- ---------------------------------------------------------------------------
-- TABLE: teacher_students
-- Formal teacher ↔ student relationship, created when invitation is accepted.
-- ---------------------------------------------------------------------------
create table if not exists public.teacher_students (
  teacher_id  uuid not null references auth.users(id) on delete cascade,
  student_id  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz default now(),
  primary key (teacher_id, student_id)
);

alter table public.teacher_students enable row level security;

create policy "Teacher can view their students"
  on public.teacher_students for select
  using (teacher_id = auth.uid());

create policy "Student can view their teachers"
  on public.teacher_students for select
  using (student_id = auth.uid());


-- ---------------------------------------------------------------------------
-- RPC: create_teacher_invitation(p_student_email)
-- Called by teacher. Looks up student by email, inserts invitation.
-- Returns invitation_id and token (token needed for email link if no account).
-- ---------------------------------------------------------------------------
create or replace function public.create_teacher_invitation(p_student_email text)
returns table(invitation_id uuid, token text, student_exists boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_inv_id     uuid;
  v_token      text;
begin
  if public.current_user_role() not in ('teacher', 'admin') then
    raise exception 'Not authorized';
  end if;

  -- Look up student by email in auth.users
  select id into v_student_id
  from auth.users
  where lower(email) = lower(p_student_email)
  limit 1;

  -- Upsert: if invite already exists, reset it to pending
  insert into public.teacher_invitations (teacher_id, student_email, student_id)
  values (auth.uid(), lower(p_student_email), v_student_id)
  on conflict (teacher_id, student_email) do update
    set status = 'pending', student_id = v_student_id, updated_at = now()
  returning id, public.teacher_invitations.token into v_inv_id, v_token;

  return query select v_inv_id, v_token, (v_student_id is not null);
end;
$$;


-- ---------------------------------------------------------------------------
-- RPC: accept_teacher_invitation(p_invitation_id)
-- Called by student from in-app notification.
-- ---------------------------------------------------------------------------
create or replace function public.accept_teacher_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.teacher_invitations%rowtype;
begin
  select * into v_inv
  from public.teacher_invitations
  where id = p_invitation_id
    and student_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'Invitation not found or already processed';
  end if;

  update public.teacher_invitations
  set status = 'accepted', updated_at = now()
  where id = p_invitation_id;

  insert into public.teacher_students (teacher_id, student_id)
  values (v_inv.teacher_id, auth.uid())
  on conflict do nothing;

  -- Notify teacher
  insert into public.notifications (user_id, type, title, body, data)
  select
    v_inv.teacher_id,
    'invitation_accepted',
    'Student accepted your invitation',
    coalesce(
      nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
      p.username,
      'A student'
    ) || ' accepted your invitation.',
    jsonb_build_object('student_id', auth.uid(), 'invitation_id', p_invitation_id)
  from public.profiles p
  where p.user_id = auth.uid();
end;
$$;


-- ---------------------------------------------------------------------------
-- RPC: decline_teacher_invitation(p_invitation_id)
-- ---------------------------------------------------------------------------
create or replace function public.decline_teacher_invitation(p_invitation_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.teacher_invitations
  set status = 'declined', updated_at = now()
  where id = p_invitation_id
    and student_id = auth.uid()
    and status = 'pending';
$$;


-- ---------------------------------------------------------------------------
-- RPC: accept_teacher_invitation_by_token(p_token)
-- Called when student arrives via email invite link.
-- Works even if student_id was null at invite time (new signup).
-- ---------------------------------------------------------------------------
create or replace function public.accept_teacher_invitation_by_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.teacher_invitations%rowtype;
begin
  select * into v_inv
  from public.teacher_invitations
  where token = p_token and status = 'pending';

  if not found then
    raise exception 'Invalid or expired invitation token';
  end if;

  update public.teacher_invitations
  set status = 'accepted', student_id = auth.uid(), updated_at = now()
  where id = v_inv.id;

  insert into public.teacher_students (teacher_id, student_id)
  values (v_inv.teacher_id, auth.uid())
  on conflict do nothing;

  -- Notify teacher
  insert into public.notifications (user_id, type, title, body, data)
  select
    v_inv.teacher_id,
    'invitation_accepted',
    'Student accepted your invitation',
    coalesce(
      nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
      p.username,
      'A student'
    ) || ' accepted your invitation.',
    jsonb_build_object('student_id', auth.uid(), 'invitation_id', v_inv.id)
  from public.profiles p
  where p.user_id = auth.uid();
end;
$$;


-- ---------------------------------------------------------------------------
-- RPC: process_pending_invitations()
-- Called on login. Auto-accepts any email-link invitations where student_id
-- was null (student signed up after invite was sent).
-- Returns count of invitations processed.
-- ---------------------------------------------------------------------------
create or replace function public.process_pending_invitations()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_inv   public.teacher_invitations%rowtype;
  v_count int := 0;
begin
  select lower(email) into v_email from auth.users where id = auth.uid();

  for v_inv in
    select * from public.teacher_invitations
    where lower(student_email) = v_email
      and student_id is null
      and status = 'pending'
  loop
    update public.teacher_invitations
    set status = 'accepted', student_id = auth.uid(), updated_at = now()
    where id = v_inv.id;

    insert into public.teacher_students (teacher_id, student_id)
    values (v_inv.teacher_id, auth.uid())
    on conflict do nothing;

    insert into public.notifications (user_id, type, title, body, data)
    select
      v_inv.teacher_id,
      'invitation_accepted',
      'Student accepted your invitation',
      coalesce(
        nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
        p.username,
        'A student'
      ) || ' accepted your invitation.',
      jsonb_build_object('student_id', auth.uid(), 'invitation_id', v_inv.id)
    from public.profiles p
    where p.user_id = auth.uid();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


-- ---------------------------------------------------------------------------
-- TRIGGER: notify student when invitation is created (if they have an account)
-- ---------------------------------------------------------------------------
create or replace function public.notify_student_on_invitation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teacher_name text;
begin
  if new.student_id is null then return new; end if;

  select coalesce(
    nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''),
    username,
    new.teacher_id::text
  ) into v_teacher_name
  from public.profiles
  where user_id = new.teacher_id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    new.student_id,
    'teacher_invitation',
    'Teacher invitation',
    coalesce(v_teacher_name, 'A teacher') || ' has invited you to be their student.',
    jsonb_build_object(
      'invitation_id', new.id,
      'teacher_id',    new.teacher_id,
      'teacher_name',  v_teacher_name
    )
  );

  return new;
end;
$$;

create or replace trigger trg_notify_student_on_invitation
  after insert on public.teacher_invitations
  for each row execute function public.notify_student_on_invitation();


-- ---------------------------------------------------------------------------
-- UPDATE: get_students_for_teacher()
-- Now uses teacher_students instead of student_assignments as the primary join,
-- so students appear as soon as they accept — before any assignment is made.
-- ---------------------------------------------------------------------------
create or replace function public.get_students_for_teacher()
returns table (
  user_id                uuid,
  first_name             text,
  last_name              text,
  username               text,
  last_seen_at           timestamptz,
  joined_at              timestamptz,
  last_assignment_update timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.user_id,
    p.first_name,
    p.last_name,
    p.username,
    p.last_seen_at,
    u.created_at                as joined_at,
    max(sa.updated_at)          as last_assignment_update
  from public.teacher_students ts
  join public.profiles p         on p.user_id   = ts.student_id
  join auth.users u              on u.id         = ts.student_id
  left join public.student_assignments sa
    on sa.student_id = ts.student_id and sa.assigned_by = auth.uid()
  where ts.teacher_id = auth.uid()
  group by p.user_id, p.first_name, p.last_name, p.username, p.last_seen_at, u.created_at;
$$;
