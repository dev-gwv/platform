-- 0227: step 3 of the next phase.
--
--   1. Quotation terms presets belong to the studio, not to one browser. They
--      lived in localStorage, so a partner on another laptop never saw them.
--      One preset can be the studio's default: a project with no terms of its
--      own shows it instead of the built-in list.
--   2. One deliverable from several shoots ("Highlights from Haldi + Wedding").
--      deliverable_shoot_links (0006) has been there since the start and
--      nothing wrote it after 0161 went to one shoot per deliverable.
--      set_deliverable_shoots() is the one way to set the list; shoot_id stays
--      the last of them, so every screen that reads one shoot still works.
--   3. Email copies of a team member's alerts: an alert still unread fifteen
--      minutes after it was made goes out by email too, once, on the hourly
--      cron. alert_email_due() / alert_email_mark() are service-only.

-- ── 1. Quotation terms presets ────────────────────────────────────
create table if not exists quotation_terms_presets (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade default get_current_company_id(),
  title       text not null check (length(btrim(title)) between 1 and 80),
  body        text not null check (length(body) between 1 and 10000),
  is_default  boolean not null default false,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists quotation_terms_presets_title_uidx
  on quotation_terms_presets (company_id, lower(btrim(title)));
-- At most one default per studio.
create unique index if not exists quotation_terms_presets_default_uidx
  on quotation_terms_presets (company_id) where is_default;
drop trigger if exists quotation_terms_presets_set_updated_at on quotation_terms_presets;
create trigger quotation_terms_presets_set_updated_at before update on quotation_terms_presets
  for each row execute function set_updated_at();

alter table quotation_terms_presets enable row level security;
drop policy if exists quotation_terms_presets_select on quotation_terms_presets;
create policy quotation_terms_presets_select on quotation_terms_presets
  for select to authenticated
  using (company_id = get_current_company_id());
-- Whoever can write a quotation's terms (admins and managers) keeps the list.
drop policy if exists quotation_terms_presets_write on quotation_terms_presets;
create policy quotation_terms_presets_write on quotation_terms_presets
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_admin_or_manager())
  with check (company_id = get_current_company_id() and is_current_admin_or_manager());
grant select, insert, update, delete on quotation_terms_presets to authenticated;

-- Make one preset the default (null clears it). Two statements under one
-- lock, so the unique index never sees two defaults.
create or replace function set_default_quotation_terms(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
begin
  if not is_current_admin_or_manager() then
    raise exception 'Only an owner or manager can change the default terms.' using errcode = '42501';
  end if;
  if p_id is not null and not exists (
    select 1 from quotation_terms_presets where id = p_id and company_id = v_company
  ) then
    raise exception 'That preset was not found.' using errcode = 'P0002';
  end if;
  update quotation_terms_presets set is_default = false
   where company_id = v_company and is_default and id is distinct from p_id;
  if p_id is not null then
    update quotation_terms_presets set is_default = true where id = p_id and not is_default;
  end if;
end;
$$;
revoke all on function set_default_quotation_terms(uuid) from public, anon;
grant execute on function set_default_quotation_terms(uuid) to authenticated;

-- ── 2. One deliverable, several shoots ────────────────────────────
-- The list lives in deliverable_shoot_links only when there are two or more;
-- with one shoot it is just deliverables.shoot_id, as before. shoot_id is
-- always the LAST of them (the edit starts once everything is shot), and
-- start_rule says 'specific_shoots' while there are several.
create or replace function set_deliverable_shoots(p_deliverable uuid, p_shoot_ids uuid[])
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project uuid;
  v_ids     uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_shoot_ids, '{}')) x where x is not null), '{}');
  v_last    uuid;
  v_found   int;
begin
  select project_id into v_project from deliverables where id = p_deliverable;
  if v_project is null then
    raise exception 'That deliverable was not found.' using errcode = 'P0002';
  end if;

  select count(*) into v_found from shoots where id = any (v_ids) and project_id = v_project;
  if v_found <> cardinality(v_ids) then
    raise exception 'Pick shoots from this project.' using errcode = '23514';
  end if;

  select s.id into v_last
    from shoots s
   where s.id = any (v_ids)
   order by s.shoot_date desc nulls last, s.created_at desc
   limit 1;

  perform set_config('ipc.deliverable_shoots', 'on', true);
  delete from deliverable_shoot_links where deliverable_id = p_deliverable;
  if cardinality(v_ids) >= 2 then
    insert into deliverable_shoot_links (company_id, deliverable_id, shoot_id)
      select d.company_id, d.id, x from deliverables d, unnest(v_ids) x where d.id = p_deliverable;
  end if;
  update deliverables
     set shoot_id = v_last,
         start_rule = case
                        when cardinality(v_ids) >= 2 then 'specific_shoots'
                        when start_rule = 'specific_shoots' then 'whole_project'
                        else start_rule
                      end
   where id = p_deliverable;
  perform set_config('ipc.deliverable_shoots', 'off', true);
  return v_last;
end;
$$;
revoke all on function set_deliverable_shoots(uuid, uuid[]) from public, anon;
grant execute on function set_deliverable_shoots(uuid, uuid[]) to authenticated;

-- A shoot_id changed any other way (an older screen, the bulk bar) means one
-- shoot again, so the list goes. A deleted shoot is the exception: its FK
-- sets shoot_id to null, and the next of the remaining shoots takes its place.
create or replace function deliverables_shoot_links_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left int;
begin
  if coalesce(current_setting('ipc.deliverable_shoots', true), '') = 'on'
     or new.shoot_id is not distinct from old.shoot_id then
    return new;
  end if;

  if new.shoot_id is null and old.shoot_id is not null
     and not exists (select 1 from shoots where id = old.shoot_id) then
    select count(*) into v_left
      from deliverable_shoot_links l join shoots s on s.id = l.shoot_id
     where l.deliverable_id = new.id and l.shoot_id <> old.shoot_id;
    select l.shoot_id into new.shoot_id
      from deliverable_shoot_links l join shoots s on s.id = l.shoot_id
     where l.deliverable_id = new.id and l.shoot_id <> old.shoot_id
     order by s.shoot_date desc nulls last, s.created_at desc
     limit 1;
    if v_left >= 2 then
      return new;
    end if;
  end if;

  delete from deliverable_shoot_links where deliverable_id = new.id;
  if new.start_rule = 'specific_shoots' then
    new.start_rule := 'whole_project';
  end if;
  return new;
end;
$$;

drop trigger if exists deliverables_shoot_links_sync on deliverables;
create trigger deliverables_shoot_links_sync
  before update of shoot_id on deliverables
  for each row execute function deliverables_shoot_links_sync();

-- ── 3. Email copies of a team member's alerts ─────────────────────
-- On by default; anyone can turn their own off on My profile.
alter table users add column if not exists alert_emails boolean not null default true;

create or replace function set_my_alert_emails(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on boolean;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  update users set alert_emails = coalesce(p_on, true)
   where user_id = auth.uid() and company_id = get_current_company_id() and deleted_at is null
  returning alert_emails into v_on;
  return coalesce(v_on, coalesce(p_on, true));
end;
$$;
revoke all on function set_my_alert_emails(boolean) from public, anon;
grant execute on function set_my_alert_emails(boolean) to authenticated;

-- One email row per alert, ever.
create unique index if not exists notification_deliveries_email_uidx
  on notification_deliveries (notification_id) where channel = 'email';

-- The alerts a person should hear about by email: the work given to them and
-- the work they are late on. Still unread and not dismissed fifteen minutes
-- on, made in the last day, never emailed, to a person still active in that
-- studio who has not turned the copies off and whose email is a real address
-- (a made-up team login under .test / example.com never gets one).
create or replace function alert_email_due(p_limit int default 500)
returns table (
  notification_id uuid,
  company_id      uuid,
  studio_name     text,
  recipient_uid   uuid,
  email           text,
  name            text,
  type            text,
  title           text,
  body            text,
  deep_link       text,
  created_at      timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.company_id, c.name, n.recipient_uid, u.email, u.name,
         n.type, n.title, n.body, n.deep_link, n.created_at
    from notifications n
    join users u on u.user_id = n.recipient_uid and u.company_id = n.company_id
    join companies c on c.id = n.company_id
   where n.type in (
           'shoot_assigned', 'shoot_tomorrow',
           'task.assigned', 'task.status', 'task.overdue', 'task_start',
           'deliverable_start',
           'data.pending', 'data.backup_pending', 'data.handover',
           'allocation.conflict'
         )
     and n.read_at is null
     and n.dismissed_at is null
     and n.created_at <= now() - interval '15 minutes'
     and n.created_at >  now() - interval '1 day'
     and u.status = 'active'
     and u.deleted_at is null
     and u.alert_emails
     and u.email ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'
     and u.email !~* '@(([^@]*\.)?example\.(com|org|net)|[^@]*\.(test|example|invalid|localhost|local))$'
     and not exists (
       select 1 from notification_deliveries d where d.notification_id = n.id and d.channel = 'email'
     )
   order by n.recipient_uid, n.created_at
   limit greatest(coalesce(p_limit, 500), 1);
$$;
revoke all on function alert_email_due(int) from public, anon, authenticated;
grant execute on function alert_email_due(int) to service_role;

-- Claim the alerts before the email goes, so two overlapping ticks never
-- send one twice. Returns the ids this call claimed; the sender then records
-- whether the email went with alert_email_result().
create or replace function alert_email_mark(p_ids uuid[])
returns setof uuid
language sql
security definer
set search_path = public
as $$
  insert into notification_deliveries (notification_id, channel, status)
    select x, 'email', 'pending' from unnest(coalesce(p_ids, '{}')) x
  on conflict (notification_id) where channel = 'email' do nothing
  returning notification_id;
$$;
revoke all on function alert_email_mark(uuid[]) from public, anon, authenticated;
grant execute on function alert_email_mark(uuid[]) to service_role;

create or replace function alert_email_result(p_ids uuid[], p_status text)
returns void
language sql
security definer
set search_path = public
as $$
  update notification_deliveries
     set status = case when p_status in ('sent', 'failed', 'provider_missing') then p_status else 'failed' end
   where channel = 'email' and notification_id = any (coalesce(p_ids, '{}'));
$$;
revoke all on function alert_email_result(uuid[], text) from public, anon, authenticated;
grant execute on function alert_email_result(uuid[], text) to service_role;
