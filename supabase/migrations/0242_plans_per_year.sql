-- 0242: plans counted from each studio's own billing date.
--
-- A studio's plan year starts the day it pays: pay on 15 Oct and Starter's
-- 30 projects run to 14 Oct, then start again. A monthly plan carries the
-- yearly numbers pro rata for each 30-day pass (written on its own row).
-- Upgrading part-way costs only the difference: what is left of the current
-- plan is taken off the new one, and the new plan year starts that day. A
-- lower plan waits until the current one ends.
--
-- Starter's limits (docs/plans.md): projects, invoices and leads in the plan
-- year; team logins, team without a login, enquiry forms, Facebook Pages,
-- saved packages and uploads as they stand. Pro and Studio Max are unlimited.
-- Leads that arrive by themselves (forms, Facebook, WhatsApp) are never
-- refused; only adding by hand or by import stops at the limit.
--
-- company_usage, enforce_plan_limit and my_plan_usage are copied from 0241
-- with the new keys; activate_subscription from 0241, create_payment_order
-- from 0214 and platform_assign_plan from 0226. The plans stay switched off
-- (is_active = false) until the owner puts them live.

-- ── the plan year ────────────────────────────────────────────────────
alter table companies add column if not exists plan_period_start timestamptz;

-- The window of the plan year (or 30-day pass) that holds now: the anchor
-- plus whole periods. Without an anchor, the paid period counts back from
-- its end; without a plan, the last year.
create or replace function plan_window(p_company uuid)
returns table (starts timestamptz, ends timestamptz, period_days int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days   int;
  v_anchor timestamptz;
  v_n      int;
begin
  select coalesce(p.duration_days, case when p.billing_interval = 'monthly' then 30 else 365 end),
         coalesce(c.plan_period_start,
                  c.plan_expiry - make_interval(days => coalesce(p.duration_days, case when p.billing_interval = 'monthly' then 30 else 365 end)))
    into v_days, v_anchor
    from companies c left join plans p on p.key = c.plan
   where c.id = p_company;
  if v_days is null or v_anchor is null then
    return query select now() - interval '365 days', now(), 365;
    return;
  end if;
  v_n := greatest(0, floor(extract(epoch from (now() - v_anchor)) / (v_days * 86400.0))::int);
  return query select v_anchor + make_interval(days => v_n * v_days),
                      v_anchor + make_interval(days => (v_n + 1) * v_days),
                      v_days;
end;
$$;
revoke all on function plan_window(uuid) from public, anon;
grant execute on function plan_window(uuid) to authenticated, service_role;

-- ── how a lead arrived ───────────────────────────────────────────────
-- manual: added by a signed-in person (Add lead); import: a CSV; auto: a
-- form, Facebook, WhatsApp or a referral. Only manual and import are ever
-- refused by a plan.
alter table crm_leads add column if not exists created_via text
  check (created_via is null or created_via in ('manual', 'import', 'auto'));

create or replace function crm_leads_set_created_via()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.created_via is null then
    new.created_via := case
      when auth.uid() is null then 'auto'
      when new.source_key = 'csv_import' then 'import'
      when new.source_key is null then 'manual'
      else 'auto'
    end;
  end if;
  return new;
end;
$$;
-- Named to sort before crm_leads_plan_limit: same-timing triggers fire by name.
drop trigger if exists crm_leads_0_created_via on crm_leads;
create trigger crm_leads_0_created_via before insert on crm_leads
  for each row execute function crm_leads_set_created_via();

-- ── what a studio has used ───────────────────────────────────────────
-- Projects, invoices and leads in the plan year; the rest as they stand.
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
    'leads', (select count(*) from crm_leads, w where company_id = p_company and created_at >= w.starts),
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
revoke all on function company_usage(uuid) from public, anon;
grant execute on function company_usage(uuid) to authenticated, service_role;

-- The room left under one limit; null when there is none. For checks that
-- must run before something outside the database is done (a Facebook Page
-- is subscribed on Facebook before its row is connected).
create or replace function plan_room(p_company uuid, p_key text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
           when (company_plan(p_company)).limits ->> p_key is null then null
           else greatest(0, ((company_plan(p_company)).limits ->> p_key)::int - coalesce((company_usage(p_company) ->> p_key)::int, 0))
         end
$$;
revoke all on function plan_room(uuid, text) from public, anon;
grant execute on function plan_room(uuid, text) to authenticated, service_role;

-- The studio's own plan, limits, usage and plan year, for its Subscription page.
create or replace function my_plan_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_plan    plans;
  v_w       record;
begin
  if v_company is null then
    raise exception 'no studio' using errcode = '42501';
  end if;
  v_plan := company_plan(v_company);
  select * into v_w from plan_window(v_company);
  return jsonb_build_object(
    'plan_key', v_plan.key,
    'plan_name', v_plan.name,
    'tier', v_plan.tier,
    'limits', coalesce(v_plan.limits, '{}'::jsonb),
    'includes', to_jsonb(coalesce(v_plan.includes, '{}')),
    'used', company_usage(v_company),
    'window_starts', case when v_plan.key is null then null else v_w.starts end,
    'window_ends', case when v_plan.key is null then null else v_w.ends end,
    'period', case when v_w.period_days < 300 then 'month' else 'year' end
  );
end;
$$;
revoke all on function my_plan_usage() from public, anon;
grant execute on function my_plan_usage() to authenticated;

-- ── the check, as a row is made ──────────────────────────────────────
-- Raises 54000 (program_limit_exceeded) with a sentence the studio can read;
-- the API turns it into 402 with an Upgrade button.
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
    if new.created_via not in ('manual', 'import') then
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
    when 'leads' then format('Your %s plan takes %s leads %s. Enquiries from your forms and Facebook still come in.', v_plan.name, v_limit, v_per)
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

-- 0241's monthly and 0242's first financial-year triggers give way to these.
drop trigger if exists projects_plan_limit on projects;
drop trigger if exists projects_plan_limit_year on projects;
create trigger projects_plan_limit before insert on projects
  for each row execute function enforce_plan_limit('projects');
drop trigger if exists invoices_plan_limit on invoices;
create trigger invoices_plan_limit before insert on invoices
  for each row execute function enforce_plan_limit('invoices');
drop trigger if exists crm_leads_plan_limit on crm_leads;
create trigger crm_leads_plan_limit before insert on crm_leads
  for each row execute function enforce_plan_limit('leads');
drop trigger if exists users_plan_limit on users;
create trigger users_plan_limit before insert or update of login_enabled, status on users
  for each row execute function enforce_plan_limit('team_logins');
drop trigger if exists users_plan_limit_members on users;
create trigger users_plan_limit_members before insert or update of login_enabled, status on users
  for each row execute function enforce_plan_limit('team_members');
drop trigger if exists enquiry_forms_plan_limit on enquiry_forms;
create trigger enquiry_forms_plan_limit before insert or update of archived_at on enquiry_forms
  for each row execute function enforce_plan_limit('enquiry_forms');
drop trigger if exists fb_pages_plan_limit on fb_pages;
create trigger fb_pages_plan_limit before insert or update of is_connected on fb_pages
  for each row execute function enforce_plan_limit('facebook_pages');
drop trigger if exists project_templates_plan_limit on project_templates;
create trigger project_templates_plan_limit before insert on project_templates
  for each row execute function enforce_plan_limit('packages');
drop trigger if exists files_plan_limit on files;
create trigger files_plan_limit before insert on files
  for each row execute function enforce_plan_limit('storage_mb');

-- ── buying, renewing and upgrading ───────────────────────────────────
alter table payment_orders
  add column if not exists kind text not null default 'buy' check (kind in ('buy', 'renew', 'upgrade')),
  -- What was left of the plan being upgraded from, before GST.
  add column if not exists credit numeric(12, 2) not null default 0;

-- What paying for a plan would mean for this studio now:
--   buy     no plan is running; it starts today.
--   renew   the same plan (or the same tier, the other way of paying); it
--           continues from the current end.
--   upgrade a higher tier; what is left of the current plan comes off the
--           price, and the new plan year starts today.
--   later   a lower tier, or a plan worth less than what is left; it can
--           be bought once the current plan ends (blocked_until).
create or replace function plan_quote(p_company uuid, p_plan uuid)
returns table (kind text, price numeric, credit numeric, amount numeric, current_name text, blocked_until timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_new    plans;
  v_cur    plans;
  v_expiry timestamptz;
  v_days   numeric;
  v_left   numeric;
  v_credit numeric;
  r_new    int;
  r_cur    int;
begin
  select * into v_new from plans where id = p_plan;
  if not found then
    raise exception 'unknown plan' using errcode = '42501';
  end if;
  select c.plan_expiry into v_expiry from companies c where c.id = p_company;
  select p.* into v_cur from companies c join plans p on p.key = c.plan where c.id = p_company;
  if v_expiry is null or v_expiry <= now() or v_cur.id is null then
    return query select 'buy'::text, v_new.price, 0::numeric, round(v_new.price * 1.18, 2), null::text, null::timestamptz;
    return;
  end if;
  if v_cur.key = v_new.key or (v_cur.tier is not null and v_cur.tier = v_new.tier) then
    return query select 'renew'::text, v_new.price, 0::numeric, round(v_new.price * 1.18, 2), v_cur.name, null::timestamptz;
    return;
  end if;
  r_new := case v_new.tier when 'starter' then 1 when 'pro' then 2 when 'max' then 3 else 0 end;
  r_cur := case v_cur.tier when 'starter' then 1 when 'pro' then 2 when 'max' then 3 else 0 end;
  v_days := coalesce(v_cur.duration_days, case when v_cur.billing_interval = 'monthly' then 30 else 365 end);
  v_left := greatest(0, extract(epoch from (v_expiry - now())) / 86400.0);
  v_credit := round(v_cur.price * least(1, v_left / v_days), 2);
  if r_new <= r_cur or v_credit >= v_new.price then
    return query select 'later'::text, v_new.price, 0::numeric, round(v_new.price * 1.18, 2), v_cur.name, v_expiry;
    return;
  end if;
  return query select 'upgrade'::text, v_new.price, v_credit, round((v_new.price - v_credit) * 1.18, 2), v_cur.name, null::timestamptz;
end;
$$;
revoke all on function plan_quote(uuid, uuid) from public, anon;
grant execute on function plan_quote(uuid, uuid) to authenticated, service_role;

-- Every plan this studio can see, with what paying would mean now.
create or replace function my_plan_quotes()
returns table (plan_id uuid, kind text, credit numeric, amount numeric, current_name text, blocked_until timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, q.kind, q.credit, q.amount, q.current_name, q.blocked_until
    from plans p
    join companies c on c.id = get_current_company_id()
    cross join lateral plan_quote(c.id, p.id) q
   where p.is_active and p.audience = c.member_tier
$$;
revoke all on function my_plan_quotes() from public, anon;
grant execute on function my_plan_quotes() to authenticated;

-- Copied from 0214; priced through plan_quote, and a lower plan waits.
create or replace function create_payment_order(p_plan_id uuid)
returns table (order_id uuid, amount numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_ok      boolean;
  v_q       record;
  v_name    text;
  v_id      uuid;
begin
  if not is_current_owner() then
    raise exception 'only the owner can start a subscription' using errcode = '42501';
  end if;
  select true, p.name into v_ok, v_name
    from plans p
    join companies c on c.id = v_company
   where p.id = p_plan_id and p.is_active and p.audience = c.member_tier;
  if v_ok is null then
    raise exception 'unknown plan' using errcode = '42501';
  end if;
  select * into v_q from plan_quote(v_company, p_plan_id);
  if v_q.kind = 'later' then
    raise exception 'Your % plan runs until %. You can move to % then.',
      v_q.current_name, to_char(v_q.blocked_until at time zone 'Asia/Kolkata', 'FMDD Mon YYYY'), v_name
      using errcode = '22023';
  end if;
  insert into payment_orders (company_id, plan_id, amount, created_by, kind, credit)
    values (v_company, p_plan_id, v_q.amount, auth.uid(), v_q.kind, v_q.credit)
    returning id into v_id;
  return query select v_id, v_q.amount;
end;
$$;

-- Copied from 0241. An upgrade starts its plan year today; a renewal
-- continues it; a purchase with nothing running starts today.
create or replace function activate_subscription(
  p_order_id   uuid,
  p_payment_id text
)
returns table (duplicate boolean, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   payment_orders;
  v_months  int := 1;
  v_days    int;
  v_key     text;
  v_expires timestamptz;
  v_base    timestamptz;
  v_running boolean;
begin
  select * into v_order from payment_orders where id = p_order_id for update;
  if not found then
    raise exception 'unknown order' using errcode = '42501';
  end if;
  if v_order.status = 'paid' then
    select cs.expires_at into v_expires from company_subscriptions cs
      where cs.company_id = v_order.company_id order by cs.expires_at desc limit 1;
    return query select true, v_expires;
    return;
  end if;

  select case when p.billing_interval = 'yearly' then 12 else 1 end, p.duration_days, p.key
    into v_months, v_days, v_key
    from plans p where p.id = v_order.plan_id;

  select coalesce(plan_expiry > now(), false) into v_running
    from companies where id = v_order.company_id for update;
  -- An upgrade starts now (what was left came off its price); anything else
  -- extends from the later of now / current expiry (no lost days).
  if v_order.kind = 'upgrade' then
    v_base := now();
  else
    select greatest(now(), coalesce(plan_expiry, now())) into v_base
      from companies where id = v_order.company_id;
  end if;
  -- A plan with its own duration_days wins over the monthly/yearly interval.
  v_expires := case
                 when v_days is not null then v_base + make_interval(days => v_days)
                 else v_base + make_interval(months => v_months)
               end;

  update payment_orders set status = 'paid' where id = p_order_id;
  insert into payment_transactions (order_id, company_id, razorpay_payment_id, amount)
    values (p_order_id, v_order.company_id, p_payment_id, v_order.amount);
  insert into company_subscriptions (company_id, plan_id, expires_at, order_id)
    values (v_order.company_id, v_order.plan_id, v_expires, p_order_id);
  update companies
     set plan_expiry = v_expires,
         plan = coalesce(v_key, plan),
         plan_period_start = case
           when v_order.kind = 'upgrade' or not v_running or plan_period_start is null then now()
           else plan_period_start
         end
   where id = v_order.company_id;
  insert into billing_events (company_id, kind, detail)
    values (v_order.company_id, 'subscription_activated',
            jsonb_build_object('order_id', p_order_id, 'kind', v_order.kind, 'credit', v_order.credit));

  return query select false, v_expires;
end;
$$;

-- Copied from 0226: a plan given by hand starts its plan year when the plan
-- changes (or nothing was running), and continues it otherwise.
create or replace function platform_assign_plan(p_company_id uuid, p_plan_key text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    plans;
  v_base    timestamptz;
  v_expires timestamptz;
  v_old     companies;
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  select * into v_plan from plans where key = p_plan_key;
  if not found then
    raise exception 'unknown plan' using errcode = '22023';
  end if;
  select * into v_old from companies where id = p_company_id for update;
  if not found then
    raise exception 'unknown studio' using errcode = '42501';
  end if;
  v_base := greatest(now(), coalesce(v_old.plan_expiry, now()));
  v_expires := case
                 when v_plan.duration_days is not null then v_base + make_interval(days => v_plan.duration_days)
                 when v_plan.billing_interval = 'yearly' then v_base + interval '12 months'
                 else v_base + interval '1 month'
               end;
  update companies
     set plan = v_plan.key,
         plan_expiry = v_expires,
         plan_period_start = case
           when v_old.plan is distinct from v_plan.key
             or v_old.plan_expiry is null or v_old.plan_expiry <= now()
             or v_old.plan_period_start is null then now()
           else v_old.plan_period_start
         end
   where id = p_company_id;
  insert into company_subscriptions (company_id, plan_id, expires_at)
    values (p_company_id, v_plan.id, v_expires);
  insert into billing_events (company_id, kind, detail)
    values (p_company_id, 'platform_plan_assigned',
            jsonb_build_object('plan', v_plan.key, 'by', auth.uid(), 'new_expiry', v_expires));
  return v_expires;
end;
$$;
revoke all on function platform_assign_plan(uuid, text) from public, anon;
grant execute on function platform_assign_plan(uuid, text) to authenticated;

-- ── the plans ────────────────────────────────────────────────────────
-- Free emails a month before credits are used (null: included, fair use).
alter table plans add column if not exists free_emails_month int
  check (free_emails_month is null or free_emails_month >= 0);

update plans
   set limits = case key
         when 'starter_yearly' then '{"projects":30,"invoices":60,"leads":300,"team_logins":3,"team_members":20,"enquiry_forms":2,"facebook_pages":1,"packages":3,"storage_mb":2048}'::jsonb
         else '{"projects":3,"invoices":5,"leads":25,"team_logins":3,"team_members":20,"enquiry_forms":2,"facebook_pages":1,"packages":3,"storage_mb":2048}'::jsonb
       end,
       badge = null,
       free_emails_month = 100,
       description = 'For a studio starting out.',
       features = case key
         when 'starter_yearly' then jsonb_build_array('30 projects a year', '3 team logins · 20 crew', 'WhatsApp & email from credits')
         else jsonb_build_array('3 projects a month', '3 team logins · 20 crew', 'WhatsApp & email from credits')
       end
 where key in ('starter_yearly', 'starter_monthly');

update plans
   set limits = '{}'::jsonb,
       badge = 'Most Popular',
       free_emails_month = 300,
       description = 'For a working studio.',
       features = jsonb_build_array('Unlimited projects, leads and team', 'WhatsApp & email from credits')
 where key in ('pro_yearly', 'pro_monthly');

update plans
   set limits = '{}'::jsonb,
       badge = null,
       free_emails_month = null,
       description = 'Your own brand in front of every client.',
       features = jsonb_build_array('Everything unlimited', 'Your own name and WhatsApp number', 'Priority help')
 where key in ('max_yearly', 'max_monthly');
