-- =============================================================================
-- Assignment Submission System
-- Migration: 20260324_assignment_submission_system.sql
--
-- Tables:
--   assignments
--   assignment_items
--   student_assignments
--   assignment_submissions
--   submission_item_responses
--   notifications
--
-- Storage bucket: assignment-submissions (private)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- HELPER: current_user_role()
-- Reads the current user's role from profiles once per statement.
-- Used by all RLS policies to avoid repeating the join inline.
-- Pattern: security definer + set search_path (see check_email_exists_fn.sql)
-- ---------------------------------------------------------------------------
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid();
$$;


-- ---------------------------------------------------------------------------
-- TABLE: assignments
-- Master assignment definitions created by admin/teacher.
-- course_id is optional — assignments can be standalone or tied to a course.
-- ---------------------------------------------------------------------------
create table if not exists public.assignments (
  id               uuid        default gen_random_uuid() primary key,
  created_by       uuid        not null references auth.users(id) on delete cascade,
  course_id        uuid        references public.courses(id) on delete set null,
  title            text        not null,
  description      text,
  default_due_date timestamptz,
  is_published     boolean     not null default false,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

alter table public.assignments enable row level security;


-- ---------------------------------------------------------------------------
-- TABLE: assignment_items
-- Ordered list of submission items required for an assignment.
--
-- item_type values:
--   mark_complete  — student simply marks done, no upload needed
--   quiz           — student answers questions (config stores the question data)
--   audio          — student records and uploads audio
--   video          — student records and uploads video
--   link           — student provides a URL
--
-- config (jsonb, used by quiz type only):
-- {
--   "questions": [
--     {
--       "id": "q1",
--       "prompt": "What is the Ding?",
--       "options": [{ "id": "o1", "label": "..." }, { "id": "o2", "label": "..." }],
--       "correct_option_id": "o1"
--     }
--   ],
--   "passing_score": 70
-- }
-- ---------------------------------------------------------------------------
create table if not exists public.assignment_items (
  id            uuid    default gen_random_uuid() primary key,
  assignment_id uuid    not null references public.assignments(id) on delete cascade,
  item_type     text    not null check (item_type in ('mark_complete', 'quiz', 'audio', 'video', 'link')),
  title         text    not null,
  instructions  text,
  sort_order    int     not null default 0,
  required      boolean not null default true,
  config        jsonb,
  created_at    timestamptz default now()
);

alter table public.assignment_items enable row level security;


-- ---------------------------------------------------------------------------
-- TABLE: student_assignments
-- A specific assignment assigned to a specific student.
-- due_date overrides the assignment's default_due_date if set.
-- Status lifecycle: pending → in_progress → submitted → reviewed
-- ---------------------------------------------------------------------------
create table if not exists public.student_assignments (
  id            uuid    default gen_random_uuid() primary key,
  assignment_id uuid    not null references public.assignments(id) on delete cascade,
  student_id    uuid    not null references auth.users(id) on delete cascade,
  assigned_by   uuid    not null references auth.users(id) on delete cascade,
  due_date      timestamptz,
  status        text    not null default 'pending'
                        check (status in ('pending', 'in_progress', 'submitted', 'reviewed')),
  assigned_at   timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (assignment_id, student_id)
);

alter table public.student_assignments enable row level security;


-- ---------------------------------------------------------------------------
-- TABLE: assignment_submissions
-- One submission per student_assignment (enforced by unique constraint).
-- Created when the student formally submits. Teacher writes feedback here.
-- ---------------------------------------------------------------------------
create table if not exists public.assignment_submissions (
  id                    uuid    default gen_random_uuid() primary key,
  student_assignment_id uuid    not null references public.student_assignments(id) on delete cascade,
  submitted_at          timestamptz default now(),
  reviewed_at           timestamptz,
  reviewed_by           uuid    references auth.users(id) on delete set null,
  feedback              text,
  unique (student_assignment_id)
);

alter table public.assignment_submissions enable row level security;


-- ---------------------------------------------------------------------------
-- TABLE: submission_item_responses
-- One response per assignment_item per submission.
--
-- response_data shapes by item_type:
--   mark_complete : {}
--   audio / video : { "storage_path": "uuid/sa-id/file.webm", "duration_seconds": 45, "file_size_bytes": 102400 }
--   link          : { "url": "https://...", "label": "My practice video" }
--   quiz          : { "answers": { "q1": "o2", "q2": "o1" }, "score": 85, "passed": true }
-- ---------------------------------------------------------------------------
create table if not exists public.submission_item_responses (
  id            uuid  default gen_random_uuid() primary key,
  submission_id uuid  not null references public.assignment_submissions(id) on delete cascade,
  item_id       uuid  not null references public.assignment_items(id) on delete cascade,
  response_data jsonb not null default '{}',
  responded_at  timestamptz default now(),
  unique (submission_id, item_id)
);

alter table public.submission_item_responses enable row level security;


-- ---------------------------------------------------------------------------
-- TABLE: notifications
-- Generic in-app notifications for students and teachers.
-- type is an open text string (no CHECK) so future notification types
-- (post likes, private messages, etc.) can be added without schema changes.
-- read_at IS NULL means unread.
--
-- Known types (by convention):
--   assignment_assigned   — sent to student when assigned
--   assignment_submitted  — sent to teacher when student submits
--   assignment_reviewed   — sent to student when teacher reviews
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid  default gen_random_uuid() primary key,
  user_id    uuid  not null references auth.users(id) on delete cascade,
  type       text  not null,
  title      text  not null,
  body       text,
  data       jsonb default '{}',
  read_at    timestamptz,
  created_at timestamptz default now()
);

alter table public.notifications enable row level security;


-- =============================================================================
-- INDEXES
-- =============================================================================

create index if not exists idx_assignments_created_by
  on public.assignments (created_by);

create index if not exists idx_assignments_course_id
  on public.assignments (course_id);

create index if not exists idx_assignment_items_assignment_sort
  on public.assignment_items (assignment_id, sort_order);

create index if not exists idx_student_assignments_student_id
  on public.student_assignments (student_id);

create index if not exists idx_student_assignments_assigned_by
  on public.student_assignments (assigned_by);

create index if not exists idx_student_assignments_assignment_id
  on public.student_assignments (assignment_id);

create index if not exists idx_student_assignments_status
  on public.student_assignments (status);

create index if not exists idx_assignment_submissions_student_assignment_id
  on public.assignment_submissions (student_assignment_id);

create index if not exists idx_submission_item_responses_submission_id
  on public.submission_item_responses (submission_id);

-- Partial index: fast unread notification count per user
create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, created_at desc)
  where read_at is null;


-- =============================================================================
-- TRIGGER FUNCTIONS & TRIGGERS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- updated_at maintenance (shared by assignments + student_assignments)
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger assignments_set_updated_at
  before update on public.assignments
  for each row execute function public.set_updated_at();

create or replace trigger student_assignments_set_updated_at
  before update on public.student_assignments
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- TRIGGER 1: Notify student when they are assigned an assignment
-- Fires: AFTER INSERT on student_assignments
-- ---------------------------------------------------------------------------
create or replace function public.notify_student_on_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment_title text;
  v_assigner_name    text;
begin
  select title into v_assignment_title
  from public.assignments
  where id = new.assignment_id;

  select coalesce(
    nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''),
    username,
    new.assigned_by::text
  ) into v_assigner_name
  from public.profiles
  where user_id = new.assigned_by;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    new.student_id,
    'assignment_assigned',
    'New assignment',
    coalesce(v_assigner_name, 'Your teacher') || ' assigned you "' || coalesce(v_assignment_title, 'a new assignment') || '".',
    jsonb_build_object(
      'student_assignment_id', new.id,
      'assignment_id',         new.assignment_id,
      'assigned_by',           new.assigned_by,
      'assignment_title',      v_assignment_title,
      'due_date',              new.due_date
    )
  );

  return new;
end;
$$;

create or replace trigger trg_notify_student_on_assignment
  after insert on public.student_assignments
  for each row execute function public.notify_student_on_assignment();


-- ---------------------------------------------------------------------------
-- TRIGGER 2: Notify teacher when student submits
-- Fires: AFTER UPDATE on student_assignments when status → 'submitted'
-- ---------------------------------------------------------------------------
create or replace function public.notify_teacher_on_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment_title text;
  v_student_name     text;
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' then

    select title into v_assignment_title
    from public.assignments
    where id = new.assignment_id;

    select coalesce(
      nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''),
      username,
      new.student_id::text
    ) into v_student_name
    from public.profiles
    where user_id = new.student_id;

    insert into public.notifications (user_id, type, title, body, data)
    values (
      new.assigned_by,
      'assignment_submitted',
      'Assignment submitted',
      coalesce(v_student_name, 'A student') || ' submitted "' || coalesce(v_assignment_title, 'an assignment') || '".',
      jsonb_build_object(
        'student_assignment_id', new.id,
        'assignment_id',         new.assignment_id,
        'student_id',            new.student_id,
        'assignment_title',      v_assignment_title,
        'student_name',          v_student_name
      )
    );

  end if;

  return new;
end;
$$;

create or replace trigger trg_notify_teacher_on_submission
  after update on public.student_assignments
  for each row execute function public.notify_teacher_on_submission();


-- ---------------------------------------------------------------------------
-- TRIGGER 3: Notify student when teacher reviews their submission
-- Fires: AFTER UPDATE on assignment_submissions when reviewed_at is set
-- ---------------------------------------------------------------------------
create or replace function public.notify_student_on_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id       uuid;
  v_assignment_title text;
  v_reviewer_name    text;
begin
  if new.reviewed_at is not null and old.reviewed_at is null then

    -- Look up student and assignment info via student_assignments
    select sa.student_id, a.title
    into v_student_id, v_assignment_title
    from public.student_assignments sa
    join public.assignments a on a.id = sa.assignment_id
    where sa.id = new.student_assignment_id;

    select coalesce(
      nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''),
      username,
      new.reviewed_by::text
    ) into v_reviewer_name
    from public.profiles
    where user_id = new.reviewed_by;

    insert into public.notifications (user_id, type, title, body, data)
    values (
      v_student_id,
      'assignment_reviewed',
      'Assignment reviewed',
      coalesce(v_reviewer_name, 'Your teacher') || ' reviewed your submission for "' || coalesce(v_assignment_title, 'an assignment') || '".',
      jsonb_build_object(
        'student_assignment_id', new.student_assignment_id,
        'submission_id',         new.id,
        'assignment_title',      v_assignment_title,
        'reviewed_by',           new.reviewed_by,
        'has_feedback',          (new.feedback is not null)
      )
    );

  end if;

  return new;
end;
$$;

create or replace trigger trg_notify_student_on_review
  after update on public.assignment_submissions
  for each row execute function public.notify_student_on_review();


-- =============================================================================
-- RLS POLICIES
-- =============================================================================

-- ---------------------------------------------------------------------------
-- assignments
-- ---------------------------------------------------------------------------

create policy "Admin full select on assignments"
  on public.assignments for select
  using (public.current_user_role() = 'admin');

create policy "Teacher selects own and published assignments"
  on public.assignments for select
  using (
    public.current_user_role() = 'teacher'
    and (created_by = auth.uid() or is_published = true)
  );

create policy "Student selects their assigned published assignments"
  on public.assignments for select
  using (
    public.current_user_role() = 'student'
    and is_published = true
    and exists (
      select 1 from public.student_assignments sa
      where sa.assignment_id = assignments.id
        and sa.student_id = auth.uid()
    )
  );

create policy "Admin and teacher can create assignments"
  on public.assignments for insert
  with check (
    public.current_user_role() in ('admin', 'teacher')
    and created_by = auth.uid()
  );

create policy "Admin can update any assignment"
  on public.assignments for update
  using (public.current_user_role() = 'admin');

create policy "Teacher can update own assignments"
  on public.assignments for update
  using (public.current_user_role() = 'teacher' and created_by = auth.uid());

create policy "Admin can delete any assignment"
  on public.assignments for delete
  using (public.current_user_role() = 'admin');

create policy "Teacher can delete own assignments"
  on public.assignments for delete
  using (public.current_user_role() = 'teacher' and created_by = auth.uid());


-- ---------------------------------------------------------------------------
-- assignment_items
-- ---------------------------------------------------------------------------

create policy "Admin full select on assignment_items"
  on public.assignment_items for select
  using (public.current_user_role() = 'admin');

create policy "Teacher selects items for own or published assignments"
  on public.assignment_items for select
  using (
    public.current_user_role() = 'teacher'
    and exists (
      select 1 from public.assignments a
      where a.id = assignment_items.assignment_id
        and (a.created_by = auth.uid() or a.is_published = true)
    )
  );

create policy "Student selects items for their assigned assignments"
  on public.assignment_items for select
  using (
    public.current_user_role() = 'student'
    and exists (
      select 1
      from public.student_assignments sa
      join public.assignments a on a.id = sa.assignment_id
      where sa.assignment_id = assignment_items.assignment_id
        and sa.student_id = auth.uid()
        and a.is_published = true
    )
  );

create policy "Admin and owner teacher can insert assignment_items"
  on public.assignment_items for insert
  with check (
    public.current_user_role() = 'admin'
    or (
      public.current_user_role() = 'teacher'
      and exists (
        select 1 from public.assignments a
        where a.id = assignment_items.assignment_id and a.created_by = auth.uid()
      )
    )
  );

create policy "Admin and owner teacher can update assignment_items"
  on public.assignment_items for update
  using (
    public.current_user_role() = 'admin'
    or (
      public.current_user_role() = 'teacher'
      and exists (
        select 1 from public.assignments a
        where a.id = assignment_items.assignment_id and a.created_by = auth.uid()
      )
    )
  );

create policy "Admin and owner teacher can delete assignment_items"
  on public.assignment_items for delete
  using (
    public.current_user_role() = 'admin'
    or (
      public.current_user_role() = 'teacher'
      and exists (
        select 1 from public.assignments a
        where a.id = assignment_items.assignment_id and a.created_by = auth.uid()
      )
    )
  );


-- ---------------------------------------------------------------------------
-- student_assignments
-- ---------------------------------------------------------------------------

create policy "Admin full select on student_assignments"
  on public.student_assignments for select
  using (public.current_user_role() = 'admin');

create policy "Teacher sees their assigned student_assignments"
  on public.student_assignments for select
  using (public.current_user_role() = 'teacher' and assigned_by = auth.uid());

create policy "Student sees their own student_assignments"
  on public.student_assignments for select
  using (public.current_user_role() = 'student' and student_id = auth.uid());

create policy "Admin and teacher can assign students"
  on public.student_assignments for insert
  with check (
    public.current_user_role() in ('admin', 'teacher')
    and assigned_by = auth.uid()
  );

create policy "Admin can update any student_assignment"
  on public.student_assignments for update
  using (public.current_user_role() = 'admin');

create policy "Teacher can update their student_assignments"
  on public.student_assignments for update
  using (public.current_user_role() = 'teacher' and assigned_by = auth.uid());

-- Student can advance status to in_progress or submitted only (not back to pending, not to reviewed)
create policy "Student can update own assignment status"
  on public.student_assignments for update
  using (public.current_user_role() = 'student' and student_id = auth.uid())
  with check (
    public.current_user_role() = 'student'
    and student_id = auth.uid()
    and status in ('in_progress', 'submitted')
  );

create policy "Admin can delete student_assignments"
  on public.student_assignments for delete
  using (public.current_user_role() = 'admin');

create policy "Teacher can delete their student_assignments"
  on public.student_assignments for delete
  using (public.current_user_role() = 'teacher' and assigned_by = auth.uid());


-- ---------------------------------------------------------------------------
-- assignment_submissions
-- ---------------------------------------------------------------------------

create policy "Admin full select on assignment_submissions"
  on public.assignment_submissions for select
  using (public.current_user_role() = 'admin');

create policy "Teacher sees submissions for their students"
  on public.assignment_submissions for select
  using (
    public.current_user_role() = 'teacher'
    and exists (
      select 1 from public.student_assignments sa
      where sa.id = assignment_submissions.student_assignment_id
        and sa.assigned_by = auth.uid()
    )
  );

create policy "Student sees their own submissions"
  on public.assignment_submissions for select
  using (
    public.current_user_role() = 'student'
    and exists (
      select 1 from public.student_assignments sa
      where sa.id = assignment_submissions.student_assignment_id
        and sa.student_id = auth.uid()
    )
  );

create policy "Student can create their own submission"
  on public.assignment_submissions for insert
  with check (
    public.current_user_role() = 'student'
    and exists (
      select 1 from public.student_assignments sa
      where sa.id = assignment_submissions.student_assignment_id
        and sa.student_id = auth.uid()
    )
  );

create policy "Admin can update any submission"
  on public.assignment_submissions for update
  using (public.current_user_role() = 'admin');

create policy "Teacher can update submissions for their students"
  on public.assignment_submissions for update
  using (
    public.current_user_role() = 'teacher'
    and exists (
      select 1 from public.student_assignments sa
      where sa.id = assignment_submissions.student_assignment_id
        and sa.assigned_by = auth.uid()
    )
  );

create policy "Admin can delete any submission"
  on public.assignment_submissions for delete
  using (public.current_user_role() = 'admin');


-- ---------------------------------------------------------------------------
-- submission_item_responses
-- ---------------------------------------------------------------------------

create policy "Admin full select on submission_item_responses"
  on public.submission_item_responses for select
  using (public.current_user_role() = 'admin');

create policy "Teacher sees responses for their students"
  on public.submission_item_responses for select
  using (
    public.current_user_role() = 'teacher'
    and exists (
      select 1
      from public.assignment_submissions asub
      join public.student_assignments sa on sa.id = asub.student_assignment_id
      where asub.id = submission_item_responses.submission_id
        and sa.assigned_by = auth.uid()
    )
  );

create policy "Student sees their own responses"
  on public.submission_item_responses for select
  using (
    public.current_user_role() = 'student'
    and exists (
      select 1
      from public.assignment_submissions asub
      join public.student_assignments sa on sa.id = asub.student_assignment_id
      where asub.id = submission_item_responses.submission_id
        and sa.student_id = auth.uid()
    )
  );

create policy "Student can insert their own responses"
  on public.submission_item_responses for insert
  with check (
    public.current_user_role() = 'student'
    and exists (
      select 1
      from public.assignment_submissions asub
      join public.student_assignments sa on sa.id = asub.student_assignment_id
      where asub.id = submission_item_responses.submission_id
        and sa.student_id = auth.uid()
    )
  );

-- Students can update responses only before the assignment is submitted
create policy "Student can update responses before submission"
  on public.submission_item_responses for update
  using (
    public.current_user_role() = 'student'
    and exists (
      select 1
      from public.assignment_submissions asub
      join public.student_assignments sa on sa.id = asub.student_assignment_id
      where asub.id = submission_item_responses.submission_id
        and sa.student_id = auth.uid()
        and sa.status not in ('submitted', 'reviewed')
    )
  );

create policy "Admin can delete any response"
  on public.submission_item_responses for delete
  using (public.current_user_role() = 'admin');


-- ---------------------------------------------------------------------------
-- notifications
-- No INSERT policy for regular roles — only SECURITY DEFINER triggers insert.
-- ---------------------------------------------------------------------------

create policy "User sees own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "User can mark own notifications as read"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "User can delete own notifications"
  on public.notifications for delete
  using (auth.uid() = user_id);

create policy "Admin can read all notifications"
  on public.notifications for select
  using (public.current_user_role() = 'admin');


-- =============================================================================
-- STORAGE BUCKET: assignment-submissions (private)
--
-- Path convention: {student_id}/{student_assignment_id}/{filename}
-- Files are served via signed URLs, never public CDN links.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('assignment-submissions', 'assignment-submissions', false)
on conflict (id) do nothing;

create policy "Student can upload their own submission files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'assignment-submissions'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Student can read their own submission files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'assignment-submissions'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Student can delete their own submission files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'assignment-submissions'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Teacher can read their students submission files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'assignment-submissions'
    and exists (
      select 1 from public.student_assignments sa
      where sa.student_id = ((storage.foldername(name))[1])::uuid
        and sa.assigned_by = auth.uid()
    )
  );

create policy "Admin can read all submission files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'assignment-submissions'
    and public.current_user_role() = 'admin'
  );

create policy "Admin can delete submission files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'assignment-submissions'
    and public.current_user_role() = 'admin'
  );
