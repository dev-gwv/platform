-- 0242: plans matched to the market. Projects count per financial year
-- (1 April, India time). Starter: 30 projects a year, 3 team logins. Pro: no
-- project limit, 10 team logins, the plan most studios should pick. Studio
-- Max: unlimited, with white-label, the studio's own WhatsApp and automatic
-- sequences. Invoices, enquiry forms, leads and crew are never limited.
-- The plans stay switched off (is_active = false) until the owner puts them live.
--
-- company_usage and enforce_plan_limit are copied from 0241 with the
-- projects_per_year key added; 0241's monthly keys still work for any plan
-- that writes them.

-- What a studio has made this month and this financial year (India), and has now.
create or replace function company_usage(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with t as (select (now() at time zone 'Asia/Kolkata') as ist),
  m as (
    select (date_trunc('month', t.ist) at time zone 'Asia/Kolkata') as starts,
           (make_date(extract(year from t.ist)::int - case when extract(month from t.ist) < 4 then 1 else 0 end, 4, 1)::timestamp
              at time zone 'Asia/Kolkata') as fy_starts
      from t
  )
  select jsonb_build_object(
    'projects_per_month', (select count(*) from projects, m where company_id = p_company and created_at >= m.starts),
    'projects_per_year', (select count(*) from projects, m where company_id = p_company and created_at >= m.fy_starts),
    'invoices_per_month', (select count(*) from invoices, m where company_id = p_company and created_at >= m.starts),
    'team_logins', (select count(*) from users u join companies c on c.id = u.company_id
                     where u.company_id = p_company and u.login_enabled and u.status <> 'inactive'
                       and u.user_id <> c.owner_user_id),
    'enquiry_forms', (select count(*) from enquiry_forms where company_id = p_company and archived_at is null)
  )
$$;
revoke all on function company_usage(uuid) from public, anon;
grant execute on function company_usage(uuid) to authenticated, service_role;

create or replace function enforce_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key   text := tg_argv[0];
  v_limit int;
  v_used  int;
  v_plan  plans;
  v_words text;
begin
  -- A team member counts only when they can sign in, and not the owner.
  if v_key = 'team_logins' then
    if not new.login_enabled or new.status = 'inactive'
       or new.user_id = (select owner_user_id from companies where id = new.company_id) then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.login_enabled and old.status <> 'inactive' then
      return new;
    end if;
  end if;

  v_plan := company_plan(new.company_id);
  v_limit := nullif(v_plan.limits ->> v_key, '')::int;
  if v_limit is null then
    return new;
  end if;
  v_used := (company_usage(new.company_id) ->> v_key)::int;
  if v_used >= v_limit then
    v_words := case v_key
      when 'projects_per_month' then format('Your %s plan makes %s projects a month.', v_plan.name, v_limit)
      when 'projects_per_year' then format('Your %s plan makes %s projects a year (April to March).', v_plan.name, v_limit)
      when 'invoices_per_month' then format('Your %s plan makes %s invoices a month.', v_plan.name, v_limit)
      when 'team_logins' then format('Your %s plan has %s team logins.', v_plan.name, v_limit)
      when 'enquiry_forms' then format('Your %s plan has %s enquiry forms.', v_plan.name, v_limit)
    end;
    raise exception '% Upgrade to add more.', v_words using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_plan_limit_year on projects;
create trigger projects_plan_limit_year before insert on projects
  for each row execute function enforce_plan_limit('projects_per_year');

-- Starter is a real studio's first season; a working studio outgrows it in
-- its first wedding season and moves to Pro.
update plans
   set limits = '{"projects_per_year":30,"team_logins":3}'::jsonb,
       badge = null,
       description = 'For a studio starting out: up to 30 projects a year.',
       features = jsonb_build_array('30 projects a year', '3 team logins', 'Unlimited leads, invoices and crew')
 where key in ('starter_yearly', 'starter_monthly');

update plans
   set limits = '{"team_logins":10}'::jsonb,
       badge = case when key = 'pro_yearly' then 'Most popular' else null end,
       description = 'For a working studio: no project limit.',
       features = jsonb_build_array('Unlimited projects', '10 team logins', 'Unlimited leads, invoices, crew and enquiry forms')
 where key in ('pro_yearly', 'pro_monthly');

update plans
   set limits = '{}'::jsonb,
       description = 'Your own brand and WhatsApp number, and no limits at all.',
       features = jsonb_build_array(
         'Everything in Pro, with unlimited team logins',
         'Emails in your own name (white-label)',
         'Your own WhatsApp number, set up with you',
         'Follow-ups that send themselves',
         'Priority help on WhatsApp')
 where key in ('max_yearly', 'max_monthly');
