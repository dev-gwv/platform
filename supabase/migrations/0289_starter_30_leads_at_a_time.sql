-- 0289: Starter holds 30 leads at a time, from every source (owner, 29 Oct:
-- "They should be able to store 30 leads at any point in time. The maximum
-- in the starter plan is to store 30 leads only, from Meta or from any other
-- place.").
--
-- Until now Starter took 300 leads a plan year, and only leads typed in or
-- imported were ever stopped: an enquiry form, a QR or Facebook always got
-- in. Now:
--   * Every Starter row (Diamond and regular, yearly and monthly) carries
--     leads = 30, and its card says "30 leads at a time".
--   * The count is the leads the studio holds now -- not archived, not merged
--     into another -- never a yearly tally. Archiving or deleting a lead makes
--     room; bringing an archived lead back counts again.
--   * Every source is held to it: typed in, imported, the enquiry form and
--     its QR codes, Facebook and WhatsApp. The API keeps a refused Facebook
--     lead in the import log (Retry once there is room), tells the person on
--     the form to call the studio, and rings the owner's bell once a day
--     (plan_full_notice below).
-- Pro, Studio Max, a trial and a platform admin's studio (0288) have no lead
-- limit and are untouched. enforce_plan_limit and company_usage are copied
-- from 0242, their latest definitions, with only the lead parts changed.

update plans
   set limits = jsonb_set(limits, '{leads}', '30'::jsonb),
       features = jsonb_build_array('30 projects · 30 invoices a year', '30 leads at a time', '3 team logins · 10 crew'),
       updated_at = now()
 where key in ('starter_yearly', 'starter_monthly', 'starter_yearly_regular', 'starter_monthly_regular');

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
    else format('Your %s plan has reached its limit.', v_plan.name)
  end;
  raise exception '% Upgrade to add more.', v_words using errcode = '54000';
end;
$$;

-- An archived lead brought back takes a place too.
drop trigger if exists crm_leads_plan_limit_unarchive on crm_leads;
create trigger crm_leads_plan_limit_unarchive before update of is_archived on crm_leads
  for each row when (old.is_archived and not new.is_archived)
  execute function enforce_plan_limit('leads');

-- The owner hears once a day that a lead was turned away because the plan is
-- full. Called by the API after a refusal (the refused insert's own
-- transaction is gone by then). p_what names the lead or where it came from.
create or replace function plan_full_notice(p_company uuid, p_what text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_limit int;
begin
  select c.owner_user_id into v_owner from companies c where c.id = p_company;
  if v_owner is null then return; end if;
  v_limit := nullif((company_plan(p_company)).limits ->> 'leads', '')::int;
  insert into notifications (company_id, recipient_uid, type, title, body, entity_type, entity_id, dedupe_key)
  values (p_company, v_owner, 'plan_limit', 'A new lead could not be saved',
          format('%s came in, but your plan holds %s leads at a time. Archive or delete a lead, or upgrade, to make room.',
                 coalesce(nullif(trim(p_what), ''), 'A lead'), coalesce(v_limit::text, 'its')),
          null, null,
          'plan_full:leads:' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD'))
  on conflict do nothing;
end;
$$;
revoke all on function plan_full_notice(uuid, text) from public, anon, authenticated;
grant execute on function plan_full_notice(uuid, text) to service_role;

-- The company behind a public form key (as enquiry_resolve finds it), for the
-- notice above.
create or replace function enquiry_form_company(p_key text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select f.company_id from enquiry_forms f
      where (f.code = lower(trim(p_key)) or f.slug = lower(trim(p_key))) and f.archived_at is null limit 1),
    (select p.company_id from enquiry_partners p where p.code = lower(trim(p_key)) limit 1))
$$;
revoke all on function enquiry_form_company(text) from public, anon, authenticated;
grant execute on function enquiry_form_company(text) to service_role;
