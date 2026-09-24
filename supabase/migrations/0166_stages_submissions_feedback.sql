-- 0166: a studio's own stages, work that moves itself, and a way to ask for features.
--
-- 1. Stages. A deliverable still walks the four-step spine (To do, Editing,
--    Review, Delivered) that tracking, quotations and the pipeline count on.
--    Inside a step a studio may name its own stages -- "With manager",
--    "Approved", "With client", "Changes requested", "Colour grading" -- kept
--    in company_deliverable_statuses (0007), which nothing wrote to until now.
--    A new `stage` column says which step each one belongs to.
-- 2. Assigning an editor starts the work: To do becomes Editing.
-- 3. Work an editor submits for a deliverable moves it to Review / With
--    manager; approving moves it to Approved; sending it back moves it to
--    Editing / Changes requested, and the reviewer's words land in the
--    deliverable's timeline, where the editor is notified of them.
-- 4. feature_requests: "Suggest a feature" from any screen, read by the
--    platform's own admins.

-- ── 1. stages ─────────────────────────────────────────────────────
alter table company_deliverable_statuses
  add column if not exists stage text
    check (stage is null or stage in ('pending', 'in_progress', 'review', 'completed'));

-- Rows made before this (tasks' custom statuses, or anything imported) get a
-- step from their category, so they show in the right place.
update company_deliverable_statuses
   set stage = case category::text
                 when 'to_do' then 'pending'
                 when 'in_progress' then 'in_progress'
                 when 'completed' then 'completed'
               end
 where stage is null and scope in ('deliverable', 'both') and category::text <> 'cancelled';

create index if not exists company_deliverable_statuses_stage_idx
  on company_deliverable_statuses (company_id, stage, sort_order);

-- The five a studio starts with. Codes are stable: the automations below
-- look for them by code, and renaming a stage changes only its label.
create or replace function seed_deliverable_stages(p_company uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into company_deliverable_statuses
    (company_id, code, label, scope, category, stage, team_allowed, color, sort_order)
  values
    (p_company, 'changes_requested', 'Changes requested', 'deliverable', 'in_progress', 'in_progress', true,  'rose',   10),
    (p_company, 'with_manager',      'With manager',      'deliverable', 'in_progress', 'review',      true,  'violet', 10),
    (p_company, 'approved',          'Approved',          'deliverable', 'in_progress', 'review',      false, 'teal',   20),
    (p_company, 'with_client',       'With client',       'deliverable', 'in_progress', 'review',      true,  'amber',  30),
    (p_company, 'client_approved',   'Client approved',   'deliverable', 'in_progress', 'review',      false, 'green',  40)
  on conflict (company_id, code) do nothing;
$$;
revoke all on function seed_deliverable_stages(uuid) from public;

do $$
declare c record;
begin
  for c in select id from companies loop
    perform seed_deliverable_stages(c.id);
  end loop;
end $$;

create or replace function companies_seed_stages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_deliverable_stages(new.id);
  return new;
end;
$$;

drop trigger if exists companies_seed_stages on companies;
create trigger companies_seed_stages
  after insert on companies
  for each row execute function companies_seed_stages();

-- What was "With client" before is still "With client".
update deliverables set custom_status_code = 'with_client'
 where status = 'review' and custom_status_code is null;

-- ── 2. the deliverable's own rules, extended ──────────────────────
create or replace function deliverables_normalise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from projects p where p.id = new.project_id and p.company_id = new.company_id) then
    raise exception 'That project is not in this studio.' using errcode = '42501';
  end if;
  if new.shoot_id is not null and not exists (
       select 1 from shoots s
        where s.id = new.shoot_id and s.company_id = new.company_id and s.project_id = new.project_id) then
    raise exception 'That shoot is not part of this project.' using errcode = '23514';
  end if;
  if new.assignee_id is not null and not exists (
       select 1 from users u where u.user_id = new.assignee_id and u.company_id = new.company_id) then
    raise exception 'That person is not on this studio''s team.' using errcode = '23514';
  end if;

  -- Giving it to an editor starts it.
  if new.assignee_id is not null and new.status = 'pending'
     and (tg_op = 'INSERT' or old.assignee_id is null) then
    new.status := 'in_progress';
  end if;

  -- A named stage must be the studio's and sit in the step it is in. When
  -- the step moves on and the stage was not changed with it, the stage is
  -- simply left behind.
  if new.custom_status_code is not null and not exists (
       select 1 from company_deliverable_statuses cs
        where cs.company_id = new.company_id and cs.code = new.custom_status_code
          and cs.stage = new.status) then
    if tg_op = 'UPDATE' and new.custom_status_code is not distinct from old.custom_status_code then
      new.custom_status_code := null;
    else
      raise exception 'That stage is not one of this studio''s stages for this step.' using errcode = '23514';
    end if;
  end if;

  -- Team work is never promised on a quotation.
  if new.visibility_scope = 'internal' then
    new.show_on_quotation := false;
  end if;

  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from 'completed' or new.delivered_at is null then
      new.delivered_at := coalesce(new.delivered_at, now());
    end if;
  else
    new.delivered_at := null;
  end if;
  return new;
end;
$$;

-- The timeline records the named stage too: moved:<step>[:<stage code>].
-- A submission writes its own, richer event and asks for this one to stay
-- quiet (ipc.quiet_stage_log) so the timeline does not say it twice.
create or replace function deliverables_log_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is not distinct from new.status
     and old.custom_status_code is not distinct from new.custom_status_code then
    return new;
  end if;
  if coalesce(current_setting('ipc.quiet_stage_log', true), '') = '1' then
    return new;
  end if;
  insert into deliverable_notes (company_id, deliverable_id, author_id, kind, body)
  values (new.company_id, new.id, auth.uid(), 'event',
          'moved:' || new.status || coalesce(':' || new.custom_status_code, ''));
  return new;
end;
$$;

-- Every update, not `update of status`: a column list fires only for columns
-- named in the UPDATE, and assigning an editor moves the status from the
-- BEFORE trigger above without naming it.
drop trigger if exists deliverables_log_stage on deliverables;
create trigger deliverables_log_stage
  after update on deliverables
  for each row execute function deliverables_log_stage();

-- ── 3. submitted work moves the deliverable ───────────────────────
alter table team_work_submissions
  add column if not exists deliverable_id uuid references deliverables (id) on delete set null;
create index if not exists team_work_submissions_deliverable_idx
  on team_work_submissions (deliverable_id) where deliverable_id is not null;

update team_work_submissions s
   set deliverable_id = t.deliverable_id
  from tasks t
 where s.task_id = t.id and s.deliverable_id is null and t.deliverable_id is not null;

-- The deliverable must be the studio's, and the submission is for its project.
create or replace function team_work_submissions_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_project uuid;
begin
  if new.deliverable_id is null then
    return new;
  end if;
  select project_id into v_project from deliverables
   where id = new.deliverable_id and company_id = new.company_id;
  if v_project is null then
    raise exception 'That deliverable is not in this studio.' using errcode = '42501';
  end if;
  if new.project_id is null then
    new.project_id := v_project;
  elsif new.project_id <> v_project then
    raise exception 'That deliverable is from a different project.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists team_work_submissions_fill on team_work_submissions;
create trigger team_work_submissions_fill
  before insert or update of deliverable_id, project_id on team_work_submissions
  for each row execute function team_work_submissions_fill();

-- Move a deliverable for a submission: the step, the named stage if the
-- studio still has it, the link, and one event in the timeline.
create or replace function deliverable_follow_submission(
  p_deliverable uuid, p_status text, p_code text, p_link text, p_event text, p_author uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_company uuid; v_code text;
begin
  select company_id into v_company from deliverables where id = p_deliverable;
  if v_company is null then
    return;
  end if;
  select code into v_code from company_deliverable_statuses
   where company_id = v_company and code = p_code and stage = p_status;

  perform set_config('ipc.quiet_stage_log', '1', true);
  update deliverables
     set status = p_status,
         custom_status_code = v_code,
         delivery_link = coalesce(nullif(p_link, ''), delivery_link)
   where id = p_deliverable;
  perform set_config('ipc.quiet_stage_log', '', true);

  insert into deliverable_notes (company_id, deliverable_id, author_id, kind, body)
  values (v_company, p_deliverable, p_author, 'event', p_event);
end;
$$;
revoke all on function deliverable_follow_submission(uuid, text, text, text, text, uuid) from public;

create or replace function team_work_submissions_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deliverable_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform deliverable_follow_submission(new.deliverable_id, 'review', 'with_manager',
      new.submission_link, 'submitted:' || new.id, coalesce(new.submitted_by, auth.uid()));
    return new;
  end if;

  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'approved' then
    perform deliverable_follow_submission(new.deliverable_id, 'review', 'approved',
      null, 'approved:' || new.id, auth.uid());
  elsif new.status = 'rejected' then
    perform deliverable_follow_submission(new.deliverable_id, 'in_progress', 'changes_requested',
      null, 'sent_back:' || new.id, auth.uid());
    -- What the reviewer said reaches the editor as a note, with a notification.
    if nullif(btrim(coalesce(new.review_notes, '')), '') is not null and auth.uid() is not null then
      insert into deliverable_notes (company_id, deliverable_id, author_id, kind, body)
      values (new.company_id, new.deliverable_id, auth.uid(), 'text', left(new.review_notes, 4000));
    end if;
  elsif new.status = 'sent' then
    perform deliverable_follow_submission(new.deliverable_id, 'review', 'with_client',
      null, 'sent_to_client:' || new.id, auth.uid());
  elsif new.status = 'submitted' and old.status = 'rejected' then
    perform deliverable_follow_submission(new.deliverable_id, 'review', 'with_manager',
      new.submission_link, 'resubmitted:' || new.id, coalesce(new.submitted_by, auth.uid()));
  end if;
  return new;
end;
$$;

drop trigger if exists team_work_submissions_follow on team_work_submissions;
create trigger team_work_submissions_follow
  after insert or update of status on team_work_submissions
  for each row execute function team_work_submissions_follow();

-- ── 4. "Suggest a feature" ────────────────────────────────────────
create table if not exists feature_requests (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,
  body                text check (body is null or char_length(body) <= 4000),
  voice_file_id       uuid references files (id) on delete set null,
  voice_seconds       int check (voice_seconds is null or voice_seconds between 0 and 600),
  screenshot_file_id  uuid references files (id) on delete set null,
  page_url            text check (page_url is null or char_length(page_url) <= 1000),
  user_agent          text check (user_agent is null or char_length(user_agent) <= 400),
  status              text not null default 'new' check (status in ('new', 'planned', 'done', 'declined')),
  admin_note          text check (admin_note is null or char_length(admin_note) <= 2000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint feature_requests_has_something
    check (nullif(btrim(coalesce(body, '')), '') is not null or voice_file_id is not null or screenshot_file_id is not null)
);
create index if not exists feature_requests_created_idx on feature_requests (created_at desc);
create index if not exists feature_requests_company_idx on feature_requests (company_id);

-- Files attached must be the sender's studio's.
create or replace function feature_requests_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
       select 1 from files f
        where f.id in (new.voice_file_id, new.screenshot_file_id) and f.company_id <> new.company_id) then
    raise exception 'file not in this studio' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists feature_requests_fill on feature_requests;
create trigger feature_requests_fill
  before insert on feature_requests
  for each row execute function feature_requests_fill();

alter table feature_requests enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'feature_requests_insert') then
    create policy feature_requests_insert on feature_requests for insert to authenticated
      with check (company_id = get_current_company_id() and user_id = auth.uid() and is_current_user_active());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'feature_requests_select') then
    create policy feature_requests_select on feature_requests for select to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

grant select, insert on feature_requests to authenticated;

-- The platform's inbox: every studio's suggestions, newest first. Crosses
-- tenants on purpose, so it is gated on the platform allowlist.
create or replace function platform_list_feature_requests(p_status text default null)
returns table (
  id uuid, company_id uuid, company_name text, user_id uuid, user_name text, user_email text,
  body text, voice_file_id uuid, voice_seconds int, screenshot_file_id uuid,
  page_url text, user_agent text, status text, admin_note text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select r.id, r.company_id, c.name, r.user_id, u.name, u.email,
           r.body, r.voice_file_id, r.voice_seconds, r.screenshot_file_id,
           r.page_url, r.user_agent, r.status, r.admin_note, r.created_at
      from feature_requests r
      join companies c on c.id = r.company_id
      left join users u on u.user_id = r.user_id
     where p_status is null or r.status = p_status
     order by r.created_at desc
     limit 500;
end;
$$;
revoke all on function platform_list_feature_requests(text) from public;
grant execute on function platform_list_feature_requests(text) to authenticated;

create or replace function platform_update_feature_request(p_id uuid, p_status text, p_note text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update feature_requests
     set status = coalesce(p_status, status),
         admin_note = case when p_note is null then admin_note else nullif(btrim(p_note), '') end,
         updated_at = now()
   where id = p_id;
  return found;
end;
$$;
revoke all on function platform_update_feature_request(uuid, text, text) from public;
grant execute on function platform_update_feature_request(uuid, text, text) to authenticated;

-- A voice note or screenshot attached to a suggestion, for the platform inbox.
create or replace function platform_feature_request_file(p_request uuid, p_file uuid)
returns table (name text, mime text, bytes bytea)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select f.name, f.mime, f.bytes
      from feature_requests r
      join files f on f.id = p_file and f.id in (r.voice_file_id, r.screenshot_file_id)
     where r.id = p_request;
end;
$$;
revoke all on function platform_feature_request_file(uuid, uuid) from public;
grant execute on function platform_feature_request_file(uuid, uuid) to authenticated;
