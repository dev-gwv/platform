-- 0295: Quotation Designer (owner, 9 Nov): premium quotation designs made from a
-- project -- the owner's Canva quotation rebuilt inside Studio AutoPilot, with
-- its pages filled from the project and edited in place.
--
-- A design is one document: its pages and what is written and pictured on
-- them (doc), the look it wears (template), and the project it was made for.
-- Every plan has it; Starter (regular or Diamond) designs 30 a plan year, the
-- way it makes 30 projects and invoices (owner: "they can make only 30
-- quotations in the Diamond Starter plan"); Pro and Studio Max are unlimited,
-- and a trial is never stopped. Safe to run twice.

create table if not exists quotation_designs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null default get_current_company_id() references companies (id) on delete cascade,
  project_id  uuid references projects (id) on delete set null,
  title       text not null check (char_length(trim(title)) between 1 and 160),
  template    text not null default 'ivory' check (template ~ '^[a-z][a-z0-9_]{0,39}$'),
  doc         jsonb not null default '{}'::jsonb check (pg_column_size(doc) <= 600000),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists quotation_designs_company_idx on quotation_designs (company_id, updated_at desc);
create index if not exists quotation_designs_project_idx on quotation_designs (project_id);

alter table quotation_designs enable row level security;
drop policy if exists quotation_designs_select on quotation_designs;
create policy quotation_designs_select on quotation_designs
  for select to authenticated using (company_id = get_current_company_id());
drop policy if exists quotation_designs_insert on quotation_designs;
create policy quotation_designs_insert on quotation_designs
  for insert to authenticated
  with check (company_id = get_current_company_id() and is_current_user_active());
drop policy if exists quotation_designs_update on quotation_designs;
create policy quotation_designs_update on quotation_designs
  for update to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());
drop policy if exists quotation_designs_delete on quotation_designs;
create policy quotation_designs_delete on quotation_designs
  for delete to authenticated
  using (company_id = get_current_company_id() and is_current_user_active());
grant select, insert, delete on quotation_designs to authenticated;
grant update (project_id, title, template, doc, updated_at) on quotation_designs to authenticated;
grant all on quotation_designs to service_role;

-- A project from another studio is never attached (the same guard 0294 put
-- on invoices).
create or replace function quotation_designs_same_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.project_id is not null and not exists (
       select 1 from projects where id = new.project_id and company_id = new.company_id) then
    raise exception 'That project is not in this studio.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists quotation_designs_same_company on quotation_designs;
create trigger quotation_designs_same_company
  before insert or update on quotation_designs
  for each row execute function quotation_designs_same_company();

-- ── The plan limit: Starter designs 30 a plan year ──────────────────
update plans
   set limits = jsonb_set(limits, '{designs}', '30'::jsonb),
       updated_at = now()
 where key in ('starter_yearly', 'starter_monthly', 'starter_yearly_regular', 'starter_monthly_regular');

-- company_usage and enforce_plan_limit copied from 0289 with 'designs' added.
create or replace function company_usage(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with w as (select starts from plan_window(p_company))
  select jsonb_build_object(
    'projects', (select count(*) from projects, w where company_id = p_company and created_at >= w.starts),
    'invoices', (select count(*) from invoices, w where company_id = p_company and created_at >= w.starts),
    'leads', (select count(*) from crm_leads where company_id = p_company and not is_archived and merged_into is null),
    'team_logins', (select count(*) from users u join companies c on c.id = u.company_id
                     where u.company_id = p_company and u.login_enabled and u.status <> 'inactive'
                       and u.user_id is distinct from c.owner_user_id),
    'team_members', (select count(*) from users u join companies c on c.id = u.company_id
                      where u.company_id = p_company and not u.login_enabled and u.status <> 'inactive'
                        and u.user_id is distinct from c.owner_user_id),
    'enquiry_forms', (select count(*) from enquiry_forms where company_id = p_company and archived_at is null),
    'facebook_pages', (select count(*) from fb_pages where company_id = p_company and is_connected),
    'packages', (select count(*) from project_templates where company_id = p_company and not is_sample),
    -- 0295: quotation designs made in the plan year.
    'designs', (select count(*) from quotation_designs, w where company_id = p_company and created_at >= w.starts),
    'storage_mb', (select coalesce(ceil(sum(size_bytes) / 1048576.0), 0)::int from files where company_id = p_company)
  )
$$;

create or replace function enforce_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key    text := tg_argv[0];
  v_limit  int;
  v_used   int;
  v_plan   plans;
  v_w      record;
  v_per    text;
  v_again  text;
  v_words  text;
  v_owner  uuid;
begin
  -- Only the rows a limit is about.
  if v_key in ('team_logins', 'team_members') then
    select owner_user_id into v_owner from companies where id = new.company_id;
    if new.status = 'inactive' or new.user_id is not distinct from v_owner then
      return new;
    end if;
    if (v_key = 'team_logins') <> new.login_enabled then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.status <> 'inactive' and old.login_enabled = new.login_enabled then
      return new;
    end if;
  elsif v_key = 'leads' then
    -- 0289: every lead counts, from any source; an update counts only when it
    -- brings an archived lead back.
    if tg_op = 'UPDATE' and not (old.is_archived and not new.is_archived) then
      return new;
    end if;
    if new.is_archived or new.merged_into is not null then
      return new;
    end if;
  elsif v_key = 'enquiry_forms' then
    if new.archived_at is not null or (tg_op = 'UPDATE' and old.archived_at is null) then
      return new;
    end if;
  elsif v_key = 'facebook_pages' then
    if not new.is_connected or (tg_op = 'UPDATE' and old.is_connected) then
      return new;
    end if;
  elsif v_key = 'packages' then
    if new.is_sample then
      return new;
    end if;
  end if;

  v_plan := company_plan(new.company_id);
  v_limit := nullif(v_plan.limits ->> v_key, '')::int;
  if v_limit is null then
    return new;
  end if;
  v_used := coalesce((company_usage(new.company_id) ->> v_key)::int, 0);
  if v_key = 'storage_mb' then
    if (v_used + ceil(new.size_bytes / 1048576.0)) <= v_limit then
      return new;
    end if;
  elsif v_used < v_limit then
    return new;
  end if;

  select * into v_w from plan_window(new.company_id);
  v_per := case when v_w.period_days < 300 then 'a month' else 'a year' end;
  v_again := to_char(v_w.ends at time zone 'Asia/Kolkata', 'FMDD Mon YYYY');
  v_words := case v_key
    when 'projects' then format('Your %s plan makes %s projects %s; the count starts again on %s.', v_plan.name, v_limit, v_per, v_again)
    when 'invoices' then format('Your %s plan makes %s GST invoices %s; the count starts again on %s.', v_plan.name, v_limit, v_per, v_again)
    when 'leads' then format('Your %s plan holds %s leads at a time. Archive or delete a lead to make room.', v_plan.name, v_limit)
    when 'team_logins' then format('Your %s plan has %s team logins.', v_plan.name, v_limit)
    when 'team_members' then format('Your %s plan has %s team members without a login.', v_plan.name, v_limit)
    when 'enquiry_forms' then format('Your %s plan has %s enquiry forms.', v_plan.name, v_limit)
    when 'facebook_pages' then format('Your %s plan connects %s Facebook Page.', v_plan.name, v_limit)
    when 'packages' then format('Your %s plan saves %s packages.', v_plan.name, v_limit)
    when 'storage_mb' then format('Your %s plan keeps %s GB of uploads.', v_plan.name, round(v_limit / 1024.0, 1))
    when 'designs' then format('Your %s plan designs %s quotations %s; the count starts again on %s.', v_plan.name, v_limit, v_per, v_again)
    else format('Your %s plan has reached its limit.', v_plan.name)
  end;
  raise exception '% Upgrade to add more.', v_words using errcode = '54000';
end;
$$;

drop trigger if exists quotation_designs_plan_limit on quotation_designs;
create trigger quotation_designs_plan_limit
  before insert on quotation_designs
  for each row execute function enforce_plan_limit('designs');
